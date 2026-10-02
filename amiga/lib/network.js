/*
 * network.js - Communication with Amiga AI Bridge on PC
 * Robust error handling, null safety, and host diagnostics.
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

/**
 * Tests connection to a given host and port.
 */
function testConnection(host, port) {
    if (!net || typeof net.connect !== 'function') {
        return { success: false, error: "NodeAmiga 'net' module is not available" };
    }

    var sock = null;
    try {
        sock = net.connect(host, port, 5000);
        if (!sock) {
            return { success: false, error: "net.connect returned null (bsdsocket offline?)" };
        }
        try { sock.close(); } catch (ignore) {}
        return { success: true };
    } catch (e) {
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

    var sock = null;

    try {
        if (!net || typeof net.connect !== 'function') {
            throw new Error("NodeAmiga 'net' module is not available. Check bsdsocket.library.");
        }

        sock = net.connect(host, port, timeout);
    } catch (e) {
        var msg = "Cannot connect to Bridge at " + host + ":" + port + " (" + errToStr(e) + ").";
        if (callbacks.onError) callbacks.onError(msg);
        return null;
    }

    if (!sock) {
        var msgNull = "Connection to " + host + ":" + port + " failed (socket is null). Check bsdsocket.library in WinUAE / Amiga TCP/IP.";
        if (callbacks.onError) callbacks.onError(msgNull);
        return null;
    }

    var payload = JSON.stringify({
        model: cfg.model,
        messages: messages,
        enable_tools: true
    });

    var req = "POST /api/chat HTTP/1.0\r\n" +
              "Host: " + host + ":" + port + "\r\n" +
              "Content-Type: application/json\r\n" +
              "Content-Length: " + payload.length + "\r\n" +
              "Connection: close\r\n\r\n" +
              payload;

    try {
        sock.write(req);
    } catch (e) {
        try { sock.close(); } catch (ignore) {}
        if (callbacks.onError) callbacks.onError("Write error: " + errToStr(e));
        return null;
    }

    var inHeaders = true;
    var accumulatedCalls = null;
    var fullContent = "";

    try {
        while (true) {
            var rawLine = null;
            try {
                rawLine = sock.readLine();
            } catch (readErr) {
                if (callbacks.onError) callbacks.onError("Read error: " + errToStr(readErr));
                break;
            }

            if (rawLine === null) {
                // Connection finished
                break;
            }

            var line = rawLine.trim();

            // Skip HTTP response headers
            if (inHeaders) {
                if (line === "") {
                    inHeaders = false;
                }
                continue;
            }

            if (!line) continue;

            // In HTTP chunked, hex lengths may appear. JSON lines start with '{'
            if (line.charAt(0) !== '{') {
                continue;
            }

            var evt;
            try {
                evt = JSON.parse(line);
            } catch (jsonErr) {
                continue;
            }

            if (evt.event === 'connected') {
                if (callbacks.onConnected) callbacks.onConnected(evt.model);
            } else if (evt.event === 'heartbeat') {
                if (callbacks.onHeartbeat) callbacks.onHeartbeat();
            } else if (evt.event === 'token') {
                fullContent += evt.text;
                if (callbacks.onToken) callbacks.onToken(evt.text);
            } else if (evt.event === 'tool_calls') {
                accumulatedCalls = evt.calls;
                if (callbacks.onToolCalls) callbacks.onToolCalls(evt.calls);
            } else if (evt.event === 'done') {
                if (callbacks.onDone) callbacks.onDone(evt);
            } else if (evt.event === 'error') {
                if (callbacks.onError) callbacks.onError(evt.message);
            }
        }
    } catch (e) {
        if (callbacks.onError) callbacks.onError("Stream processing error: " + errToStr(e));
    } finally {
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
    errToStr: errToStr
};
