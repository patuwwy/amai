/*
 * ansi.js - Amiga Shell ANSI Colors and Formatting
 * Compatible with AmigaOS CON / KingCON / Shell
 */

var ANSI = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    italic: "\x1b[3m",
    underline: "\x1b[4m",

    // Foreground colors
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",

    // Background colors
    bgBlack: "\x1b[40m",
    bgRed: "\x1b[41m",
    bgGreen: "\x1b[42m",
    bgYellow: "\x1b[43m",
    bgBlue: "\x1b[44m",
    bgMagenta: "\x1b[45m",
    bgCyan: "\x1b[46m",
    bgWhite: "\x1b[47m"
};

function colorize(colorCode, text) {
    return colorCode + text + ANSI.reset;
}

module.exports = {
    ANSI: ANSI,
    c: colorize,
    info: function(text) { return colorize(ANSI.cyan, text); },
    success: function(text) { return colorize(ANSI.green, text); },
    warn: function(text) { return colorize(ANSI.yellow, text); },
    error: function(text) { return colorize(ANSI.red, text); },
    bold: function(text) { return colorize(ANSI.bold, text); },
    dim: function(text) { return colorize(ANSI.dim, text); }
};
