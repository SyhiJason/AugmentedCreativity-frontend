// Two-layer writing rubric (paper §4.1).
// Fixed layer: responsibilities that are relatively stable across scientific writing.
// Dynamic layer: venue-specific expectations and the author's current goal.
// Every dimension must be observable from the text + goals and must be able to cite evidence.
export const RUBRIC = [
    { id: 'evidential_support', layer: 'fixed', label: 'Evidential support', question: 'Do factual, causal and comparative claims have corresponding evidence or explicit citation obligations?' },
    { id: 'internal_consistency', layer: 'fixed', label: 'Internal consistency', question: 'Does the current text conflict with earlier definitions, method limitations, or conclusions?' },
    { id: 'scope_accuracy', layer: 'fixed', label: 'Scope accuracy', question: 'Do claim strength, applicable scope, and evidence coverage match?' },
    { id: 'conceptual_clarity', layer: 'fixed', label: 'Conceptual clarity', question: 'Are key terms defined consistently and are their references traceable?' },
    { id: 'contribution_criteria', layer: 'dynamic', label: 'Venue contribution criteria', question: 'Does the text meet the target venue\'s actual criteria for contribution type and argumentation structure?' },
    { id: 'venue_evidence', layer: 'dynamic', label: 'Venue evidence type', question: 'Are key claims supported by the kind of evidence the target venue typically accepts?' },
    { id: 'author_goal_node', layer: 'dynamic', label: 'Author goal node', question: 'Does the paragraph serve the author\'s declared local argumentative intent for this goal?' },
];

export const DIMENSION_BY_ID = Object.fromEntries(RUBRIC.map(d => [d.id, d]));

export const rubricToPrompt = () => RUBRIC
    .map(d => `- ${d.id} (${d.layer} layer): ${d.question}`)
    .join('\n');

// Escape-safe, whitespace-tolerant search for a sentence inside the editor text.
// Returns { start, end } or null. Used both to verify evidence (reliability feature)
// and to detect stale evidence after the author edits the text.
export const locateEvidence = (text, sentence) => {
    if (!text || !sentence) return null;
    const words = String(sentence).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    const m = new RegExp(pattern).exec(text);
    return m ? { start: m.index, end: m.index + m[0].length } : null;
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Validate / normalise the raw judge JSON so downstream code can trust its shape.
export const normalizeJudgment = (raw) => {
    if (!raw || raw.error || !Array.isArray(raw.dimensions)) return { dimensions: [], error: raw?.error || 'Malformed judgment' };
    const dimensions = raw.dimensions
        .filter(d => d && DIMENSION_BY_ID[d.dimension])
        .map(d => ({
            id: d.dimension,
            layer: DIMENSION_BY_ID[d.dimension].layer,
            // The judge answers "if the problem holds, how severe is it" on a 0-5 scale.
            severity: clamp(Math.round(Number(d.severity) || 0), 0, 5),
            problemType: String(d.problem_type || ''),
            evidence: (Array.isArray(d.evidence) ? d.evidence : [])
                .filter(e => e && typeof e.sentence === 'string' && e.sentence.trim())
                .map(e => ({ sentenceId: e.sentence_id, sentence: e.sentence.trim() })),
            rationale: String(d.rationale || ''),
            suggestedAction: ['revise_text', 'reinterpret_goal'].includes(d.suggested_action) ? d.suggested_action : 'none',
        }));
    return { dimensions };
};
