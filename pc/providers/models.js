/**
 * pc/providers/models.js
 * Dynamically queries available models from configured providers:
 * - Ollama (local)
 * - Google Gemini (if GEMINI_API_KEY is configured in .env)
 * - OpenAI (if OPENAI_API_KEY is configured in .env)
 * - OpenRouter (if OPENROUTER_API_KEY is configured in .env)
 * - Custom OpenAI-Compatible (if LLM_BASE_URL is configured in .env)
 *
 * Models are returned with provider labels, e.g. "qwen3.8:latest (local)", "gemini-2.5-flash (google)".
 */

let cachedModels = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // Cache for 60 seconds

/**
 * Fetch local models from Ollama
 */
async function fetchOllamaModels(env) {
    const host = env.OLLAMA_HOST || '127.0.0.1';
    const port = env.OLLAMA_PORT || 11434;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const resp = await fetch(`http://${host}:${port}/api/tags`, {
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.models || []).map(m => ({
            id: m.name,
            displayName: `${m.name} (local)`,
            provider: 'ollama',
            size: m.size || 0,
            modified: m.modified_at || new Date().toISOString()
        }));
    } catch (e) {
        return [];
    }
}

/**
 * Fetch models from Google Gemini (via OpenAI-compatible endpoint)
 */
async function fetchGeminiModels(env) {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return [];
    try {
        const baseUrl = (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, '');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(`${baseUrl}/models`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!resp.ok) {
            console.error(`[Bridge] Failed to fetch Gemini models: HTTP ${resp.status}`);
            return [];
        }
        const data = await resp.json();
        const list = data.data || [];
        // Filter to text/chat Gemini models (strip models/ prefix, exclude audio/tts/image/embedding/internal)
        const chatModels = Array.from(new Set(
            list
                .map(m => (m.id || '').replace(/^models\//, ''))
                .filter(id => {
                    if (!id.startsWith('gemini-')) return false;
                    const noisy = ['embedding', 'aqa', 'image', 'tts', 'transcribe', 'live', 'audio', 'robotics', 'banana', 'customtools'];
                    for (const term of noisy) {
                        if (id.includes(term)) return false;
                    }
                    // Filter out dated snapshots like -10-2025, -09-2025, -001, -002 to keep list clean
                    if (/\b\d{2}-\d{4}\b|\b\d{8}\b/.test(id)) return false;
                    return true;
                })
        ));

        // Sort: latest / flash first, then pro
        chatModels.sort((a, b) => {
            const score = (name) => {
                if (name === 'gemini-flash-latest') return 100;
                if (name === 'gemini-pro-latest') return 95;
                if (name === 'gemini-flash-lite-latest') return 90;
                if (name.includes('2.5-flash')) return 80;
                if (name.includes('2.5-pro')) return 75;
                if (name.includes('3.8-flash')) return 70;
                return 10;
            };
            return score(b) - score(a);
        });

        // Limit to top 8 most useful models so Amiga Topaz screen is never overwhelmed
        const topModels = chatModels.slice(0, 8);

        return topModels.map(id => ({
            id: id,
            displayName: `${id} (google)`,
            provider: 'google',
            size: 0,
            modified: new Date().toISOString()
        }));
    } catch (e) {
        console.error('[Bridge] Error fetching Gemini models:', e.message);
        return [];
    }
}

/**
 * Fetch models from official OpenAI
 */
async function fetchOpenAIModels(env) {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return [];
    const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(`${baseUrl}/models`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!resp.ok) {
            console.error(`[Bridge] Failed to fetch OpenAI models: HTTP ${resp.status}`);
            return [];
        }
        const data = await resp.json();
        const list = (data.data || []).map(m => m.id);
        const chatModels = list.filter(id =>
            (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('chatgpt-')) &&
            !id.includes('realtime') && !id.includes('audio') && !id.includes('transcription')
        );
        chatModels.sort();
        return chatModels.map(id => ({
            id: id,
            displayName: `${id} (openai)`,
            provider: 'openai',
            size: 0,
            modified: new Date().toISOString()
        }));
    } catch (e) {
        console.error('[Bridge] Error fetching OpenAI models:', e.message);
        return [];
    }
}

/**
 * Fetch models from OpenRouter
 */
async function fetchOpenRouterModels(env) {
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) return [];
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const resp = await fetch('https://openrouter.ai/api/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!resp.ok) {
            console.error(`[Bridge] Failed to fetch OpenRouter models: HTTP ${resp.status}`);
            return [];
        }
        const data = await resp.json();
        const list = (data.data || []).map(m => m.id);
        // Prioritize free models (:free) and popular flagship models, max 10
        const freeModels = list.filter(id => id.endsWith(':free'));
        const flagship = list.filter(id =>
            !id.endsWith(':free') &&
            (id.includes('claude-3-5') || id.includes('gpt-4o') || id.includes('deepseek') || id.includes('gemini-2.5'))
        );
        const selected = Array.from(new Set([...freeModels.slice(0, 5), ...flagship.slice(0, 5)]));
        const finalOpenRouter = (selected.length > 0 ? selected : list.slice(0, 10));

        return finalOpenRouter.map(id => ({
            id: id,
            displayName: `${id} (openrouter)`,
            provider: 'openrouter',
            size: 0,
            modified: new Date().toISOString()
        }));
    } catch (e) {
        console.error('[Bridge] Error fetching OpenRouter models:', e.message);
        return [];
    }
}

/**
 * Fetch models from custom OpenAI-compatible endpoint (LiteLLM, Groq, etc.)
 */
async function fetchCustomModels(env) {
    const baseUrl = env.LLM_BASE_URL;
    const apiKey = env.LLM_API_KEY;
    if (!baseUrl) return [];
    if (baseUrl.includes('googleapis.com') || baseUrl.includes('api.openai.com') || baseUrl.includes('openrouter.ai')) {
        return [];
    }
    try {
        const cleanUrl = baseUrl.replace(/\/+$/, '');
        const headers = {};
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(`${cleanUrl}/models`, {
            headers,
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!resp.ok) return [];
        const data = await resp.json();
        const list = (data.data || []).map(m => m.id);
        return list.map(id => ({
            id: id,
            displayName: `${id} (custom)`,
            provider: 'custom',
            size: 0,
            modified: new Date().toISOString()
        }));
    } catch (e) {
        return [];
    }
}

/**
 * Get all available models across all configured providers
 */
async function getAvailableModels(env = process.env, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedModels && (now - lastCacheTime < CACHE_TTL_MS)) {
        return cachedModels;
    }

    const tasks = [
        fetchOllamaModels(env),
        fetchGeminiModels(env),
        fetchOpenAIModels(env),
        fetchOpenRouterModels(env),
        fetchCustomModels(env)
    ];

    const results = await Promise.allSettled(tasks);
    const all = [];
    for (const r of results) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            all.push(...r.value);
        }
    }

    cachedModels = all;
    lastCacheTime = now;
    return all;
}

/**
 * Strips provider suffix from model string, e.g.:
 * "gemini-2.5-flash (google)" -> "gemini-2.5-flash"
 * "qwen3.8:latest (local)" -> "qwen3.8:latest"
 */
function cleanModelName(model) {
    if (!model) return '';
    return model.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/**
 * Finds provider info for a given model
 */
function findModelInfo(modelName, modelsList = cachedModels) {
    if (!modelName) return null;
    const clean = cleanModelName(modelName);
    if (!modelsList || modelsList.length === 0) return null;
    return modelsList.find(m => m.id === clean || m.displayName === modelName) || null;
}

module.exports = {
    getAvailableModels,
    cleanModelName,
    findModelInfo
};

