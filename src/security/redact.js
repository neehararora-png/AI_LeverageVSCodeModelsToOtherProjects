//@ts-check
'use strict';

function redactSecret(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return '[redacted]';
  }
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return '***';
  }
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

function redactHeaders(headers = {}) {
  const next = { ...headers };
  for (const key of Object.keys(next)) {
    if (/token|authorization|secret|key/i.test(key)) {
      next[key] = redactSecret(String(next[key]));
    }
  }
  return next;
}

module.exports = {
  redactSecret,
  redactHeaders
};
