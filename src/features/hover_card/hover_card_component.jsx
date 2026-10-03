import { DIMENSION_BY_ID } from "../../utils/rubric_tool.jsx";

// Hover summary for one goal in the alignment overview: the judge's flagged dimensions at a glance.
export default function HoverCardComponent({ visible, anchorRect, title, item = null, onClose }) {
    if (!visible || !anchorRect) return null;
    const cardWidth = 300;
    const left = Math.max(8, anchorRect.left - cardWidth - 16);
    const top = Math.min(window.innerHeight - 220, Math.max(8, anchorRect.top));
    const flagged = (item?.dimensions || []).filter(d => d.severity > 0).sort((a, b) => b.severity - a.severity);
    return (
        <div
            className="fixed z-[60] w-[300px] max-h-[220px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl p-3 text-slate-800"
            style={{ left, top }}
            onMouseLeave={onClose}
        >
            <div className="text-xs uppercase tracking-wide text-sky-600 font-semibold mb-1">{title}</div>
            {!item ? (
                <div className="text-xs text-slate-500">Not judged yet.</div>
            ) : flagged.length === 0 ? (
                <div className="text-xs text-slate-500">No rubric dimension flagged for this goal.</div>
            ) : (
                <ul className="space-y-1.5">
                    {flagged.slice(0, 4).map(d => (
                        <li key={d.id} className="text-xs">
                            <span className="font-semibold text-slate-800">{DIMENSION_BY_ID[d.id].label}</span>
                            <span className="text-slate-400"> · severity {d.severity}/5</span>
                            {d.rationale && <div className="text-slate-600">{d.rationale}</div>}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
