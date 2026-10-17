//@ts-check
'use strict';

const MAX_BODY_CHARS = 256 * 1024;

function buildRequestError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function parseStrictJson(rawBody, options = {}) {
  const maxChars = Number.isInteger(options.maxChars) ? Math.max(1, options.maxChars) : MAX_BODY_CHARS;
  const text = typeof rawBody === 'string' ? rawBody : String(rawBody ?? '');

  if (text.length === 0) {
    throw buildRequestError('invalid_request', 'Empty request body');
  }
  if (text.length > maxChars) {
    throw buildRequestError('payload_too_large', 'Body exceeds allowed size');
  }

  try {
    const parsed = JSON.parse(text, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    });

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw buildRequestError('invalid_request', 'Request body must be a JSON object');
    }

    return parsed;
  } catch (error) {
    if (error && error.code) {
      throw error;
    }
    throw buildRequestError('invalid_request', 'Malformed JSON body');
  }
}

function validateGenerateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw buildRequestError('invalid_request', 'Bad request body');
  }

  const allowed = new Set(['model', 'messages', 'temperature', 'maxInputTokens', 'requestId']);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw buildRequestError('invalid_request', 'Unknown fields are not allowed');
  }

  if (typeof body.model !== 'string' || body.model.trim().length === 0) {
    throw buildRequestError('invalid_request', 'Model is required');
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 64) {
    throw buildRequestError('invalid_request', 'Messages must be a non-empty array');
  }

  if (Object.prototype.hasOwnProperty.call(body, 'temperature')) {
    if (typeof body.temperature !== 'number' || Number.isNaN(body.temperature)) {
      throw buildRequestError('invalid_request', 'Temperature must be numeric');
    }
    if (body.temperature < 0 || body.temperature > 2) {
      throw buildRequestError('invalid_request', 'Temperature out of range');
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'maxInputTokens')) {
    if (!Number.isInteger(body.maxInputTokens) || body.maxInputTokens < 1 || body.maxInputTokens > 200000) {
      throw buildRequestError('invalid_request', 'maxInputTokens out of range');
    }
  }

  return body;
}

module.exports = {
  MAX_BODY_CHARS,
  buildRequestError,
  parseStrictJson,
  validateGenerateBody
};
