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
const { extractBearerToken, authenticateRequest, validateRequestHeaders, createReplayNonceCache } = require('../../security/authenticator');
const { redactSecret } = require('../../security/redact');
const { activate } = require('../../extension');
const { createPipeServer } = require('../../transport/pipeServer');

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

test('validateRequestHeaders rejects missing replay state and keeps a fresh nonce valid', () => {
  const now = Date.now();
  const valid = validateRequestHeaders({
    Authorization: 'Bearer test-token',
    'X-Bridge-Client': 'client-123',
    'X-Bridge-Nonce': 'nonce-123',
    'X-Bridge-Timestamp': String(now)
  }, { nowMs: now });

  assert.equal(valid.ok, true);

  const missingNonce = validateRequestHeaders({
    Authorization: 'Bearer test-token',
    'X-Bridge-Client': 'client-123',
    'X-Bridge-Timestamp': String(now)
  }, { nowMs: now });

  assert.equal(missingNonce.ok, false);
  assert.equal(missingNonce.code, 'invalid_request');

  const replayCache = createReplayNonceCache({ maxAgeMs: 120000 });
  replayCache.add('nonce-123', now);
  const reused = validateRequestHeaders({
    Authorization: 'Bearer test-token',
    'X-Bridge-Client': 'client-123',
    'X-Bridge-Nonce': 'nonce-123',
    'X-Bridge-Timestamp': String(now)
  }, { nowMs: now, replayCache });

  assert.equal(reused.ok, false);
  assert.equal(reused.code, 'invalid_request');
});

test('authenticateRequest enforces bearer token and replay cache semantics', () => {
  const now = Date.now();
  const token = 'token-123';
  const replayCache = createReplayNonceCache({ maxAgeMs: 120000 });

  const first = authenticateRequest({
    Authorization: `Bearer ${token}`,
    'X-Bridge-Client': 'client-123',
    'X-Bridge-Nonce': 'nonce-456',
    'X-Bridge-Timestamp': String(now)
  }, token, { nowMs: now, replayCache });

  assert.equal(first.ok, true);

  const second = authenticateRequest({
    Authorization: `Bearer ${token}`,
    'X-Bridge-Client': 'client-123',
    'X-Bridge-Nonce': 'nonce-456',
    'X-Bridge-Timestamp': String(now)
  }, token, { nowMs: now, replayCache });

  assert.equal(second.ok, false);
  assert.equal(second.code, 'invalid_request');
});

test('pipe server sets slow-request timeout values and binds via named-pipe path', async () => {
  const pipe = thePipePath(`bridge-timeout-${Date.now()}`);
  const server = createPipeServer({
    pipePath: pipe,
    requestHandler(req, res) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    },
    onError(error) {
      if (error && error.code !== 'EACCES') {
        assert.ifError(error);
      }
    }
  });

  assert.equal(server.server.headersTimeout, 30000);
  assert.equal(server.server.requestTimeout, 30000);
  assert.equal(server.server.keepAliveTimeout, 15000);

  try {
    await server.listen();
  } catch (error) {
    if (error && error.code === 'EACCES') {
      return;
    }
    throw error;
  }

  await new Promise((resolve, reject) => {
    const req = require('node:http').request({ socketPath: pipe, path: '/', method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        assert.equal(res.statusCode, 200);
        assert.match(body, /"ok"\s*:\s*true/);
        resolve();
      });
    });
    req.on('error', reject);
    req.end();
  });

  await server.close();
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
