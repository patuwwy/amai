/*
 * network.js - Communication with Amiga AI Bridge on PC
 * Robust error handling, null safety, host diagnostics, and debug logging.
 */

var net = null;
var http = null;
try { net = require('net'); } catch (e) {}
try { http = require('http'); } catch (e) {}

/**
 * Safely extract error message string
 */
function errToStr(e) {
    if (!e) return "Unknown error";
    if (typeof e === 'string') return e;
    if (e.message) return e.message;
    try {
        return JSON.stringify(e);
    } catch (ignore) {
        return String(e);
    }
}

function debugLog(cfg, msg) {
    if (cfg && cfg.debug) {
        console.log("\x1b[33m[DEBUG]\x1b[0m " + msg);
    }
}

/**
 * Tests connection to a given host and port.
 */
function testConnection(host, port, debug) {
    if (debug) console.log("\x1b[33m[DEBUG]\x1b[0m Testing socket connection to " + host + ":" + port + "...");
    if (!net || typeof net.connect !== 'function') {
        return { success: false, error: "NodeAmiga 'net' module is not available" };
    }

    var sock = null;
    try {
        sock = net.connect(host, port, 5000);
        if (!sock) {
            if (debug) console.log("\x1b[33m[DEBUG]\x1b[0m net.connect returned null");
            return { success: false, error: "net.connect returned null (bsdsocket offline?)" };
        }
        if (debug) console.log("\x1b[33m[DEBUG]\x1b[0m Socket connected OK! Closing test socket.");
        try { sock.close(); } catch (ignore) {}
        return { success: true };
    } catch (e) {
        if (debug) console.log("\x1b[33m[DEBUG]\x1b[0m net.connect threw exception: " + errToStr(e));
        if (sock) {
            try { sock.close(); } catch (ignore) {}
        }
        return { success: false, error: errToStr(e) };
    }
}

/**
 * Sends a chat / prompt request to the PC Bridge and streams the response.
 */
function sendChat(cfg, messages, callbacks) {
    var host = cfg.host || '127.0.0.1';
    var port = cfg.port || 11435;
    var timeout = cfg.timeout || 60000;

    debugLog(cfg, "sendChat() started. Target: " + host + ":" + port + ", Model: " + cfg.model);

    var sock = null;

    try {
        if (!net || typeof net.connect !== 'function') {
            throw new Error("NodeAmiga 'net' module is not available. Check bsdsocket.library.");
        }

        debugLog(cfg, "Opening TCP socket via net.connect(" + host + ", " + port + ", " + timeout + ")...");
        sock = net.connect(host, port, timeout);
    } catch (e) {
        debugLog(cfg, "net.connect failed with exception: " + errToStr(e));
        var msg = "Cannot connect to Bridge at " + host + ":" + port + " (" + errToStr(e) + ").";
        if (callbacks.onError) callbacks.onError(msg);
        return null;
    }

    if (!sock) {
        debugLog(cfg, "net.connect returned NULL socket object!");
        var msgNull = "Connection to " + host + ":" + port + " failed (socket is null). Check bsdsocket.library in WinUAE / Amiga TCP/IP.";
        if (callbacks.onError) callbacks.onError(msgNull);
        return null;
    }

    debugLog(cfg, "Socket connected successfully. Preparing HTTP POST payload...");

    var currentDir = "";
    try { if (typeof process.cwd === 'function') currentDir = process.cwd(); } catch(e) {}

    var payload = JSON.stringify({
        model: cfg.model,
        messages: messages,
        enable_tools: true,
        encoding: cfg.encoding || 'ascii',
        cwd: currentDir
    });

function getByteLength(str) {
    if (!str) return 0;
    try {
        if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
            return Buffer.byteLength(str, 'utf8');
        }
    } catch (e) {}
    var bytes = 0;
    for (var i = 0; i < str.length; i++) {
        var code = str.charCodeAt(i);
        if (code <= 0x7f) {
            bytes += 1;
        } else if (code <= 0x7ff) {
            bytes += 2;
        } else if (code >= 0xd800 && code <= 0xdbff) {
            bytes += 4;
            i++;
        } else {
            bytes += 3;
        }
    }
    return bytes;
}

    var payloadBytes = getByteLength(payload);

    var reqHeaders = "POST /api/chat HTTP/1.0\r\n" +
                     "Host: " + host + ":" + port + "\r\n" +
                     "Content-Type: application/json\r\n" +
                     "Content-Length: " + payloadBytes + "\r\n" +
                     "Connection: close\r\n\r\n";

    try {
        debugLog(cfg, "Sending " + (reqHeaders.length + payloadBytes) + " bytes over socket (headers: " + reqHeaders.length + ", body: " + payloadBytes + ")...");
        // 1. Send HTTP headers
        sock.write(reqHeaders);

        // 2. Send payload in 1024-byte chunks to prevent Amiga TCP socket buffer truncation
        var chunkSize = 1024;
        var offset = 0;
        while (offset < payload.length) {
            var end = offset + chunkSize;
            if (end > payload.length) end = payload.length;
            var chunk = payload.substring(offset, end);
            sock.write(chunk);
            offset = end;
        }

        debugLog(cfg, "Request fully sent. Awaiting response stream...");
    } catch (e) {
        debugLog(cfg, "sock.write failed: " + errToStr(e));
        try { sock.close(); } catch (ignore) {}
        if (callbacks.onError) callbacks.onError("Write error: " + errToStr(e));
        return null;
    }

    var inHeaders = true;
    var accumulatedCalls = null;
    var fullContent = "";
    var lineCount = 0;

    try {
        while (true) {
            var rawLine = null;
            try {
                rawLine = sock.readLine();
            } catch (readErr) {
                debugLog(cfg, "sock.readLine exception: " + errToStr(readErr));
                if (callbacks.onError) callbacks.onError("Read error: " + errToStr(readErr));
                break;
            }

            if (rawLine === null || rawLine === undefined || typeof rawLine !== 'string') {
                debugLog(cfg, "sock.readLine returned non-string or EOF: " + rawLine);
                break;
            }

            var line = String(rawLine).trim();

            // Skip HTTP response headers
            if (inHeaders) {
                if (line === "") {
                    debugLog(cfg, "End of HTTP headers. Now parsing body events.");
                    inHeaders = false;
                } else {
                    debugLog(cfg, "HTTP Header: " + line);
                }
                continue;
            }

            if (!line) continue;

            lineCount++;

            // In HTTP chunked or NDJSON, JSON lines start with '{'
            if (line.charAt(0) !== '{') {
                debugLog(cfg, "Skipping non-JSON line: " + line);
                continue;
            }

            var evt;
            try {
                evt = JSON.parse(line);
            } catch (jsonErr) {
                debugLog(cfg, "JSON parse error on line: " + line);
                continue;
            }

            if (!evt || typeof evt !== 'object') continue;

            debugLog(cfg, "Event: " + evt.event + (evt.text ? " ('" + evt.text + "')" : ""));

            if (evt.event === 'connected') {
                if (callbacks && typeof callbacks.onConnected === 'function') {
                    try { callbacks.onConnected(evt.model); } catch (e) {}
                }
            } else if (evt.event === 'heartbeat') {
                if (callbacks && typeof callbacks.onHeartbeat === 'function') {
                    try { callbacks.onHeartbeat(); } catch (e) {}
                }
            } else if (evt.event === 'token') {
                var tokenText = (evt.text !== undefined && evt.text !== null) ? String(evt.text) : "";
                fullContent += tokenText;
                if (callbacks && typeof callbacks.onToken === 'function') {
                    try { callbacks.onToken(tokenText); } catch (e) {}
                }
            } else if (evt.event === 'tool_calls') {
                accumulatedCalls = evt.calls;
                debugLog(cfg, "Received tool_calls: " + JSON.stringify(evt.calls));
                if (callbacks && typeof callbacks.onToolCalls === 'function') {
                    try { callbacks.onToolCalls(evt.calls); } catch (e) {}
                }
            } else if (evt.event === 'done') {
                debugLog(cfg, "Done event received. Total duration: " + evt.total_duration + "ns, tokens: " + evt.eval_count);
                if (callbacks && typeof callbacks.onDone === 'function') {
                    try { callbacks.onDone(evt); } catch (e) {}
                }
                break; // Response stream complete - exit loop immediately
            } else if (evt.event === 'error') {
                debugLog(cfg, "Error event received: " + evt.message);
                if (callbacks && typeof callbacks.onError === 'function') {
                    try { callbacks.onError(evt.message); } catch (e) {}
                }
                break; // Error event received - exit loop immediately
            }
        }
    } catch (e) {
        debugLog(cfg, "Loop exception: " + errToStr(e));
        if (callbacks.onError) callbacks.onError("Stream processing error: " + errToStr(e));
    } finally {
        debugLog(cfg, "Closing socket connection.");
        if (sock) {
            try { sock.close(); } catch (ignore) {}
        }
    }

    return {
        content: fullContent,
        toolCalls: accumulatedCalls
    };
}

/**
 * Checks connection and gets status from Bridge.
 */
function getStatus(cfg) {
    var host = cfg.host || '127.0.0.1';
    var port = cfg.port || 11435;

    debugLog(cfg, "getStatus() connecting to " + host + ":" + port + "...");

    var sock = null;
    try {
        if (!net || typeof net.connect !== 'function') {
            return { success: false, error: "'net' module not available" };
        }

        sock = net.connect(host, port, 5000);
        if (!sock) {
            return { success: false, error: "Connection returned null to " + host + ":" + port };
        }

        var req = "GET /api/status HTTP/1.0\r\n" +
                  "Host: " + host + ":" + port + "\r\n" +
                  "Connection: close\r\n\r\n";

        sock.write(req);
        var inHeaders = true;
        var body = "";

        while (true) {
            var rawLine = null;
            try {
                rawLine = sock.readLine();
            } catch (re) {
                break;
            }
            if (rawLine === null || rawLine === undefined || typeof rawLine !== 'string') break;
            var line = String(rawLine).trim();

            if (inHeaders) {
                if (line === "") inHeaders = false;
                continue;
            }
            // Skip chunk-size hex lines if any proxy or server used chunked
            if (line.match(/^[0-9a-fA-F]+$/) && !body) {
                continue;
            }
            if (line === "0" && body) {
                continue;
            }
            body += line;
        }
        try { sock.close(); } catch (ignore) {}

        if (!body) {
            return { success: false, error: "Empty response from server" };
        }

        // Find JSON object boundaries {...}
        var startIdx = body.indexOf('{');
        var endIdx = body.lastIndexOf('}');
        if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
            body = body.substring(startIdx, endIdx + 1);
        }

        var json = JSON.parse(body);
        return { success: true, data: json };
    } catch (e) {
        if (sock) {
            try { sock.close(); } catch (ignore) {}
        }
        return { success: false, error: errToStr(e) };
    }
}

module.exports = {
    testConnection: testConnection,
    sendChat: sendChat,
    getStatus: getStatus,
    errToStr: errToStr,
    debugLog: debugLog
};
