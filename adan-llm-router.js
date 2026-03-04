// adan-llm-router.js — NUEVA VERSION
// Reemplaza Anthropic/Ollama con Google AI Studio
// Gemma 3 27B = Cerebro 24/7 | Gemini 2.5 Flash = Francotirador (20 RPD)

import { GoogleGenerativeAI } from '@google/generative-ai';
import { quota } from './src/core/quota_manager.js';

let _genAI = null;
function getGenAI() {
    if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    return _genAI;
}

const MODELS = {
    BRAIN: 'gemma-3-27b-it',
    SNIPER: 'gemini-2.5-flash',
    EMBEDDER: 'text-embedding-004'
};

async function withRetry(fn, maxRetries = 3, label = '') {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (err) {
            const is429 = err.message?.includes('429') || err.message?.includes('Resource Exhausted');
            if (is429 && i < maxRetries - 1) {
                const wait = Math.pow(2, i + 1) * 1000;
                console.warn(`[ROUTER] 429 en ${label}. Wait ${wait}ms...`);
                await new Promise(r => setTimeout(r, wait));
                continue;
            }
            if (is429) { console.error(`[ROUTER] ${label} agotado. Fallback SKIP.`); return null; }
            throw err;
        }
    }
}

async function callGemma(prompt, options = {}) {
    if (!quota.canUseGemma()) return null;
    const model = getGenAI().getGenerativeModel({
        model: MODELS.BRAIN,
        generationConfig: {
            temperature: options.temperature ?? 0.1,
            topP: 0.8, topK: 20,
            maxOutputTokens: options.maxTokens ?? 1024,
        }
    });
    const result = await withRetry(() => model.generateContent(prompt), 3, 'Gemma');
    if (!result) return null;
    quota.consumeGemma();
    return result.response.text();
}

async function callGemini(prompt, reason = 'unknown', options = {}) {
    if (!quota.canUseGemini()) return callGemma(prompt, options);
    if (quota.isSaverMode() && reason !== 'dream_mode') return callGemma(prompt, options);
    const model = getGenAI().getGenerativeModel({
        model: MODELS.SNIPER,
        generationConfig: { temperature: 0.1, topP: 0.9, maxOutputTokens: options.maxTokens ?? 2048 }
    });
    const result = await withRetry(() => model.generateContent(prompt), 3, 'Gemini');
    if (!result) return null;
    quota.consumeGemini(reason);
    return result.response.text();
}

export async function getEmbedding(text) {
    if (!quota.canEmbed()) return null;
    const model = getGenAI().getGenerativeModel({ model: MODELS.EMBEDDER });
    const result = await withRetry(() => model.embedContent(text.slice(0, 2000)), 3, 'Embed');
    if (!result) return null;
    quota.consumeEmbed();
    return result.embedding.values;
}

export async function routeLLM({ prompt, systemPrompt, userPrompt, weight = 'Heavy', reason = 'cycle' }) {
    // If systemPrompt/userPrompt provided, join them
    let finalPrompt = prompt;
    if (!finalPrompt && systemPrompt && userPrompt) {
        finalPrompt = `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`;
    }

    const isPaper = process.env.ADAN_MODE !== 'LIVE';
    if (isPaper) {
        if (weight === 'Dream') return callGemini(finalPrompt, 'dream_mode', { maxTokens: 2048, temperature: 0.3 });
        return callGemma(finalPrompt);
    }
    if (weight === 'Heavy') return callGemini(finalPrompt, `live_${reason}`);
    if (weight === 'Dream') return callGemini(finalPrompt, 'dream_mode', { maxTokens: 2048, temperature: 0.3 });
    return callGemma(finalPrompt, { temperature: 0.05 });
}

export function parseAIResponse(text) {
    if (!text) return null;
    try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        if (cleaned.startsWith('{') || cleaned.startsWith('[')) return JSON.parse(cleaned);
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (m) return JSON.parse(m[0]);
        return { raw: text };
    } catch { return { raw: text }; }
}

export { callGemma, callGemini, MODELS };
