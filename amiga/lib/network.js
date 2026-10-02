/*
 * network.js - Communication with Amiga AI Bridge on PC
 * Uses NodeAmiga's 'net' module for streaming responses and keepalive.
 */

var net = require('net');

/**
 * Sends a chat / prompt request to the PC Bridge and streams the response.
 *
 * @param {Object} cfg - Configuration { host, port, model, timeout }
 * @param {Array} messages - Chat messages array [{role, content}, ...]
 * @param {Object} callbacks - Event handlers:
 *   onConnected(model)
 *   onHeartbeat()
 *   onToken(text)
 *   onToolCalls(calls)
 *   onDone(stats)
 *   onError(err)
 */
function sendChat(cfg, messages, callbacks) {
    var host = cfg.host || '127.0.0.1';
    var port = cfg.port || 11435;
    var timeout = cfg.timeout || 60000;

    var sock;
    try {
        sock = net.connect(host, port, timeout);
    } catch (e) {
        if (callbacks.onError) callbacks.onError("Cannot connect to Bridge at " + host + ":" + port + " (" + e.message + ")");
        return;
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
        sock.close();
        if (callbacks.onError) callbacks.onError("Write error: " + e.message);
        return;
    }

    var inHeaders = true;
    var accumulatedCalls = null;
    var fullContent = "";

    try {
        while (true) {
            var rawLine = sock.readLine();
            if (rawLine === null) {
                // Connection closed by server
                break;
            }

            var line = rawLine.trim();

            // Skip HTTP headers
            if (inHeaders) {
                if (line === "") {
                    inHeaders = false;
                }
                continue;
            }

            if (!line) continue;

            // In HTTP/1.1 chunked, hex lengths may appear.
            // All our JSON events start with '{'.
            if (line.charAt(0) !== '{') {
                continue;
            }

            var evt;
            try {
                evt = JSON.parse(line);
            } catch (e) {
                // Invalid JSON fragment
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
        if (callbacks.onError) callbacks.onError("Socket read error: " + e.message);
    } finally {
        try { sock.close(); } catch (ignore) {}
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

    var sock;
    try {
        sock = net.connect(host, port, 10000);
    } catch (e) {
        return { success: false, error: "Cannot connect to " + host + ":" + port + " (" + e.message + ")" };
    }

    var req = "GET /api/status HTTP/1.0\r\n" +
              "Host: " + host + ":" + port + "\r\n" +
              "Connection: close\r\n\r\n";

    try {
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
        try { sock.close(); } catch (ignore) {}
        return { success: false, error: e.message };
    }
}

module.exports = {
    sendChat: sendChat,
    getStatus: getStatus
};
