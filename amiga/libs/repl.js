/* repl.js -- Programmatic REPL for NodeAmiga */
/* Usage: */
/*   var repl = require('repl'); */
/*   repl.start({ prompt: '> ', eval: function(cmd) { return eval(cmd); } }); */

var readline = require('readline');

function ReplServer(options) {
    options = options || {};
    this.prompt = options.prompt || '> ';
    this.evalFn = options.eval || null;
    this.running = false;
    this.history = [];
    this.maxHistory = options.historySize || 100;
    this.rl = null;
}

ReplServer.prototype.start = function() {
    var self = this;
    var line;
    self.running = true;
    self.rl = readline.createInterface({ input: process.stdin });

    console.log("REPL started. Type .exit to quit, .help for commands.");

    /* Iterative loop — no recursion, no stack overflow */
    while (self.running) {
        process.stdout.write(self.prompt);
        line = process.stdin.read();

        if (line === null || line === undefined) {
            self.running = false;
            break;
        }

        line = line.trim();

        /* Handle special commands */
        if (line === '.exit' || line === '.quit') {
            self.running = false;
            break;
        }
        if (line === '.help') {
            console.log("Commands:");
            console.log("  .exit    Exit the REPL");
            console.log("  .help    Show this help");
            continue;
        }
        if (line === '') continue;

        /* Add to history */
        if (self.history.length >= self.maxHistory) {
            self.history.shift();
        }
        self.history.push(line);

        /* Evaluate */
        if (self.evalFn) {
            try {
                var result = self.evalFn(line);
                if (result !== undefined) {
                    console.log(result);
                }
            } catch (e) {
                console.error('Error: ' + (e.message || e));
            }
        }
    }

    if (self.rl) self.rl.close();
};

ReplServer.prototype.eval = function(code) {
    if (this.evalFn) {
        try {
            return this.evalFn(code);
        } catch (e) {
            console.error('Error: ' + (e.message || e));
            return undefined;
        }
    }
    return undefined;
};

ReplServer.prototype.close = function() {
    this.running = false;
    if (this.rl) {
        this.rl.close();
        this.rl = null;
    }
};

module.exports = {
    start: function(options) {
        var server = new ReplServer(options);
        server.start();
        return server;
    },
    ReplServer: ReplServer
};
