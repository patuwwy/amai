/*
 * compile.js - Amiga AMAI Standalone Compiler Assistant
 *
 * Detects current CPU architecture using base NodeAmiga (os.cpu / os.cpus)
 * and proposes/executes compilation with the optimal NodeAmiga binary:
 *   - NodeAmiga     (MC68000 / MC68010)
 *   - NodeAmiga_020 (MC68020 / MC68030)
 *   - NodeAmiga_040 (MC68040)
 *   - NodeAmiga_060 (MC68060)
 */

var os = require('os');
var fs = require('fs');
var readline = require('readline');
var child_process = null;
try {
    child_process = require('child_process');
} catch (e) {}

// Optional ANSI styling
var ansi = null;
try {
    ansi = require('./lib/ansi');
} catch (e) {
    try { ansi = require('./ansi'); } catch (e2) {}
}

function bold(s) { return ansi ? ansi.bold(s) : s; }
function cyan(s) { return ansi ? ansi.c(ansi.ANSI.cyan, s) : s; }
function green(s) { return ansi ? ansi.success(s) : s; }
function yellow(s) { return ansi ? ansi.warn(s) : s; }
function red(s) { return ansi ? ansi.error(s) : s; }
function dim(s) { return ansi ? ansi.dim(s) : s; }

var ARCHITECTURES = [
    {
        num: "1",
        code: "000",
        binary: "NodeAmiga",
        cpu: "MC68000 / MC68010",
        target: "Universal (any 68000+)",
        desc: "Base build - 100% compatibility with all Classic Amiga models"
    },
    {
        num: "2",
        code: "020",
        binary: "NodeAmiga_020",
        cpu: "MC68020 / MC68030",
        target: "Amiga 1200/3000/020+",
        desc: "Optimized 32-bit instructions and addressing modes"
    },
    {
        num: "3",
        code: "040",
        binary: "NodeAmiga_040",
        cpu: "MC68040",
        target: "Amiga 4000/040 accelerator boards",
        desc: "Optimized 040 execution pipeline and cache handling"
    },
    {
        num: "4",
        code: "060",
        binary: "NodeAmiga_060",
        cpu: "MC68060",
        target: "68060 accelerator boards",
        desc: "Optimized superscalar dual-pipeline execution (max speed)"
    }
];

function detectCpu() {
    var raw = "";
    var speed = 0;

    // 1. Try os.cpu() if exposed by NodeAmiga / runtime
    try {
        if (typeof os.cpu === 'function') {
            var res = os.cpu();
            if (typeof res === 'string') {
                raw = res;
            } else if (res && typeof res === 'object') {
                raw = res.model || res.name || res.cpu || "";
                if (res.speed) speed = res.speed;
            }
        }
    } catch (e) {}

    // 2. Try os.cpus() (Node.js & NodeAmiga standard)
    if (!raw) {
        try {
            if (typeof os.cpus === 'function') {
                var c = os.cpus();
                if (Array.isArray(c) && c.length > 0) {
                    if (typeof c[0] === 'string') {
                        raw = c[0];
                    } else if (c[0] && typeof c[0] === 'object') {
                        raw = c[0].model || "";
                        if (c[0].speed) speed = c[0].speed;
                    }
                }
            }
        } catch (e) {}
    }

    // 3. Fallback to process.arch
    if (!raw && typeof process !== 'undefined' && process.arch) {
        raw = process.arch;
    }

    return {
        model: raw || "MC68000",
        speed: speed
    };
}

function getRecommendedIndex(cpuModel) {
    var s = String(cpuModel || "").toUpperCase();
    if (s.indexOf("68060") !== -1 || s.indexOf("060") !== -1) {
        return 3; // NodeAmiga_060
    }
    if (s.indexOf("68040") !== -1 || s.indexOf("040") !== -1) {
        return 2; // NodeAmiga_040
    }
    if (s.indexOf("68030") !== -1 || s.indexOf("030") !== -1 ||
        s.indexOf("68020") !== -1 || s.indexOf("020") !== -1) {
        return 1; // NodeAmiga_020
    }
    return 0; // Base NodeAmiga (68000)
}

function parseChoice(input) {
    if (!input) return null;
    var s = String(input).trim().toLowerCase().replace(/^-+/, '');
    if (s === '4' || s === '060' || s === '68060' || s === 'nodeamiga_060') return 3;
    if (s === '3' || s === '040' || s === '68040' || s === 'nodeamiga_040') return 2;
    if (s === '2' || s === '020' || s === '030' || s === '68020' || s === '68030' || s === 'nodeamiga_020') return 1;
    if (s === '1' || s === '000' || s === '010' || s === '68000' || s === '68010' || s === 'base' || s === 'nodeamiga') return 0;
    return null;
}

function isMacroPlaceholder(s) {
    if (!s) return true;
    var t = String(s).trim();
    if (!t) return true;
    if (/^[\{<].*[\}>]$/.test(t)) return true;
    return false;
}

function resolveBinaryPath(binName) {
    var candidates = [
        binName,
        "./" + binName,
        "PROGDIR:" + binName,
        "bin/" + binName,
        "C:" + binName
    ];
    for (var i = 0; i < candidates.length; i++) {
        try {
            if (fs.existsSync(candidates[i])) {
                return candidates[i];
            }
        } catch (e) {}
    }
    return binName;
}

function printHeader() {
    console.log(bold(cyan("========================================================")));
    console.log(bold(yellow("   AMAI Standalone Compiler - Amiga Binary Builder      ")));
    console.log(bold(cyan("========================================================")));
}

function showHelp() {
    printHeader();
    console.log("Usage: NodeAmiga compile.js [options] [arch] [output]");
    console.log("");
    console.log("Arguments:");
    console.log("  [arch]            Architecture: 000 (base), 020, 040, 060, or 1-4");
    console.log("  [output]          Output executable name (default: amai)");
    console.log("");
    console.log("Options:");
    console.log("  -y, --auto        Automatically compile for detected CPU");
    console.log("  --from-script     Run in AmigaDOS script handoff mode");
    console.log("  -h, --help        Show this help screen");
    console.log("");
    console.log("Available Compiler Binaries:");
    for (var i = 0; i < ARCHITECTURES.length; i++) {
        var a = ARCHITECTURES[i];
        console.log("  [" + a.num + "] " + a.binary.padEnd(16) + a.cpu.padEnd(20) + a.target);
    }
    console.log("");
}

function compileTarget(arch, outName, entryFile, isFromScript) {
    var compilerBin = resolveBinaryPath(arch.binary);
    var compileCmd = compilerBin + " -compile " + outName + " " + entryFile;

    console.log(bold(cyan("\n--------------------------------------------------------")));
    console.log(" Selected Architecture: " + green(arch.binary) + " (" + arch.cpu + ")");
    console.log(" Target Executable:     " + green(outName));
    console.log(" Source Script:         " + green(entryFile));
    console.log(" Compilation Command:   " + dim(compileCmd));
    console.log(bold(cyan("--------------------------------------------------------\n")));

    var tmpScript = "T:amai_compile_cmd";

    // Write command script for AmigaDOS execution
    var scriptContent = "; AMAI Standalone Compilation Script\n" +
        "; Generated by compile.js for " + arch.cpu + "\n" +
        compileCmd + "\n" +
        "Echo \"\"\n" +
        "Echo \"Compilation complete! You can now run '" + outName + "' standalone without NodeAmiga.\"\n";

    try {
        fs.writeFileSync(tmpScript, scriptContent);
    } catch (err) {
        // Continue even if T: write fails
    }

    if (isFromScript) {
        console.log(green("Preparing compilation via AmigaDOS shell (maximum free RAM)..."));
        process.exit(0);
    }

    // Direct execution mode via child_process.execSync
    console.log(yellow("Executing compiler..."));
    try {
        if (child_process && typeof child_process.execSync === 'function') {
            child_process.execSync(compileCmd);
            console.log("\n" + green("Compilation complete! You can now run '" + outName + "' standalone without NodeAmiga."));
            try { if (fs.existsSync(tmpScript)) fs.unlinkSync(tmpScript); } catch (e) {}
            process.exit(0);
        } else {
            console.log(yellow("child_process.execSync not available."));
            console.log("Please run the following command in Shell to complete compilation:");
            console.log("  " + bold(compileCmd));
            console.log("or:");
            console.log("  execute " + tmpScript);
            process.exit(0);
        }
    } catch (e) {
        console.log(red("\nDirect execution encountered an issue: " + e.message));
        console.log("To complete compilation, run in Shell:\n  " + bold("execute " + tmpScript));
        process.exit(1);
    }
}

function main() {
    var rawArgs = process.argv.slice(2);
    var isFromScript = false;
    var autoMode = false;
    var explicitArch = null;
    var outName = "amai";
    var entryFile = "amai.js";

    var positional = [];
    for (var i = 0; i < rawArgs.length; i++) {
        var arg = rawArgs[i];
        if (!arg || isMacroPlaceholder(arg)) {
            continue;
        }
        if (arg === '--from-script') {
            isFromScript = true;
        } else if (arg === '-y' || arg === '--auto' || arg === '--yes' || arg.toLowerCase() === 'auto') {
            autoMode = true;
        } else if (arg === '-h' || arg === '--help') {
            showHelp();
            process.exit(0);
        } else if (arg === '-o' || arg === '--output') {
            if (i + 1 < rawArgs.length && !isMacroPlaceholder(rawArgs[i + 1])) {
                outName = rawArgs[++i];
            }
        } else if (arg === '-e' || arg === '--entry') {
            if (i + 1 < rawArgs.length && !isMacroPlaceholder(rawArgs[i + 1])) {
                entryFile = rawArgs[++i];
            }
        } else {
            positional.push(arg);
        }
    }

    if (positional.length > 0) {
        var parsed = parseChoice(positional[0]);
        if (parsed !== null) {
            explicitArch = parsed;
            if (positional.length > 1 && !isMacroPlaceholder(positional[1])) {
                outName = positional[1];
            }
        } else {
            if (!isMacroPlaceholder(positional[0])) {
                outName = positional[0];
            }
        }
    }
    if (positional.length > 2 && !isMacroPlaceholder(positional[2])) {
        entryFile = positional[2];
    }

    // Verify source entry script exists
    if (!fs.existsSync(entryFile)) {
        if (fs.existsSync("amiga/" + entryFile)) {
            entryFile = "amiga/" + entryFile;
        } else {
            console.log(red("Error: Source file '" + entryFile + "' not found!"));
            process.exit(1);
        }
    }

    // Detect CPU
    var cpuInfo = detectCpu();
    var recIdx = getRecommendedIndex(cpuInfo.model);
    var recArch = ARCHITECTURES[recIdx];

    // Explicit arch passed on CLI
    if (explicitArch !== null) {
        compileTarget(ARCHITECTURES[explicitArch], outName, entryFile, isFromScript);
        return;
    }

    // Auto mode passed on CLI
    if (autoMode) {
        printHeader();
        console.log(" Current CPU:   " + green(cpuInfo.model + (cpuInfo.speed ? " @ " + cpuInfo.speed + " MHz" : "")));
        console.log(" Architecture:  " + green(recArch.binary) + " (auto-selected)");
        compileTarget(recArch, outName, entryFile, isFromScript);
        return;
    }

    // Interactive prompt
    printHeader();
    console.log(" Runtime:       " + dim("NodeAmiga (base MC68000 query)"));
    var speedStr = cpuInfo.speed ? " @ " + cpuInfo.speed + " MHz" : "";
    console.log(" Detected CPU:  " + bold(green(cpuInfo.model + speedStr)));
    console.log(" Recommended:   " + bold(yellow(recArch.binary)) + " (" + recArch.desc + ")\n");

    console.log("Available NodeAmiga compiler builds:");
    for (var j = 0; j < ARCHITECTURES.length; j++) {
        var a = ARCHITECTURES[j];
        var isRec = (j === recIdx);
        var marker = isRec ? bold(green(" [*] ")) : "     ";
        var binLabel = isRec ? bold(green(a.binary.padEnd(16))) : a.binary.padEnd(16);
        console.log(marker + "[" + a.num + "] " + binLabel + a.cpu.padEnd(20) + a.target);
    }
    console.log("\n" + dim("  [*] = Recommended for detected CPU"));

    var defaultNum = recArch.num;
    var promptStr = "\nSelect architecture [1-4, q to cancel] (default: " + defaultNum + " [" + recArch.binary + "]): ";

    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question(promptStr, function(answer) {
        rl.close();
        var trimmed = (answer || "").trim().toLowerCase();
        if (trimmed === 'q' || trimmed === 'quit' || trimmed === 'exit' || trimmed === 'abort') {
            console.log("\nCompilation cancelled.");
            // Clean up any stale temp command
            try { if (fs.existsSync("T:amai_compile_cmd")) fs.unlinkSync("T:amai_compile_cmd"); } catch (e) {}
            process.exit(0);
        }

        var chosenIdx = recIdx;
        if (trimmed.length > 0) {
            var parsedChoice = parseChoice(trimmed);
            if (parsedChoice !== null) {
                chosenIdx = parsedChoice;
            } else {
                console.log(red("Unrecognized option '" + trimmed + "'. Defaulting to " + recArch.binary + "."));
            }
        }

        var selectedArch = ARCHITECTURES[chosenIdx];
        compileTarget(selectedArch, outName, entryFile, isFromScript);
    });
}

main();
