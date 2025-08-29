
export default function EditorToolBarComponent({ editorRef }) {

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
}