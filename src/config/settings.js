//@ts-check
'use strict';

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  pipeName: '',
  allowedModelFamilies: ['copilot'],
  rateLimit: {
    requestsPerMinute: 30,
    maxConcurrent: 2
  },
  requestTimeoutMs: 60000,
  idleShutdownMinutes: 30,
  audit: {
    enabled: true,
    logPrompts: false
  }
});

const PIPE_NAME_RE = /^[A-Za-z0-9_-]{1,200}$/;

function asStringArray(value, fallback) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  }
  return fallback;
}

function sanitizeSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const next = {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SETTINGS.enabled,
    pipeName: typeof source.pipeName === 'string' ? source.pipeName.trim() : DEFAULT_SETTINGS.pipeName,
    allowedModelFamilies: asStringArray(source.allowedModelFamilies, [...DEFAULT_SETTINGS.allowedModelFamilies]),
    rateLimit: {
      requestsPerMinute: Number.isInteger(source?.rateLimit?.requestsPerMinute)
        ? Math.min(Math.max(source.rateLimit.requestsPerMinute, 1), 1048576)
        : DEFAULT_SETTINGS.rateLimit.requestsPerMinute,
      maxConcurrent: Number.isInteger(source?.rateLimit?.maxConcurrent)
        ? Math.min(Math.max(source.rateLimit.maxConcurrent, 1), 100)
        : DEFAULT_SETTINGS.rateLimit.maxConcurrent
    },
    requestTimeoutMs: Number.isInteger(source.requestTimeoutMs)
      ? Math.min(Math.max(source.requestTimeoutMs, 1000), 300000)
      : DEFAULT_SETTINGS.requestTimeoutMs,
    idleShutdownMinutes: Number.isInteger(source.idleShutdownMinutes)
      ? Math.min(Math.max(source.idleShutdownMinutes, 0), 1440)
      : DEFAULT_SETTINGS.idleShutdownMinutes,
    audit: {
      enabled: typeof source?.audit?.enabled === 'boolean' ? source.audit.enabled : DEFAULT_SETTINGS.audit.enabled,
      logPrompts: typeof source?.audit?.logPrompts === 'boolean' ? source.audit.logPrompts : DEFAULT_SETTINGS.audit.logPrompts
    }
  };

  if (next.pipeName && !PIPE_NAME_RE.test(next.pipeName)) {
    next.pipeName = DEFAULT_SETTINGS.pipeName;
  }

  if (next.allowedModelFamilies.length === 0) {
    next.allowedModelFamilies = [...DEFAULT_SETTINGS.allowedModelFamilies];
  }

  return next;
}

module.exports = {
  DEFAULT_SETTINGS,
  PIPE_NAME_RE,
  sanitizeSettings
};
