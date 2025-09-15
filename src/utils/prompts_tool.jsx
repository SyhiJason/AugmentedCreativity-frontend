// Prompts for the Gemini API, designed to return JSON
export const prompts = {
    metadata: `Based on the following initial paper idea, extract a working title, a target conference/venue, and 5-7 relevant keywords. INITIAL IDEA: "{idea}" Output ONLY a valid JSON object with the keys "working_title", "target_venue", and "keywords".`,
    objective: `Based on the following user description for a paper section, generate a concise one-sentence objective and a bulleted list of key points. USER DESCRIPTION: "{description}" Output ONLY a valid JSON object with two keys: "objective" (a string), and "key_points" (an array of strings).`,
    content_judge:
    (
      `You are a Content Goal Alignment Critic for scientific writing.\n` +
      `Judge ONLY the alignment between the user's goal (KP) and the current text at the SENTENCE level.\n` +
      `FIRST, internally split [TEXT] into sentences and index them starting at 1. Do not output the split list; only use it to reference sentences.\n` +
      `Use ONLY the standard Natural Language Inference (NLI) labels: "entailment", "contradiction", "neutral".\n` +
      `Output ONLY a JSON object with: score (1-5), statement (one sentence), reason (one-two sentences with sentence_id references), evidence (array of objects with { "sentence_id", "sentence", "relation" }).\n` +
      `Example: {"score":3,"statement":"Partially aligned.","reason":"Sentence 2 entails the goal but sentence 5 contradicts it.","evidence":[{"sentence_id":2,"sentence":"This study evaluates goal alignment.","relation":"entailment"},{"sentence_id":5,"sentence":"We explicitly reject the goal.","relation":"contradiction"}]}\n` +
      `[GOAL]: "{key_point}"\n[TEXT]: "{current_text}"`
    ),
    review_judge:
      (
        `You are a Reviewer-Style Feedback Critic (peer-review simulation).\n` +
        `Evaluate the given text at the SENTENCE level with respect to the following dimensions: originality, soundness, meaningful comparison, replicability, substance.\n` +
        `FIRST, internally split [TEXT TO REVIEW] into sentences and index them starting at 1. Do not output the split list; only use it to reference sentences.\n` +
        `Output ONLY a JSON object with:\n` +
        `- score (1-5) overall,\n` +
        `- statement (one sentence overall verdict),\n` +
        `- reason (one-two sentences that reference specific sentence_ids),\n` +
        `- evidence (array of objects), where each object is { "sentence_id": <int>, "sentence": "<full sentence>", "dimension": "<one of: originality | soundness | comparison | replicability | substance>" }.\n` +
        `Do NOT provide suggestions here.\n` +
        `Example: {"score":4,"statement":"Strong but with limited comparison.","reason":"Originality in s1; missing baselines in s5.","evidence":[{"sentence_id":1,"sentence":"We introduce a new ...","dimension":"originality"},{"sentence_id":5,"sentence":"We do not compare against ...","dimension":"comparison"}]}\n` +
        `[KEY POINT CONTEXT]: "{key_point}"\n[TEXT TO REVIEW]: "{current_text}"`
      ),
    summary: `You are a research writing assistant. Analyze the user's text to see if it achieves the stated goal. Be concise and encouraging. Explain how it achieves the goal, or what is missing if it does not. [GOAL]: "{key_point}" [USER TEXT]: "{current_text}" Your response MUST be ONLY a valid JSON object with a single key "summary_text".`,
    suggestion: `You are an expert writing coach. You are given: [GOAL]: "{key_point}", [TEXT]: "{current_text}", [PROBLEM]: "{problem_description}". Generate a "state_description" (why the text is failing) and a "suggestion" (an actionable piece of advice). Your response MUST be ONLY a valid JSON object with two keys: "state_description" and "suggestion".`
  };
  