/* assert module for NodeAmiga */

function deepStrictEqualImpl(a, b, seen) {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;

    /* Prevent circular reference infinite loop */
    if (!seen) seen = [];
    var i;
    for (i = 0; i < seen.length; i++) {
        if (seen[i][0] === a && seen[i][1] === b) return true;
    }
    seen.push([a, b]);

    var aIsArr = Array.isArray(a);
    var bIsArr = Array.isArray(b);
    if (aIsArr !== bIsArr) return false;

    if (aIsArr) {
        if (a.length !== b.length) return false;
        for (i = 0; i < a.length; i++) {
            if (!deepStrictEqualImpl(a[i], b[i], seen)) return false;
        }
        return true;
    }

    /* Date */
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }

    /* RegExp */
    if (a instanceof RegExp && b instanceof RegExp) {
        return a.toString() === b.toString();
    }

    var aKeys = Object.keys(a);
    var bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;

    aKeys.sort();
    bKeys.sort();
    for (i = 0; i < aKeys.length; i++) {
        if (aKeys[i] !== bKeys[i]) return false;
    }
    for (i = 0; i < aKeys.length; i++) {
        if (!deepStrictEqualImpl(a[aKeys[i]], b[aKeys[i]], seen)) return false;
    }
    return true;
}

var assert = module.exports = function(value, message) {
    if (!value) {
        throw new Error(message || 'AssertionError: ' + String(value) + ' == true');
    }
};

assert.ok = assert;

assert.equal = function(actual, expected, message) {
    if (actual != expected) {
        throw new Error(message || 'AssertionError: ' + String(actual) + ' == ' + String(expected));
    }
};

assert.strictEqual = function(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message || 'AssertionError: ' + String(actual) + ' === ' + String(expected));
    }
};

assert.notEqual = function(actual, expected, message) {
    if (actual == expected) {
        throw new Error(message || 'AssertionError: ' + String(actual) + ' != ' + String(expected));
    }
};

assert.notStrictEqual = function(actual, expected, message) {
    if (actual === expected) {
        throw new Error(message || 'AssertionError: ' + String(actual) + ' !== ' + String(expected));
    }
};

assert.deepEqual = function(actual, expected, message) {
    if (!deepStrictEqualImpl(actual, expected, null)) {
        throw new Error(message || 'AssertionError: deepEqual failed');
    }
};

assert.deepStrictEqual = function(actual, expected, message) {
    if (!deepStrictEqualImpl(actual, expected, null)) {
        throw new Error(message || 'AssertionError: deepStrictEqual failed\n  actual: ' + JSON.stringify(actual) + '\n  expected: ' + JSON.stringify(expected));
    }
};

assert.notDeepEqual = function(actual, expected, message) {
    if (deepStrictEqualImpl(actual, expected, null)) {
        throw new Error(message || 'AssertionError: notDeepEqual failed');
    }
};

assert.notDeepStrictEqual = function(actual, expected, message) {
    if (deepStrictEqualImpl(actual, expected, null)) {
        throw new Error(message || 'AssertionError: notDeepStrictEqual failed');
    }
};

assert.throws = function(fn, expected, message) {
    var threw = false;
    var err;
    try { fn(); } catch(e) { threw = true; err = e; }
    if (!threw) {
        throw new Error(message || 'AssertionError: expected function to throw');
    }
    if (expected) {
        if (typeof expected === 'function') {
            if (!(err instanceof expected)) {
                throw new Error(message || 'AssertionError: thrown error is not instance of expected type');
            }
        } else if (expected instanceof RegExp) {
            if (!expected.test(err.message || String(err))) {
                throw new Error(message || 'AssertionError: thrown error message does not match: ' + String(err));
            }
        }
    }
};

assert.doesNotThrow = function(fn, message) {
    try { fn(); } catch(e) {
        throw new Error(message || 'AssertionError: unexpected throw: ' + (e.message || e));
    }
};

assert.fail = function(message) {
    throw new Error(message || 'AssertionError: failed');
};

assert.ifError = function(value) {
    if (value !== null && value !== undefined) {
        throw value instanceof Error ? value : new Error('ifError: ' + String(value));
    }
};

assert.match = function(string, regexp, message) {
    if (!regexp.test(string)) {
        throw new Error(message || 'AssertionError: ' + String(string) + ' does not match ' + String(regexp));
    }
};

assert.doesNotMatch = function(string, regexp, message) {
    if (regexp.test(string)) {
        throw new Error(message || 'AssertionError: ' + String(string) + ' should not match ' + String(regexp));
    }
};

assert.rejects = function(asyncFn, expected, message) {
    var promise = typeof asyncFn === 'function' ? asyncFn() : asyncFn;
    return promise.then(function() {
        throw new Error(message || 'AssertionError: expected promise to reject');
    }, function(err) {
        if (expected) {
            if (typeof expected === 'function' && !(err instanceof expected)) {
                throw new Error(message || 'AssertionError: rejection is not instance of expected type');
            }
            if (expected instanceof RegExp && !expected.test(err.message || String(err))) {
                throw new Error(message || 'AssertionError: rejection message does not match');
            }
        }
    });
};

assert.doesNotReject = function(asyncFn, message) {
    var promise = typeof asyncFn === 'function' ? asyncFn() : asyncFn;
    return promise.then(function() {}, function(err) {
        throw new Error(message || 'AssertionError: unexpected rejection: ' + (err.message || err));
    });
};
