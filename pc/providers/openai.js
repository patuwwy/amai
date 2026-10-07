/**
 * pc/providers/openai.js
 * Universal OpenAI-Compatible streaming client.
 * Supports:
 *  - Official OpenAI (gpt-4o, gpt-4o-mini, o1, o3-mini)
 *  - OpenRouter (openrouter.ai -> Claude 3.7/3.5, Gemini 2.5, DeepSeek R1, Llama 3)
 *  - LiteLLM proxy (localhost:8000/v1)
 *  - Groq, DeepSeek, vLLM, LM Studio, etc.
 */

const { cleanModelName, findModelInfo } = require('./models');

// Cache of Google Gemini thought_signatures indexed by tool_call ID
const thoughtSignaturesByCallId = new Map();

async function handleStream({
    model,
    messages,
    enableTools,
    tools,
    abortSignal,
    env,
    callbacks,
    log
}) {
    let cleanModel = cleanModelName(model);
    let baseUrl = env.LLM_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    let apiKey = env.LLM_API_KEY || env.OPENAI_API_KEY;

    // Check dynamically discovered model info
    const info = findModelInfo(cleanModel);
    if (info) {
        if (info.provider === 'google') {
            baseUrl = env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
            apiKey = env.GEMINI_API_KEY || apiKey;
        } else if (info.provider === 'openai') {
            baseUrl = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
            apiKey = env.OPENAI_API_KEY || apiKey;
        } else if (info.provider === 'openrouter') {
            baseUrl = env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
            apiKey = env.OPENROUTER_API_KEY || apiKey;
        } else if (info.provider === 'custom') {
            baseUrl = env.LLM_BASE_URL;
            apiKey = env.LLM_API_KEY || apiKey;
        }
    } else if (cleanModel.startsWith('openrouter/') || cleanModel.startsWith('openrouter:')) {
        cleanModel = cleanModel.replace(/^openrouter[\/:]/, '');
        baseUrl = env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
        apiKey = env.OPENROUTER_API_KEY || apiKey;
    } else if (cleanModel.startsWith('openai:')) {
        cleanModel = cleanModel.substring(7);
        baseUrl = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
        apiKey = env.OPENAI_API_KEY || apiKey;
    } else if (cleanModel.startsWith('gemini:') || cleanModel.startsWith('google:')) {
        cleanModel = cleanModel.replace(/^(gemini|google):/, '');
        baseUrl = env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
        apiKey = env.GEMINI_API_KEY || apiKey;
    } else if (cleanModel.startsWith('gemini') && env.GEMINI_API_KEY) {
        // Direct Gemini model with GEMINI_API_KEY
        baseUrl = env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
        apiKey = env.GEMINI_API_KEY;
    } else if (env.OPENROUTER_API_KEY && (cleanModel.includes('/') || env.LLM_PROVIDER === 'openrouter')) {
        // e.g. "anthropic/claude-3.7-sonnet" or "google/gemini-2.5-flash" via OpenRouter
        baseUrl = env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
        apiKey = env.OPENROUTER_API_KEY;
    }

    // Strip trailing slashes from baseUrl
    baseUrl = baseUrl.replace(/\/+$/, '');

    if (!apiKey && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1')) {
        throw new Error(
            `Missing API key. Please configure GEMINI_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY in pc/.env.`
        );
    }

    // Format messages for OpenAI format (restoring Google thought_signatures if present)
    const formattedMessages = messages.map(m => {
        const item = { role: m.role, content: m.content || '' };
        if (m.tool_calls) {
            item.tool_calls = m.tool_calls.map(tc => {
                const fn = tc.function || tc;
                const callId = tc.id || 'call_0';
                const callObj = {
                    id: callId,
                    type: 'function',
                    function: {
                        name: fn.name,
                        arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {})
                    }
                };
                // Restore Google Gemini thought_signature
                if (tc.extra_content) {
                    callObj.extra_content = tc.extra_content;
                } else if (thoughtSignaturesByCallId.has(callId)) {
                    callObj.extra_content = thoughtSignaturesByCallId.get(callId);
                }
                return callObj;
            });
            if (!item.content) {
                item.content = null;
            }
        }
        if (m.tool_call_id) {
            item.tool_call_id = m.tool_call_id;
        }
        return item;
    });

    const payload = {
        model: cleanModel,
        messages: formattedMessages,
        stream: true
    };

    if (baseUrl.includes('api.openai.com') || baseUrl.includes('openrouter.ai')) {
        payload.stream_options = { include_usage: true };
    }

    if (enableTools && tools && tools.length > 0) {
        payload.tools = tools;
    }

    const headers = {
        'Content-Type': 'application/json'
    };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    if (baseUrl.includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'https://github.com/patuwwy/amai';
        headers['X-Title'] = 'AMAI Amiga Shell';
    }

    let resp = null;
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        log(`[OpenAI-Compat] Connecting to ${baseUrl}/chat/completions (model: ${cleanModel})${attempt > 0 ? ` [retry ${attempt}/${maxRetries}]` : ''}...`);
        resp = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload),
            signal: abortSignal
        });

        if (resp.ok) break;

        // Auto-retry on 503 (High Demand spike)
        if (resp.status === 503 && attempt < maxRetries) {
            log(`[OpenAI-Compat 503] Model experiencing high demand. Retrying in 2s...`);
            await new Promise(r => setTimeout(r, 2000));
            continue;
        }

        break;
    }

    if (!resp.ok) {
        const errText = await resp.text();
        log(`[OpenAI-Compat ERROR] HTTP ${resp.status}: ${errText}`);
        let formattedMsg = `API error ${resp.status}`;
        try {
            const parsed = JSON.parse(errText);
            const errObj = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
            if (errObj && errObj.message) {
                let firstSentence = errObj.message.split('\n')[0].trim();
                firstSentence = firstSentence.replace(/For more information.*$/i, '').trim();
                firstSentence = firstSentence.replace(/To monitor your current usage.*$/i, '').trim();
                formattedMsg = `${formattedMsg}: ${firstSentence || 'Resource limit reached'}`;
            }
        } catch (e) {
            formattedMsg = `${formattedMsg}: ${errText.replace(/[\r\n\t]+/g, ' ').substring(0, 120)}`;
        }
        throw new Error(formattedMsg);
    }

    log(`[OpenAI-Compat OK] Stream opened. Reading SSE chunks...`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const toolCallsByIndex = {};
    let hadThinking = false;
    let inThinkTag = false;
    let evalCount = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            log(`[OpenAI-Compat EOF] Stream completed.`);
            break;
        }

        if (callbacks.onActivity) callbacks.onActivity();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue; // Ignore SSE keepalive / comments
            if (!trimmed.startsWith('data:')) continue;

            const dataStr = trimmed.substring(5).trim();
            if (dataStr === '[DONE]') {
                if (hadThinking || inThinkTag) {
                    callbacks.emitThinkingDone();
                    hadThinking = false;
                    inThinkTag = false;
                }
                break;
            }

            try {
                const chunk = JSON.parse(dataStr);
                const choice = chunk.choices && chunk.choices[0];

                if (chunk.usage && chunk.usage.completion_tokens) {
                    evalCount = chunk.usage.completion_tokens;
                }

                if (choice && choice.delta) {
                    const delta = choice.delta;

                    // 1. Explicit reasoning tokens (DeepSeek-R1, Qwen on OpenRouter, o1/o3-mini)
                    const reasoning = delta.reasoning_content || delta.reasoning;
                    if (reasoning) {
                        hadThinking = true;
                        callbacks.emitThinking(reasoning);
                    } else if (hadThinking && delta.content) {
                        callbacks.emitThinkingDone();
                        hadThinking = false;
                    }

                    // 2. Regular content tokens (also check for inline <think> tags)
                    if (delta.content) {
                        evalCount++;
                        let content = delta.content;
                        while (content.length > 0) {
                            if (!inThinkTag) {
                                const idx = content.indexOf('<think>');
                                if (idx !== -1) {
                                    if (idx > 0) callbacks.emitToken(content.substring(0, idx));
                                    inThinkTag = true;
                                    content = content.substring(idx + 7);
                                } else {
                                    callbacks.emitToken(content);
                                    content = '';
                                }
                            } else {
                                const idx = content.indexOf('</think>');
                                if (idx !== -1) {
                                    if (idx > 0) callbacks.emitThinking(content.substring(0, idx));
                                    inThinkTag = false;
                                    callbacks.emitThinkingDone();
                                    content = content.substring(idx + 8);
                                } else {
                                    callbacks.emitThinking(content);
                                    content = '';
                                }
                            }
                        }
                    }

                    // 3. Tool calls streaming accumulation
                    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index ?? 0;
                            if (!toolCallsByIndex[idx]) {
                                toolCallsByIndex[idx] = {
                                    id: tc.id || `call_${idx}`,
                                    type: 'function',
                                    function: {
                                        name: tc.function && tc.function.name ? tc.function.name : '',
                                        arguments: ''
                                    }
                                };
                            }
                            if (tc.id) {
                                toolCallsByIndex[idx].id = tc.id;
                            }
                            if (tc.extra_content) {
                                toolCallsByIndex[idx].extra_content = tc.extra_content;
                                thoughtSignaturesByCallId.set(toolCallsByIndex[idx].id, tc.extra_content);
                            }
                            if (tc.function && tc.function.name) {
                                toolCallsByIndex[idx].function.name = tc.function.name;
                            }
                            if (tc.function && tc.function.arguments) {
                                toolCallsByIndex[idx].function.arguments += tc.function.arguments;
                            }
                        }
                    }

                    // 4. Finish reason
                    if (choice.finish_reason) {
                        if (hadThinking || inThinkTag) {
                            callbacks.emitThinkingDone();
                            hadThinking = false;
                            inThinkTag = false;
                        }

                        const finalToolCalls = Object.values(toolCallsByIndex).map(tc => {
                            let parsedArgs = tc.function.arguments;
                            try {
                                parsedArgs = JSON.parse(tc.function.arguments);
                            } catch (e) {}
                            const out = {
                                id: tc.id,
                                type: 'function',
                                function: {
                                    name: tc.function.name,
                                    arguments: parsedArgs
                                }
                            };
                            if (tc.extra_content) {
                                out.extra_content = tc.extra_content;
                                thoughtSignaturesByCallId.set(tc.id, tc.extra_content);
                            }
                            return out;
                        });

                        if (finalToolCalls.length > 0) {
                            log(`[OpenAI-Compat Sending tool_calls event] Count: ${finalToolCalls.length}`);
                            for (const c of finalToolCalls) {
                                log(`[OpenAI-Compat Tool Call] ${c.function.name} args: ${JSON.stringify(c.function.arguments)} (thought_sig: ${c.extra_content ? 'yes' : 'no'})`);
                            }
                            callbacks.emitToolCalls(finalToolCalls);
                        }

                        callbacks.emitDone({
                            total_duration: 0,
                            eval_count: evalCount
                        });
                    }
                }
            } catch (err) {
                log(`[OpenAI-Compat Parse ERROR] Failed to parse SSE line: ${err.message} (${dataStr.substring(0, 80)})`);
            }
        }
    }
}

module.exports = {
    name: 'openai',
    handleStream
};
