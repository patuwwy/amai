/* zlib module for NodeAmiga */
/* Pure JS DEFLATE/INFLATE (RFC 1951) + gzip/zlib wrappers */

/* ================================================================== */
/* CRC32                                                               */
/* ================================================================== */

var crc32Table = null;

function makeCRC32Table() {
    var table = [];
    var i, j, c;
    for (i = 0; i < 256; i++) {
        c = i;
        for (j = 0; j < 8; j++) {
            if (c & 1) c = 0xEDB88320 ^ (c >>> 1);
            else c = c >>> 1;
        }
        table[i] = c;
    }
    return table;
}

function crc32(buf) {
    if (!crc32Table) crc32Table = makeCRC32Table();
    var crc = 0xFFFFFFFF;
    var i;
    for (i = 0; i < buf.length; i++) {
        var b = (typeof buf === 'string') ? buf.charCodeAt(i) & 0xFF : buf[i];
        crc = crc32Table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* ================================================================== */
/* Adler-32 (for zlib format)                                          */
/* ================================================================== */

function adler32(buf) {
    var a = 1, b = 0;
    var i;
    for (i = 0; i < buf.length; i++) {
        var byte = (typeof buf === 'string') ? buf.charCodeAt(i) & 0xFF : buf[i];
        a = (a + byte) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
}

/* ================================================================== */
/* DEFLATE — fixed Huffman only (stores 1, static 2 block types)       */
/* Fast compression: LZ77 + fixed Huffman codes                        */
/* ================================================================== */

function toBytes(input) {
    var arr = [];
    var i;
    if (typeof input === 'string') {
        for (i = 0; i < input.length; i++) {
            arr.push(input.charCodeAt(i) & 0xFF);
        }
        return arr;
    }
    /* Assume array-like with numeric indices */
    for (i = 0; i < input.length; i++) arr.push(input[i] & 0xFF);
    return arr;
}

function fromBytes(arr) {
    var result = '';
    var i;
    for (i = 0; i < arr.length; i++) {
        result += String.fromCharCode(arr[i]);
    }
    return result;
}

/* Bit writer for DEFLATE output */
function BitWriter() {
    this.buf = [];
    this.bitBuf = 0;
    this.bitCount = 0;
}

BitWriter.prototype.writeBits = function(val, count) {
    this.bitBuf |= (val << this.bitCount);
    this.bitCount += count;
    while (this.bitCount >= 8) {
        this.buf.push(this.bitBuf & 0xFF);
        this.bitBuf >>= 8;
        this.bitCount -= 8;
    }
};

BitWriter.prototype.flush = function() {
    if (this.bitCount > 0) {
        this.buf.push(this.bitBuf & 0xFF);
        this.bitBuf = 0;
        this.bitCount = 0;
    }
};

/* Reverse bits for Huffman decoding */
function reverseBits(val, bits) {
    var result = 0;
    var i;
    for (i = 0; i < bits; i++) {
        result = (result << 1) | (val & 1);
        val >>= 1;
    }
    return result;
}

/* Encode length for DEFLATE (257-285) */
var lengthBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
var lengthExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];

/* Distance tables (used by inflate) */
var distBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
var distExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

/* DEFLATE encoder — uses stored blocks (no compression) */
function deflateRaw(input) {
    var bytes = toBytes(input);
    var len = bytes.length;
    var result = [];
    var offset = 0;

    /* Use stored blocks (BTYPE=00) — no compression but always correct.
     * Each block can hold up to 65535 bytes. */
    while (offset < len) {
        var blockLen = len - offset;
        var isFinal = 1;
        if (blockLen > 65535) {
            blockLen = 65535;
            isFinal = 0;
        }
        /* Block header byte: BFINAL (1 bit) | BTYPE=00 (2 bits) | padding to byte */
        result.push(isFinal ? 0x01 : 0x00);
        /* LEN (2 bytes LE) */
        result.push(blockLen & 0xFF);
        result.push((blockLen >> 8) & 0xFF);
        /* NLEN (one's complement of LEN, 2 bytes LE) */
        var nlen = (~blockLen) & 0xFFFF;
        result.push(nlen & 0xFF);
        result.push((nlen >> 8) & 0xFF);
        /* Data */
        var i;
        for (i = 0; i < blockLen; i++) {
            result.push(bytes[offset + i]);
        }
        offset += blockLen;
    }
    /* Edge case: empty input */
    if (len === 0) {
        result.push(0x01, 0x00, 0x00, 0xFF, 0xFF);
    }
    return result;
}

/* ================================================================== */
/* INFLATE — decode DEFLATE stream                                     */
/* ================================================================== */

function BitReader(buf) {
    this.buf = buf;
    this.pos = 0;
    this.bitBuf = 0;
    this.bitCount = 0;
}

BitReader.prototype.readBits = function(count) {
    while (this.bitCount < count) {
        if (this.pos >= this.buf.length) {
            this.eof = 1;
            return 0;
        }
        this.bitBuf |= (this.buf[this.pos++] << this.bitCount);
        this.bitCount += 8;
    }
    var val = this.bitBuf & ((1 << count) - 1);
    this.bitBuf >>= count;
    this.bitCount -= count;
    return val;
};

/* Build Huffman decode table from code lengths */
function buildHuffmanTable(codeLens) {
    var maxBits = 0;
    var i;
    for (i = 0; i < codeLens.length; i++) {
        if (codeLens[i] > maxBits) maxBits = codeLens[i];
    }
    if (maxBits === 0) return {};

    var blCount = [];
    for (i = 0; i <= maxBits; i++) blCount[i] = 0;
    for (i = 0; i < codeLens.length; i++) {
        if (codeLens[i]) blCount[codeLens[i]]++;
    }

    var nextCode = [];
    var code = 0;
    nextCode[0] = 0;
    for (i = 1; i <= maxBits; i++) {
        code = (code + (blCount[i - 1] || 0)) << 1;
        nextCode[i] = code;
    }

    var table = {};
    for (i = 0; i < codeLens.length; i++) {
        var len = codeLens[i];
        if (len > 0) {
            var c = nextCode[len]++;
            var key = len + '_' + reverseBits(c, len);
            table[key] = i;
        }
    }
    table._maxBits = maxBits;
    return table;
}

function decodeSymbol(br, table) {
    var code = 0;
    var bits;
    for (bits = 1; bits <= table._maxBits; bits++) {
        code |= (br.readBits(1) << (bits - 1));
        var key = bits + '_' + code;
        if (table[key] !== undefined) return table[key];
    }
    return -1;
}

/* Build fixed Huffman tables */
function buildFixedLitTable() {
    var lens = [];
    var i;
    for (i = 0; i <= 143; i++) lens[i] = 8;
    for (i = 144; i <= 255; i++) lens[i] = 9;
    for (i = 256; i <= 279; i++) lens[i] = 7;
    for (i = 280; i <= 287; i++) lens[i] = 8;
    return buildHuffmanTable(lens);
}

function buildFixedDistTable() {
    var lens = [];
    var i;
    for (i = 0; i < 32; i++) lens[i] = 5;
    return buildHuffmanTable(lens);
}

var fixedLitTable = null;
var fixedDistTable = null;

function inflateRaw(compressed) {
    var br = new BitReader(compressed);
    var output = [];
    var bfinal, btype;

    if (!fixedLitTable) fixedLitTable = buildFixedLitTable();
    if (!fixedDistTable) fixedDistTable = buildFixedDistTable();

    do {
        bfinal = br.readBits(1);
        btype = br.readBits(2);

        if (btype === 0) {
            /* Stored (no compression) */
            br.bitBuf = 0;
            br.bitCount = 0;
            var slen = br.buf[br.pos] | (br.buf[br.pos+1] << 8);
            br.pos += 4; /* skip LEN and NLEN */
            var si;
            for (si = 0; si < slen; si++) {
                output.push(br.buf[br.pos++]);
            }
        } else if (btype === 1 || btype === 2) {
            var litTable, distTable;

            if (btype === 1) {
                litTable = fixedLitTable;
                distTable = fixedDistTable;
            } else {
                /* Dynamic Huffman */
                var hlit = br.readBits(5) + 257;
                var hdist = br.readBits(5) + 1;
                var hclen = br.readBits(4) + 4;
                var clOrder = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
                var clLens = [];
                var ci;
                for (ci = 0; ci < 19; ci++) clLens[ci] = 0;
                for (ci = 0; ci < hclen; ci++) {
                    clLens[clOrder[ci]] = br.readBits(3);
                }
                var clTable = buildHuffmanTable(clLens);

                var allLens = [];
                while (allLens.length < hlit + hdist) {
                    var sym = decodeSymbol(br, clTable);
                    if (sym < 16) {
                        allLens.push(sym);
                    } else if (sym === 16) {
                        var rep = br.readBits(2) + 3;
                        var last = allLens[allLens.length - 1] || 0;
                        var ri;
                        for (ri = 0; ri < rep; ri++) allLens.push(last);
                    } else if (sym === 17) {
                        var rep17 = br.readBits(3) + 3;
                        var ri2;
                        for (ri2 = 0; ri2 < rep17; ri2++) allLens.push(0);
                    } else if (sym === 18) {
                        var rep18 = br.readBits(7) + 11;
                        var ri3;
                        for (ri3 = 0; ri3 < rep18; ri3++) allLens.push(0);
                    }
                }
                litTable = buildHuffmanTable(allLens.slice(0, hlit));
                distTable = buildHuffmanTable(allLens.slice(hlit));
            }

            /* Decode compressed data */
            while (!br.eof) {
                var sym2 = decodeSymbol(br, litTable);
                if (sym2 < 0 || sym2 === 256) break;
                if (sym2 < 256) {
                    output.push(sym2);
                } else {
                    /* Length/distance pair */
                    var lcode = sym2 - 257;
                    var matchLength = lengthBase[lcode] + (lengthExtra[lcode] > 0 ? br.readBits(lengthExtra[lcode]) : 0);
                    var dcode = decodeSymbol(br, distTable);
                    var matchDist = distBase[dcode] + (distExtra[dcode] > 0 ? br.readBits(distExtra[dcode]) : 0);
                    var mi;
                    for (mi = 0; mi < matchLength; mi++) {
                        output.push(output[output.length - matchDist]);
                    }
                }
            }
        } else {
            throw new Error('zlib: invalid block type');
        }
    } while (!bfinal);

    return output;
}

/* ================================================================== */
/* gzip / gunzip (RFC 1952)                                            */
/* ================================================================== */

function gzip(input) {
    var bytes = toBytes(input);
    var compressed = deflateRaw(input);
    var crc = crc32(bytes);
    var size = bytes.length;
    var result = [];

    /* gzip header */
    result.push(0x1F, 0x8B); /* magic */
    result.push(0x08);       /* method: deflate */
    result.push(0x00);       /* flags */
    result.push(0, 0, 0, 0); /* mtime */
    result.push(0x00);       /* xfl */
    result.push(0xFF);       /* OS: unknown */

    /* compressed data */
    var i;
    for (i = 0; i < compressed.length; i++) result.push(compressed[i]);

    /* trailer: CRC32 + ISIZE (LE) */
    result.push(crc & 0xFF, (crc >> 8) & 0xFF, (crc >> 16) & 0xFF, (crc >> 24) & 0xFF);
    result.push(size & 0xFF, (size >> 8) & 0xFF, (size >> 16) & 0xFF, (size >> 24) & 0xFF);

    return result;
}

function gunzip(input) {
    var bytes = toBytes(input);
    if (bytes[0] !== 0x1F || bytes[1] !== 0x8B) throw new Error('zlib: not gzip');
    if (bytes[2] !== 0x08) throw new Error('zlib: unsupported method');

    var flags = bytes[3];
    var pos = 10;

    /* Skip extra field */
    if (flags & 0x04) {
        var xlen = bytes[pos] | (bytes[pos+1] << 8);
        pos += 2 + xlen;
    }
    /* Skip name */
    if (flags & 0x08) { while (bytes[pos++] !== 0) {} }
    /* Skip comment */
    if (flags & 0x10) { while (bytes[pos++] !== 0) {} }
    /* Skip header CRC */
    if (flags & 0x02) pos += 2;

    /* Decompress */
    var compData = bytes.slice(pos, bytes.length - 8);
    return inflateRaw(compData);
}

/* ================================================================== */
/* zlib format (RFC 1950) — deflate with header/checksum               */
/* ================================================================== */

function deflate(input) {
    var bytes = toBytes(input);
    var compressed = deflateRaw(input);
    var checksum = adler32(bytes);
    var result = [];

    /* zlib header: CMF=0x78, FLG=0x01 (no dict, fastest) */
    result.push(0x78, 0x01);

    var i;
    for (i = 0; i < compressed.length; i++) result.push(compressed[i]);

    /* Adler-32 checksum (BE) */
    result.push((checksum >> 24) & 0xFF, (checksum >> 16) & 0xFF, (checksum >> 8) & 0xFF, checksum & 0xFF);

    return result;
}

function inflate(input) {
    var bytes = toBytes(input);
    /* Skip 2-byte zlib header */
    var compData = bytes.slice(2, bytes.length - 4);
    return inflateRaw(compData);
}

/* ================================================================== */
/* Sync API (Node.js compatible)                                       */
/* ================================================================== */

function deflateSync(input) {
    var result = deflate(input);
    return fromBytes(result);
}

function inflateSync(input) {
    var result = inflate(input);
    return fromBytes(result);
}

function deflateRawSync(input) {
    var result = deflateRaw(input);
    return fromBytes(result);
}

function inflateRawSync(input) {
    var result = inflateRaw(input);
    return fromBytes(result);
}

function gzipSync(input) {
    var result = gzip(input);
    return fromBytes(result);
}

function gunzipSync(input) {
    var result = gunzip(input);
    return fromBytes(result);
}

/* ================================================================== */
/* Exports                                                             */
/* ================================================================== */

module.exports = {
    deflateSync: deflateSync,
    inflateSync: inflateSync,
    deflateRawSync: deflateRawSync,
    inflateRawSync: inflateRawSync,
    gzipSync: gzipSync,
    gunzipSync: gunzipSync,
    crc32: crc32,
    adler32: adler32,

    /* Constants */
    Z_NO_COMPRESSION: 0,
    Z_BEST_SPEED: 1,
    Z_BEST_COMPRESSION: 9,
    Z_DEFAULT_COMPRESSION: -1
};
