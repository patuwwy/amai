/* string_decoder module for NodeAmiga */
/* Converts Buffer data to strings, handling multi-byte UTF-8 boundaries */

function StringDecoder(encoding) {
    this.encoding = (encoding || 'utf8').toLowerCase();
    if (this.encoding === 'utf-8') this.encoding = 'utf8';
    this._partial = null;
    this._partialLen = 0;
}

/* How many bytes does this UTF-8 lead byte expect? */
function utf8SeqLen(byte) {
    if ((byte & 0x80) === 0) return 1;
    if ((byte & 0xE0) === 0xC0) return 2;
    if ((byte & 0xF0) === 0xE0) return 3;
    if ((byte & 0xF8) === 0xF0) return 4;
    return 1; /* invalid lead byte, treat as single */
}

StringDecoder.prototype.write = function(buf) {
    if (!buf || buf.length === 0) return '';

    /* For non-utf8 encodings, just convert directly */
    if (this.encoding !== 'utf8') {
        if (typeof buf === 'string') return buf;
        return buf.toString(this.encoding);
    }

    var str = '';
    var i = 0;
    var data;

    /* buf may be a Buffer or a string */
    if (typeof buf === 'string') return buf;

    /* Prepend any leftover partial bytes from previous write */
    if (this._partial && this._partialLen > 0) {
        var totalNeeded = utf8SeqLen(this._partial[0]);
        var copyLen = totalNeeded - this._partialLen;
        if (copyLen > buf.length) copyLen = buf.length;
        /* Build combined bytes */
        var combined = [];
        var j;
        for (j = 0; j < this._partialLen; j++) {
            combined.push(this._partial[j]);
        }
        for (j = 0; j < copyLen; j++) {
            combined.push(buf.readUInt8(j));
        }
        i = copyLen;
        if (combined.length >= totalNeeded) {
            /* Decode the completed character */
            var cp;
            if (totalNeeded === 2) {
                cp = ((combined[0] & 0x1F) << 6) | (combined[1] & 0x3F);
            } else if (totalNeeded === 3) {
                cp = ((combined[0] & 0x0F) << 12) | ((combined[1] & 0x3F) << 6) | (combined[2] & 0x3F);
            } else if (totalNeeded === 4) {
                cp = ((combined[0] & 0x07) << 18) | ((combined[1] & 0x3F) << 12) | ((combined[2] & 0x3F) << 6) | (combined[3] & 0x3F);
            } else {
                cp = combined[0];
            }
            str += String.fromCharCode(cp);
            this._partial = null;
            this._partialLen = 0;
        } else {
            /* Still incomplete, store what we have */
            this._partial = combined;
            this._partialLen = combined.length;
            return '';
        }
    }

    /* Process remaining bytes */
    while (i < buf.length) {
        var byte0 = buf.readUInt8(i);
        var seqLen = utf8SeqLen(byte0);

        if (i + seqLen > buf.length) {
            /* Incomplete sequence at end — save for next write */
            this._partial = [];
            for (var k = i; k < buf.length; k++) {
                this._partial.push(buf.readUInt8(k));
            }
            this._partialLen = buf.length - i;
            break;
        }

        if (seqLen === 1) {
            str += String.fromCharCode(byte0);
        } else if (seqLen === 2) {
            str += String.fromCharCode(((byte0 & 0x1F) << 6) | (buf.readUInt8(i + 1) & 0x3F));
        } else if (seqLen === 3) {
            str += String.fromCharCode(((byte0 & 0x0F) << 12) | ((buf.readUInt8(i + 1) & 0x3F) << 6) | (buf.readUInt8(i + 2) & 0x3F));
        } else {
            /* 4-byte: codepoint > 0xFFFF — emit as-is via fromCharCode */
            var cp4 = ((byte0 & 0x07) << 18) | ((buf.readUInt8(i + 1) & 0x3F) << 12) | ((buf.readUInt8(i + 2) & 0x3F) << 6) | (buf.readUInt8(i + 3) & 0x3F);
            str += String.fromCharCode(cp4);
        }
        i += seqLen;
    }

    return str;
};

StringDecoder.prototype.end = function(buf) {
    var str = '';
    if (buf && buf.length > 0) {
        str = this.write(buf);
    }
    /* Flush any remaining partial bytes as replacement chars */
    if (this._partial && this._partialLen > 0) {
        str += '\uFFFD';
        this._partial = null;
        this._partialLen = 0;
    }
    return str;
};

module.exports = { StringDecoder: StringDecoder };
