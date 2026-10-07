/**
 * AMAI Bridge - PC Node.js Server
 * Bridges Amiga (NodeAmiga) to local Ollama instance (localhost:11434).
 * Supports streaming, heartbeat keepalive, charset transliteration (ASCII / AmigaPL / ISO-8859-2), and Amiga tools.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Load environment variables if .env file exists
let loadedEnvFile = null;
const envPath = path.join(__dirname, '.env');
const rootEnvPath = path.join(__dirname, '..', '.env');
if (typeof process.loadEnvFile === 'function') {
    if (fs.existsSync(envPath)) {
        process.loadEnvFile(envPath);
        loadedEnvFile = envPath;
    } else if (fs.existsSync(rootEnvPath)) {
        process.loadEnvFile(rootEnvPath);
        loadedEnvFile = rootEnvPath;
    }
}

const { getProvider } = require('./providers');
const { getAvailableModels, cleanModelName } = require('./providers/models');

function maskKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
}

function getConfiguredProviders() {
    const list = [];
    list.push(`Ollama (local)   -> http://${OLLAMA_HOST}:${OLLAMA_PORT}`);
    if (process.env.GEMINI_API_KEY) {
        list.push(`Google Gemini    -> configured (${maskKey(process.env.GEMINI_API_KEY)})`);
    }
    if (process.env.OPENAI_API_KEY) {
        list.push(`OpenAI           -> configured (${maskKey(process.env.OPENAI_API_KEY)})`);
    }
    if (process.env.OPENROUTER_API_KEY) {
        list.push(`OpenRouter       -> configured (${maskKey(process.env.OPENROUTER_API_KEY)})`);
    }
    if (process.env.LLM_BASE_URL) {
        list.push(`Custom Base URL  -> ${process.env.LLM_BASE_URL}`);
    }
    return list;
}

const PORT = process.env.BRIDGE_PORT || 11435;
const OLLAMA_HOST = process.env.OLLAMA_HOST || '127.0.0.1';
const OLLAMA_PORT = process.env.OLLAMA_PORT || 11434;
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'qwen3.8:latest';

const LOG_FILE = path.join(__dirname, 'bridge.log');
const SYSTEM_PROMPT_FILE = path.join(__dirname, 'system-prompt.md');

function log(msg) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const line = `[${timestamp}] ${msg}`;
    console.log(line);
    try {
        fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
    } catch (e) {}
}

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
            description: 'Read the contents of a text file on Amiga (e.g. RAM:test.c, DH0:src/main.c). Only supports text files; cannot read binary files or .info icon files.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'AmigaDOS path to text file, e.g. RAM:hello.c or DH0:dev/file.c'
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
    },
    {
        type: 'function',
        function: {
            name: 'launch_workbench_app',
            description: 'Launch a GUI / Workbench application in the background using WBRun (e.g. "SYS:Tools/Clock", "SYS:Utilities/Calculator", "SYS:Utilities/MultiView", "SYS:Prefs/ScreenMode"). Use this tool whenever the user asks to start, open, or run a GUI or Workbench program.',
            parameters: {
                type: 'object',
                properties: {
                    app_path: {
                        type: 'string',
                        description: 'AmigaDOS path to the Workbench executable (e.g. "SYS:Tools/Clock", "SYS:Utilities/Calculator", "SYS:Prefs/Palette")'
                    },
                    args: {
                        type: 'string',
                        description: 'Optional arguments or files to open with the application (e.g. "S:Startup-Sequence" for MultiView)'
                    }
                },
                required: ['app_path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'cpu',
            description: 'Get CPU, FPU, MMU, and cache information about the Amiga system using the AmigaDOS "cpu" command (e.g. detect 68000, 68020, 68030, 68040, 68060, FPU presence, cache status).',
            parameters: {
                type: 'object',
                properties: {
                    args: {
                        type: 'string',
                        description: 'Optional arguments for the cpu command (leave empty to query CPU/system specs)'
                    }
                }
            }
        }
    }
];

function getSystemPrompt(cwd) {
    if (fs.existsSync(SYSTEM_PROMPT_FILE)) {
        try {
            return fs.readFileSync(SYSTEM_PROMPT_FILE, 'utf8').trim();
        } catch (err) {
            log(`[SystemPrompt ERROR] Failed to read ${SYSTEM_PROMPT_FILE}: ${err.message}`);
        }
    }
    const cwdLine = cwd ? `Current working directory on Amiga: "${cwd}".` : '';
    return `You are AMAI (Amiga AI), an intelligent coding assistant running on Commodore Amiga, connected to external LLM.
You help the user program in C (SAS/C, VBCC, GCC), m68k Assembler, ARexx, Amiga E, Amos, or shell scripts.
You have tools to get the current working directory (get_cwd), read files, write files, patch files, list directories, execute AmigaDOS commands (run_command), launch Workbench/GUI applications (launch_workbench_app), and inspect CPU/system architecture (cpu).
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
6. Output in plain ASCII text suitable for standard classic Amiga Topaz console. Do NOT use emojis, special unicode bullets, or fancy quotes.
7. In polish, use Amiga, Amidze, Amigi.
8. GUI & Workbench Applications:
   - Classic Amiga GUI applications (such as Clock, Calculator, MultiView, Prefs tools, Exchange) require Workbench startup and CANNOT be run directly via run_command.
   - ALWAYS use launch_workbench_app to start GUI/Workbench applications. It uses the Amiga WBRun utility to launch them detached in Workbench mode.
   - Common program locations:
     * Clock: SYS:Tools/Clock or SYS:Utilities/Clock
     * Calculator: SYS:Utilities/Calculator
     * MultiView: SYS:Utilities/MultiView
     * Commodities/Exchange: SYS:Tools/Commodities/Exchange
     * Preferences: SYS:Prefs/<Name> (e.g. ScreenMode, Palette, Font, Input)
   - When asked to run or open a GUI program (e.g. 'uruchom zegar', 'otwórz kalkulator'), invoke launch_workbench_app with its path.
9. System & CPU Architecture:
   - To inspect the Amiga processor, FPU, MMU, and cache configuration (e.g. 68000, 68020, 68030, 68040, 68060), use the "cpu" tool.
   - Use this information to tailor compiler flags (e.g. -m68020, -m68040, -m68060) or advise on system capabilities.`;
}

// Active chat session state tracking
let activeSession = null;

function abortActiveSession(reason) {
    if (!activeSession) return false;
    log(`[Chat ABORT] Aborting active session: ${reason}`);
    const s = activeSession;
    activeSession = null;

    if (s.heartbeatTimer) {
        clearInterval(s.heartbeatTimer);
        s.heartbeatTimer = null;
    }

    try {
        if (s.abortController) {
            s.abortController.abort();
        }
    } catch (e) {}

    if (s.res && !s.res.writableEnded) {
        try {
            s.res.end();
        } catch (e) {}
    }

    if (s.socket && !s.socket.destroyed) {
        try {
            s.socket.destroy();
        } catch (e) {}
    }

    return true;
}

// Create HTTP Server
const server = http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress;
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url} from ${ip}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Immediate TCP delivery to Amiga (disable Nagle's algorithm)
    if (req.socket && typeof req.socket.setNoDelay === 'function') {
        req.socket.setNoDelay(true);
    }
    if (res.socket && typeof res.socket.setNoDelay === 'function') {
        res.socket.setNoDelay(true);
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/api/status')) {
        const clientIp = req.socket ? req.socket.remoteAddress : 'unknown';
        log(`[Status] Health check from ${clientIp}`);
        const models = await getAvailableModels();
        const matchedDefault = models.find(m => m.id === cleanModelName(DEFAULT_MODEL) || m.displayName === DEFAULT_MODEL);
        const defaultModelDisplay = matchedDefault ? matchedDefault.displayName : DEFAULT_MODEL;
        const jsonBody = JSON.stringify({
            status: 'online',
            service: 'AMAI Bridge',
            default_model: defaultModelDisplay,
            ollama: `${OLLAMA_HOST}:${OLLAMA_PORT}`,
            models: models.map(m => m.displayName)
        }, null, 2);
        const byteLen = Buffer.byteLength(jsonBody, 'utf8');
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': byteLen,
            'Connection': 'close'
        });
        res.end(jsonBody, () => {
            if (res.socket) try { res.socket.end(); } catch (e) {}
        });
        return;
    }

    if (req.method === 'GET' && req.url === '/api/models') {
        const models = await getAvailableModels();
        const jsonBody = JSON.stringify({
            models: models.map(m => ({
                name: m.displayName,
                id: m.id,
                provider: m.provider,
                size: m.size,
                modified: m.modified
            }))
        }, null, 2);
        const byteLen = Buffer.byteLength(jsonBody, 'utf8');
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': byteLen,
            'Connection': 'close'
        });
        res.end(jsonBody, () => {
            if (res.socket) try { res.socket.end(); } catch (e) {}
        });
        return;
    }

    if (req.url === '/api/abort' || req.url === '/api/exit' || req.url === '/api/reset') {
        const clientIp = req.socket ? req.socket.remoteAddress : 'unknown';
        log(`[Session] Received ${req.url} (${req.method}) from ${clientIp}`);
        const wasAborted = abortActiveSession(`Requested by Amiga via ${req.url}`);
        const jsonBody = JSON.stringify({
            status: 'ok',
            aborted: wasAborted,
            message: wasAborted ? 'Active session aborted' : 'No active session was running'
        }, null, 2);
        const byteLen = Buffer.byteLength(jsonBody, 'utf8');
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': byteLen,
            'Connection': 'close'
        });
        res.end(jsonBody, () => {
            if (res.socket) try { res.socket.end(); } catch (e) {}
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
        const clientIp = req.socket ? req.socket.remoteAddress : 'unknown';
        const expectedLen = parseInt(req.headers['content-length'] || '0', 10);
        let body = '';
        let handled = false;
        let silenceTimer = null;
        let timeoutTimer = null;

        const processBody = async () => {
            if (handled) return;
            handled = true;
            if (silenceTimer) clearTimeout(silenceTimer);
            if (timeoutTimer) clearTimeout(timeoutTimer);

            let requestData;
            try {
                requestData = JSON.parse(body);
            } catch (e) {
                log(`[Chat ERROR] Invalid JSON body from ${clientIp}: ${e.message} (received ${body.length} bytes, expected ${expectedLen || 'unknown'})`);
                if (body.length > 0) {
                    log(`[Chat ERROR Body Tail]: ...${body.substring(Math.max(0, body.length - 200))}`);
                }
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body: ' + e.message }));
                return;
            }

            const rawModel = requestData.model || DEFAULT_MODEL;
            const model = cleanModelName(rawModel);
            const messages = requestData.messages || [];
            const enableTools = requestData.enable_tools !== false;
            const cwd = requestData.cwd || '';
            const encoding = requestData.encoding || 'ascii';

            if (!messages.some(m => m.role === 'system')) {
                messages.unshift({ role: 'system', content: getSystemPrompt(cwd) });
            }

            const lastUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0];
            const userPreview = lastUserMsg ? JSON.stringify(lastUserMsg.content || '').substring(0, 80) : '';

            log(`[Chat START] From: ${clientIp} | Model: ${model} | Msgs: ${messages.length} | CWD: "${cwd}" | Enc: ${encoding} | Prompt: ${userPreview}`);

            // If another session was still active, abort it now
            if (activeSession) {
                log(`[Chat START] Existing session in progress; aborting before starting new chat.`);
                abortActiveSession('Superceded by new chat request');
            }

            const abortController = new AbortController();
            const session = {
                abortController,
                res,
                socket: req.socket,
                heartbeatTimer: null
            };
            activeSession = session;

            // Direct NDJSON line stream with Connection: close (no HTTP chunk framing to avoid Amiga parse issues)
            res.writeHead(200, {
                'Content-Type': 'application/x-ndjson; charset=latin1',
                'Cache-Control': 'no-cache',
                'Connection': 'close'
            });

            const sendEvent = (obj) => {
                if (res.writableEnded) return;
                try {
                    const json = JSON.stringify(obj);
                    res.write(json + '\n');
                } catch (e) {
                    log(`[Chat ERROR] Failed to sendEvent (${obj.event}): ${e.message}`);
                }
            };

            sendEvent({ event: 'connected', model: model });

            let lastActivityTime = Date.now();
            const heartbeatTimer = setInterval(() => {
                if (Date.now() - lastActivityTime >= 2000) {
                    log(`[Chat Heartbeat] Keepalive ping sent to Amiga`);
                    sendEvent({ event: 'heartbeat' });
                    lastActivityTime = Date.now();
                }
            }, 2000);
            session.heartbeatTimer = heartbeatTimer;

            let tokenCount = 0;
            let thinkCount = 0;
            let fullTextReceived = '';
            let inThinkTag = false;
            let hadOllamaThinking = false;

            const emitThinking = (raw) => {
                thinkCount++;
                const sanitized = sanitizeForAmiga(raw, encoding).replace(/[\r\n\t]+/g, ' ');
                sendEvent({
                    event: 'thinking',
                    text: sanitized
                });
                if (thinkCount === 1 || thinkCount % 20 === 0) {
                    log(`[Chat Thinking #${thinkCount}] "${sanitized}"`);
                }
            };

            const emitThinkingDone = () => {
                log(`[Chat Thinking DONE] Finished thinking (${thinkCount} chunks).`);
                sendEvent({ event: 'thinking_done' });
            };

            const emitToken = (raw) => {
                tokenCount++;
                fullTextReceived += raw;
                const sanitized = sanitizeForAmiga(raw, encoding);
                sendEvent({
                    event: 'token',
                    text: sanitized
                });
                if (tokenCount <= 5 || tokenCount % 10 === 0) {
                    log(`[Chat Token #${tokenCount}] "${sanitized.replace(/\n/g, '\\n')}"`);
                }
            };

            const onClientDisconnect = () => {
                if (activeSession === session && !res.writableEnded) {
                    log(`[Chat CLIENT DISCONNECT] Amiga closed socket early! (Tokens sent: ${tokenCount})`);
                    abortActiveSession('Amiga closed socket early');
                }
            };

            res.on('close', onClientDisconnect);
            if (req.socket) {
                req.socket.on('close', onClientDisconnect);
            }

            try {
                // Ensure at least one user query is present so prompt templates don't fail
                if (!messages.some(m => m.role === 'user')) {
                    messages.push({ role: 'user', content: 'Continue' });
                }

                const provider = getProvider(model, process.env);
                log(`[Chat Route] Selected provider "${provider.name}" for model "${model}"`);

                await provider.handleStream({
                    model: model,
                    messages: messages,
                    enableTools: enableTools,
                    tools: AMIGA_TOOLS,
                    abortSignal: abortController.signal,
                    env: process.env,
                    callbacks: {
                        onActivity: () => {
                            lastActivityTime = Date.now();
                        },
                        emitThinking: (text) => {
                            emitThinking(text);
                        },
                        emitThinkingDone: () => {
                            emitThinkingDone();
                        },
                        emitToken: (text) => {
                            emitToken(text);
                        },
                        emitToolCalls: (calls) => {
                            log(`[Chat Sending tool_calls event] Count: ${calls.length}`);
                            sendEvent({
                                event: 'tool_calls',
                                calls: calls
                            });
                        },
                        emitDone: (stats) => {
                            sendEvent({
                                event: 'done',
                                total_duration: stats ? stats.total_duration : 0,
                                eval_count: stats ? stats.eval_count : tokenCount
                            });
                        }
                    },
                    log: log
                });

                clearInterval(heartbeatTimer);
                session.heartbeatTimer = null;
                log(`[Chat FINISH] All tokens streamed (${tokenCount} tokens, ${fullTextReceived.length} chars). Calling res.end()...`);
                res.end(() => {
                    log(`[Chat COMPLETE] Response closed and flushed to Amiga.`);
                    if (res.socket) try { res.socket.end(); } catch (e) {}
                    if (req.socket) try { req.socket.end(); } catch (e) {}
                });
            } catch (err) {
                clearInterval(heartbeatTimer);
                session.heartbeatTimer = null;
                if (err.name === 'AbortError') {
                    log(`[Chat Stream] Request aborted.`);
                } else {
                    log(`[Chat Exception] ${err.message}`);
                    sendEvent({ event: 'error', message: err.message });
                    res.end();
                }
            } finally {
                clearInterval(heartbeatTimer);
                if (activeSession === session) {
                    activeSession = null;
                }
            }
        };

        req.on('data', chunk => {
            body += chunk;
            if (silenceTimer) clearTimeout(silenceTimer);

            if (expectedLen > 0 && body.length >= expectedLen) {
                processBody();
            } else {
                silenceTimer = setTimeout(() => {
                    const trimmed = body.trim();
                    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                        try {
                            JSON.parse(trimmed);
                            log(`[Chat WARN] Received valid JSON before Content-Length reached (${body.length}/${expectedLen}). Processing now.`);
                            processBody();
                        } catch (ignore) {}
                    }
                }, 800);
            }
        });

        req.on('end', () => {
            processBody();
        });

        req.on('error', err => {
            log(`[Chat ERROR] Request stream error from ${clientIp}: ${err.message}`);
            if (silenceTimer) clearTimeout(silenceTimer);
            if (timeoutTimer) clearTimeout(timeoutTimer);
        });

        req.socket.on('close', () => {
            if (!handled && body.length > 0) {
                const trimmed = body.trim();
                if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                    try {
                        JSON.parse(trimmed);
                        log(`[Chat WARN] Socket closed by client before HTTP end; processing received body (${body.length}/${expectedLen}).`);
                        processBody();
                    } catch (ignore) {}
                }
            }
        });

        timeoutTimer = setTimeout(() => {
            if (!handled) {
                log(`[Chat TIMEOUT] Request body timed out from ${clientIp} (${body.length}/${expectedLen} bytes received)`);
                handled = true;
                if (!res.writableEnded) {
                    res.writeHead(408, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Request body timeout' }));
                }
            }
        }, 15000);

        return;
    }

    const notFoundBody = JSON.stringify({ error: 'Not found' });
    res.writeHead(404, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(notFoundBody, 'utf8'),
        'Connection': 'close'
    });
    res.end(notFoundBody, () => {
        if (res.socket) try { res.socket.end(); } catch (e) {}
    });
});

server.listen(PORT, '0.0.0.0', async () => {
    const envDisplay = loadedEnvFile
        ? path.relative(path.join(__dirname, '..'), loadedEnvFile)
        : 'none (using defaults)';

    console.log('========================================================');
    console.log(`   AMAI Bridge Server running on http://0.0.0.0:${PORT}`);
    console.log(`   Config File:   ${envDisplay}`);
    console.log(`   Default Model: ${DEFAULT_MODEL}`);
    console.log(`   System Prompt: ${fs.existsSync(SYSTEM_PROMPT_FILE) ? 'system-prompt.md' : 'default (internal)'}`);
    console.log('   Configured Providers:');
    const providers = getConfiguredProviders();
    for (const p of providers) {
        console.log(`     * ${p}`);
    }
    console.log('========================================================');

    try {
        const models = await getAvailableModels();
        if (models.length > 0) {
            console.log(`Available Models (${models.length}):`);
            for (const m of models) {
                console.log(`  - ${m.displayName}`);
            }
            console.log('--------------------------------------------------------');
        }
    } catch (e) {}

    console.log('Ready to receive connections from Real Amigas and WinUAE\n');
});
