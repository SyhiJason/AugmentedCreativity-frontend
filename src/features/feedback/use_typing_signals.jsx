import { useCallback, useRef } from "react";

// Observable writing behaviour used by the timing model (paper §4.3).
// Structural boundaries are independent features; they are not read as cognitive states.
const WINDOW_MS = 10000;

export default function useTypingSignals() {
    const state = useRef({ events: [], lastEditAt: Date.now() });

    const recordEdit = useCallback((prevText, nextText) => {
        const delta = nextText.length - prevText.length;
        const now = Date.now();
        state.current.events.push({ t: now, ins: Math.max(delta, 0), del: Math.max(-delta, 0) });
        state.current.lastEditAt = now;
    }, []);

    const snapshot = useCallback((textarea) => {
        const now = Date.now();
        const s = state.current;
        s.events = s.events.filter(e => now - e.t <= WINDOW_MS);
        const ins = s.events.reduce((a, e) => a + e.ins, 0);
        const del = s.events.reduce((a, e) => a + e.del, 0);
        const before = textarea ? textarea.value.slice(0, textarea.selectionStart ?? 0) : '';
        return {
            pauseMs: now - s.lastEditAt,
            typingRate: ins / (WINDOW_MS / 1000),
            deleteRatio: ins + del > 0 ? del / (ins + del) : 0,
            sentenceEnd: /[.!?]["')\]]?[ \t]*$/.test(before),
            paragraphEnd: /\n[ \t]*$/.test(before),
        };
    }, []);

    return { recordEdit, snapshot };
}
