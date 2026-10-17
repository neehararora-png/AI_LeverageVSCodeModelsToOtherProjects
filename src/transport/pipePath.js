//@ts-check
'use strict';

const crypto = require('node:crypto');
const os = require('node:os');

const PIPE_NAME_RE = /^[A-Za-z0-9_-]{1,200}$/;

function derivePipeName(hostname = os.hostname()) {
  const hash = crypto.createHash('sha256').update(String(hostname || 'vscode-bridge')).digest('hex').slice(0, 16);
  return `vscode-browser-bridge-${hash}`;
}

function buildPipeName(override = '') {
  const value = typeof override === 'string' ? override.trim() : '';
  if (!value) {
    return derivePipeName();
  }

  if (!PIPE_NAME_RE.test(value)) {
    return derivePipeName();
  }

  return value;
}

function thePipePath(override = '') {
  const name = buildPipeName(override);
  if (!PIPE_NAME_RE.test(name)) {
    throw new Error('Unsafe pipe name');
  }
  return `\\.\\pipe\\${name}`;
}

module.exports = {
  PIPE_NAME_RE,
  derivePipeName,
  buildPipeName,
  thePipePath
};
