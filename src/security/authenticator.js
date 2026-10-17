//@ts-check
'use strict';

const crypto = require('node:crypto');

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

function authenticateRequest(headers = {}, expectedToken) {
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
  extractBearerToken,
  verifyBearerToken,
  authenticateRequest
};
