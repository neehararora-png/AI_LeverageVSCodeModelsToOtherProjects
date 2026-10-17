//@ts-check
'use strict';

const crypto = require('node:crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function verifyToken(candidate, expected) {
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

function createTokenManager(storage = null) {
  const fallback = {
    async get() {
      return null;
    },
    async set() {
      return undefined;
    },
    async delete() {
      return undefined;
    }
  };

  const store = storage || fallback;
  let cachedToken = null;

  async function getToken() {
    if (typeof store.get === 'function') {
      const value = await store.get('vscode-browser-bridge-token');
      if (typeof value === 'string' && value.length > 0) {
        cachedToken = value;
        return value;
      }
    }
    return cachedToken;
  }

  async function setToken(value) {
    cachedToken = value;
    if (typeof store.set === 'function') {
      await store.set('vscode-browser-bridge-token', value);
    }
    return value;
  }

  async function rotateToken() {
    const next = generateToken();
    await setToken(next);
    return next;
  }

  async function verifyStoredToken(candidate) {
    const expected = await getToken();
    return verifyToken(candidate, expected || '');
  }

  return {
    generateToken,
    verifyToken,
    getToken,
    setToken,
    rotateToken,
    verifyStoredToken
  };
}

module.exports = {
  generateToken,
  verifyToken,
  createTokenManager
};
