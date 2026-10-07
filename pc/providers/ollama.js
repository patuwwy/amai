/**
 * pc/providers/ollama.js
 * Local Ollama provider streaming handler.
 */

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
    const host = env.OLLAMA_HOST || '127.0.0.1';
    const port = env.OLLAMA_PORT || 11434;

    // Ensure at least one user query is present so Qwen template doesn't fail
    const msgs = [...messages];
    if (!msgs.some(m => m.role === 'user')) {
        msgs.push({ role: 'user', content: 'Continue' });
    }

    const payload = {
        model: model,
        messages: msgs,
        stream: true,
        options: {
            num_ctx: 16384
        }
    };

    if (enableTools && tools && tools.length > 0) {
        payload.tools = tools;
    }

    log(`[Ollama] Connecting to http://${host}:${port}/api/chat...`);
    const resp = await fetch(`http://${host}:${port}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortSignal
    });

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Ollama error ${resp.status}: ${errText}`);
    }

    log(`[Ollama OK] Stream opened. Reading chunks...`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedToolCalls = [];
    let hadOllamaThinking = false;
    let inThinkTag = false;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            log(`[Ollama EOF] reader.read() returned done=true`);
            break;
        }

        if (callbacks.onActivity) callbacks.onActivity();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
                const chunk = JSON.parse(trimmed);
                const msg = chunk.message;
                if (msg) {
                    if (msg.thinking) {
                        hadOllamaThinking = true;
                        callbacks.emitThinking(msg.thinking);
                    } else {
                        if (hadOllamaThinking) {
                            callbacks.emitThinkingDone();
                            hadOllamaThinking = false;
                        }

                        if (msg.content) {
                            let content = msg.content;
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
                    }

                    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                        for (const tc of msg.tool_calls) {
                            accumulatedToolCalls.push(tc);
                            const fnName = tc.function ? tc.function.name : (tc.name || 'unknown');
                            log(`[Ollama Tool Call] ${fnName} args: ${JSON.stringify(tc.function ? tc.function.arguments : {})}`);
                        }
                    }
                }

                if (chunk.done) {
                    if (hadOllamaThinking || inThinkTag) {
                        callbacks.emitThinkingDone();
                        hadOllamaThinking = false;
                        inThinkTag = false;
                    }

                    log(`[Ollama Done] reason: ${chunk.done_reason || 'stop'}, eval_count: ${chunk.eval_count}, duration: ${chunk.total_duration ? Math.round(chunk.total_duration/1e6) + 'ms' : '?'}`);

                    if (accumulatedToolCalls.length > 0) {
                        log(`[Ollama Sending tool_calls event] Count: ${accumulatedToolCalls.length}`);
                        callbacks.emitToolCalls(accumulatedToolCalls);
                    }

                    callbacks.emitDone({
                        total_duration: chunk.total_duration,
                        eval_count: chunk.eval_count
                    });
                }
            } catch (err) {
                log(`[Ollama Parse ERROR] Chunk parse failed: ${err.message} on line: ${trimmed.substring(0, 100)}`);
            }
        }
    }
}

module.exports = {
    name: 'ollama',
    handleStream
};
