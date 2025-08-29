import {useCallback, useEffect, useRef, useState} from "react";

export default function DraggableModalComponent({ show, onClose, title, children }) {
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
}