import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

// It's recommended to use environment variables for API keys in a real application.
const GEMINI_API_KEY = "AIzaSyBsinouJnEwskZjSDOOY3H0XbchmjxMV8k";

// --- Firebase Configuration ---
// These variables would be provided by the environment in a real deployment.
// For local testing, you might need to replace them with actual values.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';


// Prompts for the Gemini API, designed to return JSON
const prompts = {
  metadata: `Based on the following initial paper idea, extract a working title, a target conference/venue, and 5-7 relevant keywords. INITIAL IDEA: "{idea}" Output ONLY a valid JSON object with the keys "working_title", "target_venue", and "keywords".`,
  objective: `Based on the following user description for a paper section, generate a concise one-sentence objective and a bulleted list of key points. USER DESCRIPTION: "{description}" Output ONLY a valid JSON object with two keys: "objective" (a string), and "key_points" (an array of strings).`,
  content_judge: (
    `You are a Content Goal Alignment Critic for scientific writing.\n` +
    `Judge ONLY the alignment between the user's goal (KP) and the current text.\n` +
    `Output JSON with: score (1-5), statement (one sentence), reason (one-two sentences), evidence (array of short quotes from the text that support your judgement).\n` +
    `If you cannot find evidence, include an empty array for evidence.\n` +
    `Example: {"score":3,"statement":"...","reason":"...","evidence":[{"quote":"..."}]}\n` +
    `[GOAL]: "{key_point}"\n[TEXT]: "{current_text}"`
  ),
  review_judge: (
    `You are a Reviewer-Style Feedback Critic (peer-review simulation).\n` +
    `For the given text and key point context, give a 1-5 score and an explanation.\n` +
    `Focus on originality, soundness, meaningful comparison, replicability, and substance AS RELEVANT to the current text.\n` +
    `Output JSON with: score (1-5), statement (one sentence), reason (one-two sentences), evidence (array of short quotes).\n` +
    `Do NOT provide suggestions here.\n` +
    `Example: {"score":4,"statement":"...","reason":"...","evidence":[{"quote":"..."}]}\n` +
    `[KEY POINT CONTEXT]: "{key_point}"\n[TEXT TO REVIEW]: "{current_text}"`
  ),
  summary: `You are a research writing assistant. Analyze the user's text to see if it achieves the stated goal. Be concise and encouraging. Explain how it achieves the goal, or what is missing if it does not. [GOAL]: "{key_point}" [USER TEXT]: "{current_text}" Your response MUST be ONLY a valid JSON object with a single key "summary_text".`,
  suggestion: `You are an expert writing coach. You are given: [GOAL]: "{key_point}", [TEXT]: "{current_text}", [PROBLEM]: "{problem_description}". Generate a "state_description" (why the text is failing) and a "suggestion" (an actionable piece of advice). Your response MUST be ONLY a valid JSON object with two keys: "state_description" and "suggestion".`
};

// --- API Call Helper ---
async function callGoogleAPI(prompt) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'PASTE_YOUR_GEMINI_API_KEY_HERE') {
        console.error('API key missing. Please add your Gemini API key.');
        return JSON.stringify({ error: 'API Key not configured.' });
    }
    // MODIFICATION: Updated to a more recent, stable model version.
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
    };

    let retries = 3;
    let delay = 1000;

    while (retries > 0) {
        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.status === 429) {
                console.warn(`Rate limit hit. Retrying in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                retries--;
                continue;
            }
            if (!res.ok) {
                const body = await res.json();
                console.error('Gemini API error:', body);
                throw new Error(`API responded with status ${res.status}`);
            }
            const data = await res.json();
            return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? JSON.stringify({ error: 'No content returned from API.' });
        } catch (e) {
            console.error('Error calling Google API:', e);
            retries--;
            if (retries <= 0) {
                return JSON.stringify({ error: `LLM call failed: ${e.message}` });
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
    return JSON.stringify({ error: 'LLM call failed after multiple retries.' });
}

// --- LLM Interaction Logic ---
async function callLLM(promptType, replacements = {}) {
    const tpl = prompts[promptType];
    if (!tpl) {
        console.error('Invalid prompt type requested:', promptType);
        return {};
    }
    let finalPrompt = tpl;
    for (const k in replacements) {
        finalPrompt = finalPrompt.replace(new RegExp(`{${k}}`, 'g'), String(replacements[k]));
    }
    try {
        const resultText = await callGoogleAPI(finalPrompt);
        return JSON.parse(resultText);
    } catch (e) {
        console.error(`Failed to parse JSON for prompt type ${promptType}:`, e);
        return { error: `JSON parsing failed.` };
    }
}

const debounce = (fn, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
};

// --- UI Components ---
const ChatBubble = ({ role, text }) => (
    <div className={`max-w-[80%] p-3 rounded-lg break-words ${role === 'user' ? 'bg-blue-600 text-white self-end rounded-br-none' : 'bg-slate-200 text-slate-800 self-start rounded-bl-none'}`}>{text}</div>
);

// FIX: Made this component more robust to handle cases where `structure` or its properties might be undefined.
const GoalStructureInteractiveView = ({ structure }) => (
    <div className="p-4 space-y-4 text-sm text-slate-600">
        <div>
            <h3 className="font-bold text-slate-900">Metadata</h3>
            <p><strong>Title:</strong> {structure?.metadata?.working_title || '...'}</p>
            <p><strong>Venue:</strong> {structure?.metadata?.target_venue || '...'}</p>
            <p><strong>Keywords:</strong> {(structure?.metadata?.keywords || []).join(', ') || '...'}</p>
        </div>
        <div>
            <h3 className="font-bold text-slate-900 mt-4">Paper Outline</h3>
            {(structure?.paper_outline || []).map((s, i) => (
                <div key={i} className="mt-2 p-3 bg-slate-100 rounded-lg">
                    <p className="font-semibold text-slate-800">{s?.section_name || `Section ${i + 1}`}</p>
                    <p className="text-xs italic text-slate-500">{s?.objective || '...'}</p>
                    <ul className="list-disc list-inside pl-2 mt-1 text-slate-600">
                        {(s?.key_points || []).map((kp, k) => <li key={k}>{typeof kp === 'string' ? kp : kp.text}</li>)}
                    </ul>
                </div>
            ))}
        </div>
    </div>
);


const EditableBubble = ({ path, text, onUpdate, extraClasses = '' }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(text);
    const inputRef = useRef(null);
    useEffect(() => { setValue(text); }, [text]);
    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);
    const handleDone = () => {
        setIsEditing(false);
        onUpdate(path, value);
    };
    return isEditing ? (
        <input
            ref={inputRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            onBlur={handleDone}
            onKeyDown={e => e.key === 'Enter' && handleDone()}
            className={`w-full bg-slate-200 text-slate-800 rounded-md p-2 ${extraClasses}`}
        />
    ) : (
        <div onDoubleClick={() => setIsEditing(true)} className={`goal-bubble-light ${extraClasses}`}>{text}</div>
    );
};

const EditorToolbar = ({ editorRef }) => {
    const wrap = (pre, suf = '') => {
        const el = editorRef.current;
        if (!el) return;
        const { selectionStart: s, selectionEnd: e, value } = el;
        const sel = value.substring(s, e);
        if (s === e) {
            el.setRangeText(pre + suf, s, e, 'end');
            if (suf) el.selectionStart = el.selectionEnd = s + pre.length;
        } else {
            el.setRangeText(pre + sel + suf, s, e, 'select');
        }
        el.focus();
    };
    const btn = 'p-2 rounded-md text-slate-600 hover:bg-slate-200 w-9 h-9 flex items-center justify-center';
    return (
        <div className="flex items-center p-2 border-b border-slate-200 bg-slate-100 gap-x-1 flex-wrap">
            <button onClick={() => wrap('**', '**')} className={btn} title="Bold"><strong className="text-base">B</strong></button>
            <button onClick={() => wrap('*', '*')} className={btn} title="Italic"><em className="text-base">I</em></button>
            <div className="w-px h-5 bg-slate-300 mx-1" />
            <button onClick={() => wrap('[', '](https://)')} className={btn} title="Link">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"></path></svg>
            </button>
            <button onClick={() => wrap('![Alt Text](', 'https://)')} className={btn} title="Image">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            </button>
            <button onClick={() => wrap('\n```\n', '\n```\n')} className={btn} title="Code">{`</>`}</button>
        </div>
    );
};

function splitIntoSentences(text) {
    if (!text) return [];
    return text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean).map((t, i) => ({ id: i, text: t }));
}

const HoverCard = ({ visible, anchorRect, title, sentences = [], llm = null, onClose }) => {
    if (!visible || !anchorRect) return null;
    const cardWidth = 300;
    const left = Math.max(8, anchorRect.left - cardWidth - 16);
    const top = Math.min(window.innerHeight - 220, Math.max(8, anchorRect.top));
    return (
        <div
            className="fixed z-[60] w-[300px] max-h-[220px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl p-3 text-slate-800"
            style={{ left, top }}
            onMouseLeave={onClose}
        >
            <div className="text-xs uppercase tracking-wide text-sky-600 font-semibold mb-1">{title}</div>
            {llm && (
                <div className="mb-2 space-y-1 text-xs">
                    {llm.statement && <p className="text-slate-900 font-semibold">{llm.statement}</p>}
                    {llm.reason && <p className="text-slate-600">{llm.reason}</p>}
                    {Array.isArray(llm.evidence) && llm.evidence.length > 0 && (
                        <div className="mt-1 p-2 rounded-md bg-slate-100 border border-slate-200">
                            <div className="text-[10px] text-slate-500 mb-1">Evidence</div>
                            <ul className="space-y-1 list-disc list-inside">
                                {llm.evidence.slice(0, 3).map((e, i) => (
                                    <li key={i} className="text-slate-700 text-xs">“{e.quote}”</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
            <div className="text-[10px] text-slate-500 mb-1">Sentences mentioning this goal</div>
            {sentences.length === 0 ? (
                <div className="text-xs text-slate-500">No direct mentions detected.</div>
            ) : (
                <ul className="space-y-1">
                    {sentences.map(s => (
                        <li key={s.id} className="text-xs text-slate-700">• {s.text.length > 160 ? s.text.slice(0, 160) + '…' : s.text}</li>
                    ))}
                </ul>
            )}
        </div>
    );
};

const DraggableModal = ({ show, onClose, title, children }) => {
    const [pos, setPos] = useState({ x: window.innerWidth / 2 - 224, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [rel, setRel] = useState(null);
    const ref = useRef(null);
    const onMouseDown = (e) => {
        if (e.button !== 0 || !ref.current.contains(e.target) || e.target.tagName === 'BUTTON') return;
        const head = e.currentTarget;
        if (!head.classList.contains('modal-header')) return;
        setIsDragging(true);
        const m = ref.current;
        setRel({ x: e.pageX - m.offsetLeft, y: e.pageY - m.offsetTop });
        e.stopPropagation(); e.preventDefault();
    };
    const onMouseUp = useCallback(() => { setIsDragging(false); }, []);
    const onMouseMove = useCallback((e) => {
        if (!isDragging || !rel) return;
        setPos({ x: e.pageX - rel.x, y: e.pageY - rel.y });
    }, [isDragging, rel]);
    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, [isDragging, onMouseMove, onMouseUp]);
    if (!show) return null;
    return (
        <div ref={ref} style={{ left: `${pos.x}px`, top: `${pos.y}px` }} className="fixed bg-white border border-slate-200 rounded-lg shadow-xl p-4 w-full max-w-md z-50 text-slate-800">
            <div onMouseDown={onMouseDown} className="modal-header flex justify-between items-center mb-4 pb-2 border-b border-slate-200 cursor-move">
                <h3 className="text-lg font-bold text-slate-900">{title}</h3>
                <button onClick={onClose} className="text-slate-500 hover:text-slate-900">&times;</button>
            </div>
            <div>{children}</div>
        </div>
    );
};

// --- Main Views ---
const GoalSettingView = ({ goalStructure, setGoalStructure, onConfirm }) => {
    const [chat, setChat] = useState([{ role: 'assistant', text: "Hello! I'm your Writing Assistant. To begin, please tell me your initial paper idea." }]);
    const [input, setInput] = useState('');
    const [isBusy, setIsBusy] = useState(false);
    const [state, setState] = useState('awaiting_initial_idea');
    const [totalSections, setTotalSections] = useState(0);
    const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
    const [isRawView, setIsRawView] = useState(false);
    const [rawText, setRawText] = useState(JSON.stringify(goalStructure, null, 2));
    const [isJsonValid, setIsJsonValid] = useState(true);
    const endRef = useRef(null);
    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat]);
    useEffect(() => { if (!isRawView) setRawText(JSON.stringify(goalStructure, null, 2)); }, [goalStructure, isRawView]);
    const addMessage = (role, text) => setChat(prev => [...prev, { role, text }]);
    const handleRawChange = (e) => {
        const t = e.target.value;
        setRawText(t);
        try {
            setGoalStructure(JSON.parse(t));
            setIsJsonValid(true);
        } catch {
            setIsJsonValid(false);
        }
    };
    const handleSend = async () => {
        if (!input.trim() || isBusy) return;
        const userInput = input;
        addMessage('user', userInput);
        setInput('');
        setIsBusy(true);
        if (state === 'awaiting_initial_idea') {
            const metadata = await callLLM('metadata', { idea: userInput });
            setGoalStructure(p => ({ ...p, metadata }));
            setState('awaiting_section_count');
            addMessage('assistant', 'Thanks! I\'ve populated the metadata. Now, how many main sections will your paper have?');
        } else if (state === 'awaiting_section_count') {
            const n = parseInt(userInput, 10) || 0;
            if (n > 0 && n < 15) {
                setTotalSections(n);
                setCurrentSectionIdx(0);
                setState('awaiting_section_name');
                addMessage('assistant', `Great. What is the title of **Section 1**?`);
            } else {
                addMessage('assistant', 'Please enter a valid number (e.g., between 1 and 15).');
            }
        } else if (state === 'awaiting_section_name') {
            setGoalStructure(p => {
                const newOutline = [...(p.paper_outline || [])];
                newOutline[currentSectionIdx] = { section_name: userInput, objective: '', key_points: [] };
                return { ...p, paper_outline: newOutline };
            });
            setState('awaiting_section_objective_description');
            addMessage('assistant', `Got it. Now, please briefly describe the main goal of the **${userInput}** section.`);
        } else if (state === 'awaiting_section_objective_description') {
            const data = await callLLM('objective', { description: userInput });
            setGoalStructure(p => {
                const newOutline = [...p.paper_outline];
                newOutline[currentSectionIdx] = { ...newOutline[currentSectionIdx], objective: data.objective || '', key_points: data.key_points || [] };
                return { ...p, paper_outline: newOutline };
            });
            const nextIdx = currentSectionIdx + 1;
            if (nextIdx < totalSections) {
                setCurrentSectionIdx(nextIdx);
                setState('awaiting_section_name');
                addMessage('assistant', `Excellent. What is the title of **Section ${nextIdx + 1}**?`);
            } else {
                setState('finalizing');
                addMessage('assistant', 'Great! The initial plan is complete. Please review it, then click "Confirm & Start Writing".');
            }
        }
        setIsBusy(false);
    };
    return (
        <div className="flex h-screen w-full bg-slate-100 text-slate-800">
            <div className="flex flex-col w-full md:w-1/2 h-full bg-slate-50">
                <header className="p-4 border-b border-slate-200"><h1 className="text-xl font-bold text-slate-900">Phase 1: Goal Setting</h1></header>
                <main className="flex-1 p-4 overflow-y-auto space-y-4 flex flex-col">
                    {chat.map((m, i) => (<ChatBubble key={i} role={m.role} text={m.text} />))}
                    {isBusy && <div className="text-sm text-slate-500 self-start">Writing Assistant is thinking...</div>}
                    <div ref={endRef} />
                </main>
                <footer className="p-4 border-t border-slate-200 bg-slate-100">
                    <div className="flex items-start space-x-2">
                        <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} className="flex-1 p-3 bg-white border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="Enter your response..." rows="1" />
                        <button onClick={handleSend} disabled={isBusy} className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 disabled:bg-blue-400">Send</button>
                    </div>
                </footer>
            </div>
            <div className="flex flex-col w-full md:w-1/2 h-full bg-white">
                <header className="p-4 border-b border-slate-200 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-slate-900">Goal Structure</h2>
                    <button onClick={() => setIsRawView(!isRawView)} className="px-3 py-1.5 text-sm bg-slate-200 text-slate-700 rounded-md hover:bg-slate-300">{isRawView ? 'Interactive View' : 'Raw JSON View'}</button>
                </header>
                <div className="flex-1 overflow-y-auto bg-white">
                    {isRawView ? (
                        <textarea value={rawText} onChange={handleRawChange} className={`w-full h-full p-4 text-sm font-mono bg-transparent outline-none resize-none ${!isJsonValid ? 'text-red-500' : ''}`} />
                    ) : (
                        <GoalStructureInteractiveView structure={goalStructure} />
                    )}
                </div>
                <footer className="p-4 border-t border-slate-200 text-right">
                    <button onClick={onConfirm} className="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-500 disabled:bg-green-400 disabled:cursor-not-allowed" disabled={state !== 'finalizing' || !isJsonValid}>Confirm & Start Writing</button>
                </footer>
            </div>
        </div>
    );
};

const WritingView = ({ firebase, initialData, logEvent }) => {
    const [goalStructure, setGoalStructure] = useState(initialData.goalStructure);
    const [editorText, setEditorText] = useState(initialData.editorText);
    const sentences = useMemo(() => splitIntoSentences(editorText), [editorText]);
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

    const debouncedSave = useMemo(() => debounce(async (data) => {
        if (firebase.db && firebase.userId) {
            const dataRef = doc(firebase.db, `artifacts/${appId}/users/${firebase.userId}/data/main_document`);
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
                        callLLM('content_judge', { key_point: goal.text, current_text: text }),
                        callLLM('review_judge', { key_point: goal.text, current_text: text })
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

    const debouncedAnalysis = useMemo(() => debounce((text) => analyzeText(text), 500), [analyzeText]);

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
        const sug = await callLLM('suggestion', { current_text: editorText, key_point: keyPointText, problem_description: problem });
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
            <DraggableModal show={modal.show} onClose={() => setModal({ show: false })} title={modal.title}>
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
            </DraggableModal>

            <DraggableModal show={showHintPopup} onClose={() => setShowHintPopup(false)} title="Writing Suggestion">
                <div className="space-y-4">
                    <p>It looks like some of your writing may not be strongly aligned with its goals. Would you like some automated advice?</p>
                    <div className="flex justify-end items-center pt-4 mt-4 border-t border-slate-200 gap-x-2">
                        <button onClick={() => setShowHintPopup(false)} className="px-4 py-2 bg-slate-600 text-white text-sm font-semibold rounded-lg hover:bg-slate-500">Dismiss</button>
                        <button onClick={handleHint} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-500">Get Advice</button>
                    </div>
                </div>
            </DraggableModal>

            <HoverCard visible={hoverIdx !== null} anchorRect={hoverRect} title={`${hoverType} • ${flatGoals[hoverIdx || 0]?.text || ''}`} sentences={hoverSents} llm={hoverIdx !== null ? (hoverType === 'Content' ? analysis.contentLLM[hoverIdx] : analysis.reviewLLM[hoverIdx]) : null} onClose={onLeave} />

            <div className="flex h-screen w-full bg-white text-slate-700">
                <div className="w-[25%] h-full flex flex-col bg-slate-50 border-r border-slate-200">
                    <header className="p-4 border-b border-slate-200"><h2 className="text-xl font-bold text-slate-900">Goal Blueprint</h2></header>
                    <div className="flex-1 p-6 overflow-y-auto">
                        <div className="space-y-8">
                            <div>
                                <h3 className="font-bold text-lg text-slate-800 mb-3 border-b border-slate-200 pb-2">Metadata</h3>
                                <div className="space-y-3">
                                    <EditableBubble path="metadata.working_title" text={goalStructure.metadata.working_title} onUpdate={onBubbleUpdate} extraClasses="font-bold text-lg text-slate-900" />
                                    <EditableBubble path="metadata.target_venue" text={goalStructure.metadata.target_venue} onUpdate={onBubbleUpdate} extraClasses="text-base text-slate-700" />
                                </div>
                            </div>
                            {(goalStructure.paper_outline || []).map((section, si) => (
                                <div key={si}>
                                    <h3 className="font-bold text-lg text-slate-800 mb-3 border-b border-slate-200 pb-2 mt-6">{section.section_name}</h3>
                                    <EditableBubble path={`paper_outline.${si}.objective`} text={section.objective} onUpdate={onBubbleUpdate} extraClasses="text-base font-semibold block w-full mb-4 !text-blue-800 !bg-blue-100" />
                                    <div className="space-y-2">
                                        {flatGoals.map((g, gi) => {
                                            if (g.sectionIdx !== si) return null;
                                            const isActive = editorText.toLowerCase().includes(g.text.toLowerCase());
                                            return (
                                                <div key={g.path} className={`flex items-center group transition-all duration-200 rounded-md p-1 ${g.type === 'sub' ? 'ml-6' : ''} ${isActive ? 'opacity-100 bg-slate-200/60' : 'opacity-60'}`}>
                                                    <button onClick={() => openDeviation(gi, 'Content')} className="mr-2 text-slate-400 group-hover:text-blue-500" title="Analyze Goal Achievement">●</button>
                                                    <div className="flex-1"><EditableBubble path={g.path} text={g.text} onUpdate={onBubbleUpdate} extraClasses={`!bg-transparent ${g.type === 'sub' ? 'text-sm text-slate-600' : 'text-base text-slate-800'}`} /></div>
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
                    <EditorToolbar editorRef={editorRef} />
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
};

export default function App() {
    const [firebase, setFirebase] = useState({ app: null, auth: null, db: null, userId: null });
    const [isLoading, setIsLoading] = useState(true);
    const [view, setView] = useState('goalSetting');
    const [initialData, setInitialData] = useState({
        goalStructure: { metadata: { target_venue: '', working_title: '', keywords: [] }, paper_outline: [] },
        editorText: ''
    });

    const logEvent = useCallback(async (eventName, details = {}) => {
        if (!firebase.db || !firebase.userId) return;
        try {
            const logData = {
                eventName,
                timestamp: serverTimestamp(),
                ...details
            };
            await addDoc(collection(firebase.db, `artifacts/${appId}/users/${firebase.userId}/logs`), logData);
        } catch (error) {
            console.error("Error logging event:", error);
        }
    }, [firebase.db, firebase.userId]);

    useEffect(() => {
        if (!firebaseConfig) {
            console.error("Firebase config is missing.");
            setIsLoading(false);
            return;
        }
        
        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                setFirebase({ app, auth, db, userId: user.uid });
                const dataRef = doc(db, `artifacts/${appId}/users/${user.uid}/data/main_document`);
                const docSnap = await getDoc(dataRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setInitialData({
                        goalStructure: data.goalStructure || initialData.goalStructure,
                        editorText: data.editorText || ''
                    });
                    setView('writing');
                }
                await logEvent('user_session_started');
                setIsLoading(false);
            } else {
                 if (initialAuthToken) {
                    signInWithCustomToken(auth, initialAuthToken).catch(err => {
                        console.error("Custom token sign-in failed, trying anonymous", err);
                        signInAnonymously(auth);
                    });
                } else {
                    signInAnonymously(auth);
                }
            }
        });
    }, []);
    
    const handleConfirmGoal = () => {
        logEvent('goal_setting_confirmed');
        setView('writing');
    }

    if (isLoading) {
        return <div className="flex items-center justify-center h-screen bg-slate-100 text-slate-700">Loading...</div>;
    }

    return (
        <div className="bg-slate-100 overflow-hidden">
            {view === 'goalSetting' ? (
                <GoalSettingView
                    goalStructure={initialData.goalStructure}
                    setGoalStructure={(gs) => setInitialData(p => ({ ...p, goalStructure: gs }))}
                    onConfirm={handleConfirmGoal}
                />
            ) : (
                <WritingView
                    firebase={firebase}
                    initialData={initialData}
                    logEvent={logEvent}
                />
            )}
        </div>
    );
}
