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

    var req = "POST /api/chat HTTP/1.0\r\n" +
              "Host: " + host + ":" + port + "\r\n" +
              "Content-Type: application/json\r\n" +
              "Content-Length: " + payload.length + "\r\n" +
              "Connection: close\r\n\r\n" +
              payload;

    try {
        debugLog(cfg, "Sending " + req.length + " bytes over socket...");
        sock.write(req);
        debugLog(cfg, "Request sent. Awaiting response stream...");
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

            if (rawLine === null) {
                debugLog(cfg, "sock.readLine returned null (end of stream / connection closed).");
                break;
            }

            var line = rawLine.trim();

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

            // In HTTP chunked, hex lengths may appear. JSON lines start with '{'
            if (line.charAt(0) !== '{') {
                debugLog(cfg, "Skipping non-JSON chunk line: " + line);
                continue;
            }

            var evt;
            try {
                evt = JSON.parse(line);
            } catch (jsonErr) {
                debugLog(cfg, "JSON parse error on line: " + line);
                continue;
            }

            debugLog(cfg, "Event: " + evt.event + (evt.text ? " ('" + evt.text + "')" : ""));

            if (evt.event === 'connected') {
                if (callbacks.onConnected) callbacks.onConnected(evt.model);
            } else if (evt.event === 'heartbeat') {
                if (callbacks.onHeartbeat) callbacks.onHeartbeat();
            } else if (evt.event === 'token') {
                fullContent += evt.text;
                if (callbacks.onToken) callbacks.onToken(evt.text);
            } else if (evt.event === 'tool_calls') {
                accumulatedCalls = evt.calls;
                debugLog(cfg, "Received tool_calls: " + JSON.stringify(evt.calls));
                if (callbacks.onToolCalls) callbacks.onToolCalls(evt.calls);
            } else if (evt.event === 'done') {
                debugLog(cfg, "Done event received. Total duration: " + evt.total_duration + "ns, tokens: " + evt.eval_count);
                if (callbacks.onDone) callbacks.onDone(evt);
                break; // Response stream complete - exit loop immediately
            } else if (evt.event === 'error') {
                debugLog(cfg, "Error event received: " + evt.message);
                if (callbacks.onError) callbacks.onError(evt.message);
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
            var rawLine = sock.readLine();
            if (rawLine === null) break;
            var line = rawLine.trim();

            if (inHeaders) {
                if (line === "") inHeaders = false;
                continue;
            }
            body += rawLine + "\n";
        }
        sock.close();

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
