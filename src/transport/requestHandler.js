//@ts-check
'use strict';

const crypto = require('node:crypto');
const { dispatch } = require('../dispatch/dispatch');
const { buildHealthResponse } = require('../handlers/health');
const { handleGenerate } = require('../handlers/generate');
const { parseStrictJson, validateGenerateBody } = require('../security/guards');
const { createRateLimiter } = require('../security/rateLimiter');
const { authenticateRequest, createReplayNonceCache } = require('../security/authenticator');

function readBoundedBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let oversized = false;

    request.on('data', (chunk) => {
      if (oversized) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBodyBytes) {
        oversized = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buffer);
    });

    request.on('end', () => {
      if (oversized) {
        const error = new Error('Request body exceeds allowed size');
        error.code = 'payload_too_large';
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    request.on('error', reject);
    request.on('aborted', () => {
      const error = new Error('Request body was aborted');
      error.code = 'invalid_request';
      reject(error);
    });
  });
}

function createBridgeRequestHandler(options = {}) {
  const maxBodyBytes = Number.isInteger(options.maxBodyBytes) ? Math.max(1, options.maxBodyBytes) : 256 * 1024;
  const replayCache = options.replayCache || createReplayNonceCache();
  const rateLimiter = options.rateLimiter || createRateLimiter(options.rateLimit || {});
  const expectedToken = typeof options.expectedToken === 'string' ? options.expectedToken : '';
  const startedAt = Number.isFinite(options.startedAt) ? options.startedAt : Date.now();
  const availableModels = Array.isArray(options.availableModels) ? options.availableModels : [];

  const dependencies = {
    expectedToken,
    authenticator: options.authenticator || {
      authenticateRequest(headers, expected) {
        return authenticateRequest(headers, expected, { replayCache });
      }
    },
    rateLimiter,
    validateBody(rawBody) {
      return validateGenerateBody(parseStrictJson(rawBody, { maxChars: maxBodyBytes }));
    },
    handlers: {
      '/v1/health'({ requestId }) {
        return {
          statusCode: 200,
          payload: buildHealthResponse({
            startedAt,
            requestId,
            modelsAvailable: availableModels.length > 0
          })
        };
      },
      '/v1/generate'({ body, requestId }) {
        return handleGenerate({ ...body, requestId }, {
          availableModels,
          allowedFamilies: options.allowedModelFamilies,
          chatClient: options.chatClient
        });
      }
    }
  };

  return async function handleHttpRequest(request, response) {
    const requestId = crypto.randomUUID();
    let pathname = '/';
    try {
      pathname = new URL(request.url || '/', 'http://localhost').pathname;
    } catch {
      writeJson(response, 400, { ok: false, error: { code: 'invalid_request', message: 'Invalid request.', requestId } });
      return;
    }

    const method = String(request.method || 'GET').toUpperCase();
    const allowedMethod = pathname === '/v1/health' ? 'GET' : pathname === '/v1/generate' ? 'POST' : null;
    if (allowedMethod && method !== allowedMethod) {
      writeJson(response, 405, {
        ok: false,
        error: { code: 'method_not_allowed', message: 'Method not allowed.', requestId }
      }, { Allow: allowedMethod });
      return;
    }

    try {
      const result = await dispatch({
        method,
        pathname,
        headers: request.headers,
        requestId,
        readBody: () => {
          const contentType = String(request.headers?.['content-type'] || request.headers?.['Content-Type'] || '');
          if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
            const error = new Error('Expected JSON content type');
            error.code = 'invalid_request';
            throw error;
          }
          return readBoundedBody(request, maxBodyBytes);
        }
      }, dependencies);

      writeJson(response, result.statusCode, result.payload, result.headers);
    } catch {
      writeJson(response, 500, {
        ok: false,
        error: { code: 'internal_error', message: 'Request could not be completed.', requestId }
      });
    }
  };
}

function writeJson(response, statusCode, payload, headers = {}) {
  if (response.headersSent || response.destroyed) {
    return;
  }
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  response.end(JSON.stringify(payload));
}

module.exports = {
  createBridgeRequestHandler,
  readBoundedBody
};