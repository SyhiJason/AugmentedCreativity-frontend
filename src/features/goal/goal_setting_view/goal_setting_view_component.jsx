import {useEffect, useRef, useState} from "react";
import GeminiApi from "../../../services/gemini_api.jsx";
import GoalStructureInteractiveComponent from "../goal_structure_interactive/goal_structure_interactive_component.jsx";
import ChatbotBubbleComponent from "../../chatbot/chatbot_bubble_component.jsx";

export default function GoalSettingView({ goalStructure, setGoalStructure, onConfirm }) {
    const geminiApi = new GeminiApi();

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
    async function handleSend () {
        if (!input.trim() || isBusy) return;
        const userInput = input;
        addMessage('user', userInput);
        setInput('');
        setIsBusy(true);
        if (state === 'awaiting_initial_idea') {
            const metadata = await geminiApi.callLLM('metadata', { idea: userInput });

            setGoalStructure(p => {
                return { ...p, metadata }
            });
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
                if (!p) return p;

                const newOutline = [...(p.paper_outline || [])];
                newOutline[currentSectionIdx] = { section_name: userInput, objective: '', key_points: [] };
                return { ...p, paper_outline: newOutline };
            });
            setState('awaiting_section_objective_description');
            addMessage('assistant', `Got it. Now, please briefly describe the main goal of the **${userInput}** section.`);
        } else if (state === 'awaiting_section_objective_description') {
            const data = await geminiApi.callLLM('objective', { description: userInput });
            setGoalStructure(p => {
                if (!p) return p;

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
    }

    return (
        <div className="flex h-full w-full bg-slate-100 text-slate-800">
            <div className="flex flex-col h-full w-1/2 bg-slate-50">
                <div className="h-[3.5rem] px-4 border-b border-slate-200  font-bold text-black flex flex-row items-center">
                    <div>
                        Phase 1: Goal Setting
                    </div>
                </div>
                <main className="flex-1 p-4 overflow-y-auto space-y-4 flex flex-col">
                    {chat.map((m, i) => (<ChatbotBubbleComponent key={i} role={m.role} message={m.text} />))}
                    {isBusy && <div className="text-sm text-slate-500 self-start">Writing Assistant is thinking...</div>}
                    <div ref={endRef} />
                </main>
                <footer className="p-4 border-t border-slate-200 bg-slate-100">
                    <div className="relative flex items-start space-x-2">
                        <textarea className="relative resize-none h-[4rem] flex-1 py-2 pl-3 pr-[50px] bg-white border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder="Enter your response..." rows="1" />
                        <button
                            className="absolute flex items-center justify-center right-[15px] bottom-[5px] w-[35px] h-[35px] rounded-full bg-blue-600 text-white cursor-pointer hover:bg-blue-500 disabled:bg-blue-400"
                            onClick={handleSend} disabled={isBusy}>
                            <div>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3"
                                     stroke="currentColor" className="size-5">
                                    <path strokeLinecap="round" strokeLinejoin="round"
                                          d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18"/>
                                </svg>
                            </div>
                        </button>
                    </div>
                </footer>
            </div>
            <div className="flex flex-col h-full w-1/2 bg-white border-l border-slate-200">
                <div
                    className="h-[3.5rem] px-4 border-b border-slate-200  font-bold text-black flex flex-row items-center">
                    <div className={"flex-1"}>
                        Goal Structure
                    </div>
                    <div onClick={() => setIsRawView(!isRawView)} className="px-3 py-1.5 cursor-pointer text-sm bg-slate-200 text-slate-700 rounded hover:bg-slate-300">{isRawView ? 'Interactive View' : 'Raw JSON View'}</div>
                </div>

                <div className="flex-1 overflow-y-auto bg-white">
                    {isRawView ? (
                        <textarea value={rawText} onChange={handleRawChange} className={`w-full h-full p-4 text-sm font-mono bg-transparent outline-none resize-none ${!isJsonValid ? 'text-red-500' : ''}`} />
                    ) : (
                        <GoalStructureInteractiveComponent structure={goalStructure} />
                    )}
                </div>
                <footer className="p-4 border-t border-slate-200 text-right">
                    <div className={"h-[4rem] flex items-center justify-end"}>
                        <button onClick={onConfirm} className="px-4 py-2 bg-green-700 text-white font-semibold rounded cursor-pointer hover:bg-green-900 disabled:bg-gray-300 disabled:cursor-not-allowed"  disabled={state !== 'finalizing' || !isJsonValid}>Confirm & Start Writing</button>
                    </div>
                </footer>
            </div>
        </div>
    );
}