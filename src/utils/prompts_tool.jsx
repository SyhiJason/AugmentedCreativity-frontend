// Prompts for the Gemini API, designed to return JSON
export const prompts = {
    metadata: `Based on the following initial paper idea, extract a working title, a target conference/venue, and 5-7 relevant keywords. INITIAL IDEA: "{idea}" Output ONLY a valid JSON object with the keys "working_title", "target_venue", and "keywords".`,
    objective: `Based on the following user description for a paper section, generate a concise one-sentence objective and a bulleted list of key points. USER DESCRIPTION: "{description}" Output ONLY a valid JSON object with two keys: "objective" (a string), and "key_points" (an array of strings).`,
    content_judge: (
        `You are a Content Goal Alignment Critic for scientific writing.\n` +
        `Judge ONLY the alignment between the user's goal (KP) and the current text.\n` +
        `Output JSON with: score (1-5), statement (one sentence), reason (one-two sentences), evidence (array of short quotes from the text that support your judgement).\n` +
        `If you cannot find evidence, include an empty array for evidence.\n` +
        `Example: {"score":3,"statement":"...","reason":"...","evidence":[{"quote":"..."}]}\n` +
        `[GOAL]: "{key_point}"\n[TEXT]: "{current_text}"`
    ),
    review_judge: (
        `You are a Reviewer-Style Feedback Critic (peer-review simulation).\n` +
        `For the given text and key point context, give a 1-5 score and an explanation.\n` +
        `Focus on originality, soundness, meaningful comparison, replicability, and substance AS RELEVANT to the current text.\n` +
        `Output JSON with: score (1-5), statement (one sentence), reason (one-two sentences), evidence (array of short quotes).\n` +
        `Do NOT provide suggestions here.\n` +
        `Example: {"score":4,"statement":"...","reason":"...","evidence":[{"quote":"..."}]}\n` +
        `[KEY POINT CONTEXT]: "{key_point}"\n[TEXT TO REVIEW]: "{current_text}"`
    ),
    summary: `You are a research writing assistant. Analyze the user's text to see if it achieves the stated goal. Be concise and encouraging. Explain how it achieves the goal, or what is missing if it does not. [GOAL]: "{key_point}" [USER TEXT]: "{current_text}" Your response MUST be ONLY a valid JSON object with a single key "summary_text".`,
    suggestion: `You are an expert writing coach. You are given: [GOAL]: "{key_point}", [TEXT]: "{current_text}", [PROBLEM]: "{problem_description}". Generate a "state_description" (why the text is failing) and a "suggestion" (an actionable piece of advice). Your response MUST be ONLY a valid JSON object with two keys: "state_description" and "suggestion".`
}