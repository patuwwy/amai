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

function readFile(path) {
    if (!fs.existsSync(path)) {
        return { success: false, error: "File not found: " + path };
    }
    try {
        var content = fs.readFileSync(path, 'utf8');
        var maxLen = MAX_READ_SIZE;
        var truncated = false;
        if (content.length > maxLen) {
            content = content.substring(0, maxLen) + "\n... [TRUNCATED - File exceeds " + MAX_READ_SIZE + " bytes. NodeAmiga memory protection] ...";
            truncated = true;
        }
        return {
            success: true,
            path: path,
            size: content.length,
            truncated: truncated,
            content: content
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
        return {
            success: true,
            path: path,
            count: entries.length,
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
        return {
            success: false,
            command: command,
            error: e.message,
            output: errOutput
        };
    }
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
        var safeCmds = ['cd', 'dir', 'list', 'avail', 'version', 'status', 'date', 'type', 'echo', 'info', 'which'];
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

    return { dangerous: true, riskLevel: "HIGH", reason: "Unknown tool: " + name };
}

module.exports = {
    readFile: readFile,
    writeFile: writeFile,
    patchFile: patchFile,
    listDir: listDir,
    runCommand: runCommand,
    executeTool: executeTool,
    assessRisk: assessRisk
};
