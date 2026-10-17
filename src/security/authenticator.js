//@ts-check
'use strict';

const crypto = require('node:crypto');

const DEFAULT_REPLAY_WINDOW_MS = 120000;

function createReplayNonceCache(options = {}) {
  const maxAgeMs = Number.isInteger(options.maxAgeMs) ? options.maxAgeMs : DEFAULT_REPLAY_WINDOW_MS;
  const seen = new Map();

  function prune(nowMs = Date.now()) {
    for (const [nonce, timestamp] of seen.entries()) {
      if (nowMs - Number(timestamp) > maxAgeMs) {
        seen.delete(nonce);
      }
    }
  }

  return {
    add(nonce, timestamp = Date.now()) {
      if (typeof nonce !== 'string' || nonce.length === 0) {
        return false;
      }
      prune(Number(timestamp));
      seen.set(nonce, Number(timestamp));
      return true;
    },
    has(nonce, nowMs = Date.now()) {
      if (typeof nonce !== 'string' || nonce.length === 0) {
        return true;
      }
      prune(nowMs);
      return seen.has(nonce);
    },
    clear() {
      seen.clear();
      return true;
    }
  };
}

function getHeader(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return '';
  }
  const direct = headers[name];
  if (typeof direct === 'string') {
    return direct;
  }
  const lowered = name.toLowerCase();
  const candidate = headers[lowered];
  return typeof candidate === 'string' ? candidate : '';
}

function validateRequestHeaders(headers = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const replayCache = options.replayCache || null;

  if (headers.cookie || headers.Cookie || headers.origin || headers.Origin) {
    return { ok: false, code: 'invalid_request', reason: 'ambient_authority' };
  }

  const client = getHeader(headers, 'X-Bridge-Client');
  const nonce = getHeader(headers, 'X-Bridge-Nonce');
  const timestamp = getHeader(headers, 'X-Bridge-Timestamp');

  if (!client || !nonce || !timestamp) {
    return { ok: false, code: 'invalid_request', reason: 'missing_replay_headers' };
  }

  if (client.length < 1 || client.length > 128) {
    return { ok: false, code: 'invalid_request', reason: 'invalid_client' };
  }

  if (nonce.length < 1 || nonce.length > 200) {
    return { ok: false, code: 'invalid_request', reason: 'invalid_nonce' };
  }

  const parsedTs = Number(timestamp);
  if (!Number.isFinite(parsedTs) || Math.abs(nowMs - parsedTs) > DEFAULT_REPLAY_WINDOW_MS) {
    return { ok: false, code: 'invalid_request', reason: 'stale_timestamp' };
  }

  if (replayCache && typeof replayCache.has === 'function' && replayCache.has(nonce, nowMs)) {
    return { ok: false, code: 'invalid_request', reason: 'replay_nonce_reused' };
  }

  if (replayCache && typeof replayCache.add === 'function') {
    replayCache.add(nonce, parsedTs || nowMs);
  }

  return { ok: true, client, nonce, timestamp: parsedTs };
}

function extractBearerToken(headers = {}) {
  const value = headers.Authorization || headers.authorization || '';
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function verifyBearerToken(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') {
    return false;
  }

  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);

  if (left.length !== right.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function authenticateRequest(headers = {}, expectedToken, options = {}) {
  if (headers.cookie || headers.Cookie || headers.origin || headers.Origin) {
    return { ok: false, code: 'invalid_request', reason: 'ambient_authority' };
  }

  const replayCheck = validateRequestHeaders(headers, options);
  if (!replayCheck.ok) {
    return replayCheck;
  }

  const token = extractBearerToken(headers);
  if (!token) {
    return { ok: false, code: 'unauthorized', reason: 'missing_token' };
  }
  if (!verifyBearerToken(token, expectedToken || '')) {
    return { ok: false, code: 'unauthorized', reason: 'token_mismatch' };
  }
  return { ok: true, token };
}

module.exports = {
  createReplayNonceCache,
  validateRequestHeaders,
  extractBearerToken,
  verifyBearerToken,
  authenticateRequest
};
