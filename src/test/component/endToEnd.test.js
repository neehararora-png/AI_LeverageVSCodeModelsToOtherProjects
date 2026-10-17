//@ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeSettings } = require('../../config/settings');
const { thePipePath } = require('../../transport/pipePath');
const { createRateLimiter } = require('../../security/rateLimiter');

const settings = sanitizeSettings({ enabled: true, pipeName: 'bridge-e2e', rateLimit: { requestsPerMinute: 10, maxConcurrent: 2 } });

test('end-to-end config and pipe name remain consistent', () => {
  assert.equal(settings.enabled, true);
  assert.equal(settings.pipeName, 'bridge-e2e');
  const pipePath = thePipePath('bridge-e2e');
  assert.ok(pipePath.includes('pipe'));
  assert.ok(pipePath.endsWith('bridge-e2e'));
});

test('rate limiter enforces concurrency and bucket limits', () => {
  const limiter = createRateLimiter({ requestsPerMinute: 2, maxConcurrent: 1 });
  const a = limiter.acquire();
  const b = limiter.acquire();
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'concurrency');
});
