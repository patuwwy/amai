/* Punycode module for NodeAmiga */
/* RFC 3492 — Bootstring encoding for Internationalized Domain Names */

var maxInt = 2147483647;
var base = 36;
var tMin = 1;
var tMax = 26;
var skew = 38;
var damp = 700;
var initialBias = 72;
var initialN = 128;
var delimiter = '-';

function error(type) {
    throw new RangeError('punycode: ' + type);
}

function map(array, fn) {
    var result = [];
    var i;
    for (i = 0; i < array.length; i++) {
        result.push(fn(array[i]));
    }
    return result;
}

function digitToBasic(digit, flag) {
    return digit + 22 + 75 * (digit < 26 ? 1 : 0) - ((flag ? 1 : 0) << 5);
}

function basicToDigit(cp) {
    if (cp - 0x30 < 0x0A) return cp - 0x16;
    if (cp - 0x41 < 0x1A) return cp - 0x41;
    if (cp - 0x61 < 0x1A) return cp - 0x61;
    return base;
}

function adapt(delta, numPoints, firstTime) {
    var k = 0;
    delta = firstTime ? Math.floor(delta / damp) : (delta >> 1);
    delta += Math.floor(delta / numPoints);
    while (delta > ((base - tMin) * tMax >> 1)) {
        delta = Math.floor(delta / (base - tMin));
        k += base;
    }
    return Math.floor(k + (base - tMin + 1) * delta / (delta + skew));
}

function decode(input) {
    var output = [];
    var i = 0;
    var n = initialN;
    var bias = initialBias;
    var basic, j, index, oldi, w, k, digit, t;

    basic = input.lastIndexOf(delimiter);
    if (basic < 0) basic = 0;

    for (j = 0; j < basic; j++) {
        output.push(input.charCodeAt(j));
    }

    index = basic > 0 ? basic + 1 : 0;

    while (index < input.length) {
        oldi = i;
        w = 1;
        k = base;
        while (true) {
            if (index >= input.length) error('invalid-input');
            digit = basicToDigit(input.charCodeAt(index++));
            if (digit >= base || digit > Math.floor((maxInt - i) / w)) error('overflow');
            i += digit * w;
            t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
            if (digit < t) break;
            if (w > Math.floor(maxInt / (base - t))) error('overflow');
            w *= (base - t);
            k += base;
        }

        bias = adapt(i - oldi, output.length + 1, oldi === 0);
        if (Math.floor(i / (output.length + 1)) > maxInt - n) error('overflow');
        n += Math.floor(i / (output.length + 1));
        i %= (output.length + 1);
        output.splice(i++, 0, n);
    }

    var result = '';
    for (j = 0; j < output.length; j++) {
        result += String.fromCharCode(output[j]);
    }
    return result;
}

function encode(input) {
    var output = [];
    var inputArr = [];
    var i, n, delta, bias, j, currentValue, handledCPCount, basicLength;
    var m, q, k, t;

    for (i = 0; i < input.length; i++) {
        inputArr.push(input.charCodeAt(i));
    }

    n = initialN;
    delta = 0;
    bias = initialBias;

    for (j = 0; j < inputArr.length; j++) {
        if (inputArr[j] < 0x80) {
            output.push(String.fromCharCode(inputArr[j]));
        }
    }

    handledCPCount = basicLength = output.length;
    if (basicLength && handledCPCount < inputArr.length) output.push(delimiter);

    while (handledCPCount < inputArr.length) {
        m = maxInt;
        for (j = 0; j < inputArr.length; j++) {
            currentValue = inputArr[j];
            if (currentValue >= n && currentValue < m) m = currentValue;
        }

        if (m - n > Math.floor((maxInt - delta) / (handledCPCount + 1))) error('overflow');
        delta += (m - n) * (handledCPCount + 1);
        n = m;

        for (j = 0; j < inputArr.length; j++) {
            currentValue = inputArr[j];
            if (currentValue < n && ++delta > maxInt) error('overflow');
            if (currentValue === n) {
                q = delta;
                k = base;
                while (true) {
                    t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
                    if (q < t) break;
                    output.push(String.fromCharCode(digitToBasic(t + (q - t) % (base - t), 0)));
                    q = Math.floor((q - t) / (base - t));
                    k += base;
                }
                output.push(String.fromCharCode(digitToBasic(q, 0)));
                bias = adapt(delta, handledCPCount + 1, handledCPCount === basicLength);
                delta = 0;
                handledCPCount++;
            }
        }
        delta++;
        n++;
    }
    return output.join('');
}

function toASCII(input) {
    return map(input.split('.'), function(label) {
        var hasNonASCII = false;
        var i;
        for (i = 0; i < label.length; i++) {
            if (label.charCodeAt(i) > 0x7E) { hasNonASCII = true; break; }
        }
        return hasNonASCII ? 'xn--' + encode(label) : label;
    }).join('.');
}

function toUnicode(input) {
    return map(input.split('.'), function(label) {
        if (label.indexOf('xn--') === 0) {
            return decode(label.substring(4));
        }
        return label;
    }).join('.');
}

module.exports = {
    version: '2.3.1',
    ucs2: {
        decode: function(string) {
            var output = [];
            var i;
            for (i = 0; i < string.length; i++) {
                output.push(string.charCodeAt(i));
            }
            return output;
        },
        encode: function(array) {
            var result = '';
            var i;
            for (i = 0; i < array.length; i++) {
                result += String.fromCharCode(array[i]);
            }
            return result;
        }
    },
    decode: decode,
    encode: encode,
    toASCII: toASCII,
    toUnicode: toUnicode
};
