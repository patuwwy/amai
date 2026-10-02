/* Stream module for NodeAmiga */
/* Node.js-compatible stream implementation with backpressure */

var EventEmitter = require('events');

/* Helper: initialize EventEmitter properties on an instance */
function initEventEmitter(self) {
    self._events = {};
    self._maxListeners = 10;
}

/* ================================================================== */
/* Readable                                                            */
/* ================================================================== */

function Readable(opts) {
    initEventEmitter(this);
    this.readable = true;
    this._readableState = {
        buffer: [],
        ended: false,
        flowing: null,
        highWaterMark: (opts && opts.highWaterMark !== undefined) ? opts.highWaterMark : 16,
        length: 0,
        pipes: [],
        destroyed: false
    };
    if (opts && opts.read) {
        this._read = opts.read;
    }
    if (opts && opts.objectMode) {
        this._readableState.objectMode = true;
    }
}

Readable.prototype = Object.create(EventEmitter.prototype);
Readable.prototype.constructor = Readable;

/* Override on() to auto-switch to flowing mode when 'data' listener added */
Readable.prototype.on = function(event, listener) {
    EventEmitter.prototype.on.call(this, event, listener);
    if (event === 'data') {
        this._readableState.flowing = true;
        this._drain();
    }
    return this;
};

Readable.prototype.addListener = Readable.prototype.on;

Readable.prototype._drain = function() {
    while (this._readableState.flowing && this._readableState.buffer.length > 0) {
        var chunk = this._readableState.buffer.shift();
        this._readableState.length--;
        this.emit('data', chunk);
    }
};

Readable.prototype.push = function(chunk) {
    if (chunk === null) {
        this._readableState.ended = true;
        if (this._readableState.buffer.length === 0) {
            this.emit('end');
        }
        return false;
    }
    if (this._readableState.flowing) {
        this.emit('data', chunk);
    } else {
        this._readableState.buffer.push(chunk);
        this._readableState.length++;
    }
    return this._readableState.length < this._readableState.highWaterMark;
};

Readable.prototype.read = function(n) {
    if (this._readableState.buffer.length === 0) {
        if (this._read) this._read(n || this._readableState.highWaterMark);
        if (this._readableState.buffer.length === 0) return null;
    }
    if (n === 0) return null;
    var chunk = this._readableState.buffer.shift();
    this._readableState.length--;
    if (this._readableState.ended && this._readableState.buffer.length === 0) {
        this.emit('end');
    }
    return chunk;
};

Readable.prototype.pipe = function(dest, opts) {
    var self = this;
    this._readableState.pipes.push(dest);
    this._readableState.flowing = true;

    /* Flush buffered data */
    while (this._readableState.buffer.length > 0) {
        var ok = dest.write(this._readableState.buffer.shift());
        this._readableState.length--;
        /* Backpressure: if write returns false, pause until drain */
        if (!ok) {
            this._readableState.flowing = false;
            dest.once('drain', function() {
                self._readableState.flowing = true;
                self._drain();
                self._pipeFlush();
            });
            break;
        }
    }

    this.on('data', function(chunk) {
        var ok = dest.write(chunk);
        if (!ok) {
            self.pause();
            dest.once('drain', function() {
                self.resume();
            });
        }
    });

    if (!opts || opts.end !== false) {
        this.on('end', function() {
            dest.end();
        });
    }

    dest.emit('pipe', self);
    return dest;
};

Readable.prototype.unpipe = function(dest) {
    var pipes = this._readableState.pipes;
    if (dest) {
        var idx = pipes.indexOf(dest);
        if (idx >= 0) pipes.splice(idx, 1);
    } else {
        this._readableState.pipes = [];
    }
    if (this._readableState.pipes.length === 0) {
        this._readableState.flowing = false;
    }
    return this;
};

Readable.prototype._pipeFlush = function() {
    var i;
    for (i = 0; i < this._readableState.pipes.length; i++) {
        while (this._readableState.flowing && this._readableState.buffer.length > 0) {
            var dest = this._readableState.pipes[i];
            var chunk = this._readableState.buffer.shift();
            this._readableState.length--;
            if (!dest.write(chunk)) {
                this._readableState.flowing = false;
            }
        }
    }
};

Readable.prototype.resume = function() {
    this._readableState.flowing = true;
    this._drain();
    return this;
};

Readable.prototype.pause = function() {
    this._readableState.flowing = false;
    return this;
};

Readable.prototype.destroy = function(err) {
    if (this._readableState.destroyed) return this;
    this._readableState.destroyed = true;
    this._readableState.ended = true;
    if (err) this.emit('error', err);
    this.emit('close');
    return this;
};

Readable.prototype.setEncoding = function(enc) {
    this._encoding = enc;
    return this;
};

/* Readable.from — create readable from iterable */
Readable.from = function(iterable, opts) {
    var r = new Readable(opts);
    var items = [];
    var i;
    if (Array.isArray(iterable)) {
        items = iterable;
    } else if (iterable && typeof iterable === 'object') {
        /* Try to iterate */
        if (typeof iterable.length === 'number') {
            for (i = 0; i < iterable.length; i++) {
                items.push(iterable[i]);
            }
        }
    }
    var idx = 0;
    r._read = function() {
        if (idx < items.length) {
            r.push(items[idx++]);
        } else {
            r.push(null);
        }
    };
    return r;
};

/* ================================================================== */
/* Writable                                                            */
/* ================================================================== */

function Writable(opts) {
    initEventEmitter(this);
    this.writable = true;
    this._writableState = {
        ended: false,
        finished: false,
        highWaterMark: (opts && opts.highWaterMark !== undefined) ? opts.highWaterMark : 16,
        length: 0,
        needDrain: false,
        corked: 0,
        buffer: [],
        destroyed: false
    };
    if (opts && opts.write) {
        this._write = opts.write;
    }
    if (opts && opts.final) {
        this._final = opts.final;
    }
}

Writable.prototype = Object.create(EventEmitter.prototype);
Writable.prototype.constructor = Writable;

Writable.prototype.write = function(chunk, encoding, callback) {
    if (typeof encoding === 'function') { callback = encoding; encoding = 'utf8'; }
    if (this._writableState.ended) {
        if (callback) callback(new Error('write after end'));
        return false;
    }
    this._writableState.length++;
    if (this._writableState.corked > 0) {
        this._writableState.buffer.push({ chunk: chunk, encoding: encoding, callback: callback });
        return this._writableState.length < this._writableState.highWaterMark;
    }
    if (this._write) {
        var self = this;
        this._write(chunk, encoding || 'utf8', function(err) {
            self._writableState.length--;
            if (err) {
                self.emit('error', err);
            }
            if (callback) callback(err);
            if (self._writableState.needDrain && self._writableState.length === 0) {
                self._writableState.needDrain = false;
                self.emit('drain');
            }
        });
    } else {
        this._writableState.length--;
    }
    if (this._writableState.length >= this._writableState.highWaterMark) {
        this._writableState.needDrain = true;
        return false;
    }
    return true;
};

Writable.prototype.end = function(chunk, encoding, callback) {
    if (typeof chunk === 'function') { callback = chunk; chunk = undefined; }
    if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
    if (chunk !== undefined && chunk !== null) {
        this.write(chunk, encoding);
    }
    this._writableState.ended = true;
    var self = this;
    var finish = function() {
        self._writableState.finished = true;
        self.emit('finish');
        if (callback) callback();
    };
    if (this._final) {
        this._final(finish);
    } else {
        finish();
    }
    return this;
};

Writable.prototype.cork = function() {
    this._writableState.corked++;
};

Writable.prototype.uncork = function() {
    this._writableState.corked--;
    if (this._writableState.corked <= 0) {
        this._writableState.corked = 0;
        /* Flush buffered writes */
        var buf = this._writableState.buffer;
        this._writableState.buffer = [];
        var i;
        for (i = 0; i < buf.length; i++) {
            this.write(buf[i].chunk, buf[i].encoding, buf[i].callback);
        }
    }
};

Writable.prototype.destroy = function(err) {
    if (this._writableState.destroyed) return this;
    this._writableState.destroyed = true;
    this._writableState.ended = true;
    if (err) this.emit('error', err);
    this.emit('close');
    return this;
};

/* ================================================================== */
/* Duplex                                                              */
/* ================================================================== */

function Duplex(opts) {
    initEventEmitter(this);
    this.readable = true;
    this._readableState = {
        buffer: [],
        ended: false,
        flowing: null,
        highWaterMark: (opts && opts.readableHighWaterMark !== undefined) ? opts.readableHighWaterMark : 16,
        length: 0,
        pipes: [],
        destroyed: false
    };
    this.writable = true;
    this._writableState = {
        ended: false,
        finished: false,
        highWaterMark: (opts && opts.writableHighWaterMark !== undefined) ? opts.writableHighWaterMark : 16,
        length: 0,
        needDrain: false,
        corked: 0,
        buffer: [],
        destroyed: false
    };
    if (opts && opts.read) this._read = opts.read;
    if (opts && opts.write) this._write = opts.write;
}

Duplex.prototype = Object.create(Readable.prototype);
Duplex.prototype.constructor = Duplex;

/* Mix in Writable methods */
Duplex.prototype.write = Writable.prototype.write;
Duplex.prototype.end = Writable.prototype.end;
Duplex.prototype.cork = Writable.prototype.cork;
Duplex.prototype.uncork = Writable.prototype.uncork;

Duplex.prototype.destroy = function(err) {
    if (this._readableState.destroyed) return this;
    this._readableState.destroyed = true;
    this._readableState.ended = true;
    this._writableState.destroyed = true;
    this._writableState.ended = true;
    if (err) this.emit('error', err);
    this.emit('close');
    return this;
};

/* ================================================================== */
/* Transform                                                           */
/* ================================================================== */

function Transform(opts) {
    initEventEmitter(this);
    this.readable = true;
    this._readableState = {
        buffer: [],
        ended: false,
        flowing: null,
        highWaterMark: 16,
        length: 0,
        pipes: [],
        destroyed: false
    };
    this.writable = true;
    this._writableState = {
        ended: false,
        finished: false,
        highWaterMark: 16,
        length: 0,
        needDrain: false,
        corked: 0,
        buffer: [],
        destroyed: false
    };
    if (opts && opts.transform) this._transform = opts.transform;
    if (opts && opts.flush) this._flush = opts.flush;
    if (opts && opts.read) this._read = opts.read;
}

Transform.prototype = Object.create(Duplex.prototype);
Transform.prototype.constructor = Transform;

Transform.prototype.write = function(chunk, encoding, callback) {
    if (typeof encoding === 'function') { callback = encoding; encoding = 'utf8'; }
    if (this._writableState.ended) return false;
    if (this._transform) {
        var self = this;
        this._transform(chunk, encoding || 'utf8', function(err, data) {
            if (err) {
                self.emit('error', err);
            } else if (data !== undefined && data !== null) {
                self.push(data);
            }
            if (callback) callback(err);
        });
    }
    return true;
};

Transform.prototype.end = function(chunk, encoding, callback) {
    if (typeof chunk === 'function') { callback = chunk; chunk = undefined; }
    if (chunk !== undefined && chunk !== null) {
        this.write(chunk, encoding);
    }
    this._writableState.ended = true;
    var self = this;
    var done = function() {
        self._writableState.finished = true;
        self._readableState.ended = true;
        self.emit('finish');
        self.emit('end');
        if (callback) callback();
    };
    if (this._flush) {
        this._flush(done);
    } else {
        done();
    }
    return this;
};

/* ================================================================== */
/* PassThrough                                                         */
/* ================================================================== */

function PassThrough(opts) {
    Transform.call(this, opts);
    this._transform = function(chunk, enc, cb) {
        cb(null, chunk);
    };
}

PassThrough.prototype = Object.create(Transform.prototype);
PassThrough.prototype.constructor = PassThrough;

/* ================================================================== */
/* pipeline(stream1, stream2, ..., callback)                           */
/* ================================================================== */

function pipeline() {
    var streams = [];
    var callback = null;
    var i;
    for (i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'function' && i === arguments.length - 1) {
            callback = arguments[i];
        } else {
            streams.push(arguments[i]);
        }
    }
    if (streams.length < 2) {
        if (callback) callback(new Error('pipeline requires at least 2 streams'));
        return streams[0] || null;
    }

    var errored = false;
    function onError(err) {
        if (errored) return;
        errored = true;
        /* Destroy all streams on error */
        for (var j = 0; j < streams.length; j++) {
            if (streams[j].destroy) streams[j].destroy();
        }
        if (callback) callback(err);
    }

    /* Chain pipe and attach error handlers */
    for (i = 0; i < streams.length - 1; i++) {
        streams[i].on('error', onError);
        streams[i].pipe(streams[i + 1]);
    }
    /* Last stream error handler */
    streams[streams.length - 1].on('error', onError);

    /* Callback on finish of last stream */
    var lastStream = streams[streams.length - 1];
    if (lastStream.on) {
        lastStream.on('finish', function() {
            if (!errored && callback) callback(null);
        });
    }

    return lastStream;
}

/* ================================================================== */
/* finished(stream, callback)                                          */
/* ================================================================== */

function finished(stream, callback) {
    var done = false;
    function onDone(err) {
        if (done) return;
        done = true;
        if (callback) callback(err || null);
    }
    if (stream.on) {
        stream.on('end', function() { onDone(null); });
        stream.on('finish', function() { onDone(null); });
        stream.on('error', function(err) { onDone(err); });
        stream.on('close', function() { onDone(null); });
    }
}

/* ================================================================== */
/* Exports                                                             */
/* ================================================================== */

module.exports = {
    Readable: Readable,
    Writable: Writable,
    Duplex: Duplex,
    Transform: Transform,
    PassThrough: PassThrough,
    pipeline: pipeline,
    finished: finished,
    Stream: Readable
};
