//@ts-check
'use strict';

const crypto = require('node:crypto');
const { dispatch } = require('../dispatch/dispatch');
const { buildHealthResponse } = require('../handlers/health');
const { handleGenerate } = require('../handlers/generate');
const { parseStrictJson, validateGenerateBody } = require('../security/guards');
const { createRateLimiter } = require('../security/rateLimiter');
const { authenticateRequest, createReplayNonceCache } = require('../security/authenticator');
const { matchesAllowed } = require('../lm/selector');

function readBoundedBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    request.on('data', (chunk) => {
      if (settled) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBodyBytes) {
        chunks.length = 0;
        if (typeof request.pause === 'function') {
          request.pause();
        }
        const error = new Error('Request body exceeds allowed size');
        error.code = 'payload_too_large';
        rejectOnce(error);
        return;
      }
      chunks.push(buffer);
    });

    request.on('end', () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    request.on('error', rejectOnce);
    request.on('aborted', () => {
      const error = new Error('Request body was aborted');
      error.code = 'invalid_request';
      rejectOnce(error);
    });
  });
}

function createBridgeRequestHandler(options = {}) {
  const maxBodyBytes = Number.isInteger(options.maxBodyBytes) ? Math.max(1, options.maxBodyBytes) : 256 * 1024;
  const replayCache = options.replayCache || createReplayNonceCache();
  const rateLimiter = options.rateLimiter || createRateLimiter(options.rateLimit || {});
  const auditLog = options.auditLog && typeof options.auditLog.writeEntry === 'function'
    ? options.auditLog
    : null;
  const expectedToken = typeof options.expectedToken === 'string' ? options.expectedToken : '';
  const startedAt = Number.isFinite(options.startedAt) ? options.startedAt : Date.now();
  const chatClient = options.chatClient;
  const getAvailableModels = async () => {
    if (Array.isArray(options.availableModels)) {
      return options.availableModels;
    }
    if (chatClient && typeof chatClient.listModels === 'function') {
      const models = await chatClient.listModels();
      return Array.isArray(models) ? models : [];
    }
    return [];
  };

  const dependencies = {
    expectedToken,
    authenticator: options.authenticator || {
      authenticateRequest(headers, expected) {
        return authenticateRequest(headers, expected, { replayCache });
      }
    },
    onAuthenticatedRequest: options.onActivity,
    rateLimiter,
    validateBody(rawBody) {
      return validateGenerateBody(parseStrictJson(rawBody, { maxChars: maxBodyBytes }));
    },
    handlers: {
      async '/v1/health'({ requestId }) {
        const availableModels = await getAvailableModels();
        const modelsAvailable = availableModels.some((model) => matchesAllowed([
          model.id,
          model.name,
          model.family,
          model.vendor
        ].filter(Boolean).join(' '), options.allowedModelFamilies || ['copilot']));
        return {
          statusCode: 200,
          payload: buildHealthResponse({
            startedAt,
            requestId,
            modelsAvailable
          })
        };
      },
      async '/v1/models'({ requestId }) {
        const availableModels = await getAvailableModels();
        const models = availableModels.filter((model) => matchesAllowed([
          model.id,
          model.name,
          model.family,
          model.vendor
        ].filter(Boolean).join(' '), options.allowedModelFamilies || ['copilot']))
          .map((model) => ({
            id: String(model.id || model.name || ''),
            name: String(model.name || model.id || ''),
            family: String(model.family || ''),
            vendor: String(model.vendor || '')
          }));
        return { statusCode: 200, payload: { ok: true, models, requestId } };
      },
      async '/v1/generate'({ body, requestId }) {
        const availableModels = await getAvailableModels();
        return handleGenerate({ ...body, requestId }, {
          availableModels,
          allowedFamilies: options.allowedModelFamilies,
          chatClient,
          confirmModelRequest: options.confirmModelRequest
        });
      }
    }
  };

  return async function handleHttpRequest(request, response) {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let pathname = '/';
    const respond = (statusCode, payload, headers = {}) => {
      const responseBytes = writeJson(response, statusCode, payload, headers);
      if (auditLog && responseBytes !== null) {
        try {
          auditLog.writeEntry({
            requestId,
            endpoint: pathname,
            outcome: statusCode < 400 ? 'ok' : 'error',
            durationMs: Math.max(0, Date.now() - startedAt),
            responseBytes
          });
        } catch (error) {
          if (typeof options.onAuditError === 'function') {
            options.onAuditError(error);
          }
        }
      }
    };

    try {
      pathname = new URL(request.url || '/', 'http://localhost').pathname;
    } catch {
      respond(400, { ok: false, error: { code: 'invalid_request', message: 'Invalid request.', requestId } });
      return;
    }

    const method = String(request.method || 'GET').toUpperCase();
    const allowedMethod = pathname === '/v1/health' || pathname === '/v1/models'
      ? 'GET'
      : pathname === '/v1/generate' ? 'POST' : null;
    if (allowedMethod && method !== allowedMethod) {
      respond(405, {
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

      respond(result.statusCode, result.payload, result.headers);
    } catch {
      respond(500, {
        ok: false,
        error: { code: 'internal_error', message: 'Request could not be completed.', requestId }
      });
    }
  };
}

function writeJson(response, statusCode, payload, headers = {}) {
  if (response.headersSent || response.destroyed) {
    return null;
  }
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  response.end(body);
  return Buffer.byteLength(body, 'utf8');
}

module.exports = {
  createBridgeRequestHandler,
  readBoundedBody
};