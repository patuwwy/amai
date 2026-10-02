/*
 * netcheck.js - Quick network diagnostic tool for Amiga AI Shell
 * Tests bsdsocket.library, local bridge connection, and external Internet.
 *
 * Usage in Amiga Shell:
 *   NodeAmiga netcheck.js
 */

var net = require('net');

console.log("==================================================");
console.log("        Amiga Network Diagnostics Tool            ");
console.log("==================================================");
console.log("NodeAmiga runtime detected.");
console.log("Testing bsdsocket.library emulation...\n");

function testBridgeLocal(cb) {
    console.log("[1/3] Testing PC Bridge on 127.0.0.1:11435...");
    var finished = false;
    var sock = null;
    try {
        sock = net.connect(11435, '127.0.0.1', function() {
            if (finished) return;
            finished = true;
            console.log("  -> [OK] Connected to 127.0.0.1:11435! PC Bridge is reachable.\n");
            try { sock.end(); } catch (e) {}
            cb(true);
        });
    } catch (e) {
        console.log("  -> [FAIL] Exception: " + e.message + "\n");
        cb(false);
        return;
    }

    if (!sock) {
        console.log("  -> [FAIL] Socket failed to initialize on 127.0.0.1.\n");
        cb(false);
        return;
    }

    sock.on('error', function(err) {
        if (finished) return;
        finished = true;
        console.log("  -> [FAIL] 127.0.0.1 error: " + (err ? err.message || err : "Unknown") + "\n");
        cb(false);
    });
}

function testBridgeLan(cb) {
    var lanIp = "192.168.1.16";
    console.log("[2/3] Testing PC Bridge on LAN IP (" + lanIp + ":11435)...");
    var finished = false;
    var sock = null;
    try {
        sock = net.connect(11435, lanIp, function() {
            if (finished) return;
            finished = true;
            console.log("  -> [OK] Connected to " + lanIp + ":11435! LAN routing works.\n");
            try { sock.end(); } catch (e) {}
            cb(true);
        });
    } catch (e) {
        console.log("  -> [FAIL] Exception: " + e.message + "\n");
        cb(false);
        return;
    }

    if (!sock) {
        console.log("  -> [FAIL] Socket failed to initialize on " + lanIp + ".\n");
        cb(false);
        return;
    }

    sock.on('error', function(err) {
        if (finished) return;
        finished = true;
        console.log("  -> [FAIL] " + lanIp + " error: " + (err ? err.message || err : "Unknown") + "\n");
        cb(false);
    });
}

function testInternet(cb) {
    console.log("[3/3] Testing external Internet access (DNS & HTTP to 1.1.1.1:80)...");
    var finished = false;
    var sock = null;
    try {
        sock = net.connect(80, '1.1.1.1', function() {
            if (finished) return;
            finished = true;
            console.log("  -> [OK] Connected to 1.1.1.1:80! External Internet is ONLINE.\n");
            try { sock.end(); } catch (e) {}
            cb(true);
        });
    } catch (e) {
        console.log("  -> [FAIL] Exception: " + e.message + "\n");
        cb(false);
        return;
    }

    if (!sock) {
        console.log("  -> [FAIL] Socket failed to initialize for Internet.\n");
        cb(false);
        return;
    }

    sock.on('error', function(err) {
        if (finished) return;
        finished = true;
        console.log("  -> [FAIL] External IP error: " + (err ? err.message || err : "Unknown") + "\n");
        cb(false);
    });
}

testBridgeLocal(function(okLocal) {
    testBridgeLan(function(okLan) {
        testInternet(function(okNet) {
            console.log("==================================================");
            console.log("Summary:");
            console.log("  bsdsocket.library emulation: " + (okLocal || okLan || okNet ? "ACTIVE (Working)" : "INACTIVE (Check WinUAE Expansions)"));
            console.log("  PC Bridge Server (11435):    " + (okLocal ? "REACHABLE via 127.0.0.1" : (okLan ? "REACHABLE via " + "192.168.1.16" : "NOT REACHABLE")));
            console.log("  External Internet:           " + (okNet ? "ONLINE" : "OFFLINE"));
            console.log("==================================================");
            if (!okLocal && !okLan) {
                console.log("\nTip: Make sure 'node bridge/server.js' is running on the PC,");
                console.log("and check in WinUAE: Settings -> Expansions -> bsdsocket.library [X].");
            }
        });
    });
});
