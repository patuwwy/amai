/* timers/promises module for NodeAmiga */
/* Provides Promise-based timer functions */

var timers = {};

timers.setTimeout = function(delay, value) {
    return new Promise(function(resolve) {
        setTimeout(function() {
            resolve(value);
        }, delay || 0);
    });
};

timers.setInterval = function(delay) {
    /* Returns an async-iterable-like object for interval ticks */
    var running = true;
    var waiters = [];
    var id = setInterval(function() {
        if (waiters.length > 0) {
            var w = waiters.shift();
            w();
        }
    }, delay || 0);

    return {
        next: function() {
            if (!running) {
                return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise(function(resolve) {
                waiters.push(function() {
                    resolve({ value: undefined, done: false });
                });
            });
        },
        cancel: function() {
            running = false;
            clearInterval(id);
            /* Resolve any pending waiters */
            while (waiters.length > 0) {
                var w = waiters.shift();
                w();
            }
        },
        /* Allow simple one-shot usage too */
        then: function(onResolve) {
            return new Promise(function(resolve) {
                waiters.push(function() {
                    running = false;
                    clearInterval(id);
                    resolve(onResolve ? onResolve() : undefined);
                });
            });
        }
    };
};

timers.setImmediate = function(value) {
    return new Promise(function(resolve) {
        setTimeout(function() {
            resolve(value);
        }, 0);
    });
};

module.exports = timers;
