// Util module for NodeAmiga
// Node.js-compatible utility functions

var util = {};

util.format = function(fmt) {
    if (typeof fmt !== 'string') {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) {
            parts.push(util.inspect(arguments[i]));
        }
        return parts.join(' ');
    }

    var argIdx = 1;
    var args = arguments;
    var result = '';
    var i = 0;

    while (i < fmt.length) {
        if (fmt.charAt(i) === '%' && i + 1 < fmt.length) {
            var spec = fmt.charAt(i + 1);
            if (spec === 's') {
                result += argIdx < args.length ? ('' +args[argIdx++]) : '%s';
                i += 2;
            } else if (spec === 'd') {
                result += argIdx < args.length ? (+args[argIdx++]) : '%d';
                i += 2;
            } else if (spec === 'j') {
                if (argIdx < args.length) {
                    result += util._jsonStringify(args[argIdx++]);
                } else {
                    result += '%j';
                }
                i += 2;
            } else if (spec === 'o' || spec === 'O') {
                result += argIdx < args.length ? util.inspect(args[argIdx++]) : '%' + spec;
                i += 2;
            } else if (spec === 'i') {
                if (argIdx < args.length) {
                    var n = (+args[argIdx++]);
                    result += (isNaN(n) ? 'NaN' : ('' +Math.floor(n)));
                } else {
                    result += '%i';
                }
                i += 2;
            } else if (spec === 'f') {
                result += argIdx < args.length ? (+args[argIdx++]) : '%f';
                i += 2;
            } else if (spec === '%') {
                result += '%';
                i += 2;
            } else {
                result += '%';
                i++;
            }
        } else {
            result += fmt.charAt(i);
            i++;
        }
    }

    // Append remaining arguments
    while (argIdx < args.length) {
        result += ' ' + util.inspect(args[argIdx++]);
    }

    return result;
};

util._jsonStringify = function(val) {
    if (val === undefined) return 'undefined';
    if (val === null) return 'null';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') {
        if (isNaN(val)) return 'null';
        if (!isFinite(val)) return 'null';
        return ('' +val);
    }
    if (typeof val === 'string') {
        return '"' + escapeStr(val) + '"';
    }
    if (Array.isArray(val)) {
        var items = [];
        for (var i = 0; i < val.length; i++) {
            items.push(util._jsonStringify(val[i]));
        }
        return '[' + items.join(',') + ']';
    }
    if (typeof val === 'object') {
        var keys = Object.keys(val);
        var pairs = [];
        for (var k = 0; k < keys.length; k++) {
            pairs.push('"' + escapeStr(keys[k]) + '":' + util._jsonStringify(val[keys[k]]));
        }
        return '{' + pairs.join(',') + '}';
    }
    return 'undefined';
};

function escapeStr(s) {
    var result = '';
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (c === '"') result += '\\"';
        else if (c === '\\') result += '\\\\';
        else if (c === '\n') result += '\\n';
        else if (c === '\r') result += '\\r';
        else if (c === '\t') result += '\\t';
        else result += c;
    }
    return result;
}

util.inspect = function(obj, opts) {
    var depth = 2;
    var showHidden = false;
    if (opts) {
        if (typeof opts.depth === 'number') depth = opts.depth;
        if (opts.showHidden) showHidden = true;
    }
    var seen = [];
    return formatValue(obj, depth, seen);
};

function formatValue(val, depth, seen) {
    if (val === undefined) return 'undefined';
    if (val === null) return 'null';
    if (typeof val === 'boolean') return val ? 'true' : 'false';

    if (typeof val === 'number') {
        if (val !== val) return 'NaN';
        if (val === 1/0) return 'Infinity';
        if (val === -1/0) return '-Infinity';
        // Distinguish -0
        if (val === 0 && (1/val) < 0) return '-0';
        return ('' +val);
    }

    if (typeof val === 'string') {
        return "'" + escapeStr(val) + "'";
    }

    if (typeof val === 'function') {
        var name = val.name || '';
        return '[Function' + (name ? ': ' + name : '') + ']';
    }

    if (typeof val !== 'object') {
        return ('' +val);
    }

    // Check for circular references
    for (var c = 0; c < seen.length; c++) {
        if (seen[c] === val) return '[Circular]';
    }

    seen.push(val);

    if (Array.isArray(val)) {
        if (val.length === 0) return '[]';
        if (depth < 0) return '[Array]';
        var items = [];
        var maxItems = Math.min(val.length, 100);
        for (var i = 0; i < maxItems; i++) {
            items.push(formatValue(val[i], depth - 1, seen));
        }
        if (val.length > maxItems) {
            items.push('... ' + (val.length - maxItems) + ' more items');
        }
        seen.pop();
        return '[ ' + items.join(', ') + ' ]';
    }

    // Regular object
    var keys = Object.keys(val);
    if (keys.length === 0) {
        seen.pop();
        return '{}';
    }
    if (depth < 0) {
        seen.pop();
        return '[Object]';
    }

    var pairs = [];
    var maxKeys = Math.min(keys.length, 50);
    for (var k = 0; k < maxKeys; k++) {
        var key = keys[k];
        var desc = formatValue(val[key], depth - 1, seen);
        pairs.push(key + ': ' + desc);
    }
    if (keys.length > maxKeys) {
        pairs.push('... ' + (keys.length - maxKeys) + ' more properties');
    }

    seen.pop();
    return '{ ' + pairs.join(', ') + ' }';
}

util.inherits = function(ctor, superCtor) {
    if (typeof ctor !== 'function') {
        throw 'util.inherits: ctor must be a function';
    }
    if (typeof superCtor !== 'function') {
        throw 'util.inherits: superCtor must be a function';
    }
    ctor.prototype = Object.create(superCtor.prototype);
    ctor.prototype.constructor = ctor;
    ctor.super_ = superCtor;
};

util.isArray = function(obj) {
    return Array.isArray(obj);
};

util.isFunction = function(obj) {
    return typeof obj === 'function';
};

util.isString = function(obj) {
    return typeof obj === 'string';
};

util.isNumber = function(obj) {
    return typeof obj === 'number';
};

util.isBoolean = function(obj) {
    return typeof obj === 'boolean';
};

util.isNull = function(obj) {
    return obj === null;
};

util.isUndefined = function(obj) {
    return obj === undefined;
};

util.isNullOrUndefined = function(obj) {
    return obj === null || obj === undefined;
};

util.isObject = function(obj) {
    return typeof obj === 'object' && obj !== null;
};

util.isPrimitive = function(obj) {
    return obj === null || obj === undefined ||
        typeof obj === 'boolean' || typeof obj === 'number' || typeof obj === 'string';
};

util.noop = function() {};

util.promisify = function(fn) {
    if (typeof fn !== 'function') {
        throw new TypeError('The "original" argument must be of type Function');
    }
    return function() {
        var args = [];
        var i;
        for (i = 0; i < arguments.length; i++) {
            args.push(arguments[i]);
        }
        return new Promise(function(resolve, reject) {
            args.push(function(err, result) {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
            fn.apply(null, args);
        });
    };
};

util.debuglog = function(section) {
    var enabled = false;
    // In Node.js this checks NODE_DEBUG env var
    // On Amiga we just return a no-op unless explicitly enabled
    return function(msg) {
        if (!enabled) return;
        console.error(section + ': ' + ('' +msg));
    };
};

module.exports = util;
