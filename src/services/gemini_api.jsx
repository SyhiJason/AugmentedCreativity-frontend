import {llmConfig} from "../config/default.jsx";
import {prompts} from "../utils/prompts_tool.jsx";

export default class GeminiApi {

    // --- LLM Interaction Logic ---
    async callLLM(promptType, replacements = {}) {
        const geminiApi = new GeminiApi();
        const tpl = prompts[promptType];
        if (!tpl) {
            console.error('Invalid prompt type requested:', promptType);
            return {};
        }
        let finalPrompt = tpl;
        for (const k in replacements) {
            finalPrompt = finalPrompt.replace(new RegExp(`{${k}}`, 'g'), String(replacements[k]));
        }
        try {
            const resultText = await geminiApi.sendMessage(finalPrompt);
            return JSON.parse(resultText);
        } catch (e) {
            console.error(`Failed to parse JSON for prompt type ${promptType}:`, e);
            return { error: `JSON parsing failed.` };
        }
    }

    // --- API Call Helper ---
     async sendMessage(prompt) {
        if (!llmConfig.gemini.token || llmConfig.gemini.token === 'PASTE_YOUR_GEMINI_API_KEY_HERE') {
            console.error('API key missing. Please add your Gemini API key.');
            return JSON.stringify({error: 'API Key not configured.'});
        }
        // MODIFICATION: Updated to a more recent, stable model version.
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${llmConfig.gemini.token}`;
        const payload = {
            contents: [{role: 'user', parts: [{text: prompt}]}],
            generationConfig: {responseMimeType: 'application/json'}
        };

        let retries = 3;
        let delay = 1000;

        while (retries > 0) {
            try {
                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });

                if (res.status === 429) {
                    console.warn(`Rate limit hit. Retrying in ${delay / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                    retries--;
                    continue;
                }
                if (!res.ok) {
                    const body = await res.json();
                    console.error('Gemini API error:', body);
                    return JSON.stringify({error: `API responded with status ${res.status}`});
                }
                const data = await res.json();
                const message = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (message) {
                    return message;
                }
                return JSON.stringify({error: 'No content returned from API.'});
            } catch (e) {
                console.error('Error calling Google API:', e);
                retries--;
                if (retries <= 0) {
                    return JSON.stringify({error: `LLM call failed: ${e.message}`});
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            }
        }
        return JSON.stringify({error: 'LLM call failed after multiple retries.'});
    }

}