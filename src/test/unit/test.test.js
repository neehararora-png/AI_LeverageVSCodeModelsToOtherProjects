//@ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeSettings } = require('../../config/settings');
const { derivePipeName, thePipePath } = require('../../transport/pipePath');
const { createTokenManager, generateToken } = require('../../security/tokenManager');
const { createRateLimiter } = require('../../security/rateLimiter');
const { parseStrictJson, validateGenerateBody } = require('../../security/guards');
const { dispatch } = require('../../dispatch/dispatch');
const { createStatusBar } = require('../../ui/statusBar');
const { hasConsent, recordConsent } = require('../../consent/consentGate');
const { createAuditLog } = require('../../audit/auditLog');
const { pickModel } = require('../../lm/selector');
const { extractBearerToken } = require('../../security/authenticator');
const { redactSecret } = require('../../security/redact');
const { activate } = require('../../extension');

const fakeStorage = {
  values: new Map(),
  async get(key) {
    return this.values.get(key) || null;
  },
  async set(key, value) {
    this.values.set(key, value);
    return value;
  }
};

test('settings sanitize with safe defaults', () => {
  const settings = sanitizeSettings({ enabled: 'yes', rateLimit: { requestsPerMinute: 0, maxConcurrent: 0 }, pipeName: '../bad' });
  assert.equal(settings.enabled, false);
  assert.equal(settings.rateLimit.requestsPerMinute, 1);
  assert.equal(settings.rateLimit.maxConcurrent, 1);
  assert.equal(settings.pipeName, '');
});

test('pipe name derivation is stable and safe', () => {
  const derived = derivePipeName('machine-name');
  assert.ok(derived.startsWith('vscode-browser-bridge-'));
  const pathA = thePipePath('bridge-test');
  assert.ok(pathA.includes('pipe'));
  assert.ok(pathA.endsWith('bridge-test'));
  assert.doesNotThrow(() => thePipePath('my_bridge-1'));
});

test('token manager generates and verifies tokens', async () => {
  const manager = createTokenManager(fakeStorage);
  const token = await manager.rotateToken();
  assert.ok(token.length > 20);
  assert.equal(await manager.verifyStoredToken(token), true);
  assert.equal(await manager.verifyStoredToken('bad-token'), false);
});

test('rate limiter checks concurrency before spending a rate token', () => {
  const limiter = createRateLimiter({ requestsPerMinute: 1, maxConcurrent: 1 });
  const first = limiter.acquire();
  const second = limiter.acquire();
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'concurrency');
});

test('guards reject invalid JSON and unknown fields', () => {
  const parsed = parseStrictJson('{"model":"copilot","messages":[{"role":"user","content":"hi"}]}');
  assert.equal(parsed.model, 'copilot');
  assert.throws(() => parseStrictJson('not-json'));
  const validated = validateGenerateBody({ model: 'copilot', messages: [{ role: 'user', content: 'hello' }], temperature: 0.5 });
  assert.equal(validated.model, 'copilot');
  assert.throws(() => validateGenerateBody({ model: 'copilot', messages: [{ role: 'user', content: 'hello' }], extra: true }));
});

test('dispatch enforces route and auth order', () => {
  const result = dispatch({
    method: 'GET',
    pathname: '/health',
    headers: { Authorization: 'Bearer secret' },
    requestId: 'abc'
  }, {
    expectedToken: 'secret',
    authenticator: {
      authenticateRequest(headers, expected) {
        return headers.Authorization === `Bearer ${expected}` ? { ok: true } : { ok: false, code: 'unauthorized' };
      }
    },
    handlers: {
      '/health': () => ({ statusCode: 200, payload: { ok: true, service: 'bridge' } })
    },
    validateBody: null,
    rateLimiter: { acquire() { return { ok: true, release() { return true; } }; } }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
});

test('status bar and consent gate track visible state', () => {
  const status = createStatusBar();
  assert.equal(status.getState(), 'off');
  status.setState('listening');
  assert.equal(status.getState(), 'listening');

  let state = {};
  state = recordConsent(state, '1.0.0', true);
  assert.equal(hasConsent(state, '1.0.0'), true);
  assert.equal(hasConsent(state, '2.0.0'), false);
});

test('audit log and model selector work predictably', () => {
  const audit = createAuditLog('.audit-test');
  const entry = audit.writeEntry({ requestId: 'r1', endpoint: '/v1/health', outcome: 'ok', durationMs: 10, responseBytes: 5 });
  assert.ok(entry.filePath.includes('.audit-test'));

  const picked = pickModel('copilot-gpt4o', [{ id: 'gpt-4o', family: 'copilot' }], ['copilot']);
  assert.equal(picked.id, 'gpt-4o' || picked.id, true);
  assert.equal(extractBearerToken({ Authorization: 'Bearer abc123' }), 'abc123');
  assert.match(redactSecret('verysecretvalue'), /\*\*\*/);
});

test('extension activation registers lifecycle commands when VS Code is present', () => {
  const subscriptions = [];
  const commands = new Map();
  const fakeVscode = {
    commands: {
      registerCommand(id, handler) {
        commands.set(id, handler);
        const disposable = { dispose() { commands.delete(id); } };
        subscriptions.push(disposable);
        return disposable;
      }
    },
    window: {
      createStatusBarItem() {
        return {
          text: '',
          command: '',
          show() {},
          hide() {},
          dispose() {}
        };
      }
    }
  };

  const result = activate({ subscriptions }, fakeVscode);
  assert.equal(result.bridge.isActive, true);
  assert.equal(typeof commands.get('vscode-browser-bridge.start'), 'function');
  assert.equal(typeof commands.get('vscode-browser-bridge.stop'), 'function');
  assert.ok(subscriptions.length >= 1);
});
