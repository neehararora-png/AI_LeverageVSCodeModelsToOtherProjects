//@ts-check
'use strict';

const crypto = require('node:crypto');

const DEFAULT_REPLAY_WINDOW_MS = 120000;
const DEFAULT_REPLAY_CACHE_MAX_ENTRIES = 65536;

function createReplayNonceCache(options = {}) {
  const maxAgeMs = Number.isInteger(options.maxAgeMs) && options.maxAgeMs > 0
    ? options.maxAgeMs
    : DEFAULT_REPLAY_WINDOW_MS;
  const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries
    : DEFAULT_REPLAY_CACHE_MAX_ENTRIES;
  const seen = new Map();

  function prune(nowMs = Date.now()) {
    for (const [nonce, timestamp] of seen.entries()) {
      if (nowMs - timestamp <= maxAgeMs) {
        break;
      }
      seen.delete(nonce);
    }
  }

  return {
    add(nonce, timestamp = Date.now()) {
      if (typeof nonce !== 'string' || nonce.length === 0) {
        return false;
      }
      const receivedAt = Number.isFinite(timestamp) ? Number(timestamp) : Date.now();
      prune(receivedAt);
      if (seen.has(nonce) || seen.size >= maxEntries) {
        return false;
      }
      seen.set(nonce, receivedAt);
      return true;
    },
    has(nonce, nowMs = Date.now()) {
      if (typeof nonce !== 'string' || nonce.length === 0) {
        return true;
      }
      prune(nowMs);
      return seen.has(nonce);
    },
    get size() {
      return seen.size;
    },
    get maxEntries() {
      return maxEntries;
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
    if (!replayCache.add(nonce, nowMs)) {
      return { ok: false, code: 'invalid_request', reason: 'replay_cache_full' };
    }
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

  const replayCache = options.replayCache || null;
  const replayCheck = validateRequestHeaders(headers, { ...options, replayCache: null });
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

  if (replayCache && replayCache.has(replayCheck.nonce, options.nowMs)) {
    return { ok: false, code: 'invalid_request', reason: 'replay_nonce_reused' };
  }
  if (replayCache && typeof replayCache.add === 'function') {
    if (!replayCache.add(replayCheck.nonce, Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now())) {
      return { ok: false, code: 'invalid_request', reason: 'replay_cache_full' };
    }
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
