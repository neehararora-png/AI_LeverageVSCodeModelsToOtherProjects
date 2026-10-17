//@ts-check
'use strict';

const { pickModel } = require('../lm/selector');

async function handleGenerate(request = {}, dependencies = {}) {
  const modelList = Array.isArray(dependencies.availableModels) ? dependencies.availableModels : [];
  const chosen = pickModel(request.model || '', modelList, dependencies.allowedFamilies || ['copilot']);
  const generator = dependencies.chatClient && typeof dependencies.chatClient.generate === 'function'
    ? dependencies.chatClient.generate.bind(dependencies.chatClient)
    : async () => ({
        ok: true,
        model: chosen.id || chosen.name || 'copilot',
        response: 'Generated response'
      });

  const output = await generator({
    model: chosen.id || chosen.name || 'copilot',
    messages: request.messages || [],
    temperature: request.temperature,
    maxInputTokens: request.maxInputTokens
  });

  return {
    ok: true,
    model: output.model || chosen.id || chosen.name || 'copilot',
    response: output.response || output.text || 'Generated response',
    requestId: request.requestId || 'generate-request'
  };
}

module.exports = {
  handleGenerate
};
