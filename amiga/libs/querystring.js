// Query string module for NodeAmiga
// Node.js-compatible query string parsing and serialization

var qs = {};

qs.escape = function(str) {
    /* Node-compatible: percent-encodes everything outside the URL
     * unreserved set [A-Za-z0-9-_.~]. Spaces become %20 (NOT '+');
     * '+' is application/x-www-form-urlencoded behavior, used by
     * qs.stringify when building key=value pairs but NOT here. */
    if (typeof str !== 'string') str = '' + str;
    var hexChars = '0123456789ABCDEF';
    var result = '';
    for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
            (c >= 48 && c <= 57) || c === 45 || c === 95 ||
            c === 46 || c === 126) {
            result += str.charAt(i);
        } else {
            result += '%' + hexChars.charAt((c >> 4) & 15) + hexChars.charAt(c & 15);
        }
    }
    return result;
};

qs.unescape = function(str) {
    if (typeof str !== 'string') str = '' + str;
    // Replace + with space first
    var result = '';
    for (var k = 0; k < str.length; k++) {
        if (str.charAt(k) === '+') {
            result += ' ';
        } else {
            result += str.charAt(k);
        }
    }

    // Decode percent-encoded sequences
    var decoded = '';
    var i = 0;
    while (i < result.length) {
        if (result.charAt(i) === '%' && i + 2 < result.length) {
            var hex = result.substring(i + 1, i + 3);
            var code = parseInt(hex, 16);
            if (!isNaN(code)) {
                decoded += String.fromCharCode(code);
                i += 3;
            } else {
                decoded += result.charAt(i);
                i++;
            }
        } else {
            decoded += result.charAt(i);
            i++;
        }
    }
    return decoded;
};

qs.parse = function(str, sep, eq, options) {
    sep = sep || '&';
    eq = eq || '=';
    var maxKeys = 1000;
    if (options && typeof options.maxKeys === 'number') {
        maxKeys = options.maxKeys;
    }

    var result = {};

    if (typeof str !== 'string' || str.length === 0) {
        return result;
    }

    // Remove leading ? if present
    if (str.charAt(0) === '?') {
        str = str.substring(1);
    }

    var pairs = str.split(sep);
    var limit = maxKeys > 0 ? Math.min(pairs.length, maxKeys) : pairs.length;

    for (var i = 0; i < limit; i++) {
        var pair = pairs[i];
        if (pair.length === 0) continue;

        var eqIdx = pair.indexOf(eq);
        var key, val;
        if (eqIdx !== -1) {
            key = qs.unescape(pair.substring(0, eqIdx));
            val = qs.unescape(pair.substring(eqIdx + eq.length));
        } else {
            key = qs.unescape(pair);
            val = '';
        }

        if (result[key] !== undefined) {
            if (Array.isArray(result[key])) {
                result[key].push(val);
            } else {
                result[key] = [result[key], val];
            }
        } else {
            result[key] = val;
        }
    }

    return result;
};

qs.stringify = function(obj, sep, eq) {
    sep = sep || '&';
    eq = eq || '=';

    if (obj === null || obj === undefined || typeof obj !== 'object') {
        return '';
    }

    var keys = Object.keys(obj);
    var parts = [];

    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var val = obj[key];
        var encodedKey = qs.escape(key);

        if (Array.isArray(val)) {
            for (var j = 0; j < val.length; j++) {
                parts.push(encodedKey + eq + qs.escape(('' + val[j])));
            }
        } else if (val === null || val === undefined) {
            parts.push(encodedKey + eq);
        } else {
            parts.push(encodedKey + eq + qs.escape(('' + val)));
        }
    }

    return parts.join(sep);
};

module.exports = qs;
