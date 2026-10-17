//@ts-check
'use strict';

async function listModels(vscodeLm = null) {
  if (!vscodeLm || typeof vscodeLm.selectChatModels !== 'function') {
    return [{ id: 'copilot', family: 'copilot', name: 'copilot' }];
  }
  return await vscodeLm.selectChatModels();
}

async function sendRequest(vscodeLm, payload = {}) {
  if (!vscodeLm || typeof vscodeLm.sendRequest !== 'function') {
    return {
      ok: true,
      model: payload.model || 'copilot',
      text: 'mock response'
    };
  }
  return await vscodeLm.sendRequest(payload);
}

module.exports = {
  listModels,
  sendRequest
};
