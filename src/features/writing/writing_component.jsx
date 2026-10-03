import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {debounce_tool} from "../../utils/debounce_tool.jsx";
import {doc, setDoc} from "firebase/firestore";
import {firebaseConfig} from "../../config/default.jsx";
import GeminiApi from "../../services/gemini_api.jsx";
import HoverCardComponent from "../hover_card/hover_card_component.jsx";
import GoalBlueprintEditableBubbleComponent from "../goal/goal_blueprint/goal_blueprint_editable_bubble_component.jsx";
import EditorToolBarComponent from "../editor_tool/editor_tool_bar_component.jsx";
import FeedbackCardComponent from "../feedback/feedback_card_component.jsx";
import useTypingSignals from "../feedback/use_typing_signals.jsx";
import useProactiveFeedback from "../feedback/use_proactive_feedback.jsx";
import {CONDITIONS, DEFAULT_PARAMS} from "../../utils/calibration_tool.jsx";
import {locateEvidence, normalizeJudgment, rubricToPrompt} from "../../utils/rubric_tool.jsx";

const LEVEL = {
    pending: {label: 'Judging…', dot: 'bg-slate-300', chip: 'bg-slate-100 text-slate-500'},
    none: {label: 'No issue found', dot: 'bg-emerald-400', chip: 'bg-emerald-100 text-emerald-800'},
    possible: {label: 'Possible issue', dot: 'bg-amber-400', chip: 'bg-amber-100 text-amber-800'},
    high: {label: 'High-confidence issue', dot: 'bg-red-500', chip: 'bg-red-100 text-red-800'},
};

const PARAM_FIELDS = [
    ['B', 'B (benefit)', 0.1], ['C_FP', 'C_FP (false positive)', 0.1], ['C_INT', 'C_INT (interruption)', 0.1],
    ['gamma', 'γ (deferral discount)', 0.05], ['C_obs', 'C_obs (staleness)', 0.05], ['pLow', 'p floor', 0.05], ['pHigh', 'p high', 0.05],
];

export default function WritingComponent({ firebase, initialData, logEvent }) {
    const geminiApi = useMemo(() => new GeminiApi(), []);
    const [goalStructure, setGoalStructure] = useState(initialData.goalStructure);
    const [editorText, setEditorText] = useState(initialData.editorText);
    const [judgments, setJudgments] = useState(null); // { items: [per-goal judgment], text }
    const [hoverIdx, setHoverIdx] = useState(null);
    const [hoverRect, setHoverRect] = useState(null);
    const [activeCardId, setActiveCardId] = useState(null);
    const [condition, setCondition] = useState('eu');
    const [mediumMode, setMediumMode] = useState('hedge');
    const [params, setParams] = useState(DEFAULT_PARAMS);
    const [notice, setNotice] = useState('');
    const editorRef = useRef(null);
    const mirrorRef = useRef(null);
    const analysisSeq = useRef(0);
    const typing = useTypingSignals();

    const debouncedSave = useMemo(() => debounce_tool(async (data) => {
        if (firebase.db && firebase.userId) {
            const dataRef = doc(firebase.db, `artifacts/${firebaseConfig.appId}/users/${firebase.userId}/data/main_document`);
            await setDoc(dataRef, data, { merge: true });
        }
    }, 2000), [firebase.db, firebase.userId]);

    useEffect(() => {
        debouncedSave({ goalStructure, editorText });
    }, [goalStructure, editorText, debouncedSave]);

    const flatGoals = useMemo(() => {
        const list = [];
        (goalStructure.paper_outline || []).forEach((sec, si) => {
            (sec.key_points || []).forEach((kp, ki) => {
                const base = `paper_outline.${si}.key_points.${ki}`;
                list.push({ text: typeof kp === 'string' ? kp : kp.text, path: base, type: 'main', sectionIdx: si });
                if (typeof kp === 'object' && kp.sub_goals) kp.sub_goals.forEach((sg, sj) => list.push({ text: sg, path: `${base}.sub_goals.${sj}`, type: 'sub', sectionIdx: si }));
            });
        });
        return list;
    }, [goalStructure]);

    const updateDeep = (obj, path, fn) => {
        const newObj = JSON.parse(JSON.stringify(obj));
        let current = newObj;
        const keys = path.split('.');
        for (let i = 0; i < keys.length - 1; i++) {
            current = current[keys[i]];
        }
        fn(current, keys[keys.length - 1]);
        return newObj;
    };

    const onBubbleUpdate = (path, value) => {
        const newStructure = updateDeep(goalStructure, path, (parent, key) => {
            const item = parent[key];
            if (typeof item === 'object' && item && Object.prototype.hasOwnProperty.call(item, 'text')) {
                item.text = value;
            } else {
                parent[key] = value;
            }
        });
        setGoalStructure(newStructure);
    };

    // One structured judgment call per goal: every rubric dimension -> severity, evidence, rationale, action.
    const analyzeText = useCallback(async (text) => {
        const seq = ++analysisSeq.current;
        if (text.trim() === '' || flatGoals.length === 0) {
            setJudgments({ items: [], text });
            return;
        }
        const venue = goalStructure.metadata?.target_venue || 'unspecified venue';
        const rubric = rubricToPrompt();
        const items = Array(flatGoals.length).fill(null);
        const BATCH_SIZE = 4;
        try {
            for (let i = 0; i < flatGoals.length; i += BATCH_SIZE) {
                await Promise.all(flatGoals.slice(i, i + BATCH_SIZE).map(async (goal, j) => {
                    const raw = await geminiApi.callLLM('rubric_judge', { rubric, venue, key_point: goal.text, current_text: text });
                    items[i + j] = normalizeJudgment(raw);
                }));
                if (seq !== analysisSeq.current) return; // a newer analysis superseded this one
            }
            setJudgments({ items, text });
        } catch (e) {
            console.error('analyzeText error:', e);
        }
    }, [flatGoals, goalStructure.metadata?.target_venue, geminiApi]);

    const debouncedAnalysis = useMemo(() => debounce_tool((text) => analyzeText(text), 2000), [analyzeText]);

    useEffect(() => {
        debouncedAnalysis(editorText);
    }, [editorText, debouncedAnalysis]);

    const fb = useProactiveFeedback({ judgments, flatGoals, editorText, editorRef, typing, condition, mediumMode, params, logEvent });

    const handleTextChange = (e) => {
        typing.recordEdit(editorText, e.target.value);
        setEditorText(e.target.value);
    };

    // Explicit request for a goal (the ● button / overview row): the author asked, so we answer.
    const requestGoal = (gi) => {
        const n = fb.requestGoal(flatGoals[gi].path);
        setNotice(n ? '' : (judgments?.items[gi] ? `No issue found for “${flatGoals[gi].text}”.` : 'This goal has not been judged yet — write a bit more or wait a moment.'));
        logEvent('feedback_requested', { goal: flatGoals[gi].text, found: n });
    };

    const reviseGoal = (card, newText) => {
        if (newText && newText !== card.goalText) onBubbleUpdate(card.goalPath, newText);
        fb.markGoalRevised(card.id);
    };

    const counterexample = async (card) => {
        const res = await geminiApi.callLLM('counterexample', {
            key_point: card.goalText,
            evidence: card.evidence.map(e => e.sentence).join(' | '),
            rationale: card.rationale,
            current_text: editorText,
        });
        fb.setCounter(card.id, res);
    };

    // Editor highlight layer: evidence of visible cards is marked behind the (transparent) textarea.
    const highlighted = useMemo(() => {
        const ranges = [];
        fb.shownCards.forEach(c => c.evidence.forEach(e => {
            const r = locateEvidence(editorText, e.sentence);
            if (r) ranges.push({ ...r, active: c.id === activeCardId });
        }));
        ranges.sort((a, b) => a.start - b.start);
        const parts = [];
        let pos = 0;
        ranges.forEach(r => {
            if (r.start < pos) return;
            parts.push(<span key={`t${pos}`}>{editorText.slice(pos, r.start)}</span>);
            parts.push(<mark key={`m${r.start}`} className={`rounded-sm text-transparent ${r.active ? 'bg-amber-300/80' : 'bg-yellow-200/70'}`}>{editorText.slice(r.start, r.end)}</mark>);
            pos = r.end;
        });
        parts.push(<span key="tail">{editorText.slice(pos)}{'\n'}</span>);
        return parts;
    }, [fb.shownCards, editorText, activeCardId]);

    const onEnter = (e, i) => {
        setHoverIdx(i);
        setHoverRect(e.currentTarget.getBoundingClientRect());
    };
    const onLeave = () => { setHoverIdx(null); };

    const levelCounts = fb.goalLevels.reduce((acc, l) => ({ ...acc, [l.level]: (acc[l.level] || 0) + 1 }), {});
    const editorBox = 'absolute inset-0 p-8 text-base leading-7 whitespace-pre-wrap break-words overflow-y-scroll';

    return (
        <>
            <HoverCardComponent visible={hoverIdx !== null} anchorRect={hoverRect} title={flatGoals[hoverIdx ?? 0]?.text || ''} item={hoverIdx !== null ? judgments?.items[hoverIdx] : null} onClose={onLeave} />

            <div className="flex h-screen w-full bg-white text-slate-700">
                <div className="w-[25%] h-full flex flex-col bg-slate-50 border-r border-slate-200">
                    <header className="p-4 border-b border-slate-200"><h2 className="text-xl font-bold text-slate-900">Goal Blueprint</h2></header>
                    <div className="flex-1 p-6 overflow-y-auto">
                        <div className="space-y-8">
                            <div>
                                <h3 className="font-bold text-lg text-slate-800 mb-3 border-b border-slate-200 pb-2">Metadata</h3>
                                <div className="space-y-3">
                                    <GoalBlueprintEditableBubbleComponent path="metadata.working_title" text={goalStructure.metadata.working_title} onUpdate={onBubbleUpdate} extraClasses="font-bold text-lg text-slate-900" />
                                    <GoalBlueprintEditableBubbleComponent path="metadata.target_venue" text={goalStructure.metadata.target_venue} onUpdate={onBubbleUpdate} extraClasses="text-base text-slate-700" />
                                </div>
                            </div>
                            {(goalStructure.paper_outline || []).map((section, si) => (
                                <div key={si}>
                                    <h3 className="font-bold text-lg text-slate-800 mb-3 border-b border-slate-200 pb-2 mt-6">{section.section_name}</h3>
                                    <GoalBlueprintEditableBubbleComponent path={`paper_outline.${si}.objective`} text={section.objective} onUpdate={onBubbleUpdate} extraClasses="cursor-pointer  text-[0.9rem] block w-full mb-2 p-3 rounded !text-blue-500 !bg-blue-100" />
                                    <div className="space-y-2">
                                        {flatGoals.map((g, gi) => {
                                            if (g.sectionIdx !== si) return null;
                                            const isActive = editorText.toLowerCase().includes(g.text.toLowerCase());
                                            const lvl = LEVEL[fb.goalLevels[gi]?.level || 'pending'];
                                            return (
                                                <div key={g.path} className={`cursor-pointer flex gap-1 items-center group transition-all duration-200 rounded p-2  hover:bg-slate-200 ${g.type === 'sub' ? 'ml-6' : ''} ${isActive ? 'opacity-100 bg-slate-200/60' : 'opacity-60'}`}>
                                                    <button onClick={() => requestGoal(gi)} className="mr-2 flex items-center" title={`${lvl.label} — click to see feedback for this goal`}><span className={`w-3 h-3 rounded-full ${lvl.dot}`} /></button>
                                                    <div className="flex-1"><GoalBlueprintEditableBubbleComponent path={g.path} text={g.text} onUpdate={onBubbleUpdate} extraClasses={`!bg-transparent ${g.type === 'sub' ? 'text-[0.8rem] text-slate-600' : 'text-[0.9rem] text-slate-800'}`} /></div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="w-[50%] h-full flex flex-col bg-white">
                    <EditorToolBarComponent editorRef={editorRef} />
                    <div className="relative flex-1">
                        <div ref={mirrorRef} aria-hidden className={`${editorBox} text-transparent pointer-events-none`} style={{ scrollbarColor: 'transparent transparent' }}>{highlighted}</div>
                        <textarea ref={editorRef} value={editorText} onChange={handleTextChange}
                                  onScroll={e => { if (mirrorRef.current) mirrorRef.current.scrollTop = e.target.scrollTop; }}
                                  className={`${editorBox} bg-transparent text-slate-800 focus:outline-none resize-none placeholder-slate-400`}
                                  placeholder="Start writing your paper here..." />
                    </div>
                </div>

                <div className="w-[25%] h-full bg-slate-50 flex flex-col p-4 border-l border-slate-200 overflow-y-auto space-y-5">
                    <section className="space-y-2">
                        <h3 className="text-sm font-bold text-slate-800">Intervention policy</h3>
                        <div className="flex flex-wrap gap-1.5">
                            {CONDITIONS.map(c => (
                                <button key={c.id} title={c.hint} onClick={() => { setCondition(c.id); logEvent('condition_changed', { condition: c.id }); }}
                                        className={`px-2 py-1 text-xs rounded-md cursor-pointer ${condition === c.id ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}>{c.label}</button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>Medium p:</span>
                            {['hedge', 'silent'].map(m => (
                                <button key={m} onClick={() => setMediumMode(m)} className={`px-2 py-0.5 rounded cursor-pointer ${mediumMode === m ? 'bg-slate-700 text-white' : 'bg-slate-200 hover:bg-slate-300'}`}>{m === 'hedge' ? 'Present with hedge' : 'Stay silent'}</button>
                            ))}
                        </div>
                        <div className="text-xs text-slate-500">
                            <div className="flex justify-between"><span>Timing q (now)</span><span>{fb.q.toFixed(2)}</span></div>
                            <div className="h-1.5 bg-slate-200 rounded"><div className="h-1.5 rounded bg-blue-500 transition-all" style={{ width: `${fb.q * 100}%` }} /></div>
                            <div className="mt-1">Proactive presentations: {fb.shownCount} / {params.budget}</div>
                        </div>
                        <details className="text-xs text-slate-500">
                            <summary className="cursor-pointer">Policy parameters (Eq. 1)</summary>
                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-2">
                                {PARAM_FIELDS.map(([k, label, step]) => (
                                    <label key={k} className="flex flex-col">{label}
                                        <input type="number" step={step} value={params[k]} onChange={e => setParams(p => ({ ...p, [k]: Number(e.target.value) }))} className="border border-slate-300 rounded px-1 py-0.5 bg-white" />
                                    </label>
                                ))}
                            </div>
                        </details>
                    </section>

                    <section className="space-y-2">
                        <h3 className="text-sm font-bold text-slate-800">Alignment overview</h3>
                        <div className="flex flex-wrap gap-1 text-[10px]">
                            {['none', 'possible', 'high'].map(k => <span key={k} className={`px-1.5 py-0.5 rounded ${LEVEL[k].chip}`}>{LEVEL[k].label}: {levelCounts[k] || 0}</span>)}
                        </div>
                        <div className="space-y-1">
                            {flatGoals.map((g, i) => {
                                const lvl = LEVEL[fb.goalLevels[i]?.level || 'pending'];
                                return (
                                    <div key={g.path} onMouseEnter={(e) => onEnter(e, i)} onMouseLeave={onLeave} onClick={() => requestGoal(i)}
                                         className={`flex items-center gap-2 text-xs cursor-pointer rounded px-1.5 py-1 hover:bg-slate-200 ${g.type === 'sub' ? 'ml-4' : ''}`}>
                                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${lvl.dot}`} />
                                        <span className="truncate" title={g.text}>{g.text}</span>
                                    </div>
                                );
                            })}
                        </div>
                        {notice && <div className="text-xs text-slate-500">{notice}</div>}
                    </section>

                    <section className="space-y-2">
                        <h3 className="text-sm font-bold text-slate-800">Feedback {fb.shownCards.length > 0 && `(${fb.shownCards.length})`}</h3>
                        {fb.shownCards.length === 0 && <p className="text-xs text-slate-500">Nothing to flag right now. The assistant only speaks when it is both reasonably sure and the moment suits you.</p>}
                        {fb.shownCards.map(card => (
                            <FeedbackCardComponent key={card.id} card={card} params={params} active={card.id === activeCardId} onHover={setActiveCardId}
                                                   onDismiss={fb.dismiss} onSnooze={fb.snooze} onReviseGoal={reviseGoal} onCounterexample={counterexample} />
                        ))}
                    </section>

                    <details className="text-xs text-slate-500">
                        <summary className="cursor-pointer font-semibold text-slate-700">Why didn't it speak? ({fb.silenceLog.length})</summary>
                        <ul className="mt-2 space-y-1.5">
                            {fb.silenceLog.map((s, i) => (
                                <li key={i} className="p-1.5 rounded bg-white border border-slate-200">
                                    <span className={`px-1 rounded mr-1 ${s.kind === 'epistemic' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>{s.kind} silence</span>
                                    {s.dimension} · “{s.goal}”
                                    <div>p {s.p.toFixed(2)} · q {s.q.toFixed(2)} — {s.reason}</div>
                                </li>
                            ))}
                        </ul>
                    </details>
                </div>
            </div>
        </>
    );
}
