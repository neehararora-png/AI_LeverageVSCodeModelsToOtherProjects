//@ts-check
'use strict';

function buildHealthResponse({ version = '0.1.0', startedAt = Date.now(), service = 'vscode-browser-bridge', requestId = 'health-check', modelsAvailable = true } = {}) {
  const now = Date.now();
  return {
    ok: true,
    service,
    version,
    uptimeMs: Math.max(0, now - startedAt),
    modelsAvailable,
    requestId
  };
}

module.exports = {
  buildHealthResponse
};
