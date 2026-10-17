//@ts-check
'use strict';

function createRateLimiter(options = {}) {
  const requestsPerMinute = Number.isInteger(options.requestsPerMinute) ? options.requestsPerMinute : 30;
  const maxConcurrent = Number.isInteger(options.maxConcurrent) ? Math.max(1, options.maxConcurrent) : 2;
  const state = {
    tokens: requestsPerMinute,
    lastRefill: Date.now(),
    active: 0
  };

  function refill() {
    const now = Date.now();
    const elapsedMinutes = (now - state.lastRefill) / 60000;
    if (elapsedMinutes > 0) {
      state.tokens = Math.min(requestsPerMinute, state.tokens + elapsedMinutes * requestsPerMinute);
      state.lastRefill = now;
    }
  }

  function acquire() {
    refill();
    if (state.active >= maxConcurrent) {
      return { ok: false, reason: 'concurrency' };
    }
    if (state.tokens < 1) {
      return { ok: false, reason: 'rate_limited' };
    }

    state.active += 1;
    state.tokens -= 1;

    return {
      ok: true,
      release() {
        state.active = Math.max(0, state.active - 1);
        return true;
      }
    };
  }

  return {
    acquire,
    getState() {
      refill();
      return {
        requestsPerMinute,
        maxConcurrent,
        active: state.active,
        tokens: state.tokens
      };
    }
  };
}

module.exports = {
  createRateLimiter
};
