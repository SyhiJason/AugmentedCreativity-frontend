import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCandidates, decideEU, estimateTiming, pLevel } from "../../utils/calibration_tool.jsx";
import { locateEvidence } from "../../utils/rubric_tool.jsx";

// Runs the intervention policy: judged candidates -> present now / defer / stay silent.
// Candidate state lives in a ref (the tick loop is the single writer); `version` re-renders consumers.
export default function useProactiveFeedback({ judgments, flatGoals, editorText, editorRef, typing, condition, mediumMode, params, logEvent }) {
    const cands = useRef([]);
    const dismissed = useRef(new Set());
    const [version, bump] = useState(0);
    const [q, setQ] = useState(0);
    const [silenceLog, setSilenceLog] = useState([]);
    const stats = useRef({ shown: 0, lastShownAt: 0, lastFixedAt: Date.now() });
    const latest = useRef({});
    latest.current = { editorText, condition, mediumMode, params, logEvent };

    const pushSilence = useCallback((c, kind, p, qNow, reason) => {
        if (c.lastSilence === kind + reason) return;
        c.lastSilence = kind + reason;
        setSilenceLog(prev => [{ t: Date.now(), goal: c.goalText, dimension: c.dimensionLabel, kind, p, q: qNow, reason }, ...prev].slice(0, 50));
        latest.current.logEvent?.('feedback_silence', { id: c.id, kind, p, q: qNow, reason });
    }, []);

    // Merge freshly judged candidates into the queue (keeps status of ones we already know).
    useEffect(() => {
        if (!judgments) return;
        const fresh = buildCandidates(judgments.items, flatGoals, judgments.text).filter(c => !dismissed.current.has(c.id));
        const freshIds = new Set(fresh.map(c => c.id));
        const judgedGoals = new Set(judgments.items.map((it, i) => (it ? i : -1)).filter(i => i >= 0).map(i => flatGoals[i]?.path));
        const next = [];
        fresh.forEach(c => {
            const old = cands.current.find(o => o.id === c.id);
            next.push(old ? { ...old, ...c, status: old.status, queuedAt: old.queuedAt, lastSilence: old.lastSilence, counter: old.counter } : { ...c, status: 'queued', queuedAt: Date.now() });
        });
        // issues the judge no longer reports (for goals that were re-judged) are resolved
        cands.current.forEach(o => {
            if (!freshIds.has(o.id) && !judgedGoals.has(o.goalPath) && o.status !== 'dismissed') next.push(o);
            else if (!freshIds.has(o.id) && o.status === 'shown') latest.current.logEvent?.('feedback_resolved', { id: o.id });
        });
        cands.current = next;
        bump(v => v + 1);
    }, [judgments, flatGoals]);

    // Policy tick.
    useEffect(() => {
        const tick = () => {
            const { editorText: text, condition: cond, mediumMode: mm, params: prm } = latest.current;
            const now = Date.now();
            const qNow = estimateTiming(typing.snapshot(editorRef.current));
            setQ(qNow);
            let changed = false;
            const eligible = [];

            cands.current.forEach(c => {
                if (c.status === 'snoozed' && now >= c.snoozedUntil) { c.status = 'queued'; c.queuedAt = now; changed = true; }
                if (c.status !== 'queued') return;
                // staleness: the evidence the judgment relied on was edited away
                if (c.evidence.length && c.evidence.every(e => !locateEvidence(text, e.sentence))) {
                    c.status = 'expired'; changed = true;
                    latest.current.logEvent?.('feedback_discarded', { id: c.id, reason: 'stale_evidence' });
                    return;
                }
                if (now - c.queuedAt > prm.ttlMs) {
                    c.status = 'expired'; changed = true;
                    pushSilence(c, 'temporal', c.p, qNow, 'deferral expired');
                    return;
                }
                if (cond === 'passive') return;
                if (cond === 'eu') {
                    const d = decideEU(c.p, qNow, prm, mm);
                    if (d.action === 'show') eligible.push({ c, d, score: d.u.show });
                    else pushSilence(c, d.silence, c.p, qNow, d.reason);
                } else if (cond === 'reliability') {
                    if (c.p >= prm.relThreshold) eligible.push({ c, d: { hedged: c.p < prm.pHigh, u: {} }, score: c.p });
                    else pushSilence(c, 'epistemic', c.p, qNow, 'p below threshold');
                } else if (cond === 'timing') {
                    if (qNow >= prm.timingThreshold) eligible.push({ c, d: { hedged: c.p < prm.pHigh, u: {} }, score: c.severity });
                } else if (cond === 'fixed') {
                    if (now - stats.current.lastFixedAt >= prm.fixedCadenceMs) eligible.push({ c, d: { hedged: c.p < prm.pHigh, u: {} }, score: c.severity + c.p });
                }
            });

            if (eligible.length && now - stats.current.lastShownAt >= prm.cooldownMs && stats.current.shown < prm.budget) {
                eligible.sort((a, b) => b.score - a.score);
                const { c, d } = eligible[0];
                c.status = 'shown'; c.hedged = d.hedged; c.shownAt = now; c.manual = false; c.q = qNow;
                stats.current.shown += 1; stats.current.lastShownAt = now; stats.current.lastFixedAt = now;
                latest.current.logEvent?.('feedback_decision', { id: c.id, action: 'show', condition: cond, p: c.p, q: qNow, hedged: c.hedged, uShow: d.u.show ?? null, uDelay: d.u.delay ?? null });
                changed = true;
            } else if (eligible.length) {
                eligible.forEach(({ c }) => pushSilence(c, 'temporal', c.p, qNow, stats.current.shown >= prm.budget ? 'session budget used' : 'cooldown'));
            }
            if (changed) bump(v => v + 1);
        };
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [typing, editorRef, pushSilence]);

    const touch = (fn) => { fn(); bump(v => v + 1); };
    const find = (id) => cands.current.find(c => c.id === id);

    // "Not an issue": negative correctness label, suppressed for good.
    const dismiss = useCallback((id) => touch(() => {
        const c = find(id); if (!c) return;
        c.status = 'dismissed'; dismissed.current.add(id);
        latest.current.logEvent?.('feedback_action', { id, action: 'not_an_issue', p: c.p, q: c.q ?? null, manual: !!c.manual });
    }), []);

    // "Remind later": a negative timing label; comes back after snoozeMs.
    const snooze = useCallback((id) => touch(() => {
        const c = find(id); if (!c) return;
        c.status = 'snoozed'; c.snoozedUntil = Date.now() + latest.current.params.snoozeMs;
        latest.current.logEvent?.('feedback_action', { id, action: 'remind_later', p: c.p, q: c.q ?? null });
    }), []);

    // Goal revised: the judgment is re-run on the new goal, so retire this card.
    const markGoalRevised = useCallback((id) => touch(() => {
        const c = find(id); if (!c) return;
        c.status = 'handled';
        latest.current.logEvent?.('feedback_action', { id, action: 'revise_goal', p: c.p });
    }), []);

    const setCounter = useCallback((id, counter) => touch(() => {
        const c = find(id); if (!c) return;
        c.counter = counter;
        latest.current.logEvent?.('feedback_action', { id, action: 'counterexample' });
    }), []);

    // Explicit request for one goal: shown even when the policy would stay silent (author asked).
    // Low-p items are labelled as such rather than hidden.
    const requestGoal = useCallback((goalPath) => {
        const mine = cands.current.filter(c => c.goalPath === goalPath && ['queued', 'snoozed', 'shown'].includes(c.status));
        mine.forEach(c => { c.status = 'shown'; c.manual = true; c.hedged = c.p < latest.current.params.pHigh; c.shownAt = Date.now(); });
        if (mine.length) {
            latest.current.logEvent?.('feedback_decision', { action: 'show_on_request', goalPath, ids: mine.map(c => c.id) });
            bump(v => v + 1);
        }
        return mine.length;
    }, []);

    const shownCards = useMemo(() => cands.current.filter(c => c.status === 'shown').sort((a, b) => b.shownAt - a.shownAt), [version]); // eslint-disable-line react-hooks/exhaustive-deps

    // Per-goal level for the three-level alignment overview (no issue / possible / high-confidence).
    const goalLevels = useMemo(() => flatGoals.map((g, i) => {
        if (!judgments?.items[i]) return { level: 'pending' };
        const mine = cands.current.filter(c => c.goalPath === g.path && c.status !== 'dismissed' && c.status !== 'handled');
        if (!mine.length) return { level: 'none', top: null };
        const top = mine.reduce((a, b) => (b.p > a.p ? b : a));
        return { level: pLevel(top.p, latest.current.params) === 'high' ? 'high' : 'possible', top };
    }), [version, flatGoals, judgments]); // eslint-disable-line react-hooks/exhaustive-deps

    return { q, shownCards, goalLevels, silenceLog, shownCount: stats.current.shown, dismiss, snooze, markGoalRevised, setCounter, requestGoal };
}
