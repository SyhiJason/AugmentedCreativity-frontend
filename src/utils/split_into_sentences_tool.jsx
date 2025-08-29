export default function splitIntoSentencesTool(text) {
    if (!text) return [];
    return text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean).map((t, i) => ({ id: i, text: t }));
}