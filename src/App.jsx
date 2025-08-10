import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// --- IMPORTANT: PASTE YOUR API KEY HERE ---
// This key will be visible in your browser's code. This is okay for development,
// but DO NOT deploy this to a public website.
const GEMINI_API_KEY = "AIzaSyBsinouJnEwskZjSDOOY3H0XbchmjxMV8k";

// --- All logic is now in the frontend ---

// 1. Prompts are defined in the frontend. "review" is now an array for sternness levels.
const prompts = {
    metadata: `Based on the following initial paper idea, extract a working title, a target conference/venue, and 5-7 relevant keywords. INITIAL IDEA: "{idea}" Output ONLY a valid JSON object with the keys "working_title", "target_venue", and "keywords".`,
    objective: `Based on the following user description for a paper section, generate a concise one-sentence objective and a bulleted list of key points. USER DESCRIPTION: "{description}" Output ONLY a valid JSON object with two keys: "objective" (a string), and "key_points" (an array of strings).`,
    content: `You are a Content Alignment Critic. Your task is to evaluate how well a given text achieves a specific goal. Provide a score from 1 (not aligned) to 5 (perfectly aligned). Your response MUST be ONLY a valid JSON object with a single key "score". Example: {"score": 4} [GOAL]: "{key_point}" [TEXT]: "{current_text}"`,
    review: [
        // Level 0: Encouraging and gentle
        `You are a friendly peer reviewer. Your goal is to find the strengths in the writing. Focus on whether the core idea is present. Provide a score from 1 (needs more work) to 5 (great start!). Your response MUST be ONLY a valid JSON object with a single key "score". Example: {"score": 4} [KEY POINT CONTEXT]: "{key_point}" [TEXT TO REVIEW]: "{current_text}"`,
        // Level 1: Standard "Reviewer 2"
        `You are "Reviewer 2" for the ACM CHI conference. Your review is guided by CHI standards. Your primary criterion is: Does this submission provide a strong contribution to HCI? Provide a score from 1 (unsuitable) to 5 (excellent). Your response MUST be ONLY a valid JSON object with a single key "score". Example: {"score": 3} [KEY POINT CONTEXT]: "{key_point}" [TEXT TO REVIEW]: "{current_text}"`,
        // Level 2: Harsh and critical
        `You are a highly critical and skeptical reviewer for a top-tier journal. You are looking for any reason to reject this paper. Is the argument flawless? Is the evidence overwhelming? Be extremely critical. Provide a score from 1 (major flaws) to 5 (barely acceptable). Your response MUST be ONLY a valid JSON object with a single key "score". Example: {"score": 2} [KEY POINT CONTEXT]: "{key_point}" [TEXT TO REVIEW]: "{current_text}"`
    ],
    summary: `You are a research writing assistant. Analyze the user's text to see if it achieves the stated goal. Be concise and encouraging. Explain how it achieves the goal, or what is missing if it does not. [GOAL]: "{key_point}" [USER TEXT]: "{current_text}" Your response MUST be ONLY a valid JSON object with a single key "summary_text".`,
    suggestion: `You are an expert writing coach. Your goal is to analyze why a piece of text is failing. You are given: [GOAL]: "{key_point}", [TEXT]: "{current_text}", [PROBLEM]: "{problem_description}". Generate a "state_description" (why the text is failing) and a "suggestion" (an actionable piece of advice). Your response MUST be ONLY a valid JSON object with two keys: "state_description" and "suggestion".`
};

// 2. The function to call the Google Gemini API is in the frontend
async function callGoogleAPI(prompt) {
    if (GEMINI_API_KEY === "PASTE_YOUR_GEMINI_API_KEY_HERE") {
        console.error("API Key not set. Please add your key to the GEMINI_API_KEY constant.");
        return JSON.stringify({ error: "API Key not configured." });
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.json();
            console.error("Google API Error:", errorBody);
            throw new Error(`Google API call failed: ${response.status}`);
        }

        const data = await response.json();
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            return data.candidates[0].content.parts[0].text;
        }
        return JSON.stringify({ error: "No content returned from Google API" });

    } catch (error) {
        console.error("Error in callGoogleAPI:", error);
        return JSON.stringify({ error: `Failed to communicate with Google API: ${error.message}` });
    }
}


// 3. The main callLLM function orchestrates the API call
async function callLLM(promptType, replacements = {}, sternness = 1) {
    let promptTemplate;
    if (promptType === 'review') {
        promptTemplate = prompts.review[sternness];
    } else {
        promptTemplate = prompts[promptType];
    }

    if (!promptTemplate) {
        console.error('Invalid prompt type or sternness level:', promptType, sternness);
        return {};
    }

    let finalPrompt = promptTemplate;
    for (const key in replacements) {
        finalPrompt = finalPrompt.replace(new RegExp(`{${key}}`, 'g'), replacements[key]);
    }

    try {
        const resultJsonString = await callGoogleAPI(finalPrompt);
        return JSON.parse(resultJsonString);
    } catch (error) {
        console.error(`Error processing LLM response for prompt type ${promptType}:`, error);
        return {};
    }
}


const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), delay);
    };
};

// --- React Components (Styled for Cursor-like UI) ---
const ChatBubble = ({ role, text }) => ( <div className={`max-w-[80%] p-3 rounded-lg break-words ${role === 'user' ? 'bg-blue-600 text-white self-end rounded-br-none' : 'bg-neutral-700 text-neutral-200 self-start rounded-bl-none'}`}>{text}</div> );

const GoalStructureInteractiveView = ({ structure }) => (
    <div className="p-4 space-y-4 text-sm text-neutral-300">
        <div>
            <h3 className="font-bold text-neutral-100">Metadata</h3>
            <p><strong>Title:</strong> {structure.metadata.working_title || '...'}</p>
            <p><strong>Venue:</strong> {structure.metadata.target_venue || '...'}</p>
            <p><strong>Keywords:</strong> {(structure.metadata.keywords || []).join(', ') || '...'}</p>
        </div>
        <div>
            <h3 className="font-bold text-neutral-100 mt-4">Paper Outline</h3>
            {(structure.paper_outline || []).map((section, idx) => (
                <div key={idx} className="mt-2 p-3 bg-neutral-800/50 rounded-lg">
                    <p className="font-semibold text-neutral-200">{section.section_name || `Section ${idx + 1}`}</p>
                    <p className="text-xs italic text-neutral-400">{section.objective || '...'}</p>
                    <ul className="list-disc list-inside pl-2 mt-1 text-neutral-300">
                        {(section.key_points || []).map((kp, kpIdx) => <li key={kpIdx}>{typeof kp === 'string' ? kp : kp.text}</li>)}
                    </ul>
                </div>
            ))}
        </div>
    </div>
);

const GoalSettingView = ({ goalStructure, setGoalStructure, onConfirm }) => {
    const [chatHistory, setChatHistory] = useState([{ role: 'assistant', text: "Hello! I'm your Writing Assistant. To begin, please tell me your initial paper idea." }]);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [gsState, setGsState] = useState('awaiting_initial_idea');
    const [totalSections, setTotalSections] = useState(0);
    const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
    const [isRawView, setIsRawView] = useState(false);
    const [rawJsonText, setRawJsonText] = useState(JSON.stringify(goalStructure, null, 2));
    const [isJsonValid, setIsJsonValid] = useState(true);
    const chatEndRef = useRef(null);

    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatHistory]);
    useEffect(() => { if (!isRawView) { setRawJsonText(JSON.stringify(goalStructure, null, 2)); } }, [goalStructure, isRawView]);

    const addMessage = (role, text) => setChatHistory(prev => [...prev, { role, text }]);
    const handleRawJsonChange = (e) => {
        const text = e.target.value;
        setRawJsonText(text);
        try { setGoalStructure(JSON.parse(text)); setIsJsonValid(true); } catch (error) { setIsJsonValid(false); }
    };

    const handleSend = async () => {
        if (!userInput.trim()) return;
        addMessage('user', userInput);
        const currentInput = userInput;
        setUserInput('');
        setIsLoading(true);
        if (gsState === 'awaiting_initial_idea') {
            const metadata = await callLLM('metadata', { idea: currentInput });
            setGoalStructure(prev => ({ ...prev, metadata }));
            setGsState('awaiting_section_count');
            addMessage('assistant', `Thanks! I've populated the metadata. Now, how many main sections will your paper have?`);
        } else if (gsState === 'awaiting_section_count') {
            const count = parseInt(currentInput, 10) || 0;
            if (count > 0) {
                setTotalSections(count);
                setCurrentSectionIndex(0);
                setGsState('awaiting_section_name');
                addMessage('assistant', `Great. What is the title of **Section 1**?`);
            } else { addMessage('assistant', "Please enter a valid number."); }
        } else if (gsState === 'awaiting_section_name') {
            setGoalStructure(prev => {
                const newOutline = [...(prev.paper_outline || [])];
                newOutline[currentSectionIndex] = { section_name: currentInput, objective: "", key_points: [] };
                return { ...prev, paper_outline: newOutline };
            });
            setGsState('awaiting_section_objective_description');
            addMessage('assistant', `Got it. Now, please briefly describe the main goal of the **${currentInput}** section.`);
        } else if (gsState === 'awaiting_section_objective_description') {
            const refinedData = await callLLM('objective', { description: currentInput });
            setGoalStructure(prev => {
                const newOutline = [...prev.paper_outline];
                newOutline[currentSectionIndex] = { ...newOutline[currentSectionIndex], objective: refinedData.objective || "", key_points: refinedData.key_points || [] };
                return { ...prev, paper_outline: newOutline };
            });
            const nextIndex = currentSectionIndex + 1;
            if (nextIndex < totalSections) {
                setCurrentSectionIndex(nextIndex);
                setGsState('awaiting_section_name');
                addMessage('assistant', `Excellent. What is the title of **Section ${nextIndex + 1}**?`);
            } else {
                setGsState('finalizing');
                addMessage('assistant', 'Great! The initial plan is complete. Please review it, then click "Confirm & Start Writing".');
            }
        }
        setIsLoading(false);
    };

    return (
        <div className="flex h-screen w-full bg-neutral-900 text-neutral-200">
            <div className="flex flex-col w-full md:w-1/2 h-full bg-neutral-800">
                <header className="p-4 border-b border-neutral-700"><h1 className="text-xl font-bold text-neutral-100">Phase 1: Goal Setting</h1></header>
                <main className="flex-1 p-4 overflow-y-auto space-y-4 flex flex-col">
                    {chatHistory.map((msg, i) => <ChatBubble key={i} role={msg.role} text={msg.text} />)}
                    {isLoading && <div className="text-sm text-neutral-400 self-start">Writing Assistant is thinking...</div>}
                    <div ref={chatEndRef} />
                </main>
                <footer className="p-4 border-t border-neutral-700">
                    <div className="flex items-start space-x-2">
                        <textarea value={userInput} onChange={e => setUserInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} className="flex-1 p-3 bg-neutral-700 border border-neutral-600 rounded-lg text-neutral-200 placeholder-neutral-400 focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="Enter your response..." rows="1" disabled={isLoading}></textarea>
                        <button onClick={handleSend} className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 disabled:bg-neutral-600" disabled={isLoading}>Send</button>
                    </div>
                </footer>
            </div>
            <div className="flex flex-col w-full md:w-1/2 h-full bg-neutral-900">
                <header className="p-4 border-b border-neutral-700 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-neutral-100">Goal Structure</h2>
                    <button onClick={() => setIsRawView(!isRawView)} className="px-3 py-1.5 text-sm bg-neutral-700 rounded-md hover:bg-neutral-600">{isRawView ? 'Interactive View' : 'Raw JSON View'}</button>
                </header>
                <div className="flex-1 overflow-y-auto bg-neutral-900">
                    {isRawView ? (<textarea value={rawJsonText} onChange={handleRawJsonChange} className={`w-full h-full p-4 text-sm font-mono bg-transparent outline-none resize-none ${!isJsonValid ? 'border-2 border-red-500' : 'border-neutral-700'}`}/>) : (<GoalStructureInteractiveView structure={goalStructure} />)}
                </div>
                <footer className="p-4 border-t border-neutral-700 text-right">
                    <button onClick={onConfirm} className="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg disabled:bg-neutral-600 hover:bg-green-500" disabled={gsState !== 'finalizing' || !isJsonValid}>Confirm & Start Writing</button>
                </footer>
            </div>
        </div>
    );
};
const EditableBubble = ({ path, text, onUpdate, extraClasses = '' }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(text);
    const inputRef = useRef(null);
    useEffect(() => { setValue(text); }, [text]);
    useEffect(() => { if (isEditing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [isEditing]);
    const handleFinishEditing = () => { setIsEditing(false); onUpdate(path, value); };
    if (isEditing) {
        return <input ref={inputRef} type="text" value={value} onChange={e => setValue(e.target.value)} onBlur={handleFinishEditing} onKeyDown={e => e.key === 'Enter' && handleFinishEditing()} className={`bubble-input w-full bg-neutral-700 text-neutral-100 rounded-md p-2 ${extraClasses}`} />;
    }
    return <div onDoubleClick={() => setIsEditing(true)} className={`goal-bubble-dark ${extraClasses}`}>{text}</div>;
};

const EditorToolbar = ({ editorRef }) => {
    const applyWrapper = (prefix, suffix = '') => {
        const editor = editorRef.current; if (!editor) return;
        const { selectionStart, selectionEnd, value } = editor;
        const selectedText = value.substring(selectionStart, selectionEnd);
        
        if (selectionStart === selectionEnd) {
             editor.setRangeText(prefix + suffix, selectionStart, selectionEnd, 'end');
             if (suffix) {
                 editor.selectionStart = editor.selectionEnd = selectionStart + prefix.length;
             }
        } else {
            editor.setRangeText(prefix + selectedText + suffix, selectionStart, selectionEnd, 'select');
        }
        editor.focus();
    };

    const applyLinePrefix = (prefix) => {
        const editor = editorRef.current; if (!editor) return;
        const { selectionStart, selectionEnd, value } = editor;
        
        let start = value.lastIndexOf('\n', selectionStart - 1) + 1;
        let effectiveEnd = selectionEnd;
        if (value[selectionEnd - 1] === '\n') {
            effectiveEnd = selectionEnd - 1;
        }
        
        const originalSelection = value.substring(start, effectiveEnd);
        const lines = originalSelection.split('\n');
        const transformedLines = lines.map(line => prefix + line).join('\n');

        editor.setRangeText(transformedLines, start, effectiveEnd, 'select');
        editor.focus();
    };

    const buttonClass = "p-2 rounded-md text-neutral-300 hover:bg-neutral-700 w-9 h-9 flex items-center justify-center";

    return (
        <div className="flex items-center p-2 border-b border-neutral-700 bg-neutral-800 gap-x-1 flex-wrap">
            <button onClick={() => applyWrapper('**', '**')} className={buttonClass} title="Bold"><strong className="text-base">B</strong></button>
            <button onClick={() => applyWrapper('*', '*')} className={buttonClass} title="Italic"><em className="text-base">I</em></button>
            <div className="w-px h-5 bg-neutral-600 mx-1"></div>
            <button onClick={() => applyLinePrefix('# ')} className={buttonClass} title="Heading 1"><span className="font-bold text-sm">H1</span></button>
            <button onClick={() => applyLinePrefix('## ')} className={buttonClass} title="Heading 2"><span className="font-bold text-sm">H2</span></button>
            <button onClick={() => applyLinePrefix('### ')} className={buttonClass} title="Heading 3"><span className="font-bold text-sm">H3</span></button>
            <div className="w-px h-5 bg-neutral-600 mx-1"></div>
            <button onClick={() => applyLinePrefix('> ')} className={buttonClass} title="Blockquote">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M12 12a1 1 0 0 0 1-1V8.558a1 1 0 0 0-1-1h-1.388q.354-1.168.832-2.651.13-.384.136-.42a1 1 0 0 0-1-1h-2.167q-.214 0-.333.224a1 1 0 0 0-.135.437q-.427 1.43-.923 2.975-1.15 3.55-1.83 4.886a1 1 0 0 0 .096.884l.263.363a1 1 0 0 0 .884.524h1.37q.413 0 .73-.224a1 1 0 0 0 .333-.437q.16-.427.427-1.168t.427-1.168h1.37zm-6 0a1 1 0 0 0 1-1V8.558a1 1 0 0 0-1-1H4.612q.354-1.168.832-2.651.13-.384.136-.42a1 1 0 0 0-1-1H2.417q-.214 0-.333.224a1 1 0 0 0-.135.437q-.427 1.43-.923 2.975-1.15 3.55-1.83 4.886a1 1 0 0 0 .096.884l.263.363a1 1 0 0 0 .884.524h1.37q.413 0 .73-.224a1 1 0 0 0 .333-.437q.16-.427.427-1.168t.427-1.168h1.37z"/></svg>
            </button>
            <button onClick={() => applyLinePrefix('- ')} className={buttonClass} title="Bulleted List">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m-2-4A.5.5 0 0 1 3.5 7h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m-2-4A.5.5 0 0 1 1.5 3h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5"/></svg>
            </button>
            <button onClick={() => applyLinePrefix('1. ')} className={buttonClass} title="Numbered List">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M2 12.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5M.5 9.2a.5.5 0 0 1 0-.4L1.2 8H2a.5.5 0 0 1 0 1H1.2l-.3.6a.5.5 0 0 1-.7.2 1 1 0 0 1-.7-1m1.5-3.2A.5.5 0 0 1 2.5 6h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m-1.5-3A.5.5 0 0 1 1.5 3h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5"/></svg>
            </button>
            <button onClick={() => applyWrapper('\n```javascript\n', '\n```\n')} className={buttonClass} title="Code Block">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.478 1.647a.5.5 0 1 0-.956.294l-4 13a.5.5 0 0 0 .956.294zM4.854 4.146a.5.5 0 0 1 0 .708L1.707 8l3.147 3.146a.5.5 0 0 1-.708.708l-3.5-3.5a.5.5 0 0 1 0-.708l3.5-3.5a.5.5 0 0 1 .708 0m6.292 0a.5.5 0 0 0 0 .708L14.293 8l-3.147 3.146a.5.5 0 0 0 .708.708l3.5-3.5a.5.5 0 0 0 0-.708l-3.5-3.5a.5.5 0 0 0-.708 0"/></svg>
            </button>
        </div>
    );
};

const DraggableModal = ({ show, onClose, title, children }) => {
    const [pos, setPos] = useState({ x: window.innerWidth / 2 - 224, y: 100 });
    const [dragging, setDragging] = useState(false);
    const [rel, setRel] = useState(null);
    const modalRef = useRef(null);
    const onMouseDown = (e) => {
        if (e.button !== 0 || !modalRef.current.contains(e.target) || e.target.tagName === 'BUTTON') return;
        const header = e.currentTarget; if (!header.classList.contains('modal-header')) return;
        setDragging(true);
        const modal = modalRef.current;
        setRel({ x: e.pageX - modal.offsetLeft, y: e.pageY - modal.offsetTop });
        e.stopPropagation(); e.preventDefault();
    };
    const onMouseUp = useCallback((e) => { setDragging(false); e.stopPropagation(); e.preventDefault(); }, []);
    const onMouseMove = useCallback((e) => {
        if (!dragging) return;
        setPos({ x: e.pageX - rel.x, y: e.pageY - rel.y });
        e.stopPropagation(); e.preventDefault();
    }, [dragging, rel]);
    useEffect(() => {
        if (dragging) {
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, [dragging, onMouseMove, onMouseUp]);
    if (!show) return null;
    return (
        <div ref={modalRef} style={{ left: `${pos.x}px`, top: `${pos.y}px` }} className="fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl p-4 w-full max-w-md z-50 text-neutral-200">
            <div onMouseDown={onMouseDown} className="modal-header flex justify-between items-center mb-4 pb-2 border-b border-neutral-700 cursor-move">
                <h3 className="text-lg font-bold text-neutral-100">{title}</h3>
                <button onClick={onClose} className="text-neutral-400 hover:text-white">&times;</button>
            </div>
            <div>{children}</div>
        </div>
    );
};

const WritingView = ({ goalStructure, setGoalStructure }) => {
    const [editorText, setEditorText] = useState('');
    const [analysisData, setAnalysisData] = useState({ contentScores: [], reviewScores: [] });
    const [modalInfo, setModalInfo] = useState({ show: false, stage: '', title: '', content: {} });
    const [hoveredKeyPointIndex, setHoveredKeyPointIndex] = useState(null);
    const editorRef = useRef(null);
    
    const [reviewerSternness, setReviewerSternness] = useState(1);
    const [debounceDelay, setDebounceDelay] = useState(300);
    const [hintThreshold, setHintThreshold] = useState(3);
    const [showHintModal, setShowHintModal] = useState(false);

    const flatGoalList = useMemo(() => {
        const list = [];
        (goalStructure.paper_outline || []).forEach((section, sectionIdx) => {
            (section.key_points || []).forEach((kp, kpIdx) => {
                const kpPath = `paper_outline.${sectionIdx}.key_points.${kpIdx}`;
                list.push({ text: typeof kp === 'string' ? kp : kp.text, path: kpPath, type: 'main', sectionIdx });
                if (typeof kp === 'object' && kp.sub_goals) {
                    kp.sub_goals.forEach((sg, sgIdx) => list.push({ text: sg, path: `${kpPath}.sub_goals.${sgIdx}`, type: 'sub', sectionIdx }));
                }
            });
        });
        return list;
    }, [goalStructure]);

    const totalGoalCount = flatGoalList.length;

    const updateDeeply = (obj, path, action) => {
        const newObj = JSON.parse(JSON.stringify(obj));
        let current = newObj;
        const keys = path.split('.');
        for (let i = 0; i < keys.length - 1; i++) { current = current[keys[i]]; }
        action(current, keys[keys.length - 1]);
        return newObj;
    };

    const handleBubbleUpdate = (path, newValue) => {
        const newStructure = updateDeeply(goalStructure, path, (parent, key) => {
            const item = parent[key];
            if (typeof item === 'object' && item !== null && item.hasOwnProperty('text')) { item.text = newValue; } else { parent[key] = newValue; }
        });
        setGoalStructure(newStructure);
    };

    const handleAddNode = (path) => {
        const newStructure = JSON.parse(JSON.stringify(goalStructure));
        const keys = path.split('.');
        const insertIndex = parseInt(keys.pop(), 10);
        let parentArray = newStructure;
        for (let i = 0; i < keys.length; i++) { parentArray = parentArray[keys[i]]; }
        if (Array.isArray(parentArray)) {
            const newItem = path.includes('sub_goals') ? "New Sibling Sub-goal" : { text: "New Sibling Goal", sub_goals: [] };
            parentArray.splice(insertIndex + 1, 0, newItem);
        }
        setGoalStructure(newStructure);
    };

    const handleDeleteNode = (path) => {
        const newStructure = JSON.parse(JSON.stringify(goalStructure));
        const keys = path.split('.');
        const deleteIndex = parseInt(keys.pop(), 10);
        let parentArray = newStructure;
        for (let i = 0; i < keys.length; i++) { parentArray = parentArray[keys[i]]; }
        if (Array.isArray(parentArray)) { parentArray.splice(deleteIndex, 1); }
        setGoalStructure(newStructure);
    };

    const analyzeText = useCallback(async (text, structure, sternness, threshold) => {
        if (text.trim() === '') {
            setAnalysisData({ contentScores: [], reviewScores: [] });
            return;
        }
        if (flatGoalList.length === 0) return;

        try {
            let problemCount = 0;
            const contentScores = Array(totalGoalCount).fill(0);
            const reviewScores = Array(totalGoalCount).fill(0);

            const analysisPromises = flatGoalList.map(async (goal, index) => {
                if (text.includes(goal.text)) {
                    const [contentRes, reviewRes] = await Promise.all([
                        callLLM('content', { key_point: goal.text, current_text: text }),
                        callLLM('review', { key_point: goal.text, current_text: text }, sternness)
                    ]);

                    const contentScore = contentRes.score ? (contentRes.score - 1) / 4 : 0;
                    const reviewScore = reviewRes.score ? (reviewRes.score - 1) / 4 : 0;
                    
                    contentScores[index] = contentScore;
                    reviewScores[index] = reviewScore;

                    if (contentScore < 0.5 || reviewScore < 0.5) {
                        problemCount++;
                    }
                }
            });

            await Promise.all(analysisPromises);
            
            setAnalysisData({ contentScores, reviewScores });

            if (problemCount >= threshold) {
                setShowHintModal(true);
            }

        } catch (error) {
            console.error("Error during analysis:", error);
            setAnalysisData({ contentScores: Array(totalGoalCount).fill(0), reviewScores: Array(totalGoalCount).fill(0) });
        }
    }, [totalGoalCount, flatGoalList]);

    const debouncedAnalyzeText = useMemo(() => {
        return debounce((...args) => analyzeText(...args), debounceDelay);
    }, [analyzeText, debounceDelay]);

    useEffect(() => {
        debouncedAnalyzeText(editorText, goalStructure, reviewerSternness, hintThreshold);
    }, [editorText, goalStructure, reviewerSternness, hintThreshold, debouncedAnalyzeText]);
    
    const openKeyPointModal = async (keyPointText) => {
        setModalInfo({ show: true, stage: 'loading_summary', title: `Analyzing...` });
        if (editorText.trim() === '') {
            setModalInfo({ show: true, stage: 'display_summary', title: `Goal Analysis`, content: { summary_text: "Please start writing to get an analysis." } });
            return;
        }
        try {
            const data = await callLLM('summary', { current_text: editorText, key_point: keyPointText });
            setModalInfo({ show: true, stage: 'display_summary', title: `Goal Analysis`, content: data });
        } catch (error) {
            setModalInfo({ show: true, stage: 'display_summary', title: 'Error', content: { summary_text: "Could not retrieve summary." } });
        }
    };
    
    const openDeviationModal = (keyPointIndex, type) => {
        const score = type === 'Content' ? analysisData.contentScores[keyPointIndex] : analysisData.reviewScores[keyPointIndex];
        if (score === 0 && !editorText.includes(flatGoalList[keyPointIndex].text)) return;
        const keyPoint = flatGoalList[keyPointIndex];
        setModalInfo({ show: true, stage: 'deviation_analysis', title: `Action for: "${keyPoint.text}"`, content: { keyPointText: keyPoint.text, type } });
    };

    const handleSeekAdvice = async (info = modalInfo) => {
        const { keyPointText, type } = info.content;
        setModalInfo(prev => ({ ...prev, stage: 'seeking_advice', title: "Seeking Advice..." }));
        try {
            const problem = type === 'Content' ? "Content Score is low." : "Review Score is low.";
            const suggestionData = await callLLM('suggestion', {
                current_text: editorText,
                key_point: keyPointText,
                problem_description: problem
            });
            setModalInfo(prev => ({...prev, stage: 'advice_displayed', title: 'Suggestions', content: {...prev.content, ...suggestionData}}));
        } catch (error) {
            setModalInfo(prev => ({...prev, stage: 'advice_displayed', title: 'Error', content: {...prev.content, state_description: "Error", suggestion: "Could not fetch suggestion."}}));
        }
    };
    
    const handleGeneralHint = () => {
        const firstProblemIndex = analysisData.contentScores.findIndex((s, i) => s < 0.5 || analysisData.reviewScores[i] < 0.5);
        if (firstProblemIndex !== -1) {
            const keyPoint = flatGoalList[firstProblemIndex];
            const type = analysisData.contentScores[firstProblemIndex] < 0.5 ? 'Content' : 'Review';
            const specificModalInfo = {
                show: true,
                stage: 'deviation_analysis',
                title: `Action for: "${keyPoint.text}"`,
                content: { keyPointText: keyPoint.text, type }
            };
            setModalInfo(specificModalInfo);
            handleSeekAdvice(specificModalInfo);
        }
        setShowHintModal(false);
    };

    const renderModalContent = () => {
        const { stage, content } = modalInfo;
        switch (stage) {
            case 'loading_summary': return <p>Fetching analysis from the Gemini API...</p>;
            case 'display_summary': return <p className="text-neutral-300">{content.summary_text}</p>;
            case 'deviation_analysis':
                return (
                    <div className="space-y-4">
                        <p>Your writing for this goal seems off-track. How would you like to proceed?</p>
                        <div className="flex justify-end items-center pt-4 mt-4 border-t border-neutral-700 gap-x-2">
                             <button onClick={() => { setModalInfo({show: false}) }} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-500">Update Goal</button>
                             <button onClick={() => handleSeekAdvice()} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-500">Seek Advice</button>
                         </div>
                    </div>
                );
            case 'seeking_advice': return <p>Generating advice from the Gemini API...</p>;
            case 'advice_displayed':
                return (
                    <div className="space-y-3">
                        <div className="p-3 bg-yellow-900/50 border border-yellow-700/50 rounded-lg"><p className="font-semibold text-sm text-yellow-300">Diagnosis:</p><p className="text-sm text-yellow-400">{content.state_description}</p></div>
                        <div className="p-3 bg-green-900/50 border border-green-700/50 rounded-lg"><p className="font-semibold text-sm text-green-300">Suggestion:</p><p className="text-sm text-green-400">{content.suggestion}</p></div>
                    </div>
                );
            default: return null;
        }
    };

    const sternnessLabels = ['Gentle', 'Standard', 'Harsh'];

    return (
        <>
            <style>{`
                .slider-thumb::-webkit-slider-thumb {
                  -webkit-appearance: none;
                  appearance: none;
                  width: 16px;
                  height: 16px;
                  background: #3b82f6; /* blue-600 */
                  border-radius: 9999px;
                  cursor: pointer;
                }
                .slider-thumb::-moz-range-thumb {
                  width: 16px;
                  height: 16px;
                  background: #3b82f6;
                  border-radius: 9999px;
                  cursor: pointer;
                }
            `}</style>
            <DraggableModal show={modalInfo.show} onClose={() => setModalInfo({ show: false })} title={modalInfo.title}>{renderModalContent()}</DraggableModal>
            <DraggableModal show={showHintModal} onClose={() => setShowHintModal(false)} title="Writing Suggestion">
                <div className="space-y-4">
                    <p>It looks like several of your points are not strongly aligned with their goals. Would you like some automated advice?</p>
                    <div className="flex justify-end items-center pt-4 mt-4 border-t border-neutral-700 gap-x-2">
                         <button onClick={() => setShowHintModal(false)} className="px-4 py-2 bg-neutral-600 text-white text-sm font-semibold rounded-lg hover:bg-neutral-500">Dismiss</button>
                         <button onClick={handleGeneralHint} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-500">Get Advice</button>
                     </div>
                </div>
            </DraggableModal>
            
            <div className="flex h-screen w-full bg-neutral-900 text-neutral-300">
                {/* Left Column: Goal Blueprint */}
                <div className="w-[25%] h-full flex flex-col bg-neutral-800/50">
                    <header className="p-4 border-b border-neutral-700">
                        <h2 className="text-xl font-bold text-neutral-100">Goal Blueprint</h2>
                    </header>
                    <div className="flex-1 p-6 overflow-y-auto">
                        <div className="space-y-8">
                            <div>
                                <h3 className="font-bold text-lg text-neutral-200 mb-3 border-b border-neutral-700 pb-2">Metadata</h3>
                                <div className="space-y-3">
                                    <EditableBubble path="metadata.working_title" text={goalStructure.metadata.working_title} onUpdate={handleBubbleUpdate} extraClasses="font-bold text-lg text-neutral-100"/>
                                    <EditableBubble path="metadata.target_venue" text={goalStructure.metadata.target_venue} onUpdate={handleBubbleUpdate} extraClasses="text-base text-neutral-300"/>
                                </div>
                            </div>
                            {(goalStructure.paper_outline || []).map((section, sectionIdx) => (
                                 <div key={sectionIdx}>
                                     <h3 className="font-bold text-lg text-neutral-200 mb-3 border-b border-neutral-700 pb-2 mt-6">{section.section_name}</h3>
                                     <EditableBubble path={`paper_outline.${sectionIdx}.objective`} text={section.objective} onUpdate={handleBubbleUpdate} extraClasses="text-base font-semibold block w-full mb-4 !text-blue-300 !bg-blue-900/20" />
                                     <div className="space-y-2">
                                         {flatGoalList.map((item, flatIdx) => {
                                             if (item.sectionIdx !== sectionIdx) return null;
                                             const isActive = editorText.includes(item.text);
                                             return (
                                                 <div key={item.path} onMouseEnter={() => setHoveredKeyPointIndex(flatIdx)} onMouseLeave={() => setHoveredKeyPointIndex(null)} className={`flex items-center group transition-all duration-200 rounded-md p-1 ${item.type === 'sub' ? 'ml-6' : ''} ${isActive ? 'opacity-100 bg-neutral-700/30' : 'opacity-50'}`}>
                                                     <button onClick={() => openKeyPointModal(item.text)} className="mr-2 text-neutral-600 group-hover:text-blue-400" title="Analyze Goal Achievement">●</button>
                                                     <div className="flex-1"><EditableBubble path={item.path} text={item.text} onUpdate={handleBubbleUpdate} extraClasses={`!bg-transparent ${item.type === 'sub' ? 'text-sm text-neutral-300' : 'text-base text-neutral-200'}`} /></div>
                                                     <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                         <button onClick={() => handleAddNode(item.path)} className="ml-2 text-green-500 hover:text-green-400" title="Add Sibling Goal">[+]</button>
                                                         <button onClick={() => handleDeleteNode(item.path)} className="ml-1 text-red-500 hover:text-red-400" title="Delete Goal">[－]</button>
                                                     </div>
                                                 </div>
                                             )
                                         })}
                                     </div>
                                 </div>
                             ))}
                        </div>
                    </div>
                </div>
                
                {/* Middle Column: Editor */}
                <div className="w-[50%] h-full flex flex-col bg-neutral-900 border-l border-r border-neutral-700">
                    <EditorToolbar editorRef={editorRef} />
                    <textarea ref={editorRef} value={editorText} onChange={e => setEditorText(e.target.value)} className="flex-1 p-8 text-base bg-neutral-900 text-neutral-200 leading-7 focus:outline-none resize-none placeholder-neutral-500" placeholder="Start writing your paper here..."></textarea>
                </div>

                {/* Right Column: Analysis & Sliders */}
                <div className="w-[25%] h-full bg-neutral-800/50 flex flex-col items-center justify-start p-4">
                    <div className="w-full max-w-xs space-y-6 my-8">
                        <div className="text-center">
                            <label className="text-xs font-semibold text-neutral-400 block mb-2">Reviewer Sternness</label>
                            <input type="range" min="0" max="2" step="1" value={reviewerSternness} onChange={e => setReviewerSternness(Number(e.target.value))} className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer slider-thumb"/>
                            <span className="text-xs text-neutral-400">{sternnessLabels[reviewerSternness]}</span>
                        </div>
                        <div className="text-center">
                            <label className="text-xs font-semibold text-neutral-400 block mb-2">Feedback Delay</label>
                            <input type="range" min="100" max="2000" step="100" value={debounceDelay} onChange={e => setDebounceDelay(Number(e.target.value))} className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer slider-thumb"/>
                            <span className="text-xs text-neutral-400">{debounceDelay}ms</span>
                        </div>
                        <div className="text-center">
                            <label className="text-xs font-semibold text-neutral-400 block mb-2">Hint Threshold</label>
                            <input type="range" min="1" max="10" step="1" value={hintThreshold} onChange={e => setHintThreshold(Number(e.target.value))} className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer slider-thumb"/>
                            <span className="text-xs text-neutral-400">{hintThreshold} issues</span>
                        </div>
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                        <div className="flex gap-x-4">
                            {['Content', 'Review'].map(type => (
                                <div key={type} className="text-center">
                                    <div className="mb-2"><p className="text-sm font-semibold text-neutral-400">{type}</p></div>
                                    <div className="flex flex-col items-center gap-y-1.5">
                                        {Array.from({ length: totalGoalCount }).map((_, i) => {
                                            const scores = type === 'Content' ? analysisData.contentScores : analysisData.reviewScores;
                                            const score = scores[i] || 0;
                                            const isActive = editorText.includes(flatGoalList[i]?.text);
                                            const color = type === 'Content' ? `hsl(0, 70%, ${60 - score * 25}%)` : `hsl(210, 70%, ${60 - score * 25}%)`;
                                            const style = isActive && score > 0 ? { backgroundColor: color } : { backgroundColor: '#3f3f46' }; // neutral-700
                                            return <div key={`${type}-${i}`} onClick={() => openDeviationModal(i, type)} className={`w-5 h-5 rounded-md cursor-pointer transition-all ${hoveredKeyPointIndex === i ? 'ring-2 ring-blue-500' : ''}`} style={style} />;
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

export default function App() {
    const [view, setView] = useState('goalSetting');
    const [goalStructure, setGoalStructure] = useState({
        metadata: { target_venue: "", working_title: "", keywords: [] },
        paper_outline: []
    });
    return (
        <div className="bg-neutral-900 overflow-hidden">
            {view === 'goalSetting' ? (
                <GoalSettingView 
                    goalStructure={goalStructure} 
                    setGoalStructure={setGoalStructure} 
                    onConfirm={() => setView('writing')} 
                />
            ) : (
                <WritingView 
                    goalStructure={goalStructure} 
                    setGoalStructure={setGoalStructure} 
                />
            )}
        </div>
    );
}