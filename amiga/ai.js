/*
 * ai.js - Main CLI Entry Point for Amiga AI
 *
 * Usage on Amiga:
 *   NodeAmiga ai.js
 *   NodeAmiga ai.js -h 192.168.1.50 -m qwen3.8:latest
 *   NodeAmiga ai.js "Write a C function to allocate chip RAM"
 *
 * Standalone executable:
 *   NodeAmiga -compile ai ai.js
 *   ai
 */

var config = require('./lib/config');
var repl = require('./lib/repl');
var network = require('./lib/network');
var ansi = require('./lib/ansi');

function parseArgs() {
    var args = process.argv.slice(2);
    var options = {
        host: null,
        port: null,
        model: null,
        auto: false,
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
        } else if (arg === '-a' || arg === '--auto') {
            options.auto = true;
        } else if (arg === '-d' || arg === '--debug') {
            options.debug = true;
        } else if (arg === '-c' || arg === '--config') {
            options.configFile = args[++i];
        } else if (arg === '-v' || arg === '--version') {
            console.log("Amiga AI Shell v1.0.0 (NodeAmiga runtime)");
            process.exit(0);
        } else if (arg === '--help') {
            console.log("Amiga AI Shell v1.0.0");
            console.log("Usage: NodeAmiga ai.js [options] [query]");
            console.log("Options:");
            console.log("  -h, --host <ip>       Bridge server IP (default: 127.0.0.1)");
            console.log("  -p, --port <num>      Bridge server port (default: 11435)");
            console.log("  -m, --model <name>    Model name in Ollama (default: qwen3.8:latest)");
            console.log("  -a, --auto            Auto-execute AI tool calls without asking");
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
    if (opts.auto) cfg.autoExecute = true;
    if (opts.debug) cfg.debug = true;

    // One-shot query mode
    if (opts.query.length > 0) {
        var queryText = opts.query.join(' ');
        var messages = [{ role: 'user', content: queryText }];

        process.stdout.write(ansi.bold(ansi.c(ansi.ANSI.cyan, "AI: ")));
        network.sendChat(cfg, messages, {
            onToken: function(t) { process.stdout.write(t); },
            onDone: function() { console.log(""); },
            onError: function(e) { console.log("\n" + ansi.error("[Error] " + e)); }
        });
        return;
    }

    // Interactive REPL mode
    repl.startRepl(cfg);
}

main();
