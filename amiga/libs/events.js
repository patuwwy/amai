// EventEmitter module for NodeAmiga
// Node.js-compatible event system

function EventEmitter() {
    this._events = {};
    this._maxListeners = 10;
}

EventEmitter.prototype.on = function(event, listener) {
    if (!this._events[event]) {
        this._events[event] = [];
    }
    var listeners = this._events[event];
    if (this._maxListeners > 0 && listeners.length >= this._maxListeners) {
        console.error('Warning: possible memory leak, ' + listeners.length + ' listeners added for event "' + event + '"');
    }
    listeners.push(listener);
    return this;
};

EventEmitter.prototype.addListener = EventEmitter.prototype.on;

EventEmitter.prototype.once = function(event, listener) {
    var self = this;
    var fired = false;
    var wrapper = function(a1, a2, a3, a4, a5) {
        if (fired) return;
        fired = true;
        self.removeListener(event, wrapper);
        listener(a1, a2, a3, a4, a5);
    };
    wrapper._original = listener;
    this.on(event, wrapper);
    return this;
};

EventEmitter.prototype.emit = function(event) {
    var listeners = this._events[event];
    if (!listeners || listeners.length === 0) {
        if (event === 'error') {
            var err = arguments.length > 1 ? arguments[1] : 'Unhandled error event';
            throw err;
        }
        return false;
    }
    var args = [];
    for (var i = 1; i < arguments.length; i++) {
        args.push(arguments[i]);
    }
    var copy = listeners.slice();
    for (var j = 0; j < copy.length; j++) {
        copy[j](args[0], args[1], args[2], args[3], args[4]);
    }
    return true;
};

EventEmitter.prototype.removeListener = function(event, listener) {
    var listeners = this._events[event];
    if (!listeners) return this;
    for (var i = 0; i < listeners.length; i++) {
        if (listeners[i] === listener || (listeners[i]._original && listeners[i]._original === listener)) {
            listeners.splice(i, 1);
            break;
        }
    }
    if (listeners.length === 0) {
        delete this._events[event];
    }
    return this;
};

EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

EventEmitter.prototype.removeAllListeners = function(event) {
    if (event !== undefined) {
        delete this._events[event];
    } else {
        this._events = {};
    }
    return this;
};

EventEmitter.prototype.listenerCount = function(event) {
    var listeners = this._events[event];
    return listeners ? listeners.length : 0;
};

EventEmitter.prototype.listeners = function(event) {
    return this._events[event] ? this._events[event].slice() : [];
};

EventEmitter.prototype.setMaxListeners = function(n) {
    this._maxListeners = n;
    return this;
};

EventEmitter.prototype.eventNames = function() {
    return Object.keys(this._events);
};

EventEmitter.prototype.prependListener = function(event, listener) {
    if (!this._events[event]) {
        this._events[event] = [];
    }
    this._events[event].unshift(listener);
    return this;
};

EventEmitter.prototype.prependOnceListener = function(event, listener) {
    var self = this;
    var fired = false;
    var wrapper = function(a1, a2, a3, a4, a5) {
        if (fired) return;
        fired = true;
        self.removeListener(event, wrapper);
        listener(a1, a2, a3, a4, a5);
    };
    wrapper._original = listener;
    this.prependListener(event, wrapper);
    return this;
};

module.exports = EventEmitter;
