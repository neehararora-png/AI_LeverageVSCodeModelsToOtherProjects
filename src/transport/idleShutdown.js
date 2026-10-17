//@ts-check
'use strict';

function createIdleShutdown(server, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(0, Number(options.timeoutMs))
    : (Number.isInteger(options.idleShutdownMinutes) ? Math.max(0, options.idleShutdownMinutes) : 30) * 60 * 1000;

  let timer = null;
  let stopped = false;
  let shutdownPromise = null;

  function reset() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (stopped || timeoutMs <= 0 || shutdownPromise) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      if (!server || typeof server.close !== 'function') {
        return;
      }
      shutdownPromise = Promise.resolve().then(() => server.close()).then(() => {
        if (typeof options.onShutdown === 'function') {
          options.onShutdown();
        }
      }).catch((error) => {
        if (typeof options.onError === 'function') {
          options.onError(error);
        }
      }).finally(() => {
        shutdownPromise = null;
        stopped = true;
      });
    }, timeoutMs);
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    reset,
    stop,
    isPending() {
      return timer !== null;
    }
  };
}

module.exports = {
  createIdleShutdown
};
