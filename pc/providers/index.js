/**
 * pc/providers/index.js
 * Provider dispatcher for AMAI PC Bridge.
 */

const ollama = require('./ollama');
const openai = require('./openai');
const { cleanModelName, findModelInfo } = require('./models');

function getProvider(model, env = process.env) {
    const clean = cleanModelName(model);
    const m = clean.toLowerCase();

    // 1. Look up in dynamic discovered models list
    const info = findModelInfo(clean);
    if (info) {
        if (info.provider === 'ollama') return ollama;
        return openai;
    }

    // 2. Explicit prefixes
    if (m.startsWith('ollama:') || m.startsWith('ollama/')) {
        return ollama;
    }
    if (
        m.startsWith('openai:') ||
        m.startsWith('openai/') ||
        m.startsWith('openrouter:') ||
        m.startsWith('openrouter/') ||
        m.startsWith('gemini:') ||
        m.startsWith('google:')
    ) {
        return openai;
    }

    // 3. Global provider configuration in .env
    if (env.LLM_PROVIDER === 'openai' || env.LLM_PROVIDER === 'openrouter' || env.LLM_PROVIDER === 'gemini') {
        return openai;
    }
    if (env.LLM_PROVIDER === 'ollama') {
        return ollama;
    }

    // 4. Gemini models or Gemini API Key
    if (m.startsWith('gemini') || (env.GEMINI_API_KEY && m.includes('gemini'))) {
        return openai;
    }

    // 5. OpenRouter model slug (vendor/model)
    if (m.includes('/') && env.OPENROUTER_API_KEY) {
        return openai;
    }

    // 6. Common OpenAI model names
    if (/^(gpt-|o1|o3)/i.test(m) && env.OPENAI_API_KEY) {
        return openai;
    }

    // 7. Explicit base URL or API key configured
    if ((env.LLM_BASE_URL || env.OPENAI_BASE_URL) && (env.OPENAI_API_KEY || env.LLM_API_KEY)) {
        return openai;
    }

    // Default to local Ollama
    return ollama;
}

module.exports = {
    getProvider,
    cleanModelName,
    findModelInfo,
    providers: {
        ollama,
        openai
    }
};

