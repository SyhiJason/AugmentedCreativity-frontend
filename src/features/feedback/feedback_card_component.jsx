import { useState } from "react";
import { pLevel } from "../../utils/calibration_tool.jsx";

const ACTION_TEXT = {
    revise_text: 'Consider revisiting this passage.',
    reinterpret_goal: 'The text may be fine — consider whether this goal should be revised.',
    none: '',
};
const LEVEL_STYLE = { high: 'bg-emerald-100 text-emerald-800', medium: 'bg-amber-100 text-amber-800', low: 'bg-slate-200 text-slate-600' };
const qLevel = (q) => (q >= 0.66 ? 'high' : q >= 0.4 ? 'medium' : 'low');

// A judgment, not a directive: shows goal -> evidence -> rubric dimension -> rationale -> reliability,
// and every action lets the author contest, defer or redirect it. No replacement text is ever offered.
export default function FeedbackCardComponent({ card, params, active, onHover, onDismiss, onSnooze, onReviseGoal, onCounterexample }) {
    const [editing, setEditing] = useState(false);
    const [goalDraft, setGoalDraft] = useState(card.goalText);
    const [loading, setLoading] = useState(false);
    const pl = pLevel(card.p, params);

    const runCounter = async () => {
        setLoading(true);
        await onCounterexample(card);
        setLoading(false);
    };

    return (
        <div onMouseEnter={() => onHover(card.id)} onMouseLeave={() => onHover(null)}
             className={`rounded-xl border bg-white shadow-sm p-3 text-xs space-y-2 ${active ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-200'}`}>
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">Goal</div>
                    <div className="font-semibold text-slate-800 break-words">{card.goalText}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`px-1.5 py-0.5 rounded ${card.layer === 'fixed' ? 'bg-sky-100 text-sky-800' : 'bg-violet-100 text-violet-800'}`}>{card.layer === 'fixed' ? 'Fixed rubric' : 'Venue / goal rubric'}</span>
                    {card.manual && <span className="text-[10px] text-slate-400">requested by you</span>}
                </div>
            </div>

            <div>
                <span className="font-semibold text-slate-700">{card.dimensionLabel}</span>
                <span className="text-slate-400"> · severity {card.severity}/5{card.problemType ? ` · ${card.problemType}` : ''}</span>
            </div>

            {card.evidence.length > 0 && (
                <div className="p-2 rounded-md bg-yellow-50 border border-yellow-200 space-y-1">
                    <div className="text-[10px] text-yellow-700">Evidence (highlighted in the editor)</div>
                    {card.evidence.slice(0, 3).map((e, i) => <div key={i} className="text-slate-700">“{e.sentence}”</div>)}
                </div>
            )}

            <p className="text-slate-700">
                {card.hedged && <span className="italic text-slate-500">I'm not entirely sure, but </span>}
                {card.rationale}
            </p>
            {ACTION_TEXT[card.suggestedAction] && <p className="text-slate-500">{ACTION_TEXT[card.suggestedAction]}</p>}

            <div className="flex gap-1.5 items-center">
                <span className={`px-1.5 py-0.5 rounded ${LEVEL_STYLE[pl]}`} title={`p = ${card.p.toFixed(2)}: probability annotators would endorse this feedback`}>p {pl}</span>
                {card.q != null && <span className={`px-1.5 py-0.5 rounded ${LEVEL_STYLE[qLevel(card.q)]}`} title={`q = ${card.q.toFixed(2)}: timing appropriateness when shown`}>q {qLevel(card.q)}</span>}
            </div>

            {card.counter && (
                <div className="p-2 rounded-md bg-slate-100 border border-slate-200 space-y-1">
                    {card.counter.error ? <div className="text-red-600">Could not generate a counterexample.</div> : (
                        <>
                            <div><span className="font-semibold">Counterexample: </span>{card.counter.counterexample}</div>
                            {Array.isArray(card.counter.uncertainty_sources) && (
                                <ul className="list-disc list-inside text-slate-600">{card.counter.uncertainty_sources.map((u, i) => <li key={i}>{u}</li>)}</ul>
                            )}
                            {card.counter.what_would_settle_it && <div className="text-slate-500">To settle it: {card.counter.what_would_settle_it}</div>}
                        </>
                    )}
                </div>
            )}

            {editing ? (
                <div className="space-y-1">
                    <textarea value={goalDraft} onChange={e => setGoalDraft(e.target.value)} className="w-full border border-slate-300 rounded p-1.5 text-xs" rows={2} />
                    <div className="flex gap-1.5 justify-end">
                        <button className="px-2 py-1 rounded bg-slate-200 hover:bg-slate-300" onClick={() => setEditing(false)}>Cancel</button>
                        <button className="px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-500" onClick={() => { onReviseGoal(card, goalDraft.trim()); setEditing(false); }}>Save goal</button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
                    <button className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" onClick={() => onDismiss(card.id)}>Not an issue</button>
                    <button className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" onClick={() => setEditing(true)}>Revise goal</button>
                    <button className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" onClick={() => onSnooze(card.id)}>Remind later</button>
                    <button disabled={loading} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-50" onClick={runCounter}>{loading ? 'Thinking…' : 'Counterexample'}</button>
                </div>
            )}
        </div>
    );
}
