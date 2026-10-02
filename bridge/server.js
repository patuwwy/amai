/**
 * Amiga AI Bridge - PC Node.js Server
 * Bridges Amiga (NodeAmiga) to local Ollama instance (localhost:11434).
 * Supports streaming, heartbeat keepalive, charset transliteration (ASCII / AmigaPL / ISO-8859-2), and Amiga tools.
 */

const http = require('http');

const PORT = process.env.BRIDGE_PORT || 11435;
const OLLAMA_HOST = process.env.OLLAMA_HOST || '127.0.0.1';
const OLLAMA_PORT = process.env.OLLAMA_PORT || 11434;
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'qwen3.8:latest';

// Character maps for Amiga console transliteration
const POLISH_ASCII_MAP = {
    'ą': 'a', 'Ą': 'A',
    'ć': 'c', 'Ć': 'C',
    'ę': 'e', 'Ę': 'E',
    'ł': 'l', 'Ł': 'L',
    'ń': 'n', 'Ń': 'N',
    'ó': 'o', 'Ó': 'O',
    'ś': 's', 'Ś': 'S',
    'ź': 'z', 'Ź': 'Z',
    'ż': 'z', 'Ż': 'Z'
};

const POLISH_ISO_8859_2 = {
    'ą': '\xb1', 'Ą': '\xa1',
    'ć': '\xe6', 'Ć': '\xc6',
    'ę': '\xea', 'Ę': '\xca',
    'ł': '\xb3', 'Ł': '\xa3',
    'ń': '\xf1', 'Ń': '\xd1',
    'ó': '\xf3', 'Ó': '\xd3',
    'ś': '\xb6', 'Ś': '\xa6',
    'ź': '\xbc', 'Ź': '\xac',
    'ż': '\xbf', 'Ż': '\xaf'
};

const POLISH_AMIGA_PL = {
    'ą': '\xe1', 'Ą': '\xc1',
    'ć': '\xe2', 'Ć': '\xc2',
    'ę': '\xe5', 'Ę': '\xc5',
    'ł': '\xe7', 'Ł': '\xc7',
    'ń': '\xe9', 'Ń': '\xc9',
    'ó': '\xf3', 'Ó': '\xd3',
    'ś': '\xeb', 'Ś': '\xcb',
    'ź': '\xec', 'Ź': '\xcc',
    'ż': '\xed', 'Ż': '\xcd'
};

const UNICODE_ASCII_MAP = {
    '—': ' - ',
    '–': '-',
    '…': '...',
    '“': '"',
    '”': '"',
    '„': '"',
    '’': "'",
    '‘': "'",
    '«': '<<',
    '»': '>>',
    '•': '*',
    '→': '->',
    '←': '<-',
    '✓': '[OK]',
    '✔': '[OK]',
    '✗': '[X]',
    '✘': '[X]'
};

/**
 * Sanitizes and encodes text for the Amiga console according to selected encoding.
 * Modes: 'ascii' (default, safe for Topaz font), 'iso-8859-2', 'amigapl', 'raw'
 */
function sanitizeForAmiga(str, encoding = 'ascii') {
    if (!str) return str;

    // First replace typography
    str = str.replace(/[—–…“”„’‘«»•→←✓✔✗✘]/g, ch => UNICODE_ASCII_MAP[ch] || ch);

    // Strip emojis and high Unicode code points (> 0xFFFF)
    str = str.replace(/[\u{1F000}-\u{1FFFF}]/gu, '');
    str = str.replace(/[\u{2600}-\u{27BF}]/gu, '');
    str = str.replace(/[\u{FE00}-\u{FE0F}]/gu, ''); // variation selectors

    if (encoding === 'ascii') {
        str = str.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, ch => POLISH_ASCII_MAP[ch] || ch);
        // Also strip any remaining non-ASCII characters (> 127) to avoid console glitches
        str = str.replace(/[^\x00-\x7F\n\r\t]/g, '');
    } else if (encoding === 'iso-8859-2' || encoding === 'latin2') {
        str = str.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, ch => POLISH_ISO_8859_2[ch] || ch);
    } else if (encoding === 'amigapl') {
        str = str.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, ch => POLISH_AMIGA_PL[ch] || ch);
    }

    return str;
}

// Tools available to the AI on the Amiga
const AMIGA_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file on Amiga (e.g. RAM:test.c, DH0:src/main.c)',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'AmigaDOS path to file, e.g. RAM:hello.c or DH0:dev/file.c'
                    }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Create or overwrite a file on Amiga with complete new content',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'AmigaDOS destination path, e.g. RAM:hello.c'
                    },
                    content: {
                        type: 'string',
                        description: 'Full text content to write into the file'
                    }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'patch_file',
            description: 'Replace an exact existing string or block of code in a file with new code',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'AmigaDOS path to file'
                    },
                    search: {
                        type: 'string',
                        description: 'Exact block of text to search for and replace'
                    },
                    replace: {
                        type: 'string',
                        description: 'New replacement text'
                    }
                },
                required: ['path', 'search', 'replace']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_dir',
            description: 'List contents of an Amiga directory or volume (e.g. RAM:, DH0:src, SYS:)',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'AmigaDOS directory path, e.g. RAM: or DH0:'
                    }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_cwd',
            description: 'Get the current working directory path on Amiga (equivalent to running "cd" without arguments in AmigaDOS)',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Execute an AmigaDOS command in shell (e.g. "cd", "dir", "list", "vc -c test.c")',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'AmigaDOS command line string'
                    }
                },
                required: ['command']
            }
        }
    }
];

function getSystemPrompt(cwd) {
    const cwdLine = cwd ? `Current working directory on Amiga: "${cwd}".` : '';
    return `You are Amiga AI, an intelligent coding assistant running on Commodore Amiga via NodeAmiga.
You help the user program in C (SAS/C, VBCC, GCC), m68k Assembler, ARexx, Amiga E, or shell scripts.
You have tools to get the current working directory (get_cwd), read files, write files, patch files, list directories, and execute AmigaDOS commands.
${cwdLine}
Rules:
1. Keep Amiga architecture in mind (Motorola 680x0 CPU, Big-Endian, AmigaOS Exec/Intuition/Graphics/DOS libraries).
2. When creating or editing files, prefer writing clean, standards-compliant code with proper AmigaOS headers (#include <proto/dos.h>, <proto/intuition.h>, etc.).
3. In AmigaDOS:
   - The command "cd" without arguments displays the current working directory.
   - To check or verify the current directory, use tool get_cwd or run_command("cd").
   - File paths use device or volume names followed by a colon, e.g. "RAM:main.c", "DEV:amiga", "DH0:projects/code.c".
   - "/" represents the parent directory (e.g. "cd /" moves one level up, "cd //" moves two levels up).
   - The "dir" or "list" commands show directory contents.
   - To inspect the current directory contents, invoke tool list_dir("") or run_command("dir").
4. When using tools, invoke read_file first if you need to inspect existing code, then use write_file or patch_file to apply fixes.
5. Keep explanations concise as screen space in Amiga Shell / CLI is limited (standard 640x256 or 640x512 PAL/NTSC).
6. Output in plain ASCII text suitable for standard classic Amiga Topaz console. Do NOT use emojis, special unicode bullets, or fancy quotes.`;
}

// Helper: Fetch available models from Ollama
async function getOllamaModels() {
    try {
        const resp = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/tags`);
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.models || []).map(m => ({
            name: m.name,
            size: m.size,
            modified: m.modified_at
        }));
    } catch (err) {
        console.error('[Bridge] Error connecting to Ollama:', err.message);
        return [];
    }
}

// Create HTTP Server
const server = http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress;
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url} from ${ip}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/api/status')) {
        const models = await getOllamaModels();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'online',
            service: 'Amiga AI Bridge',
            default_model: DEFAULT_MODEL,
            ollama: `${OLLAMA_HOST}:${OLLAMA_PORT}`,
            models: models.map(m => m.name)
        }, null, 2));
        return;
    }

    if (req.method === 'GET' && req.url === '/api/models') {
        const models = await getOllamaModels();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models }));
        return;
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            let requestData;
            try {
                requestData = JSON.parse(body);
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                return;
            }

            const model = requestData.model || DEFAULT_MODEL;
            const messages = requestData.messages || [];
            const enableTools = requestData.enable_tools !== false;
            const cwd = requestData.cwd || '';
            const encoding = requestData.encoding || 'ascii';

            if (!messages.some(m => m.role === 'system')) {
                messages.unshift({ role: 'system', content: getSystemPrompt(cwd) });
            }

            console.log(`[Bridge] Prompting model: ${model}, CWD: "${cwd}", messages: ${messages.length}, encoding: ${encoding}, tools: ${enableTools}`);

            res.writeHead(200, {
                'Content-Type': 'application/x-ndjson; charset=latin1',
                'Transfer-Encoding': 'chunked',
                'Cache-Control': 'no-cache',
                'Connection': 'close'
            });

            const sendEvent = (obj) => {
                try {
                    res.write(JSON.stringify(obj) + '\n');
                } catch (e) {}
            };

            sendEvent({ event: 'connected', model: model });

            let lastActivityTime = Date.now();
            const heartbeatTimer = setInterval(() => {
                if (Date.now() - lastActivityTime >= 2000) {
                    sendEvent({ event: 'heartbeat' });
                    lastActivityTime = Date.now();
                }
            }, 2000);

            try {
                const ollamaPayload = {
                    model: model,
                    messages: messages,
                    stream: true
                };

                if (enableTools) {
                    ollamaPayload.tools = AMIGA_TOOLS;
                }

                const ollamaResp = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ollamaPayload)
                });

                if (!ollamaResp.ok) {
                    clearInterval(heartbeatTimer);
                    const errorText = await ollamaResp.text();
                    sendEvent({ event: 'error', message: `Ollama error ${ollamaResp.status}: ${errorText}` });
                    res.end();
                    return;
                }

                const reader = ollamaResp.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';
                let accumulatedToolCalls = [];

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    lastActivityTime = Date.now();
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
                                if (msg.content) {
                                    // Sanitize token for Amiga display
                                    const sanitizedToken = sanitizeForAmiga(msg.content, encoding);
                                    sendEvent({
                                        event: 'token',
                                        text: sanitizedToken
                                    });
                                }

                                if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                                    for (const tc of msg.tool_calls) {
                                        accumulatedToolCalls.push(tc);
                                    }
                                }
                            }

                            if (chunk.done) {
                                if (accumulatedToolCalls.length > 0) {
                                    sendEvent({
                                        event: 'tool_calls',
                                        calls: accumulatedToolCalls
                                    });
                                }

                                sendEvent({
                                    event: 'done',
                                    total_duration: chunk.total_duration,
                                    eval_count: chunk.eval_count
                                });
                            }
                        } catch (err) {
                            console.error('[Bridge] Failed to parse Ollama chunk line:', err.message);
                        }
                    }
                }

                clearInterval(heartbeatTimer);
                res.end();
                console.log(`[Bridge] Completed request for ${model}`);
            } catch (err) {
                clearInterval(heartbeatTimer);
                console.error('[Bridge] Communication error:', err.message);
                sendEvent({ event: 'error', message: err.message });
                res.end();
            }
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('========================================================');
    console.log(`   Amiga AI Bridge Server running on http://0.0.0.0:${PORT}`);
    console.log(`   Connected to Ollama on http://${OLLAMA_HOST}:${OLLAMA_PORT}`);
    console.log(`   Default Model: ${DEFAULT_MODEL}`);
    console.log('========================================================');
    console.log('Ready to receive connections from WinUAE and real Amigas!\n');
});
