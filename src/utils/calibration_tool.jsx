// Calibrated intervention (paper §4.2–4.4).
//   p : probability that a majority of qualified annotators would endorse the feedback
//   q : probability that the current moment is appropriate for intervening, given valid feedback
// Both are produced by small, interpretable logistic models over low-latency features.
// The coefficients below are priors; they should be re-fit on Study 1 / Study 2 logs
// (feedback_decision + feedback_action events) and versioned with the base model / rubric.
import { DIMENSION_BY_ID, locateEvidence } from "./rubric_tool.jsx";

export const CALIBRATOR_VERSION = 'prior-0.1';
export const MIN_SEVERITY = 2; // below this the "problem" is treated as not holding

export const DEFAULT_PARAMS = {
    B: 1,              // benefit of a correct, timely intervention
    C_FP: 1,           // cost of a false positive
    C_INT: 0.6,        // cost of an ill-timed interruption
    gamma: 0.7,        // deferral discount
    C_obs: 0.1,        // risk cost of deferring (feedback may go stale)
    qNext: 0.75,       // predicted timing appropriateness at the next structural boundary (q-hat)
    pLow: 0.35,        // below: epistemic silence, always suppressed
    pHigh: 0.7,        // at/above: "high-confidence"; between pLow and pHigh: "possible"
    cooldownMs: 30000, // minimum gap between proactive presentations
    budget: 8,         // max proactive presentations per session
    ttlMs: 180000,     // deferred feedback expires after this long
    snoozeMs: 120000,  // "remind later"
    // baseline conditions (Study 2)
    fixedCadenceMs: 60000,
    relThreshold: 0.6,
    timingThreshold: 0.6,
};

export const CONDITIONS = [
    { id: 'eu', label: 'Expected-utility', hint: 'Joint p, q and costs (Eq. 1)' },
    { id: 'reliability', label: 'Reliability-only', hint: 'Speak whenever p exceeds a threshold' },
    { id: 'timing', label: 'Timing-only', hint: 'Speak whenever q exceeds a threshold' },
    { id: 'fixed', label: 'Fixed cadence', hint: 'Top-severity feedback at fixed intervals' },
    { id: 'passive', label: 'Passive', hint: 'Only on explicit request' },
];

export const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ---- p: reliability ---------------------------------------------------------
// Features come from the single judgment call (no extra LLM round trip).
export const reliabilityFeatures = (dim, text) => {
    const located = dim.evidence.map(e => locateEvidence(text, e.sentence)).filter(Boolean);
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return {
        severity: dim.severity / 5,
        evidenceVerified: dim.evidence.length ? located.length / dim.evidence.length : 0, // cited evidence really exists in the text
        rationaleOk: dim.rationale.trim().length >= 20 ? 1 : 0,
        actionConsistent: dim.suggestedAction !== 'none' && dim.problemType ? 1 : 0, // severity / action / problem type agree
        lengthFactor: clamp01(words / 150), // very short text -> little to judge on
    };
};

export const estimateReliability = (dim, text) => {
    const f = reliabilityFeatures(dim, text);
    const z = -3.0 + 1.4 * f.severity + 2.2 * f.evidenceVerified + 0.5 * f.rationaleOk + 0.4 * f.actionConsistent + 0.9 * f.lengthFactor;
    return { p: sigmoid(z), features: f };
};

export const pLevel = (p, params = DEFAULT_PARAMS) => (p >= params.pHigh ? 'high' : p >= params.pLow ? 'medium' : 'low');

// ---- q: timing appropriateness ---------------------------------------------
// Signals are observable behaviour + structural boundaries; we do NOT infer "confusion"/"focus".
export const estimateTiming = (s) => {
    const pauseN = clamp01(s.pauseMs / 4000);
    const rateN = clamp01(s.typingRate / 6); // chars / s
    const z = -0.8 + 2.0 * pauseN - 1.2 * rateN - 1.5 * s.deleteRatio + 1.0 * (s.sentenceEnd ? 1 : 0) + 1.6 * (s.paragraphEnd ? 1 : 0);
    return sigmoid(z);
};

// ---- expected-utility policy (Eq. 1) ---------------------------------------
export const utilities = (p, q, params = DEFAULT_PARAMS) => {
    const { B, C_FP, C_INT, gamma, C_obs, qNext } = params;
    const V = qNext * B - (1 - qNext) * C_INT;
    return {
        show: p * q * B - (1 - p) * C_FP - p * (1 - q) * C_INT,
        delay: p * (1 - q) * (gamma * V - C_obs),
        silent: 0,
    };
};

// -> { action: 'show' | 'defer' | 'silent', silence?: 'epistemic' | 'temporal', hedged, u }
export const decideEU = (p, q, params = DEFAULT_PARAMS, mediumMode = 'hedge') => {
    const u = utilities(p, q, params);
    if (p < params.pLow) return { action: 'silent', silence: 'epistemic', hedged: false, u, reason: 'p below floor: judgment not reliable enough to speak' };
    if (mediumMode === 'silent' && p < params.pHigh) return { action: 'silent', silence: 'epistemic', hedged: false, u, reason: 'medium p kept to overview only' };
    if (u.show >= u.delay && u.show > 0) return { action: 'show', hedged: p < params.pHigh, u, reason: 'expected utility of presenting now is highest' };
    if (u.delay > 0) return { action: 'defer', silence: 'temporal', hedged: p < params.pHigh, u, reason: 'moment not appropriate; deferred to next boundary' };
    return { action: 'silent', silence: u.show < 0 && p < params.pHigh ? 'epistemic' : 'temporal', hedged: false, u, reason: 'no action has positive expected utility' };
};

// ---- candidates -------------------------------------------------------------
const evidenceKey = (dim) => (dim.evidence[0] ? dim.evidence[0].sentence.toLowerCase().replace(/\s+/g, ' ').slice(0, 60) : 'none');

// Turn per-goal judgments into candidate feedback items with calibrated p.
export const buildCandidates = (items, goals, text) => {
    const out = [];
    items.forEach((item, gi) => {
        if (!item) return;
        item.dimensions.forEach(dim => {
            if (dim.severity < MIN_SEVERITY) return;
            const { p, features } = estimateReliability(dim, text);
            out.push({
                id: `${goals[gi]?.path}|${dim.id}|${evidenceKey(dim)}`,
                goalIdx: gi,
                goalPath: goals[gi]?.path,
                goalText: goals[gi]?.text,
                dimension: dim.id,
                dimensionLabel: DIMENSION_BY_ID[dim.id].label,
                layer: dim.layer,
                severity: dim.severity,
                problemType: dim.problemType,
                evidence: dim.evidence,
                rationale: dim.rationale,
                suggestedAction: dim.suggestedAction,
                p,
                features,
            });
        });
    });
    return out;
};
