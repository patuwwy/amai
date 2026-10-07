/*
 * tools.js - Amiga Tool Execution Engine
 * Executes file inspection, editing, and AmigaDOS commands on the Amiga.
 */

var MAX_READ_SIZE = 16 * 1024;

var fs = require('fs');
var child_process = null;
try {
    child_process = require('child_process');
} catch (e) {
    // Optional if child_process is unavailable
}

var BINARY_EXTENSIONS = [
    '.info', '.exe', '.lha', '.lzx', '.zip', '.adf', '.dms',
    '.library', '.device', '.dat', '.bin', '.iff', '.ilbm',
    '.anim', '.mod', '.med', '.oct'
];

function isBinaryExtension(filePath) {
    if (!filePath) return false;
    var lower = String(filePath).toLowerCase();
    for (var i = 0; i < BINARY_EXTENSIONS.length; i++) {
        var ext = BINARY_EXTENSIONS[i];
        if (lower.indexOf(ext) === lower.length - ext.length) {
            return ext;
        }
    }
    return null;
}

function readFile(path) {
    if (!path) {
        return { success: false, error: "Missing file path" };
    }
    var binExt = isBinaryExtension(path);
    if (binExt) {
        return {
            success: false,
            error: "File '" + path + "' is a binary file (" + binExt + "). read_file only supports text and source code files."
        };
    }
    if (!fs.existsSync(path)) {
        return { success: false, error: "File not found: " + path };
    }
    try {
        var content = fs.readFileSync(path, 'utf8');
        if (content && content.indexOf('\0') !== -1) {
            return {
                success: false,
                error: "File '" + path + "' contains binary data (null bytes). read_file only supports text files."
            };
        }
        var maxLen = MAX_READ_SIZE;
        var truncated = false;
        if (content.length > maxLen) {
            content = content.substring(0, maxLen) + "\n... [TRUNCATED - File exceeds " + MAX_READ_SIZE + " bytes. NodeAmiga memory protection] ...";
            truncated = true;
        }

        // Sanitize control characters (preserve tab, newline, carriage return)
        var cleanContent = "";
        for (var ci = 0; ci < content.length; ci++) {
            var code = content.charCodeAt(ci);
            if (code >= 32 || code === 10 || code === 13 || code === 9) {
                cleanContent += content.charAt(ci);
            }
        }

        return {
            success: true,
            path: path,
            size: cleanContent.length,
            truncated: truncated,
            content: cleanContent
        };
    } catch (e) {
        return { success: false, error: "Read error: " + e.message };
    }
}

function writeFile(path, content) {
    try {
        fs.writeFileSync(path, content);
        return {
            success: true,
            path: path,
            bytesWritten: content.length,
            message: "Successfully written " + content.length + " bytes to " + path
        };
    } catch (e) {
        return { success: false, error: "Write error: " + e.message };
    }
}

function patchFile(path, search, replace) {
    if (!fs.existsSync(path)) {
        return { success: false, error: "File not found: " + path };
    }
    try {
        var content = fs.readFileSync(path, 'utf8');
        var index = content.indexOf(search);
        if (index === -1) {
            return {
                success: false,
                error: "Search block not found in " + path + ". Make sure the code snippet matches exactly."
            };
        }

        var newContent = content.substring(0, index) + replace + content.substring(index + search.length);
        fs.writeFileSync(path, newContent);

        return {
            success: true,
            path: path,
            message: "Successfully patched " + path + " (replaced " + search.length + " chars with " + replace.length + " chars)"
        };
    } catch (e) {
        return { success: false, error: "Patch error: " + e.message };
    }
}

function listDir(path) {
    if (!path || path === "." || path === "./") {
        try { path = process.cwd(); } catch(e) { path = ""; }
    }
    try {
        var entries = fs.readdirSync(path);
        var maxEntries = 120;
        var truncated = false;
        var totalCount = entries.length;
        if (entries.length > maxEntries) {
            entries = entries.slice(0, maxEntries);
            truncated = true;
        }
        return {
            success: true,
            path: path,
            count: entries.length,
            total: totalCount,
            truncated: truncated,
            entries: entries
        };
    } catch (e) {
        return { success: false, error: "ListDir error: " + e.message };
    }
}

function getCwd() {
    var dir = "";
    try { dir = process.cwd(); } catch(e) {}
    return {
        success: true,
        cwd: dir,
        message: "Current working directory on Amiga is: " + dir
    };
}

function runCommand(command) {
    var trimmedCmd = command ? command.trim() : "";

    // AmigaDOS 'cd' command without arguments prints current directory
    if (trimmedCmd.toLowerCase() === "cd") {
        var dirNow = "";
        try { dirNow = process.cwd(); } catch(e) {}
        return {
            success: true,
            command: command,
            output: dirNow + "\n"
        };
    }

    var tmpOut = "T:ai_cmd_out.tmp";
    // Redirect stdout to temp file in T: (standard Amiga RAM temp directory)
    var cmdWithRedirect = command + " >" + tmpOut;

    try {
        if (child_process && typeof child_process.execSync === 'function') {
            child_process.execSync(cmdWithRedirect);
        } else {
            return { success: false, error: "child_process.execSync is not available in this environment" };
        }

        var output = "";
        if (fs.existsSync(tmpOut)) {
            output = fs.readFileSync(tmpOut, 'utf8');
            try { fs.unlinkSync(tmpOut); } catch (ignore) {}
        }

        return {
            success: true,
            command: command,
            output: output
        };
    } catch (e) {
        var errOutput = "";
        if (fs.existsSync(tmpOut)) {
            try {
                errOutput = fs.readFileSync(tmpOut, 'utf8');
                fs.unlinkSync(tmpOut);
            } catch (ignore) {}
        }

        // AmigaDOS commands often return non-zero return codes (e.g. WARN 5) on informative queries (cpu, version, list).
        // If output was generated and it does not indicate command failure, treat as success.
        var trimmedErr = errOutput ? errOutput.trim() : "";
        var isNotFound = trimmedErr.indexOf("Unknown command") !== -1 ||
                         trimmedErr.indexOf("not found") !== -1 ||
                         trimmedErr.indexOf("Cannot open") !== -1;
        if (trimmedErr && !isNotFound) {
            return {
                success: true,
                command: command,
                output: errOutput
            };
        }

        return {
            success: false,
            command: command,
            error: e.message || "Command execution failed",
            output: errOutput
        };
    }
}

function launchWorkbenchApp(appPath, args) {
    if (!appPath) {
        return { success: false, error: "Missing application path" };
    }

    var cleanPath = String(appPath).trim().replace(/^["']|["']$/g, '');

    // Strip .info extension if provided (WBRun expects the executable name)
    if (cleanPath.toLowerCase().indexOf('.info') === cleanPath.length - 5) {
        cleanPath = cleanPath.substring(0, cleanPath.length - 5);
    }

    // Try finding the executable if not directly found
    if (!fs.existsSync(cleanPath)) {
        // Extract filename without directories/volume: e.g. "SYS:Tools/Clock" -> "Clock"
        var baseName = cleanPath;
        var lastSlash = baseName.lastIndexOf('/');
        var lastColon = baseName.lastIndexOf(':');
        var cutIdx = Math.max(lastSlash, lastColon);
        if (cutIdx !== -1) {
            baseName = baseName.substring(cutIdx + 1);
        }

        var candidateDirs = [
            "SYS:Utilities/",
            "SYS:Tools/",
            "SYS:Prefs/",
            "SYS:Tools/Commodities/",
            "SYS:System/",
            "C:"
        ];
        var found = false;
        for (var i = 0; i < candidateDirs.length; i++) {
            var cand = candidateDirs[i] + baseName;
            if (fs.existsSync(cand)) {
                cleanPath = cand;
                found = true;
                break;
            }
        }
    }

    // 1. Try launching via WBRun (WorkBench startup)
    var cmd = 'WBRun "' + cleanPath + '"';
    if (args && String(args).trim()) {
        cmd += ' ' + String(args).trim();
    }

    var res = runCommand(cmd);
    var output = (res.output || "").trim();

    // 2. If WBRun failed or is missing, fallback to AmigaDOS 'Run >NIL: <NIL:'
    if (!res.success || output.indexOf("Unknown command") !== -1 || output.indexOf("not found") !== -1) {
        var fallbackCmd = 'Run >NIL: <NIL: "' + cleanPath + '"';
        if (args && String(args).trim()) {
            fallbackCmd += ' ' + String(args).trim();
        }
        var fbRes = runCommand(fallbackCmd);
        if (fbRes.success) {
            return {
                success: true,
                app: cleanPath,
                command: fallbackCmd,
                output: fbRes.output,
                message: "Successfully launched application in background (via Run): " + cleanPath
            };
        }

        return {
            success: false,
            app: cleanPath,
            command: cmd,
            output: output,
            error: "Failed to launch '" + cleanPath + "'. Ensure WBRun is installed in C: (https://aminet.net/util/cli/WBRun.readme) or application supports CLI startup."
        };
    }

    return {
        success: true,
        app: cleanPath,
        command: cmd,
        output: output,
        message: "Successfully launched Workbench application in background: " + cleanPath
    };
}

function getCpuInfo(args) {
    var cmd = "cpu";
    if (args && String(args).trim()) {
        cmd += " " + String(args).trim();
    }
    var res = runCommand(cmd);
    var output = (res.output || "").trim();

    if (output && output.indexOf("Unknown command") === -1 && output.indexOf("not found") === -1) {
        return {
            success: true,
            command: cmd,
            output: output,
            message: "Amiga CPU and system architecture information retrieved."
        };
    }

    if (!res.success) {
        return {
            success: false,
            command: cmd,
            output: output,
            error: res.error || "Failed to run 'cpu' command. Ensure C:CPU is present on your Amiga system."
        };
    }

    return {
        success: true,
        command: cmd,
        output: output,
        message: "Amiga CPU and system architecture information retrieved."
    };
}

// Dispatcher for incoming tool call objects
function executeTool(name, args) {
    if (typeof args === 'string') {
        try {
            args = JSON.parse(args);
        } catch (e) {
            return { success: false, error: "Invalid JSON arguments: " + args };
        }
    }

    if (name === 'get_cwd') {
        return getCwd();
    } else if (name === 'read_file') {
        return readFile(args.path);
    } else if (name === 'write_file') {
        return writeFile(args.path, args.content);
    } else if (name === 'patch_file') {
        return patchFile(args.path, args.search, args.replace);
    } else if (name === 'list_dir') {
        return listDir(args.path);
    } else if (name === 'run_command') {
        return runCommand(args.command);
    } else if (name === 'launch_workbench_app' || name === 'wbrun' || name === 'launch_app') {
        return launchWorkbenchApp(args.app_path || args.path || args.app, args.args);
    } else if (name === 'cpu' || name === 'get_cpu_info') {
        return getCpuInfo(args ? args.args : null);
    } else {
        return { success: false, error: "Unknown tool: " + name };
    }
}

/**
 * Assesses whether a tool call is dangerous.
 * Safe tools (read_file, list_dir, get_cwd, safe CLI commands) return { dangerous: false }
 * Dangerous tools (write_file, patch_file, destructive commands) return { dangerous: true, reason: "..." }
 */
function assessRisk(name, args) {
    if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch (e) {}
    }

    if (name === 'get_cwd') {
        return { dangerous: false, reason: "Read-only: queries current directory" };
    }

    if (name === 'read_file') {
        return { dangerous: false, reason: "Read-only: inspects " + (args ? args.path : "file") };
    }

    if (name === 'list_dir') {
        return { dangerous: false, reason: "Read-only: lists directory " + (args ? args.path : "") };
    }

    if (name === 'write_file') {
        var path = (args && args.path) ? args.path : "file";
        var isSystem = path.toUpperCase().indexOf("SYS:") === 0 ||
                       path.toUpperCase().indexOf("S:") === 0 ||
                       path.toUpperCase().indexOf("DEVS:") === 0 ||
                       path.toUpperCase().indexOf("C:") === 0;
        return {
            dangerous: true,
            riskLevel: isSystem ? "CRITICAL" : "MEDIUM",
            reason: isSystem ? "Modifies SYSTEM directory: " + path : "Creates/overwrites file: " + path
        };
    }

    if (name === 'patch_file') {
        var pPath = (args && args.path) ? args.path : "file";
        return {
            dangerous: true,
            riskLevel: "MEDIUM",
            reason: "Modifies existing file: " + pPath
        };
    }

    if (name === 'run_command') {
        var cmd = (args && args.command) ? args.command.trim() : "";
        var cmdLower = cmd.toLowerCase();

        // Safe read-only commands
        var safeCmds = ['cd', 'dir', 'list', 'avail', 'version', 'status', 'date', 'type', 'echo', 'info', 'which', 'cpu'];
        for (var i = 0; i < safeCmds.length; i++) {
            var sc = safeCmds[i];
            if (cmdLower === sc || cmdLower.indexOf(sc + ' ') === 0 || cmdLower.indexOf(sc + '/') === 0) {
                if (cmdLower.indexOf('delete') === -1 && cmdLower.indexOf('format') === -1 && cmd.indexOf('>') === -1) {
                    return { dangerous: false, reason: "Read-only command: " + sc };
                }
            }
        }

        var isCritical = cmdLower.indexOf('format') !== -1 ||
                         cmdLower.indexOf('reboot') !== -1 ||
                         cmdLower.indexOf('coldreboot') !== -1 ||
                         cmdLower.indexOf('install') !== -1;

        var isDestructive = cmdLower.indexOf('delete') !== -1 ||
                            cmdLower.indexOf('relabel') !== -1 ||
                            cmdLower.indexOf('copy') !== -1 ||
                            cmdLower.indexOf('rename') !== -1 ||
                            cmdLower.indexOf('protect') !== -1;

        var riskLevel = isCritical ? "CRITICAL" : (isDestructive ? "HIGH" : "MEDIUM");
        var reason = isCritical ? "Critical system command: " + cmd :
                     (isDestructive ? "Destructive/file modification command: " + cmd : "Executes shell command: " + cmd);

        return {
            dangerous: true,
            riskLevel: riskLevel,
            reason: reason
        };
    }

    if (name === 'launch_workbench_app' || name === 'wbrun' || name === 'launch_app') {
        var app = (args && (args.app_path || args.path || args.app)) ? (args.app_path || args.path || args.app) : "application";
        var appLower = String(app).toLowerCase();
        var isCriticalApp = appLower.indexOf('format') !== -1 || appLower.indexOf('install') !== -1;
        if (isCriticalApp) {
            return {
                dangerous: true,
                riskLevel: "CRITICAL",
                reason: "Critical application launch: " + app
            };
        }
        return {
            dangerous: false,
            reason: "Launches Workbench GUI application: " + app
        };
    }

    if (name === 'cpu' || name === 'get_cpu_info') {
        return {
            dangerous: false,
            reason: "Read-only: queries Amiga CPU / architecture info"
        };
    }

    return { dangerous: true, riskLevel: "HIGH", reason: "Unknown tool: " + name };
}

module.exports = {
    readFile: readFile,
    writeFile: writeFile,
    patchFile: patchFile,
    listDir: listDir,
    getCwd: getCwd,
    runCommand: runCommand,
    launchWorkbenchApp: launchWorkbenchApp,
    getCpuInfo: getCpuInfo,
    executeTool: executeTool,
    assessRisk: assessRisk
};
