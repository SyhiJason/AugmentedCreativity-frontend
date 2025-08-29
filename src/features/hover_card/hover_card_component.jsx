export default function HoverCardComponent({ visible, anchorRect, title, sentences = [], llm = null, onClose }) {
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
}