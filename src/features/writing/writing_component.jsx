import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import splitIntoSentencesTool from "../../utils/split_into_sentences_tool.jsx";
import {debounce_tool} from "../../utils/debounce_tool.jsx";
import {doc, setDoc} from "firebase/firestore";
import {firebaseConfig} from "../../config/default.jsx";
import GeminiApi from "../../services/gemini_api.jsx";
import DraggableModalComponent from "../draggable_modal/draggable_modal_component.jsx";
import HoverCardComponent from "../hover_card/hover_card_component.jsx";
import GoalBlueprintEditableBubbleComponent from "../goal/goal_blueprint/goal_blueprint_editable_bubble_component.jsx";
import EditorToolBarComponent from "../editor_tool/editor_tool_bar_component.jsx";

export default function WritingComponent({ firebase, initialData, logEvent }) {
    const geminiApi = new GeminiApi();
    const [goalStructure, setGoalStructure] = useState(initialData.goalStructure);
    const [editorText, setEditorText] = useState(initialData.editorText);
    const sentences = useMemo(() => splitIntoSentencesTool(editorText), [editorText]);
    const [analysis, setAnalysis] = useState({ contentScores: [], reviewScores: [], contentLLM: [], reviewLLM: [] });
    const [modal, setModal] = useState({ show: false, stage: '', title: '', content: {} });
    const [hoverIdx, setHoverIdx] = useState(null);
    const [hoverRect, setHoverRect] = useState(null);
    const [hoverType, setHoverType] = useState('Content');
    const [hoverSents, setHoverSents] = useState([]);
    const editorRef = useRef(null);
    const [sternness, setSternness] = useState(1);
    const [showHintPopup, setShowHintPopup] = useState(false);
    const [autoPopupMode, setAutoPopupMode] = useState('Standard');
    const modificationCount = useRef(0);
    const inactivityTimer = useRef(null);
    const triggerSettings = {
        Standard: { count: 3, delay: 300 },
        Weak: { count: 7, delay: 500 },
        None: { count: Infinity, delay: Infinity }
    };

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
    const totalGoals = flatGoals.length;

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

    const analyzeText = useCallback(async (text) => {
        const geminiApi = new GeminiApi();

        if (text.trim() === '' || flatGoals.length === 0) {
            setAnalysis({ contentScores: [], reviewScores: [], contentLLM: [], reviewLLM: [] });
            return;
        }
        try {
            const contentScores = Array(totalGoals).fill(0);
            const reviewScores = Array(totalGoals).fill(0);
            const contentLLM = Array(totalGoals).fill(null);
            const reviewLLM = Array(totalGoals).fill(null);
            const BATCH_SIZE = 4;
            for (let i = 0; i < totalGoals; i += BATCH_SIZE) {
                const batch = flatGoals.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(async (goal, j) => {
                    const idx = i + j;
                    const [cj, rj] = await Promise.all([
                        geminiApi.callLLM('content_judge', { key_point: goal.text, current_text: text }),
                        geminiApi.callLLM('review_judge', { key_point: goal.text, current_text: text })
                    ]);
                    contentScores[idx] = cj?.score ? (cj.score - 1) / 4 : 0;
                    reviewScores[idx] = rj?.score ? (rj.score - 1) / 4 : 0;
                    contentLLM[idx] = cj || null;
                    reviewLLM[idx] = rj || null;
                }));
            }
            setAnalysis({ contentScores, reviewScores, contentLLM, reviewLLM });
        } catch (e) {
            console.error('analyzeText error:', e);
            setAnalysis({ contentScores: Array(totalGoals).fill(0), reviewScores: Array(totalGoals).fill(0), contentLLM: [], reviewLLM: [] });
        }
    }, [flatGoals, totalGoals]);

    const debouncedAnalysis = useMemo(() => debounce_tool((text) => analyzeText(text), 500), [analyzeText]);

    useEffect(() => {
        debouncedAnalysis(editorText);
    }, [editorText, debouncedAnalysis]);

    const handleHint = useCallback(() => {
        const firstProblemIdx = analysis.contentScores.findIndex((s, k) => s < 0.5 || analysis.reviewScores[k] < 0.5);
        if (firstProblemIdx !== -1) {
            const type = analysis.contentScores[firstProblemIdx] < 0.5 ? 'Content' : 'Review';
            const goalText = flatGoals[firstProblemIdx].text;
            const newModal = { show: true, stage: 'deviation_analysis', title: `Action for: "${goalText}"`, content: { keyPointText: goalText, type } };
            setModal(newModal);
            seekAdvice(newModal);
            logEvent('advice_triggered_auto');
        }
        setShowHintPopup(false);
        modificationCount.current = 0;
    }, [analysis, flatGoals, logEvent]);

    const handleTextChange = (e) => {
        const newText = e.target.value;
        setEditorText(newText);
        if (autoPopupMode === 'None') return;
        modificationCount.current++;
        clearTimeout(inactivityTimer.current);
        const { count: threshold, delay } = triggerSettings[autoPopupMode];
        inactivityTimer.current = setTimeout(() => {
            if (modificationCount.current >= threshold) {
                const hasProblem = analysis.contentScores.some((s, k) => s < 0.5 || analysis.reviewScores[k] < 0.5);
                if (hasProblem) {
                    setShowHintPopup(true);
                }
            }
            modificationCount.current = 0;
        }, delay);
    };

    const openDeviation = (i, type) => {
        const g = flatGoals[i];
        setModal({ show: true, stage: 'deviation_analysis', title: `Action for: "${g.text}"`, content: { keyPointText: g.text, type } });
        logEvent('advice_triggered_manual', { goal: g.text, type });
    };

    const seekAdvice = async (info = modal) => {
        const { keyPointText, type } = info.content;
        setModal(p => ({ ...p, stage: 'seeking_advice', title: 'Seeking Advice...' }));
        const problem = type === 'Content' ? 'The text is not well-aligned with its goal.' : 'The text has issues based on peer-review standards.';
        const sug = await geminiApi.callLLM('suggestion', { current_text: editorText, key_point: keyPointText, problem_description: problem });
        setModal(p => ({ ...p, stage: 'advice_displayed', title: 'Suggestions', content: { ...p.content, ...sug } }));
    };

    const handleAcceptSuggestion = () => {
        const suggestionText = modal.content.suggestion;
        logEvent('advice_accepted', { suggestion: suggestionText });
        setModal({ show: false });
    };

    const onEnter = (e, i, type) => {
        setHoverIdx(i);
        setHoverType(type);
        setHoverRect(e.currentTarget.getBoundingClientRect());
        const kp = flatGoals[i]?.text || '';
        setHoverSents(sentences.filter(s => kp && s.text.toLowerCase().includes(kp.toLowerCase())));
    };
    const onLeave = () => { setHoverIdx(null); };

    return (
        <>
            <style>{`.slider-thumb::-webkit-slider-thumb{ -webkit-appearance:none; appearance:none; width:16px; height:16px; background:#3b82f6; border-radius:9999px; cursor:pointer; } .slider-thumb::-moz-range-thumb{ width:16px; height:16px; background:#3b82f6; border-radius:9999px; cursor:pointer; }`}</style>
            <DraggableModalComponent show={modal.show} onClose={() => setModal({ show: false })} title={modal.title}>
                {(() => {
                    const { stage, content } = modal;
                    switch (stage) {
                        case 'seeking_advice': return <p>Getting advice from AI...</p>;
                        case 'advice_displayed': return (
                            <div className="space-y-4">
                                <div className="p-3 bg-yellow-100 border border-yellow-200 rounded-lg">
                                    <p className="font-semibold text-sm text-yellow-800"><strong>Diagnosis:</strong></p>
                                    <p className="text-sm text-yellow-900">{content.state_description}</p>
                                </div>
                                <div className="p-3 bg-green-100 border border-green-200 rounded-lg">
                                    <p className="font-semibold text-sm text-green-800"><strong>Suggestion:</strong></p>
                                    <p className="text-sm text-green-900">{content.suggestion}</p>
                                </div>
                                <div className="flex justify-end items-center pt-4 mt-2 border-t border-slate-200 gap-x-2">
                                    <button onClick={() => { setModal({ show: false }); logEvent('advice_rejected'); }} className="px-4 py-2 bg-slate-200 text-slate-800 text-sm font-semibold rounded-lg hover:bg-slate-300">Reject</button>
                                    <button onClick={handleAcceptSuggestion} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-500">Accept</button>
                                </div>
                            </div>
                        );
                        default: return <p>Loading...</p>;
                    }
                })()}
            </DraggableModalComponent>

            <DraggableModalComponent show={showHintPopup} onClose={() => setShowHintPopup(false)} title="Writing Suggestion">
                <div className="space-y-4">
                    <p>It looks like some of your writing may not be strongly aligned with its goals. Would you like some automated advice?</p>
                    <div className="flex justify-end items-center pt-4 mt-4 border-t border-slate-200 gap-x-2">
                        <button onClick={() => setShowHintPopup(false)} className="px-4 py-2 bg-slate-600 text-white text-sm font-semibold rounded-lg hover:bg-slate-500">Dismiss</button>
                        <button onClick={handleHint} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-500">Get Advice</button>
                    </div>
                </div>
            </DraggableModalComponent>

            <HoverCardComponent visible={hoverIdx !== null} anchorRect={hoverRect} title={`${hoverType} • ${flatGoals[hoverIdx || 0]?.text || ''}`} sentences={hoverSents} llm={hoverIdx !== null ? (hoverType === 'Content' ? analysis.contentLLM[hoverIdx] : analysis.reviewLLM[hoverIdx]) : null} onClose={onLeave} />

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
                                    <GoalBlueprintEditableBubbleComponent path={`paper_outline.${si}.objective`} text={section.objective} onUpdate={onBubbleUpdate} extraClasses="text-base font-semibold block w-full mb-4 !text-blue-800 !bg-blue-100" />
                                    <div className="space-y-2">
                                        {flatGoals.map((g, gi) => {
                                            if (g.sectionIdx !== si) return null;
                                            const isActive = editorText.toLowerCase().includes(g.text.toLowerCase());
                                            return (
                                                <div key={g.path} className={`flex items-center group transition-all duration-200 rounded-md p-1 ${g.type === 'sub' ? 'ml-6' : ''} ${isActive ? 'opacity-100 bg-slate-200/60' : 'opacity-60'}`}>
                                                    <button onClick={() => openDeviation(gi, 'Content')} className="mr-2 text-slate-400 group-hover:text-blue-500" title="Analyze Goal Achievement">●</button>
                                                    <div className="flex-1"><GoalBlueprintEditableBubbleComponent path={g.path} text={g.text} onUpdate={onBubbleUpdate} extraClasses={`!bg-transparent ${g.type === 'sub' ? 'text-sm text-slate-600' : 'text-base text-slate-800'}`} /></div>
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
                    <textarea ref={editorRef} value={editorText} onChange={handleTextChange} className="flex-1 p-8 text-base bg-white text-slate-800 leading-7 focus:outline-none resize-none placeholder-slate-400" placeholder="Start writing your paper here..." />
                </div>
                <div className="w-[25%] h-full bg-slate-50 flex flex-col items-center justify-start p-4 border-l border-slate-200">
                    <div className="w-full max-w-xs space-y-6 my-6">
                        <div className="text-center">
                            <label className="text-xs font-semibold text-slate-500 block mb-2">Reviewer Sternness</label>
                            <input type="range" min="0" max="2" step="1" value={sternness} onChange={e => setSternness(Number(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer slider-thumb" />
                            <span className="text-xs text-slate-500">{['Gentle', 'Standard', 'Harsh'][sternness]}</span>
                        </div>
                        <div className="text-center">
                            <label className="text-xs font-semibold text-slate-500 block mb-2">Auto-Popup Trigger</label>
                            <div className="flex justify-center gap-x-2">
                                {Object.keys(triggerSettings).map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => setAutoPopupMode(mode)}
                                        className={`px-3 py-1 text-xs rounded-md ${autoPopupMode === mode ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                            <span className="text-xs text-slate-500 mt-1 block">
                                {autoPopupMode !== 'None' ? `${triggerSettings[autoPopupMode].count} mods + ${triggerSettings[autoPopupMode].delay}ms pause` : 'Keyboard trigger disabled'}
                            </span>
                        </div>
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                        <div className="flex gap-x-8">
                            {['Content', 'Review'].map(type => (
                                <div key={type} className="text-center select-none">
                                    <div className="mb-2"><p className="text-sm font-semibold text-slate-500">{type}</p></div>
                                    <div className="flex flex-col items-center gap-y-1.5 relative">
                                        {Array.from({ length: totalGoals }).map((_, i) => {
                                            const scores = type === 'Content' ? analysis.contentScores : analysis.reviewScores;
                                            const sc = scores[i] || 0;
                                            const hue = type === 'Content' ? 0 : 210;
                                            const light = 60 - sc * 25;
                                            const style = { backgroundColor: sc > 0 ? `hsl(${hue}, 70%, ${light}%)` : '#e2e8f0' };
                                            return (
                                                <div key={`${type}-${i}`} className="w-5 h-5 rounded-md cursor-pointer transition-all" style={style} onMouseEnter={(e) => onEnter(e, i, type)} onMouseLeave={onLeave} onClick={() => openDeviation(i, type)} title={`${type} • ${flatGoals[i]?.text || ''}`} />
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}