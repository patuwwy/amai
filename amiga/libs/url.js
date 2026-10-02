/* URL module for NodeAmiga */
/* Node.js-compatible URL parsing, formatting, resolution, */
/* URL class, and URLSearchParams class */

/* ================================================================== */
/* URLSearchParams                                                     */
/* ================================================================== */

function URLSearchParams(init) {
    this._params = [];
    if (typeof init === 'string') {
        if (init.charAt(0) === '?') init = init.substring(1);
        if (init.length > 0) {
            var pairs = init.split('&');
            for (var i = 0; i < pairs.length; i++) {
                var eqIdx = pairs[i].indexOf('=');
                if (eqIdx >= 0) {
                    this._params.push([
                        decodeURIComponent(pairs[i].substring(0, eqIdx).replace(/\+/g, ' ')),
                        decodeURIComponent(pairs[i].substring(eqIdx + 1).replace(/\+/g, ' '))
                    ]);
                } else {
                    this._params.push([decodeURIComponent(pairs[i].replace(/\+/g, ' ')), '']);
                }
            }
        }
    } else if (init && typeof init === 'object') {
        if (Array.isArray(init)) {
            for (var j = 0; j < init.length; j++) {
                this._params.push([String(init[j][0]), String(init[j][1])]);
            }
        } else {
            var keys = Object.keys(init);
            for (var k = 0; k < keys.length; k++) {
                this._params.push([keys[k], String(init[keys[k]])]);
            }
        }
    }
}

URLSearchParams.prototype.append = function(name, value) {
    this._params.push([String(name), String(value)]);
};

URLSearchParams.prototype.delete = function(name) {
    var result = [];
    for (var i = 0; i < this._params.length; i++) {
        if (this._params[i][0] !== String(name)) {
            result.push(this._params[i]);
        }
    }
    this._params = result;
};

URLSearchParams.prototype.get = function(name) {
    name = String(name);
    for (var i = 0; i < this._params.length; i++) {
        if (this._params[i][0] === name) return this._params[i][1];
    }
    return null;
};

URLSearchParams.prototype.getAll = function(name) {
    name = String(name);
    var result = [];
    for (var i = 0; i < this._params.length; i++) {
        if (this._params[i][0] === name) result.push(this._params[i][1]);
    }
    return result;
};

URLSearchParams.prototype.has = function(name) {
    name = String(name);
    for (var i = 0; i < this._params.length; i++) {
        if (this._params[i][0] === name) return true;
    }
    return false;
};

URLSearchParams.prototype.set = function(name, value) {
    name = String(name);
    value = String(value);
    var found = false;
    var result = [];
    for (var i = 0; i < this._params.length; i++) {
        if (this._params[i][0] === name) {
            if (!found) {
                result.push([name, value]);
                found = true;
            }
            /* skip duplicate entries */
        } else {
            result.push(this._params[i]);
        }
    }
    if (!found) result.push([name, value]);
    this._params = result;
};

URLSearchParams.prototype.sort = function() {
    this._params.sort(function(a, b) {
        if (a[0] < b[0]) return -1;
        if (a[0] > b[0]) return 1;
        return 0;
    });
};

URLSearchParams.prototype.toString = function() {
    var parts = [];
    for (var i = 0; i < this._params.length; i++) {
        parts.push(encodeURIComponent(this._params[i][0]) + '=' + encodeURIComponent(this._params[i][1]));
    }
    return parts.join('&');
};

URLSearchParams.prototype.forEach = function(callback, thisArg) {
    for (var i = 0; i < this._params.length; i++) {
        callback.call(thisArg, this._params[i][1], this._params[i][0], this);
    }
};

URLSearchParams.prototype.keys = function() {
    var arr = [];
    for (var i = 0; i < this._params.length; i++) {
        arr.push(this._params[i][0]);
    }
    return arr;
};

URLSearchParams.prototype.values = function() {
    var arr = [];
    for (var i = 0; i < this._params.length; i++) {
        arr.push(this._params[i][1]);
    }
    return arr;
};

URLSearchParams.prototype.entries = function() {
    var arr = [];
    for (var i = 0; i < this._params.length; i++) {
        arr.push([this._params[i][0], this._params[i][1]]);
    }
    return arr;
};

Object.defineProperty(URLSearchParams.prototype, 'size', {
    get: function() { return this._params.length; }
});

/* ================================================================== */
/* URL class                                                           */
/* ================================================================== */

function URL(input, base) {
    if (typeof input !== 'string') input = String(input);
    var urlStr = input;
    if (base !== undefined) {
        urlStr = urlResolve(String(base), input);
    }
    var parsed = urlParse(urlStr);
    this.protocol = parsed.protocol || '';
    this.hostname = parsed.hostname || '';
    this.port = parsed.port || '';
    this.pathname = parsed.pathname || '/';
    this.hash = parsed.hash || '';
    this.username = '';
    this.password = '';
    if (parsed.auth) {
        var colIdx = parsed.auth.indexOf(':');
        if (colIdx >= 0) {
            this.username = parsed.auth.substring(0, colIdx);
            this.password = parsed.auth.substring(colIdx + 1);
        } else {
            this.username = parsed.auth;
        }
    }
    /* Parse search params */
    this.searchParams = new URLSearchParams(parsed.search || '');
}

Object.defineProperty(URL.prototype, 'host', {
    get: function() {
        return this.port ? this.hostname + ':' + this.port : this.hostname;
    },
    set: function(v) {
        var colIdx = v.indexOf(':');
        if (colIdx >= 0) {
            this.hostname = v.substring(0, colIdx);
            this.port = v.substring(colIdx + 1);
        } else {
            this.hostname = v;
            this.port = '';
        }
    }
});

Object.defineProperty(URL.prototype, 'origin', {
    get: function() {
        if (!this.protocol || !this.hostname) return 'null';
        return this.protocol + '//' + this.host;
    }
});

Object.defineProperty(URL.prototype, 'search', {
    get: function() {
        var s = this.searchParams.toString();
        return s.length > 0 ? '?' + s : '';
    },
    set: function(v) {
        this.searchParams = new URLSearchParams(v);
    }
});

Object.defineProperty(URL.prototype, 'href', {
    get: function() {
        return this.toString();
    },
    set: function(v) {
        var u = new URL(v);
        this.protocol = u.protocol;
        this.hostname = u.hostname;
        this.port = u.port;
        this.pathname = u.pathname;
        this.hash = u.hash;
        this.username = u.username;
        this.password = u.password;
        this.searchParams = u.searchParams;
    }
});

URL.prototype.toString = function() {
    var result = '';
    if (this.protocol) {
        result += this.protocol + '//';
    }
    if (this.username) {
        result += this.username;
        if (this.password) result += ':' + this.password;
        result += '@';
    }
    result += this.hostname;
    if (this.port) result += ':' + this.port;
    result += this.pathname;
    var search = this.search;
    if (search) result += search;
    if (this.hash) result += this.hash;
    return result;
};

URL.prototype.toJSON = function() {
    return this.toString();
};

/* ================================================================== */
/* Legacy API: url.parse, url.format, url.resolve                      */
/* ================================================================== */

function urlParse(urlStr, parseQueryString) {
    var result = {
        protocol: null,
        slashes: false,
        auth: null,
        hostname: null,
        port: null,
        host: null,
        pathname: null,
        search: null,
        query: null,
        hash: null,
        path: null,
        href: urlStr
    };

    if (typeof urlStr !== 'string' || urlStr.length === 0) {
        return result;
    }

    var rest = urlStr;
    var idx;

    /* Extract hash fragment */
    idx = rest.indexOf('#');
    if (idx !== -1) {
        result.hash = rest.substring(idx);
        rest = rest.substring(0, idx);
    }

    /* Extract query string */
    idx = rest.indexOf('?');
    if (idx !== -1) {
        result.search = rest.substring(idx);
        result.query = rest.substring(idx + 1);
        rest = rest.substring(0, idx);
    }

    /* Extract protocol */
    idx = rest.indexOf('://');
    if (idx !== -1) {
        result.protocol = rest.substring(0, idx + 1).toLowerCase();
        result.slashes = true;
        rest = rest.substring(idx + 3);
    } else {
        /* Check for protocol without slashes (e.g. "mailto:") */
        idx = rest.indexOf(':');
        if (idx !== -1 && (rest.indexOf('/') < 0 || idx < rest.indexOf('/'))) {
            var maybeProto = rest.substring(0, idx + 1).toLowerCase();
            var isProto = true;
            for (var p = 0; p < idx; p++) {
                var pc = rest.charCodeAt(p);
                if (!((pc >= 97 && pc <= 122) || (pc >= 65 && pc <= 90))) {
                    isProto = false;
                    break;
                }
            }
            if (isProto && idx > 0) {
                result.protocol = maybeProto;
                rest = rest.substring(idx + 1);
            }
        }
    }

    /* If we had slashes, extract authority (auth@host:port) */
    if (result.slashes) {
        var pathStart = rest.indexOf('/');
        var authority;
        if (pathStart !== -1) {
            result.pathname = rest.substring(pathStart);
            authority = rest.substring(0, pathStart);
        } else {
            result.pathname = '/';
            authority = rest;
        }

        /* Extract auth */
        var atIdx = authority.indexOf('@');
        if (atIdx !== -1) {
            result.auth = authority.substring(0, atIdx);
            authority = authority.substring(atIdx + 1);
        }

        /* Extract port */
        var colonIdx = authority.lastIndexOf(':');
        if (colonIdx !== -1) {
            var portStr = authority.substring(colonIdx + 1);
            var portNum = parseInt(portStr);
            if (!isNaN(portNum) && portStr.length > 0) {
                result.port = portStr;
                result.hostname = authority.substring(0, colonIdx).toLowerCase();
            } else {
                result.hostname = authority.toLowerCase();
            }
        } else {
            result.hostname = authority.toLowerCase();
        }

        result.host = result.hostname;
        if (result.port) {
            result.host = result.hostname + ':' + result.port;
        }
    } else {
        if (rest.length > 0) {
            result.pathname = rest;
        }
    }

    /* Build path (pathname + search) */
    if (result.pathname) {
        result.path = result.pathname;
        if (result.search) {
            result.path = result.pathname + result.search;
        }
    }

    if (parseQueryString && result.query && typeof result.query === 'string') {
        var qs = require('querystring');
        result.query = qs.parse(result.query);
    }

    return result;
}

function urlFormat(urlObj) {
    if (typeof urlObj === 'string') return urlObj;

    var result = '';
    if (urlObj.protocol) {
        result += urlObj.protocol;
        if (urlObj.slashes !== false && urlObj.hostname) {
            result += '//';
        }
    }
    if (urlObj.auth) result += urlObj.auth + '@';
    if (urlObj.hostname) result += urlObj.hostname;
    if (urlObj.port) result += ':' + urlObj.port;
    if (urlObj.pathname) result += urlObj.pathname;
    if (urlObj.search) {
        result += urlObj.search;
    } else if (urlObj.query) {
        if (typeof urlObj.query === 'object') {
            var qs = require('querystring');
            result += '?' + qs.stringify(urlObj.query);
        } else {
            result += '?' + urlObj.query;
        }
    }
    if (urlObj.hash) result += urlObj.hash;
    return result;
}

function normalizePath(path) {
    var parts = path.split('/');
    var result = [];
    for (var i = 0; i < parts.length; i++) {
        var seg = parts[i];
        if (seg === '.') {
            continue;
        } else if (seg === '..') {
            if (result.length > 1) result.pop();
        } else {
            result.push(seg);
        }
    }
    var out = result.join('/');
    if (out.charAt(0) !== '/') out = '/' + out;
    return out;
}

function urlResolve(from, to) {
    if (!to || to.length === 0) return from;
    if (to.indexOf('://') !== -1) return to;

    var base = urlParse(from);

    /* Protocol-relative */
    if (to.charAt(0) === '/' && to.charAt(1) === '/') {
        return (base.protocol || 'http:') + to;
    }

    /* Absolute path */
    if (to.charAt(0) === '/') {
        base.pathname = to;
        base.search = null;
        base.query = null;
        base.hash = null;
        base.path = to;
        return urlFormat(base);
    }

    /* Relative path */
    var basePath = base.pathname || '/';
    var lastSlash = basePath.lastIndexOf('/');
    var dir = lastSlash !== -1 ? basePath.substring(0, lastSlash + 1) : '/';
    var resolved = dir + to;
    resolved = normalizePath(resolved);

    base.pathname = resolved;
    base.search = null;
    base.query = null;
    base.hash = null;

    var hashIdx = to.indexOf('#');
    var queryIdx = to.indexOf('?');
    if (hashIdx !== -1 || queryIdx !== -1) {
        var toObj = urlParse(to);
        base.search = toObj.search;
        base.query = toObj.query;
        base.hash = toObj.hash;
    }

    base.path = base.pathname;
    if (base.search) base.path += base.search;

    return urlFormat(base);
}

/* ================================================================== */
/* Exports                                                             */
/* ================================================================== */

module.exports = {
    parse: urlParse,
    format: urlFormat,
    resolve: urlResolve,
    URL: URL,
    URLSearchParams: URLSearchParams
};
