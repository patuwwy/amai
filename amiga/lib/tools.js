/*
 * tools.js - Amiga Tool Execution Engine
 * Executes file inspection, editing, and AmigaDOS commands on the Amiga.
 */

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
        return {
            success: true,
            path: path,
            size: content.length,
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
    if (!path) path = "";
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

function runCommand(command) {
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

    if (name === 'read_file') {
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

module.exports = {
    readFile: readFile,
    writeFile: writeFile,
    patchFile: patchFile,
    listDir: listDir,
    runCommand: runCommand,
    executeTool: executeTool
};
