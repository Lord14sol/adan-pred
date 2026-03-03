import ollama from 'ollama';

// Hybrid Router Config
// Mode can be 'TRAINING' ($0 cost local inference) or 'LIVE' (Anthropic API with Local Fallback)
export const ROUTER_CONFIG = {
    MODE: process.env.ADAN_MODE || 'TRAINING', // Default to TRAINING for $0 cost simulations
    LOCAL_HOST: 'http://127.0.0.1:11434',
    MODELS: {
        HEAVY: 'qwen3.5:0.8b',     // Downgraded to 0.8b because 9b crashes M2 8GB RAM (Swap death)
        LIGHT: 'qwen3.5:0.8b',     // Fast classification, blood-brain barrier
        CLAUDE: 'claude-3-5-sonnet-20241022' // Main live model
    }
};

export async function routeLLM({ weight, systemPrompt, userPrompt, anthropicClient }) {
    const localModel = weight === 'Heavy' ? ROUTER_CONFIG.MODELS.HEAVY : ROUTER_CONFIG.MODELS.LIGHT;

    if (ROUTER_CONFIG.MODE === 'LIVE' && anthropicClient) {
        try {
            console.log(`[ROUTER] 🌐 Routing to Claude 3.5 Sonnet (Weight: ${weight})`);
            const response = await anthropicClient.messages.create({
                model: ROUTER_CONFIG.MODELS.CLAUDE,
                max_tokens: 1500,
                system: systemPrompt,
                messages: [{ role: 'user', content: userPrompt }]
            });
            return response.content[0]?.text || '';
        } catch (error) {
            console.error(`[ROUTER] 🚨 Claude API Failed: ${error.message}. Executing Fallback to Local ${localModel}`);
            // Fallthrough to local execution
        }
    }

    // Local Execution (TRAINING mode OR Live Fallback)
    console.log(`[ROUTER] 🖥️ Routing to Local Ollama (${localModel})`);
    try {
        const response = await ollama.chat({
            model: localModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        });
        return response.message?.content || '';
    } catch (localError) {
        console.error(`[ROUTER] ❌ Local Model Failed: ${localError.message}. Make sure Ollama is running.`);
        throw localError;
    }
}
