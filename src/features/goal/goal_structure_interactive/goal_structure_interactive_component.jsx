import {useMemo} from "react";

// FIX: Made this component more robust to handle cases where `structure` or its properties might be undefined.
export default function GoalStructureInteractiveComponent({ structure }) {

    const working_title = useMemo(() => {
        return structure?.metadata?.working_title || '...';
    }, [structure]);

    const target_venue = useMemo(() => {
        return structure?.metadata?.target_venue || '...';
    }, [structure]);

    const keywords = useMemo(() => {
        return (structure?.metadata?.keywords || []).join(', ') || '...';
    }, [structure]);

    const paper_outline = useMemo(() => {
        return structure?.paper_outline || [];
    }, [structure]);

    return (
        <div className="p-4 space-y-4 text-sm text-slate-600">
            <div>
                <h3 className="font-bold text-slate-900">Metadata</h3>
                <p><strong>Title:</strong> { working_title }</p>
                <p><strong>Venue:</strong> { target_venue }</p>
                <p><strong>Keywords:</strong> { keywords }</p>
            </div>
            <div>
                <h3 className="font-bold text-slate-900 mt-4">Paper Outline</h3>
                {paper_outline.map((s, i) => (
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
}