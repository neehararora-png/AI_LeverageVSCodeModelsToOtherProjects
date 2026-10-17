//@ts-check
'use strict';

const { pickModel } = require('../lm/selector');

async function handleGenerate(request = {}, dependencies = {}) {
  const modelList = Array.isArray(dependencies.availableModels) ? dependencies.availableModels : [];
  const chosen = pickModel(request.model || '', modelList, dependencies.allowedFamilies || ['copilot']);
  if (modelList.length === 0 || !chosen) {
    return {
      statusCode: 503,
      payload: {
        ok: false,
        error: {
          code: 'model_unavailable',
          message: 'No compatible language model is available.'
        },
        requestId: request.requestId || 'generate-request'
      }
    };
  }

  const generator = dependencies.chatClient && typeof dependencies.chatClient.generate === 'function'
    ? dependencies.chatClient.generate.bind(dependencies.chatClient)
    : null;

  if (!generator) {
    return {
      statusCode: 503,
      payload: {
        ok: false,
        error: {
          code: 'model_unavailable',
          message: 'No language model is available.'
        },
        requestId: request.requestId || 'generate-request'
      }
    };
  }

  const output = await generator({
    model: chosen.id || chosen.name || 'copilot',
    messages: request.messages || [],
    temperature: request.temperature,
    maxInputTokens: request.maxInputTokens
  });

  return {
    ok: true,
    model: output.model || chosen.id || chosen.name || 'copilot',
    response: output.response || output.text || '',
    requestId: request.requestId || 'generate-request'
  };
}

module.exports = {
  handleGenerate
};
