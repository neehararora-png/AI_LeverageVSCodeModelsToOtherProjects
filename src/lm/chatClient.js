//@ts-check
'use strict';

function buildError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createChatClient(vscodeApi = null, options = {}) {
  const vendor = typeof options.vendor === 'string' && options.vendor.trim()
    ? options.vendor.trim()
    : 'copilot';

  async function listModels() {
    if (!vscodeApi?.lm || typeof vscodeApi.lm.selectChatModels !== 'function') {
      return [];
    }
    const models = await vscodeApi.lm.selectChatModels({ vendor });
    return Array.isArray(models) ? models : [];
  }

  async function generate(payload = {}) {
    if (!vscodeApi?.LanguageModelChatMessage) {
      throw buildError('model_unavailable', 'VS Code language model API is unavailable');
    }

    const models = await listModels();
    const model = models.find((item) => item.id === payload.model);
    if (!model || typeof model.sendRequest !== 'function') {
      throw buildError('model_unavailable', 'Requested language model is unavailable');
    }

    const messages = Array.isArray(payload.messages) ? payload.messages.map((message) => {
      if (!message || typeof message.content !== 'string') {
        throw buildError('invalid_request', 'Chat messages must contain text');
      }
      if (message.role === 'user') {
        return vscodeApi.LanguageModelChatMessage.User(message.content);
      }
      if (message.role === 'assistant') {
        return vscodeApi.LanguageModelChatMessage.Assistant(message.content);
      }
      throw buildError('invalid_request', 'Only user and assistant messages are supported');
    }) : [];

    const response = await model.sendRequest(messages, {
      justification: 'A trusted local application requested a response through the VS Code bridge.'
    }, options.cancellationToken);
    if (!response || !response.text || typeof response.text[Symbol.asyncIterator] !== 'function') {
      throw buildError('model_error', 'Language model returned an unsupported response');
    }

    let text = '';
    for await (const part of response.text) {
      if (typeof part === 'string') {
        text += part;
      }
      if (text.length > (options.maxResponseChars || 1024 * 1024)) {
        throw buildError('model_error', 'Language model response exceeded the allowed size');
      }
    }

    return { model: model.id, response: text };
  }

  return { listModels, generate };
}

module.exports = {
  createChatClient
};
