/*
 * repl.js - Interactive REPL & Agentic Loop for Amiga AI
 * Uses rl.question for synchronous/blocking Amiga console input loop.
 */

var readline = require('readline');
var ansi = require('./ansi');
var tools = require('./tools');
var network = require('./network');

function startRepl(cfg) {
    var messages = [];
    var maxAgentRounds = 5;

    console.log(ansi.bold(ansi.c(ansi.ANSI.cyan, "========================================================")));
    console.log(ansi.bold(ansi.c(ansi.ANSI.yellow, " Amiga AI Shell (v1.0) by Patu^Xenium      ")));
    console.log(ansi.bold(ansi.c(ansi.ANSI.cyan, "========================================================")));
    console.log(" Model:   " + ansi.info(cfg.model));
    console.log(" Bridge:  " + ansi.dim(cfg.host + ":" + cfg.port));
    var initialCwd = "";
    try { if (typeof process.cwd === 'function') initialCwd = process.cwd(); } catch(e) {}
    if (initialCwd) {
        console.log(" Dir:     " + ansi.info(initialCwd));
    }
    var curMode = (cfg.approvalMode || 'smart').toLowerCase();
    var modeBadge = ansi.success("SMART (prompts on dangerous actions)");
    if (curMode === 'auto') {
        modeBadge = ansi.warn("AUTO (unrestricted, executes all tools)");
    } else if (curMode === 'manual') {
        modeBadge = ansi.dim("MANUAL (prompts on every tool)");
    }
    console.log(" Safety:  " + modeBadge);
    if (cfg.debug) {
        console.log(" Debug:   " + ansi.warn("ENABLED (verbose logging)"));
    }
    console.log(" Commands: " + ansi.warn("/help") + ", " + ansi.warn("/status") + ", " + ansi.warn("/cd") + ", " + ansi.warn("/exit"));
    console.log(ansi.bold(ansi.c(ansi.ANSI.cyan, "--------------------------------------------------------\n")));

    var rl = readline.createInterface({ prompt: 'amiga-ai> ' });
    var promptStr = ansi.bold(ansi.c(ansi.ANSI.green, "amiga-ai> "));

    function runAgentLoop(round, callbackDone) {
        if (round > maxAgentRounds) {
            console.log(ansi.warn("\n[AI] Reached maximum agent steps (" + maxAgentRounds + ")."));
            callbackDone();
            return;
        }

        var tokenCount = 0;
        process.stdout.write(ansi.bold(ansi.c(ansi.ANSI.cyan, "AI: ")));

        var result = null;
        try {
            result = network.sendChat(cfg, messages, {
                onConnected: function(model) {},
                onHeartbeat: function() {
                    if (tokenCount === 0) {
                        process.stdout.write(ansi.dim("."));
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
                    console.log("\n" + ansi.error("[Connection Error] " + err));
                    console.log(ansi.dim("Tip: If running in WinUAE, make sure 'bsdsocket.library' is enabled,"));
                    console.log(ansi.dim("or try switching host to your PC IP with: /host 192.168.1.16"));
                }
            });
        } catch (e) {
            console.log("\n" + ansi.error("[Exception] " + network.errToStr(e)));
            callbackDone();
            return;
        }

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

                function rejectAndContinue(reason) {
                    console.log(ansi.warn("[Tool cancelled by user]"));
                    messages.push({
                        role: 'tool',
                        tool_call_id: tc.id || ("call_" + callIdx),
                        content: JSON.stringify({ success: false, error: "Tool execution denied by user (" + (reason || "rejected") + ")." })
                    });
                    callIdx++;
                    processNextTool();
                }

                var risk = tools.assessRisk(toolName, toolArgs);
                var mode = (cfg.approvalMode || 'smart').toLowerCase();

                if (mode === 'auto') {
                    console.log(ansi.dim("[Auto-approved: AUTO mode active]"));
                    executeAndContinue();
                } else if (mode === 'smart') {
                    if (!risk.dangerous) {
                        console.log(ansi.success("[Smart-Approved: Safe read-only] ") + ansi.dim(risk.reason));
                        executeAndContinue();
                    } else {
                        var badgeColor = risk.riskLevel === 'CRITICAL' ? ansi.ANSI.red :
                                        (risk.riskLevel === 'HIGH' ? ansi.ANSI.yellow : ansi.ANSI.magenta);
                        console.log(ansi.bold(ansi.c(badgeColor, "[SECURITY ALERT - " + (risk.riskLevel || "MEDIUM") + " RISK] ")) + risk.reason);
                        rl.question(ansi.bold("Execute dangerous tool? [y/N]: "), function(answer) {
                            var a = answer ? answer.trim().toLowerCase() : "";
                            if (a === "y" || a === "yes") {
                                executeAndContinue();
                            } else {
                                rejectAndContinue(risk.reason);
                            }
                        });
                    }
                } else { // 'manual' mode
                    if (risk.dangerous) {
                        var badgeColor = risk.riskLevel === 'CRITICAL' ? ansi.ANSI.red :
                                        (risk.riskLevel === 'HIGH' ? ansi.ANSI.yellow : ansi.ANSI.magenta);
                        console.log(ansi.bold(ansi.c(badgeColor, "[Risk: " + (risk.riskLevel || "MEDIUM") + "] ")) + risk.reason);
                    } else {
                        console.log(ansi.dim("[Safe action: " + risk.reason + "]"));
                    }
                    rl.question(ansi.bold("Execute tool " + toolName + "? [Y/n]: "), function(answer) {
                        var a = answer ? answer.trim().toLowerCase() : "";
                        if (a === "" || a === "y" || a === "yes") {
                            executeAndContinue();
                        } else {
                            rejectAndContinue("rejected in manual mode");
                        }
                    });
                }
            }

            processNextTool();
        } else {
            callbackDone();
        }
    }

    // Interactive Loop using rl.question
    function promptLoop() {
        rl.question(promptStr, function(answer) {
            var input = answer ? answer.trim() : "";
            if (!input) {
                promptLoop();
                return;
            }

            // Handle Slash Commands
            if (input.charAt(0) === '/') {
                var parts = input.split(' ');
                var cmd = parts[0].toLowerCase();
                var arg = parts.slice(1).join(' ').trim();

                if (cmd === '/exit' || cmd === '/quit') {
                    console.log("\n" + ansi.info("Goodbye from Amiga AI!"));
                    try { rl.close(); } catch (ignore) {}
                    return;
                }

                if (cmd === '/help') {
                    console.log(ansi.bold("\nAvailable Commands:"));
                    console.log("  " + ansi.info("/help") + "             - Show this help screen");
                    console.log("  " + ansi.info("/status") + "          - Check connection to PC bridge and Ollama");
                    console.log("  " + ansi.info("/mode [mode]") + "     - Set approval mode: smart (default), manual, auto");
                    console.log("  " + ansi.info("/cd [dir]") + "        - Print or inspect current working directory");
                    console.log("  " + ansi.info("/host <ip>") + "       - Change bridge host IP (e.g. /host 192.168.1.16)");
                    console.log("  " + ansi.info("/read <file>") + "     - Read Amiga file into AI context (e.g. /read RAM:main.c)");
                    console.log("  " + ansi.info("/run <cmd>") + "       - Run AmigaDOS command directly (e.g. /run dir RAM:)");
                    console.log("  " + ansi.info("/model [name]") + "    - Show or switch active model (e.g. /model qwen3.8:latest)");
                    console.log("  " + ansi.info("/encoding [mode]") + " - Set charset: ascii, amigapl, iso-8859-2, raw");
                    console.log("  " + ansi.info("/auto [on|off]") + "   - Quick toggle: AUTO mode vs SMART mode");
                    console.log("  " + ansi.info("/debug [on|off]") + "  - Toggle verbose debug logging");
                    console.log("  " + ansi.info("/clear") + "           - Clear conversation context");
                    console.log("  " + ansi.info("/exit") + "            - Exit Amiga AI Shell\n");
                    promptLoop();
                    return;
                }

                if (cmd === '/clear') {
                    messages = [];
                    console.log(ansi.success("Conversation history cleared.\n"));
                    promptLoop();
                    return;
                }

                if (cmd === '/mode') {
                    if (arg) {
                        var m = arg.toLowerCase();
                        if (m === 'smart' || m === 'manual' || m === 'auto') {
                            cfg.approvalMode = m;
                            console.log(ansi.success("Safety approval mode switched to: ") + ansi.bold(m.toUpperCase()));
                            if (m === 'smart') {
                                console.log(ansi.dim("Safe read-only actions run automatically; dangerous actions ask for confirmation.\n"));
                            } else if (m === 'manual') {
                                console.log(ansi.dim("Every tool execution will prompt for confirmation [Y/n].\n"));
                            } else if (m === 'auto') {
                                console.log(ansi.warn("Unrestricted mode: all tool calls execute immediately without prompt!\n"));
                            }
                        } else {
                            console.log(ansi.warn("Unknown mode '" + arg + "'. Choose: smart, manual, auto\n"));
                        }
                    } else {
                        console.log("Current approval mode: " + ansi.bold((cfg.approvalMode || 'smart').toUpperCase()));
                        console.log("Modes:");
                        console.log("  " + ansi.info("smart") + "  - Auto-executes safe reads (read_file, list_dir, cd), confirms dangerous actions");
                        console.log("  " + ansi.info("manual") + " - Asks confirmation [Y/n] for every single tool call");
                        console.log("  " + ansi.info("auto") + "   - Free mode: executes all tools without confirmation (use with caution!)");
                        console.log("Usage: /mode <smart|manual|auto>\n");
                    }
                    promptLoop();
                    return;
                }

                if (cmd === '/auto') {
                    if (arg === 'on') {
                        cfg.approvalMode = 'auto';
                    } else if (arg === 'off') {
                        cfg.approvalMode = 'smart';
                    } else {
                        cfg.approvalMode = (cfg.approvalMode === 'auto') ? 'smart' : 'auto';
                    }
                    console.log("Approval mode: " + (cfg.approvalMode === 'auto' ? ansi.warn("AUTO (unrestricted)") : ansi.success(cfg.approvalMode.toUpperCase())) + "\n");
                    promptLoop();
                    return;
                }

                if (cmd === '/cd') {
                    var currentDir = "";
                    try { currentDir = process.cwd(); } catch(e) {}
                    if (arg) {
                        console.log(ansi.info("Current directory: " + currentDir));
                        console.log(ansi.dim("Tip: AmigaDOS executes tools relative to " + currentDir + ". To run command in another dir: /run cd " + arg));
                    } else {
                        console.log("Current working directory on Amiga: " + ansi.info(currentDir) + "\n");
                    }
                    promptLoop();
                    return;
                }

                if (cmd === '/debug') {
                    if (arg === 'on') {
                        cfg.debug = true;
                    } else if (arg === 'off') {
                        cfg.debug = false;
                    } else {
                        cfg.debug = !cfg.debug;
                    }
                    console.log("Debug logging: " + (cfg.debug ? ansi.success("ENABLED") : ansi.warn("DISABLED")) + "\n");
                    promptLoop();
                    return;
                }

                if (cmd === '/host') {
                    if (arg) {
                        cfg.host = arg;
                        console.log(ansi.success("Switched host to: " + cfg.host + "\n"));
                    } else {
                        console.log("Current host: " + ansi.info(cfg.host) + "\n");
                    }
                    promptLoop();
                    return;
                }

                if (cmd === '/encoding') {
                    if (arg) {
                        var enc = arg.toLowerCase();
                        if (enc === 'ascii' || enc === 'amigapl' || enc === 'iso-8859-2' || enc === 'raw') {
                            cfg.encoding = enc;
                            console.log(ansi.success("Switched text encoding to: " + cfg.encoding + "\n"));
                        } else {
                            console.log(ansi.warn("Unknown encoding. Choose: ascii, amigapl, iso-8859-2, raw\n"));
                        }
                    } else {
                        console.log("Current encoding: " + ansi.info(cfg.encoding || 'ascii'));
                        console.log("Options: ascii (default, Topaz safe), amigapl (Polish fonts), iso-8859-2, raw");
                        console.log("Usage: /encoding <ascii|amigapl|iso-8859-2|raw>\n");
                    }
                    promptLoop();
                    return;
                }

                if (cmd === '/status' || cmd === '/test') {
                    console.log("Testing connection to " + cfg.host + ":" + cfg.port + "...");
                    var st = network.getStatus(cfg);
                    if (st.success) {
                        console.log(ansi.success("[Bridge Online!]"));
                        console.log("  Host:    " + ansi.info(cfg.host + ":" + cfg.port));
                        console.log("  Model:   " + ansi.info(st.data.default_model));
                        console.log("  Ollama:  " + st.data.ollama);
                        console.log("  Models:  " + (st.data.models ? st.data.models.join(", ") : "none") + "\n");
                    } else {
                        console.log(ansi.error("[Failed to connect to " + cfg.host + ":" + cfg.port + "] " + st.error));
                        
                        // If 127.0.0.1 failed, suggest or test LAN IP
                        var lanIp = "192.168.1.16";
                        if (cfg.host !== lanIp) {
                            console.log(ansi.info("Attempting auto-discovery on PC LAN IP (" + lanIp + ")..."));
                            var testCfg = { host: lanIp, port: cfg.port };
                            var stLan = network.getStatus(testCfg);
                            if (stLan.success) {
                                cfg.host = lanIp;
                                console.log(ansi.success("[SUCCESS!] Connected to PC on " + lanIp + ":" + cfg.port));
                                console.log("Host automatically updated to: " + ansi.info(cfg.host) + "\n");
                            } else {
                                console.log(ansi.warn("Also failed on " + lanIp + "."));
                                console.log(ansi.dim("Please check if 'bsdsocket.library' is enabled in WinUAE settings.\n"));
                            }
                        }
                    }
                    promptLoop();
                    return;
                }

                if (cmd === '/model') {
                    if (arg) {
                        cfg.model = arg;
                        console.log(ansi.success("Switched model to: " + cfg.model + "\n"));
                    } else {
                        console.log("Current model: " + ansi.info(cfg.model));
                        var st2 = network.getStatus(cfg);
                        if (st2.success && st2.data.models) {
                            console.log("Available on bridge: " + st2.data.models.join(", "));
                        }
                        console.log("Usage: /model <model_name>\n");
                    }
                    promptLoop();
                    return;
                }

                if (cmd === '/read') {
                    if (!arg) {
                        console.log(ansi.warn("Usage: /read <amiga_file_path> (e.g. /read RAM:main.c)\n"));
                        promptLoop();
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
                    promptLoop();
                    return;
                }

                if (cmd === '/run') {
                    if (!arg) {
                        console.log(ansi.warn("Usage: /run <amiga_command> (e.g. /run dir RAM:)\n"));
                        promptLoop();
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
                    promptLoop();
                    return;
                }

                console.log(ansi.error("Unknown command: " + cmd + ". Type /help for assistance.\n"));
                promptLoop();
                return;
            }

            // Regular user prompt -> Send to Agent
            messages.push({ role: 'user', content: input });
            runAgentLoop(1, function() {
                console.log("");
                promptLoop();
            });
        });
    }

    // Start interactive prompt loop
    promptLoop();
}

module.exports = {
    startRepl: startRepl
};
