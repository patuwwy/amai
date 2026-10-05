/*
 * repl.js - Interactive REPL & Agentic Loop for Amiga AI
 * Uses rl.question for synchronous/blocking Amiga console input loop.
 */

var readline = require('readline');
var ansi = require('./ansi');
var tools = require('./tools');
var network = require('./network');
var config = require('./config');

var lastKnownSize = { cols: 77, rows: 17 };
var amaiPrompt = ansi.bold(ansi.c(ansi.ANSI.cyan, "amai: "));

function getTerminalSize() {
    // 1. Standard Node.js / TTY properties
    try {
        if (process.stdout && process.stdout.columns && process.stdout.rows) {
            lastKnownSize.cols = process.stdout.columns;
            lastKnownSize.rows = process.stdout.rows;
            return {
                cols: process.stdout.columns,
                rows: process.stdout.rows,
                method: "process.stdout"
            };
        }
    } catch (e) {}

    // 2. Environment variables (LINES / COLUMNS)
    try {
        if (process.env && process.env.COLUMNS && process.env.LINES) {
            var cEnv = parseInt(process.env.COLUMNS, 10);
            var rEnv = parseInt(process.env.LINES, 10);
            if (cEnv && rEnv) {
                lastKnownSize.cols = cEnv;
                lastKnownSize.rows = rEnv;
                return {
                    cols: cEnv,
                    rows: rEnv,
                    method: "env"
                };
            }
        }
    } catch (ignore) {}

    // 3. Pure AmigaDOS / console.device via FFI (no Intuition)
    try {
        var amiga = null;
        try { amiga = require('amiga'); } catch (err) {}

        if (amiga && typeof amiga.openLibrary === 'function' && typeof amiga.call === 'function') {
            var dosBase = amiga.openLibrary("dos.library", 0);
            if (dosBase) {
                var inFh = 0;
                var rawSet = false;
                try {
                    // Input() LVO = -54
                    inFh = amiga.call(dosBase, -54, {});
                    if (inFh) {
                        // SetMode(inFh, 1) -> RAW mode, LVO = -426
                        var smRes = amiga.call(dosBase, -426, { d1: inFh, d2: 1 });
                        rawSet = (smRes !== 0);

                        if (rawSet) {
                            // Send Window Status Request: \x1b[0 q
                            process.stdout.write("\x1b[0 q");

                            // Allocate 64 bytes memory: MEMF_PUBLIC (1) | MEMF_CLEAR (0x10000)
                            var buf = amiga.allocMem(64, 0x10001);
                            if (buf) {
                                try {
                                    // Read(inFh, buf, 64) -> LVO = -42
                                    var n = amiga.call(dosBase, -42, { d1: inFh, d2: buf, d3: 64 });
                                    if (n > 0) {

                                        var allNumbers = [];
                                        var curNum = "";

                                        for (var k = 0; k < n; k++) {
                                            var c = amiga.peek8(buf, k) & 0xFF;
                                            if (c >= 48 && c <= 57) { // '0'-'9'
                                                curNum += String.fromCharCode(c);
                                            } else {
                                                if (curNum) {
                                                    allNumbers.push(parseInt(curNum, 10));
                                                    curNum = "";
                                                }
                                            }

                                        }
                                        if (curNum) allNumbers.push(parseInt(curNum, 10));


                                        // Window Status Report: 1;1;<rows>;<cols>r
                                        if (allNumbers.length >= 4) {
                                            lastKnownSize.rows = allNumbers[2];
                                            lastKnownSize.cols = allNumbers[3];
                                            return {
                                                rows: allNumbers[2],
                                                cols: allNumbers[3],
                                                method: "console.device"
                                            };
                                        }

                                        // 2-number report: <rows>;<cols>
                                        if (allNumbers.length === 2) {
                                            lastKnownSize.rows = allNumbers[0];
                                            lastKnownSize.cols = allNumbers[1];
                                            return {
                                                rows: allNumbers[0],
                                                cols: allNumbers[1],
                                                method: "console.device"
                                            };
                                        }
                                    }
                                } finally {
                                    amiga.freeMem(buf, 64);
                                }
                            }
                        }
                    }
                } finally {
                    if (inFh && rawSet) {
                        try { amiga.call(dosBase, -426, { d1: inFh, d2: 0 }); } catch (ignore) {}
                    }
                    try { amiga.closeLibrary(dosBase); } catch (ignore) {}
                }
            }
        }
    } catch (e) {}

    return lastKnownSize;
}

function startRepl(cfg) {
    var messages = [];
    var maxAgentRounds = 15;
    var bridgeAvailable = network.getStatus(cfg).success ? "OK" : "unavailable";

    process.stdout.write(ansi.ANSI.clearScreen);
    console.log(ansi.bold(ansi.c(ansi.ANSI.cyan, "==================================================")));
    console.log(ansi.bold(ansi.c(ansi.ANSI.yellow, " AMAI - Amiga AI Shell (v1.0) by Patu^Xenium   ")));
    console.log(ansi.bold(ansi.c(ansi.ANSI.cyan, "==================================================")));
    console.log(" Model:   " + ansi.info(cfg.model));
    console.log(" Bridge:  " + ansi.dim(cfg.host + ":" + cfg.port + " " + bridgeAvailable.toString()));
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

    // Ensure any leftover bridge session from a previous run is aborted cleanly
    try { network.sendAbort(cfg); } catch (ignore) {}

    var rl = readline.createInterface({ prompt: '=> ' });
    var promptStr = ansi.bold(ansi.c(ansi.ANSI.green, "=> "));

    var isExiting = false;
    var consecutiveEmptyCount = 0;
    var lastEmptyTime = 0;

    function safeExit() {
        if (isExiting) return;
        isExiting = true;
        try { network.sendAbort(cfg); } catch (ignore) {}
        try { rl.close(); } catch (ignore) {}
        if (typeof process.exit === 'function') {
            process.exit(0);
        }
    }

    try {
        if (typeof rl.on === 'function') {
            rl.on('close', function() {
                safeExit();
            });
            rl.on('SIGINT', function() {
                safeExit();
            });
        }
    } catch (ignore) {}

    function getPromptString() {
        var curMode = (cfg.approvalMode || 'smart').toUpperCase();
        var modeBadge = ansi.success("[" + curMode + "]");
        if (curMode === 'AUTO') {
            modeBadge = ansi.warn("[AUTO]");
        } else if (curMode === 'MANUAL') {
            modeBadge = ansi.dim("[MANUAL]");
        }

        var cwd = "";
        try { if (typeof process.cwd === 'function') cwd = process.cwd(); } catch(e) {}
        var cwdText = cwd ? " " + ansi.info(cwd) : "";

        var sz = getTerminalSize();
        var numCols = (sz && sz.cols) ? sz.cols : lastKnownSize.cols;
        var hrWidth = Math.max(20, Math.min(160, numCols - 3));
        var dashes = "";
        for (var d = 0; d < hrWidth; d++) {
            dashes += "-";
        }
        var hr = ansi.dim(dashes);
        return hr + "\n" + modeBadge + cwdText + " " + ansi.bold(ansi.c(ansi.ANSI.green, "> "));
    }

    function runAgentLoop(round, callbackDone) {
        if (round > maxAgentRounds) {
            console.log(ansi.warn("\n[AI] Reached maximum agent steps (" + maxAgentRounds + ")."));
            callbackDone();
            return;
        }

        var tokenCount = 0;
        var thinkCount = 0;
        var isThinking = false;
        var SPINNER = ['|', '/', '-', '\\'];
        var spinIdx = 0;

        process.stdout.write(amaiPrompt + ansi.dim("* Connecting..."));

        var result = null;
        let thinking = "";

        try {
            result = network.sendChat(cfg, messages, {
                onConnected: function(model) {
                    process.stdout.write("\r" + amaiPrompt + ansi.dim("* Connected...") + "\x1b[K");
                },
                onHeartbeat: function() {
                    if (tokenCount === 0 && !isThinking) {
                        spinIdx = (spinIdx + 1) % SPINNER.length;
                        process.stdout.write("\r" + amaiPrompt + ansi.dim(SPINNER[spinIdx] + " Thinking...") + "\x1b[K");
                    }
                },
                onThinking: function(text) {
                    isThinking = true;
                    thinking = (thinking + text).substr(-32);

                    thinkCount++;
                    spinIdx = (spinIdx + 1) % SPINNER.length;

                    var line = "\r" + amaiPrompt +
                               ansi.warn(SPINNER[spinIdx] + " Thinking (" + thinkCount + ")...") + ansi.italic(thinking) + "\x1b[K";
                    process.stdout.write(line);
                },
                onThinkingDone: function() {
                    if (isThinking) {
                        process.stdout.write("\r\x1b[K" + amaiPrompt);
                        isThinking = false;
                        thinking = "";
                    }
                },
                onToken: function(text) {
                    if (isThinking || tokenCount === 0) {
                        process.stdout.write("\r\x1b[K" + amaiPrompt);
                        isThinking = false;
                        thinking = "";
                    }
                    tokenCount++;
                    process.stdout.write(text);
                },
                onToolCalls: function(calls) {},
                onDone: function(stats) {
                    if (isThinking) {
                        process.stdout.write("\r\x1b[K");
                        isThinking = false;
                        thinking = "";
                    }
                    console.log(""); // Trailing newline
                },
                onError: function(err) {
                    if (isThinking) {
                        process.stdout.write("\r\x1b[K");
                        isThinking = false;
                        thinking = "";
                    }

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

                console.log(
                    ansi.warn("\n[Tool Proposal] ") + ansi.bold(toolName) +
                    ansi.dim(" args: " + JSON.stringify(toolArgs))
                );

                function executeAndContinue() {
                    process.stdout.write(ansi.warn("[Executing " + toolName + "...] "));
                    
                    var toolResult = tools.executeTool(toolName, toolArgs);

                    if (toolResult.success) {
                        process.stdout.write(ansi.dim("OK\n"))
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
                        console.log(ansi.warn("[Smart-Approved: Safe read-only] ") + ansi.dim(risk.reason));
                        executeAndContinue();
                    } else {
                        var badgeColor = risk.riskLevel === 'CRITICAL' ? ansi.ANSI.red :
                                        (risk.riskLevel === 'HIGH' ? ansi.ANSI.yellow : ansi.ANSI.magenta);
                        console.log(ansi.bold(ansi.c(badgeColor, "[SECURITY ALERT - " + (risk.riskLevel || "MEDIUM") + " RISK] ")) + risk.reason);
                        rl.question(ansi.bold("Execute dangerous tool? [y/N]: "), function(answer) {
                            if (isExiting) return;
                            if (answer === null || answer === undefined) {
                                safeExit();
                                return;
                            }
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
                        if (isExiting) return;
                        if (answer === null || answer === undefined) {
                            safeExit();
                            return;
                        }
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
        if (isExiting) return;

        rl.question(getPromptString(), function(answer) {
            if (isExiting) return;

            // EOF detection: window close gadget clicked, stdin closed, or Ctrl-D
            if (answer === null || answer === undefined) {
                safeExit();
                return;
            }

            var input = answer ? answer.trim() : "";
            if (!input) {
                // Safeguard against tight loop when stdin is closed:
                // A human cannot press Enter 3 times within 80ms.
                var now = Date.now();
                if (now - lastEmptyTime < 80) {
                    consecutiveEmptyCount++;
                    if (consecutiveEmptyCount >= 3) {
                        safeExit();
                        return;
                    }
                } else {
                    consecutiveEmptyCount = 0;
                }
                lastEmptyTime = now;

                promptLoop();
                return;
            }

            consecutiveEmptyCount = 0;

            // Handle Slash Commands
            if (input.charAt(0) === '/') {
                var parts = input.split(' ');
                var cmd = parts[0].toLowerCase();
                var arg = parts.slice(1).join(' ').trim();

                if (cmd === '/exit' || cmd === '/quit') {
                    console.log("\n" + ansi.info("Goodbye from AMAI!"));
                    safeExit();
                    return;
                }

                if (cmd === '/help') {
                    console.log(ansi.bold("\nAvailable Commands:"));
                    console.log("  " + ansi.info("/help") + "             - Show this help screen");
                    console.log("  " + ansi.info("/status") + "          - Check connection to PC bridge and Ollama");
                    console.log("  " + ansi.info("/host [ip[:port]]") + " - Change bridge host IP/port (auto-saved)");
                    console.log("  " + ansi.info("/port [port]") + "     - Set bridge port (auto-saved)");
                    console.log("  " + ansi.info("/model [name]") + "    - Show or switch active model (auto-saved)");
                    console.log("  " + ansi.info("/mode [mode]") + "     - Set approval mode: smart, manual, auto (auto-saved)");
                    console.log("  " + ansi.info("/auto [on|off]") + "   - Quick toggle: AUTO mode vs SMART mode (auto-saved)");
                    console.log("  " + ansi.info("/encoding [mode]") + " - Set charset: ascii, amigapl, raw (auto-saved)");
                    console.log("  " + ansi.info("/timeout [sec]") + "   - Set connection timeout in seconds (auto-saved)");
                    console.log("  " + ansi.info("/debug [on|off]") + "  - Toggle verbose debug logging (auto-saved)");
                    console.log("  " + ansi.info("/save [file]") + "     - Explicitly save current settings to config");
                    console.log("  " + ansi.info("/read <file>") + "     - Read Amiga file into AI context (e.g. /read RAM:main.c)");
                    console.log("  " + ansi.info("/run <cmd>") + "       - Run AmigaDOS command directly (e.g. /run dir RAM:)");
                    console.log("  " + ansi.info("/cd [dir]") + "        - Print or inspect current working directory");
                    console.log("  " + ansi.info("/clear") + "           - Clear conversation context");
                    console.log("  " + ansi.info("/exit") + "            - Exit AMAI Shell\n");
                    promptLoop();
                    return;
                }

                if (cmd === '/clear' || cmd === '/cls') {
                    try { network.sendAbort(cfg); } catch (ignore) {}
                    messages = [];
                    process.stdout.write(ansi.ANSI.clearScreen);
                    var szClr = getTerminalSize();
                    if (szClr.rows > 2) {
                        process.stdout.write("\x1b[" + (szClr.rows - 2) + "B");
                    }
                    promptLoop();
                    return;
                }

                if (cmd === '/mode') {
                    if (arg) {
                        var m = arg.toLowerCase();
                        if (m === 'smart' || m === 'manual' || m === 'auto') {
                            cfg.approvalMode = m;
                            console.log(ansi.success("Safety approval mode switched to: ") + ansi.bold(m.toUpperCase()));
                            var sResMode = config.saveConfig(cfg);
                            if (sResMode.success) {
                                console.log(ansi.dim("Config saved to: " + sResMode.path));
                            }
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
                    console.log("Approval mode: " + (cfg.approvalMode === 'auto' ? ansi.warn("AUTO (unrestricted)") : ansi.success(cfg.approvalMode.toUpperCase())));
                    var sResAuto = config.saveConfig(cfg);
                    if (sResAuto.success) {
                        console.log(ansi.dim("Config saved to: " + sResAuto.path + "\n"));
                    } else {
                        console.log("");
                    }
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
                    console.log("Debug logging: " + (cfg.debug ? ansi.success("ENABLED") : ansi.warn("DISABLED")));
                    var sResDbg = config.saveConfig(cfg);
                    if (sResDbg.success) {
                        console.log(ansi.dim("Config saved to: " + sResDbg.path + "\n"));
                    } else {
                        console.log("");
                    }
                    promptLoop();
                    return;
                }

                if (cmd === '/host') {
                    if (arg) {
                        var colonIdx = arg.lastIndexOf(':');
                        if (colonIdx > 0 && colonIdx < arg.length - 1) {
                            var hostPart = arg.substring(0, colonIdx);
                            var portPart = parseInt(arg.substring(colonIdx + 1), 10);
                            if (hostPart) cfg.host = hostPart;
                            if (portPart && !isNaN(portPart)) cfg.port = portPart;
                        } else {
                            cfg.host = arg;
                        }
                        console.log(ansi.success("Switched host to: " + cfg.host + ":" + cfg.port));
                        var sResHost = config.saveConfig(cfg);
                        if (sResHost.success) {
                            console.log(ansi.dim("Config saved to: " + sResHost.path + "\n"));
                        } else {
                            console.log(ansi.warn("Failed to save config: " + sResHost.error + "\n"));
                        }
                    } else {
                        console.log("Current host: " + ansi.info(cfg.host + ":" + cfg.port));
                        console.log("Usage: /host <ip> or /host <ip:port>\n");
                    }
                    promptLoop();
                    return;
                }

                if (cmd === '/port') {
                    if (arg) {
                        var pNum = parseInt(arg, 10);
                        if (pNum > 0 && pNum <= 65535) {
                            cfg.port = pNum;
                            console.log(ansi.success("Switched port to: " + cfg.port));
                            var sResPort = config.saveConfig(cfg);
                            if (sResPort.success) {
                                console.log(ansi.dim("Config saved to: " + sResPort.path + "\n"));
                            } else {
                                console.log("");
                            }
                        } else {
                            console.log(ansi.warn("Invalid port number: " + arg + "\n"));
                        }
                    } else {
                        console.log("Current port: " + ansi.info(String(cfg.port)));
                        console.log("Usage: /port <port_number>\n");
                    }
                    promptLoop();
                    return;
                }

                if (cmd === '/encoding') {
                    if (arg) {
                        var enc = arg.toLowerCase();
                        if (enc === 'ascii' || enc === 'amigapl' || enc === 'iso-8859-2' || enc === 'raw') {
                            cfg.encoding = enc;
                            console.log(ansi.success("Switched text encoding to: " + cfg.encoding));
                            var sResEnc = config.saveConfig(cfg);
                            if (sResEnc.success) {
                                console.log(ansi.dim("Config saved to: " + sResEnc.path + "\n"));
                            } else {
                                console.log("");
                            }
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

                if (cmd === '/timeout') {
                    if (arg) {
                        var tVal = parseInt(arg, 10);
                        if (tVal > 0) {
                            if (tVal < 1000) {
                                tVal = tVal * 1000;
                            }
                            cfg.timeout = tVal;
                            console.log(ansi.success("Timeout set to: " + (cfg.timeout / 1000) + "s (" + cfg.timeout + "ms)"));
                            var sResTo = config.saveConfig(cfg);
                            if (sResTo.success) {
                                console.log(ansi.dim("Config saved to: " + sResTo.path + "\n"));
                            } else {
                                console.log("");
                            }
                        } else {
                            console.log(ansi.warn("Invalid timeout value: " + arg + "\n"));
                        }
                    } else {
                        console.log("Current timeout: " + ansi.info((cfg.timeout / 1000) + "s (" + cfg.timeout + "ms)"));
                        console.log("Usage: /timeout <seconds> (e.g. /timeout 60)\n");
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
                        console.log(ansi.error("[Failed to connect to " + cfg.host + ":" + cfg.port + "]"));
                        if (st.error) {
                            console.log(ansi.dim("Reason: " + st.error));
                        }
                        
                        // If current host failed, suggest or test LAN IP
                        var lanIp = "192.168.1.16";
                        if (cfg.host !== lanIp) {
                            console.log(ansi.info("Attempting auto-discovery on PC LAN IP (" + lanIp + ")..."));
                            var testCfg = { host: lanIp, port: cfg.port };
                            var stLan = network.getStatus(testCfg);
                            if (stLan.success) {
                                cfg.host = lanIp;
                                console.log(ansi.success("[SUCCESS!] Connected to PC on " + lanIp + ":" + cfg.port));
                                console.log("Host automatically updated to: " + ansi.info(cfg.host));
                                var sResLan = config.saveConfig(cfg);
                                if (sResLan.success) {
                                    console.log(ansi.dim("Saved to " + sResLan.path + "\n"));
                                } else {
                                    console.log("");
                                }
                            } else {
                                console.log(ansi.warn("Also failed on " + lanIp + "."));
                                console.log(ansi.dim("Please check if 'bsdsocket.library' is enabled in WinUAE settings.\n"));
                            }
                        } else {
                            console.log(ansi.dim("Please check if PC bridge (node pc/server.js) is running and WinUAE has bsdsocket enabled.\n"));
                        }
                    }
                    promptLoop();
                    return;
                }

                if (cmd === '/model') {
                    if (arg) {
                        cfg.model = arg;
                        console.log(ansi.success("Switched model to: " + cfg.model));
                        var sResModel = config.saveConfig(cfg);
                        if (sResModel.success) {
                            console.log(ansi.dim("Config saved to: " + sResModel.path + "\n"));
                        } else {
                            console.log("");
                        }
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

                if (cmd === '/save') {
                    var sResExplicit = config.saveConfig(cfg, arg || null);
                    if (sResExplicit.success) {
                        console.log(ansi.success("Configuration saved successfully to: " + sResExplicit.path + "\n"));
                    } else {
                        console.log(ansi.error("Failed to save configuration: " + sResExplicit.error + "\n"));
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
                promptLoop();
            });
        });
    }

    // Anchor prompt to bottom of window at startup without scrolling banner
    var termSz = getTerminalSize();
    var bannerLines = 7 + (initialCwd ? 1 : 0) + (cfg.debug ? 1 : 0);
    var linesDown = termSz.rows - bannerLines - 2;
    if (linesDown > 0) {
        process.stdout.write("\x1b[" + linesDown + "B");
    }

    // Start interactive prompt loop
    promptLoop();
}

module.exports = {
    startRepl: startRepl,
    prompt: amaiPrompt
};
