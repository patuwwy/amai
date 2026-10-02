/*
 * repl.js - Interactive REPL & Agentic Loop for Amiga AI
 */

var readline = require('readline');
var ansi = require('./ansi');
var tools = require('./tools');
var network = require('./network');

function startRepl(cfg) {
    var messages = [];
    var maxAgentRounds = 5;

    console.log(ansi.bold(ansi.c(ansi.ANSI.cyan, "========================================================")));
    console.log(ansi.bold(ansi.c(ansi.ANSI.yellow, "             Amiga AI Shell (v1.0)                      ")));
    console.log(ansi.bold(ansi.c(ansi.ANSI.cyan, "========================================================")));
    console.log(" Model:   " + ansi.info(cfg.model));
    console.log(" Bridge:  " + ansi.dim(cfg.host + ":" + cfg.port));
    console.log(" Commands: " + ansi.warn("/help") + ", " + ansi.warn("/read <file>") + ", " + ansi.warn("/run <cmd>") + ", " + ansi.warn("/model") + ", " + ansi.warn("/exit"));
    console.log(ansi.bold(ansi.c(ansi.ANSI.cyan, "--------------------------------------------------------\n")));

    var rl = readline.createInterface({
        prompt: ansi.bold(ansi.c(ansi.ANSI.green, "amiga-ai> "))
    });

    function askUser(query, callback) {
        rl.question(query, function(ans) {
            callback(ans ? ans.trim() : "");
        });
    }

    function runAgentLoop(round, callbackDone) {
        if (round > maxAgentRounds) {
            console.log(ansi.warn("\n[AI] Reached maximum agent steps (" + maxAgentRounds + ")."));
            callbackDone();
            return;
        }

        var thinkingStarted = false;
        var tokenCount = 0;

        process.stdout.write(ansi.bold(ansi.c(ansi.ANSI.cyan, "AI: ")));

        var result = network.sendChat(cfg, messages, {
            onConnected: function(model) {},
            onHeartbeat: function() {
                if (tokenCount === 0) {
                    process.stdout.write(ansi.dim("."));
                    thinkingStarted = true;
                }
            },
            onToken: function(text) {
                tokenCount++;
                process.stdout.write(text);
            },
            onToolCalls: function(calls) {},
            onDone: function(stats) {
                console.log(""); // Trailing newline
            },
            onError: function(err) {
                console.log("\n" + ansi.error("[Error] " + err));
            }
        });

        if (!result) {
            callbackDone();
            return;
        }

        // If regular text was generated, add it to history
        if (result.content && result.content.trim()) {
            messages.push({ role: 'assistant', content: result.content });
        }

        // If tool calls were requested by AI
        if (result.toolCalls && result.toolCalls.length > 0) {
            messages.push({ role: 'assistant', tool_calls: result.toolCalls });

            var callIdx = 0;

            function processNextTool() {
                if (callIdx >= result.toolCalls.length) {
                    // All tools in this step executed -> trigger next agent round!
                    runAgentLoop(round + 1, callbackDone);
                    return;
                }

                var tc = result.toolCalls[callIdx];
                var fn = tc.function || tc;
                var toolName = fn.name;
                var toolArgs = fn.arguments;

                if (typeof toolArgs === 'string') {
                    try { toolArgs = JSON.parse(toolArgs); } catch (e) {}
                }

                console.log(ansi.warn("\n[Tool Proposal] ") + ansi.bold(toolName));
                console.log(ansi.dim("Arguments: " + JSON.stringify(toolArgs)));

                function executeAndContinue() {
                    console.log(ansi.info("[Executing " + toolName + "...]"));
                    var toolResult = tools.executeTool(toolName, toolArgs);

                    if (toolResult.success) {
                        console.log(ansi.success("[Tool OK] ") + (toolResult.message || (toolResult.count ? toolResult.count + " items" : "Done")));
                        if (toolResult.output) {
                            console.log(ansi.dim(toolResult.output));
                        }
                    } else {
                        console.log(ansi.error("[Tool Error] " + toolResult.error));
                    }

                    messages.push({
                        role: 'tool',
                        tool_call_id: tc.id || ("call_" + callIdx),
                        content: JSON.stringify(toolResult)
                    });

                    callIdx++;
                    processNextTool();
                }

                if (cfg.autoExecute) {
                    executeAndContinue();
                } else {
                    askUser(ansi.bold("Execute this tool? [Y/n]: "), function(answer) {
                        var a = answer.toLowerCase();
                        if (a === "" || a === "y" || a === "yes") {
                            executeAndContinue();
                        } else {
                            console.log(ansi.warn("[Tool cancelled by user]"));
                            messages.push({
                                role: 'tool',
                                tool_call_id: tc.id || ("call_" + callIdx),
                                content: JSON.stringify({ success: false, error: "Tool execution denied by user." })
                            });
                            callIdx++;
                            processNextTool();
                        }
                    });
                }
            }

            processNextTool();
        } else {
            // No tool calls -> turn finished
            callbackDone();
        }
    }

    rl.on('line', function(line) {
        var input = line ? line.trim() : "";
        if (!input) {
            rl.prompt();
            return;
        }

        // Handle Slash Commands
        if (input.charAt(0) === '/') {
            var parts = input.split(' ');
            var cmd = parts[0].toLowerCase();
            var arg = parts.slice(1).join(' ').trim();

            if (cmd === '/exit' || cmd === '/quit') {
                rl.close();
                return;
            }

            if (cmd === '/help') {
                console.log(ansi.bold("\nAvailable Commands:"));
                console.log("  " + ansi.info("/help") + "             - Show this help screen");
                console.log("  " + ansi.info("/read <file>") + "     - Read Amiga file into AI context (e.g. /read RAM:main.c)");
                console.log("  " + ansi.info("/run <cmd>") + "       - Run AmigaDOS command directly (e.g. /run dir RAM:)");
                console.log("  " + ansi.info("/model [name]") + "    - Show or switch active model (e.g. /model qwen3.8:latest)");
                console.log("  " + ansi.info("/status") + "          - Check connection to PC bridge and Ollama");
                console.log("  " + ansi.info("/auto [on|off]") + "   - Toggle auto-execution of AI tools without prompt");
                console.log("  " + ansi.info("/clear") + "           - Clear conversation context");
                console.log("  " + ansi.info("/exit") + "            - Exit Amiga AI Shell\n");
                rl.prompt();
                return;
            }

            if (cmd === '/clear') {
                messages = [];
                console.log(ansi.success("Conversation history cleared.\n"));
                rl.prompt();
                return;
            }

            if (cmd === '/auto') {
                if (arg === 'on') {
                    cfg.autoExecute = true;
                } else if (arg === 'off') {
                    cfg.autoExecute = false;
                } else {
                    cfg.autoExecute = !cfg.autoExecute;
                }
                console.log("Auto-execute tools: " + (cfg.autoExecute ? ansi.success("ENABLED") : ansi.warn("DISABLED")) + "\n");
                rl.prompt();
                return;
            }

            if (cmd === '/status') {
                console.log("Connecting to bridge at " + cfg.host + ":" + cfg.port + "...");
                var st = network.getStatus(cfg);
                if (st.success) {
                    console.log(ansi.success("[Bridge Online]"));
                    console.log("  Default Model: " + ansi.info(st.data.default_model));
                    console.log("  Ollama Target: " + st.data.ollama);
                    console.log("  Available Models: " + (st.data.models ? st.data.models.join(", ") : "none") + "\n");
                } else {
                    console.log(ansi.error("[Bridge Offline] " + st.error + "\n"));
                }
                rl.prompt();
                return;
            }

            if (cmd === '/model') {
                if (arg) {
                    cfg.model = arg;
                    console.log(ansi.success("Switched model to: " + cfg.model + "\n"));
                } else {
                    console.log("Current model: " + ansi.info(cfg.model));
                    console.log("Querying available models from bridge...");
                    var st2 = network.getStatus(cfg);
                    if (st2.success && st2.data.models) {
                        console.log("Available: " + st2.data.models.join(", "));
                    }
                    console.log("Usage: /model <model_name>\n");
                }
                rl.prompt();
                return;
            }

            if (cmd === '/read') {
                if (!arg) {
                    console.log(ansi.warn("Usage: /read <amiga_file_path> (e.g. /read RAM:main.c)\n"));
                    rl.prompt();
                    return;
                }
                var r = tools.readFile(arg);
                if (r.success) {
                    messages.push({
                        role: 'user',
                        content: "Here is the content of " + arg + ":\n```\n" + r.content + "\n```"
                    });
                    console.log(ansi.success("Loaded " + arg + " (" + r.size + " bytes) into conversation context.\n"));
                } else {
                    console.log(ansi.error(r.error + "\n"));
                }
                rl.prompt();
                return;
            }

            if (cmd === '/run') {
                if (!arg) {
                    console.log(ansi.warn("Usage: /run <amiga_command> (e.g. /run dir RAM:)\n"));
                    rl.prompt();
                    return;
                }
                console.log(ansi.info("Executing: " + arg + "..."));
                var resCmd = tools.runCommand(arg);
                if (resCmd.output) {
                    console.log(resCmd.output);
                }
                if (!resCmd.success && resCmd.error) {
                    console.log(ansi.error("[Command error] " + resCmd.error));
                }
                console.log("");
                rl.prompt();
                return;
            }

            console.log(ansi.error("Unknown command: " + cmd + ". Type /help for assistance.\n"));
            rl.prompt();
            return;
        }

        // Regular user prompt -> Send to Agent
        messages.push({ role: 'user', content: input });
        runAgentLoop(1, function() {
            console.log("");
            rl.prompt();
        });
    });

    rl.on('close', function() {
        console.log("\n" + ansi.info("Goodbye from Amiga AI!"));
    });

    rl.prompt();
}

module.exports = {
    startRepl: startRepl
};
