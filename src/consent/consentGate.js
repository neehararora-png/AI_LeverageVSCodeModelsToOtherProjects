//@ts-check
'use strict';

function hasConsent(state = {}, version = '') {
  if (!state || typeof state !== 'object') {
    return false;
  }
  return Boolean(state[version]);
}

function recordConsent(state = {}, version = '', allowed = true) {
  const next = { ...(state || {}) };
  if (version) {
    next[version] = Boolean(allowed);
  }
  return next;
}

function shouldPrompt(state = {}, version = '') {
  return !hasConsent(state, version);
}

module.exports = {
  hasConsent,
  recordConsent,
  shouldPrompt
};
