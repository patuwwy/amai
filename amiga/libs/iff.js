/* IFF/ILBM parser for NodeAmiga
 * Parses Interchange File Format (IFF) files.
 * Supports ILBM (images), 8SVX (audio), ANIM, generic chunks.
 */

var fs = require('fs');

function B(buf, off) {
    return buf.charCodeAt ? buf.charCodeAt(off) & 0xFF : buf[off] & 0xFF;
}

function readUint32BE(buf, off) {
    return (B(buf, off) << 24) | (B(buf, off+1) << 16) |
           (B(buf, off+2) << 8) | B(buf, off+3);
}

function readUint16BE(buf, off) {
    return (B(buf, off) << 8) | B(buf, off+1);
}

function readInt16BE(buf, off) {
    var v = readUint16BE(buf, off);
    return v > 32767 ? v - 65536 : v;
}

function readInt8(buf, off) {
    var v = B(buf, off);
    return v > 127 ? v - 256 : v;
}

function chunkId(buf, off) {
    return String.fromCharCode(B(buf,off), B(buf,off+1), B(buf,off+2), B(buf,off+3));
}

/* Parse IFF file into chunk tree */
/* Parse IFF from file path */
function parseFile(path) {
    return parse(fs.readFileSync(path));
}

/* Parse IFF from data (string or array of bytes) */
function parse(buf) {
    if (!buf || buf.length < 12) {
        throw new Error('IFF data too short or null (length=' + (buf ? buf.length : 'null') + ')');
    }
    var formId = chunkId(buf, 0);
    if (formId !== 'FORM' && formId !== 'LIST' && formId !== 'CAT ') {
        throw new Error('Not an IFF file (missing FORM/LIST/CAT header)');
    }

    var totalLen = readUint32BE(buf, 4);
    var subType = chunkId(buf, 8);
    var end = Math.min(8 + totalLen, buf.length);

    return {
        type: formId,
        subType: subType,
        length: totalLen,
        chunks: parseChunks(buf, 12, end)
    };
}

/* Walk chunk sequence between start and end, returning chunk tree */
function parseChunks(buf, start, end) {
    var chunks = [];
    var pos = start;
    while (pos + 8 <= end) {
        var id = chunkId(buf, pos);
        var len = readUint32BE(buf, pos + 4);
        var dataStart = pos + 8;
        var dataEnd = Math.min(dataStart + len, buf.length);

        if (id === 'FORM' || id === 'LIST' || id === 'CAT ') {
            var nested = chunkId(buf, dataStart);
            chunks.push({
                id: id,
                subType: nested,
                length: len,
                offset: pos,
                chunks: parseChunks(buf, dataStart + 4, dataEnd)
            });
        } else {
            chunks.push({
                id: id,
                length: len,
                offset: pos,
                data: bufSlice(buf, dataStart, dataEnd)
            });
        }

        pos = dataEnd;
        if (pos % 2 !== 0) pos++; /* IFF chunks are word-aligned */
    }
    return chunks;
}

function bufSlice(buf, start, end) {
    var result = [];
    var i;
    for (i = start; i < end; i++) {
        result.push(buf.charCodeAt ? buf.charCodeAt(i) & 0xFF : buf[i] & 0xFF);
    }
    return result;
}

/* Find a chunk by ID in parsed IFF */
function findChunk(iff, id) {
    var i;
    for (i = 0; i < iff.chunks.length; i++) {
        if (iff.chunks[i].id === id) return iff.chunks[i];
        if (iff.chunks[i].chunks) {
            var found = findChunk(iff.chunks[i], id);
            if (found) return found;
        }
    }
    return null;
}

/* Find all chunks with given ID */
function findChunks(iff, id) {
    var result = [];
    var i;
    for (i = 0; i < iff.chunks.length; i++) {
        if (iff.chunks[i].id === id) result.push(iff.chunks[i]);
        if (iff.chunks[i].chunks) {
            var sub = findChunks(iff.chunks[i], id);
            var j;
            for (j = 0; j < sub.length; j++) result.push(sub[j]);
        }
    }
    return result;
}

/* Parse ILBM BMHD (BitMap Header) chunk */
function parseBMHD(data) {
    return {
        width: readUint16BE(data, 0),
        height: readUint16BE(data, 2),
        x: readInt16BE(data, 4),
        y: readInt16BE(data, 6),
        numPlanes: data[8] & 0xFF,
        masking: data[9] & 0xFF,
        compression: data[10] & 0xFF,
        transparentColor: readUint16BE(data, 12),
        xAspect: data[14] & 0xFF,
        yAspect: data[15] & 0xFF,
        pageWidth: readInt16BE(data, 16),
        pageHeight: readInt16BE(data, 18)
    };
}

/* Parse CMAP (Color Map) chunk — returns array of {r,g,b} */
function parseCMAP(data) {
    var colors = [];
    var i;
    for (i = 0; i + 2 < data.length; i += 3) {
        colors.push({
            r: data[i] & 0xFF,
            g: data[i + 1] & 0xFF,
            b: data[i + 2] & 0xFF
        });
    }
    return colors;
}

/* Unpack RLE compressed BODY data (ByteRun1) */
function unpackByteRun1(data, unpackedSize) {
    var out = [];
    var i = 0;
    while (i < data.length && out.length < unpackedSize) {
        var n = readInt8(data, i); i++;
        if (n >= 0) {
            /* Copy n+1 bytes literally */
            var count = n + 1;
            var j;
            for (j = 0; j < count && i < data.length; j++) {
                out.push(data[i++] & 0xFF);
            }
        } else if (n !== -128) {
            /* Repeat next byte -n+1 times */
            var rep = -n + 1;
            var val = (i < data.length) ? data[i++] & 0xFF : 0;
            var k;
            for (k = 0; k < rep; k++) out.push(val);
        }
        /* n === -128: NOP */
    }
    return out;
}

/* Parse ILBM image — returns {width, height, planes, colors, pixels} */
function parseILBM(iff) {
    var bmhd_chunk = findChunk(iff, 'BMHD');
    var cmap_chunk = findChunk(iff, 'CMAP');
    var body_chunk = findChunk(iff, 'BODY');

    if (!bmhd_chunk) throw new Error('ILBM missing BMHD chunk');

    var bmhd = parseBMHD(bmhd_chunk.data);
    var colors = cmap_chunk ? parseCMAP(cmap_chunk.data) : [];

    var pixels = null;
    if (body_chunk) {
        var rowBytes = Math.floor((bmhd.width + 15) / 16) * 2;
        var totalBytes = rowBytes * bmhd.numPlanes * bmhd.height;
        var bodyData;

        if (bmhd.compression === 1) {
            bodyData = unpackByteRun1(body_chunk.data, totalBytes);
        } else {
            bodyData = body_chunk.data;
        }

        /* Convert planar to chunky */
        pixels = [];
        var y, x, plane, bit, byteIdx, byteVal;
        for (y = 0; y < bmhd.height; y++) {
            for (x = 0; x < bmhd.width; x++) {
                var color = 0;
                for (plane = 0; plane < bmhd.numPlanes; plane++) {
                    byteIdx = y * rowBytes * bmhd.numPlanes +
                              plane * rowBytes +
                              Math.floor(x / 8);
                    if (byteIdx < bodyData.length) {
                        byteVal = bodyData[byteIdx] & 0xFF;
                        bit = (byteVal >> (7 - (x % 8))) & 1;
                        color |= (bit << plane);
                    }
                }
                pixels.push(color);
            }
        }
    }

    return {
        width: bmhd.width,
        height: bmhd.height,
        numPlanes: bmhd.numPlanes,
        compression: bmhd.compression,
        colors: colors,
        pixels: pixels,
        bmhd: bmhd
    };
}

/* Parse 8SVX audio sample */
function parse8SVX(iff) {
    var vhdr = findChunk(iff, 'VHDR');
    var body = findChunk(iff, 'BODY');
    var name = findChunk(iff, 'NAME');

    var info = {};
    if (vhdr && vhdr.data.length >= 20) {
        info.oneShotHiSamples = readUint32BE(vhdr.data, 0);
        info.repeatHiSamples = readUint32BE(vhdr.data, 4);
        info.samplesPerHiCycle = readUint32BE(vhdr.data, 8);
        info.samplesPerSec = readUint16BE(vhdr.data, 12);
        info.numOctaves = vhdr.data[14] & 0xFF;
        info.compression = vhdr.data[15] & 0xFF;
        info.volume = readUint32BE(vhdr.data, 16);
    }
    if (name) {
        var s = '';
        var i;
        for (i = 0; i < name.data.length && name.data[i] !== 0; i++) {
            s += String.fromCharCode(name.data[i]);
        }
        info.name = s;
    }
    if (body) {
        info.samples = body.data;
        info.length = body.data.length;
    }

    return info;
}

module.exports = {
    parse: parse,
    parseFile: parseFile,
    findChunk: findChunk,
    findChunks: findChunks,
    parseBMHD: parseBMHD,
    parseCMAP: parseCMAP,
    parseILBM: parseILBM,
    parse8SVX: parse8SVX,
    unpackByteRun1: unpackByteRun1
};
