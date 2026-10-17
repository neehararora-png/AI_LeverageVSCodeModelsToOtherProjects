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

  if (typeof dependencies.confirmModelRequest === 'function') {
    const approved = await dependencies.confirmModelRequest({
      model: chosen.id || chosen.name || request.model || '',
      messageCount: Array.isArray(request.messages) ? request.messages.length : 0
    });
    if (!approved) {
      return {
        statusCode: 403,
        payload: {
          ok: false,
          error: {
            code: 'model_request_denied',
            message: 'The model request was not approved.'
          },
          requestId: request.requestId || 'generate-request'
        }
      };
    }
  }

  const cancellationSource = typeof dependencies.cancellationTokenSourceFactory === 'function'
    ? dependencies.cancellationTokenSourceFactory()
    : null;
  let timeout = null;
  let abortListener = null;

  const cancellationResult = new Promise((resolve) => {
    if (request.signal && typeof request.signal.addEventListener === 'function') {
      abortListener = () => {
        if (cancellationSource && typeof cancellationSource.cancel === 'function') {
          cancellationSource.cancel();
        }
        resolve({
          statusCode: 499,
          payload: {
            ok: false,
            error: { code: 'client_disconnected', message: 'Request was cancelled.' },
            requestId: request.requestId || 'generate-request'
          }
        });
      };
      if (request.signal.aborted) {
        abortListener();
      } else {
        request.signal.addEventListener('abort', abortListener, { once: true });
      }
    }
    if (Number.isInteger(dependencies.requestTimeoutMs) && dependencies.requestTimeoutMs > 0) {
      timeout = setTimeout(() => {
        if (cancellationSource && typeof cancellationSource.cancel === 'function') {
          cancellationSource.cancel();
        }
        resolve({
          statusCode: 504,
          payload: {
            ok: false,
            error: { code: 'request_timeout', message: 'Model request timed out.' },
            requestId: request.requestId || 'generate-request'
          }
        });
      }, dependencies.requestTimeoutMs);
    }
  });

  try {
    const output = await Promise.race([
      Promise.resolve().then(() => generator({
        model: chosen.id || chosen.name || 'copilot',
        messages: request.messages || [],
        temperature: request.temperature,
        maxInputTokens: request.maxInputTokens,
        cancellationToken: cancellationSource?.token
      })),
      cancellationResult
    ]);

    if (output && output.statusCode) {
      return output;
    }

    return {
      ok: true,
      model: output.model || chosen.id || chosen.name || 'copilot',
      response: output.response || output.text || '',
      requestId: request.requestId || 'generate-request'
    };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (abortListener && request.signal) {
      request.signal.removeEventListener('abort', abortListener);
    }
    if (cancellationSource && typeof cancellationSource.dispose === 'function') {
      cancellationSource.dispose();
    }
  }
}

module.exports = {
  handleGenerate
};
