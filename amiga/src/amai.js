/*
 * amai.js - Main CLI Entry Point for AMAI (Amiga AI)
 *
 * Usage on Amiga:
 *   NodeAmiga amai.js
 *   NodeAmiga amai.js -h 192.168.1.50 -m qwen3.8:latest
 *   NodeAmiga amai.js "Write a C function to allocate chip RAM"
 *
 * Standalone executable:
 *   NodeAmiga -compile amai amai.js
 *   # or use specific NodeAmiga_020/40/60
 *   amai
 */

var config = require('./lib/config');
var repl = require('./lib/repl');
var network = require('./lib/network');
var ansi = require('./lib/ansi');
var version = require('./lib/version');

function parseArgs() {
    var args = process.argv.slice(2);
    var options = {
        host: null,
        port: null,
        model: null,
        auto: false,
        approvalMode: null,
        configFile: null,
        query: []
    };

    var i = 0;
    while (i < args.length) {
        var arg = args[i];
        if (arg === '-h' || arg === '--host') {
            options.host = args[++i];
        } else if (arg === '-p' || arg === '--port') {
            options.port = parseInt(args[++i], 10);
        } else if (arg === '-m' || arg === '--model') {
            options.model = args[++i];
        } else if (arg === '-s' || arg === '--mode') {
            options.approvalMode = (args[++i] || "").toLowerCase();
        } else if (arg === '-a' || arg === '--auto') {
            options.approvalMode = 'auto';
        } else if (arg === '-d' || arg === '--debug') {
            options.debug = true;
        } else if (arg === '-c' || arg === '--config') {
            options.configFile = args[++i];
        } else if (arg === '-v' || arg === '--version') {
            console.log("AMAI - Amiga AI Shell " + version + " (NodeAmiga runtime)");
            process.exit(0);
        } else if (arg === '--help') {
            console.log("AMAI - Amiga AI Shell " + version);
            console.log("Usage: NodeAmiga amai.js [options] [query]");
            console.log("Options:");
            console.log("  -h, --host <ip>       Bridge server IP (default: 127.0.0.1)");
            console.log("  -p, --port <num>      Bridge server port (default: 11435)");
            console.log("  -m, --model <name>    Model name in Ollama (default: qwen3.8:latest)");
            console.log("  -s, --mode <mode>     Approval mode: smart (default), manual, auto");
            console.log("  -a, --auto            Shortcut for '--mode auto' (unrestricted execution)");
            console.log("  -d, --debug           Enable verbose debug logging");
            console.log("  -c, --config <file>   Path to JSON configuration file");
            console.log("  -v, --version         Show version");
            process.exit(0);
        } else {
            options.query.push(arg);
        }
        i++;
    }

    return options;
}

function main() {
    var opts = parseArgs();
    var cfg = config.loadConfig(opts.configFile);

    if (opts.host) cfg.host = opts.host;
    if (opts.port) cfg.port = opts.port;
    if (opts.model) cfg.model = opts.model;
    if (opts.approvalMode) cfg.approvalMode = opts.approvalMode;
    if (opts.debug) cfg.debug = true;

    function cleanup() {
        try { network.sendAbort(cfg); } catch (e) {}
    }

    try {
        if (typeof process.on === 'function') {
            process.on('SIGINT', function() {
                cleanup();
                if (typeof process.exit === 'function') process.exit(0);
            });
            process.on('exit', function() {
                cleanup();
            });
        }
    } catch (ignore) {}

    // One-shot query mode
    if (opts.query.length > 0) {
        var queryText = opts.query.join(' ');
        var messages = [{ role: 'user', content: queryText }];

        process.stdout.write(repl.prompt);
        network.sendChat(cfg, messages, {
            onToken: function(t) { process.stdout.write(t); },
            onDone: function() {
                console.log("");
                cleanup();
                if (typeof process.exit === 'function') process.exit(0);
            },
            onError: function(e) {
                console.log("\n" + ansi.error("[Error] " + e));
                cleanup();
                if (typeof process.exit === 'function') process.exit(1);
            }
        });
        return;
    }

    // Interactive REPL mode
    repl.startRepl(cfg);
}

main();
