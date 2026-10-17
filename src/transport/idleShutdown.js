//@ts-check
'use strict';

function createIdleShutdown(server, options = {}) {
  const minutes = Number.isInteger(options.idleShutdownMinutes) ? options.idleShutdownMinutes : 30;

  let timer = null;

  function reset() {
    if (timer) {
      clearTimeout(timer);
    }
    if (minutes <= 0) {
      return;
    }
    timer = setTimeout(() => {
      if (server && typeof server.close === 'function') {
        server.close();
      }
    }, minutes * 60 * 1000);
  }

  function stop() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    reset,
    stop
  };
}

module.exports = {
  createIdleShutdown
};
