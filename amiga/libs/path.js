/* path module for NodeAmiga */
/* AmigaOS paths: Volume:dir/file, relative: dir/file */

function basename(p, ext) {
    if (typeof p !== 'string') return '.';
    var i = p.length - 1;
    var b;
    while (i >= 0) {
        if (p[i] === '/' || p[i] === ':') { b = p.substring(i + 1); break; }
        i--;
    }
    if (b === undefined) b = p;
    if (ext && b.length >= ext.length && b.substring(b.length - ext.length) === ext) {
        b = b.substring(0, b.length - ext.length);
    }
    return b;
}

function dirname(p) {
    if (typeof p !== 'string') return '.';
    var i = p.length - 1;
    var hasColon = p.indexOf(':') >= 0;
    /* Skip trailing slashes */
    while (i > 0 && p[i] === '/') i--;
    while (i >= 0) {
        if (p[i] === ':') return p.substring(0, i + 1);
        if (p[i] === '/') {
            if (i === 0) return '/';
            /* AmigaOS paths keep trailing / after volume:dir/ */
            if (hasColon) return p.substring(0, i + 1);
            return p.substring(0, i);
        }
        i--;
    }
    return '.';
}

function extname(p) {
    if (typeof p !== 'string') return '';
    var base = basename(p);
    var dot = base.lastIndexOf('.');
    if (dot <= 0) return '';
    return base.substring(dot);
}

function normalize(p) {
    if (typeof p !== 'string') return '.';
    if (p.length === 0) return '.';
    var prefix = '';
    var colIdx = p.indexOf(':');
    var rest = p;
    if (colIdx >= 0) {
        prefix = p.substring(0, colIdx + 1);
        rest = p.substring(colIdx + 1);
    }
    var parts = rest.split('/');
    var result = [];
    var i;
    for (i = 0; i < parts.length; i++) {
        var seg = parts[i];
        if (seg === '.' || seg === '') {
            if (i === 0 && seg === '') result.push('');
            continue;
        }
        if (seg === '..') {
            if (result.length > 0 && result[result.length - 1] !== '..') {
                result.pop();
            } else if (prefix === '') {
                result.push('..');
            }
        } else {
            result.push(seg);
        }
    }
    var out = prefix + result.join('/');
    if (out === '' || out === prefix) {
        /* preserve leading slash for root paths like "/" */
        if (rest.length > 0 && rest.charAt(0) === '/') return '/';
        return prefix ? prefix : '.';
    }
    return out;
}

function isAbsolute(p) {
    if (typeof p !== 'string') return false;
    /* AmigaOS: absolute if it has Volume: prefix */
    return p.indexOf(':') >= 0;
}

function parse(p) {
    if (typeof p !== 'string') p = '';
    var r = { root: '', dir: '', base: '', ext: '', name: '' };
    if (p.length === 0) return r;
    var colIdx = p.indexOf(':');
    if (colIdx >= 0) {
        r.root = p.substring(0, colIdx + 1);
    } else if (p.charAt(0) === '/') {
        r.root = '/';
    }
    r.base = basename(p);
    r.ext = extname(p);
    r.name = r.ext.length > 0 ? r.base.substring(0, r.base.length - r.ext.length) : r.base;
    r.dir = dirname(p);
    return r;
}

function format(pathObj) {
    if (!pathObj || typeof pathObj !== 'object') return '';
    var dir = pathObj.dir || '';
    var base = pathObj.base || '';
    if (!base) {
        base = (pathObj.name || '') + (pathObj.ext || '');
    }
    if (!dir) {
        /* No dir — use root as fallback */
        var root = pathObj.root || '';
        if (!root) return base;
        var rl = root[root.length - 1];
        if (rl === '/' || rl === ':') return root + base;
        return root + '/' + base;
    }
    var last = dir[dir.length - 1];
    if (last === '/' || last === ':') return dir + base;
    return dir + '/' + base;
}

function relative(from, to) {
    if (typeof from !== 'string' || typeof to !== 'string') return '';
    from = normalize(from);
    to = normalize(to);
    if (from === to) return '';
    var fromParts = from.split('/');
    var toParts = to.split('/');
    /* Find common prefix length */
    var minLen = fromParts.length < toParts.length ? fromParts.length : toParts.length;
    var common = 0;
    var i;
    for (i = 0; i < minLen; i++) {
        if (fromParts[i] !== toParts[i]) break;
        common++;
    }
    var ups = [];
    for (i = common; i < fromParts.length; i++) {
        ups.push('..');
    }
    var downs = [];
    for (i = common; i < toParts.length; i++) {
        downs.push(toParts[i]);
    }
    return ups.concat(downs).join('/');
}

function join() {
    var parts = [];
    var i;
    for (i = 0; i < arguments.length; i++) {
        var p = arguments[i];
        if (typeof p !== 'string') continue;
        if (p.length > 0) parts.push(p);
    }
    if (parts.length === 0) return '.';
    var result = parts[0];
    for (var j = 1; j < parts.length; j++) {
        var part = parts[j];
        /* If absolute (contains :), use as-is */
        if (part.indexOf(':') >= 0) { result = part; continue; }
        /* Add separator if needed */
        var last = result[result.length - 1];
        if (last !== '/' && last !== ':') result = result + '/';
        result = result + part;
    }
    return normalize(result);
}

function resolve() {
    var result = '';
    var i;
    for (i = 0; i < arguments.length; i++) {
        var p = arguments[i];
        if (typeof p !== 'string') continue;
        if (p.indexOf(':') >= 0) {
            result = p;
        } else {
            if (result.length > 0) {
                var last = result[result.length - 1];
                if (last !== '/' && last !== ':') result = result + '/';
            }
            result = result + p;
        }
    }
    return normalize(result);
}

var sep = '/';
var delimiter = ';';

module.exports = {
    basename: basename,
    dirname: dirname,
    extname: extname,
    join: join,
    resolve: resolve,
    normalize: normalize,
    isAbsolute: isAbsolute,
    parse: parse,
    format: format,
    relative: relative,
    sep: sep,
    delimiter: delimiter
};
