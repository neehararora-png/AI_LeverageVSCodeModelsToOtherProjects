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
  assert.ok(pathA.startsWith('\\\\.\\pipe\\'));
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

test('token manager supports VS Code SecretStorage store semantics', async () => {
  const values = new Map();
  const secretStorage = {
    async get(key) { return values.get(key) || undefined; },
    async store(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); }
  };
  const manager = createTokenManager(secretStorage);

  const token = await manager.rotateToken();
  assert.equal(await secretStorage.get('vscode-browser-bridge-token'), token);
  assert.equal(await manager.verifyStoredToken(token), true);
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

test('dispatch enforces route and auth order', async () => {
  const result = await dispatch({
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

test('model selection honors explicit families and never falls back outside the allowlist', () => {
  const available = [
    { id: 'gpt-4o', family: 'gpt-4o', vendor: 'copilot' },
    { id: 'external-chat', family: 'external', vendor: 'third-party' }
  ];
  assert.equal(pickModel('gpt-4o', available, ['copilot']).id, 'gpt-4o');
  assert.equal(pickModel('external-chat', available, ['copilot']).id, 'gpt-4o');
  assert.equal(pickModel('external-chat', [available[1]], ['copilot']), null);
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

test('invalid bearer tokens do not reserve replay nonces', () => {
  const now = Date.now();
  const replayCache = createReplayNonceCache({ maxAgeMs: 120000 });
  const headers = {
    Authorization: 'Bearer wrong-token',
    'X-Bridge-Client': 'client-123',
    'X-Bridge-Nonce': 'nonce-after-invalid-token',
    'X-Bridge-Timestamp': String(now)
  };

  const rejected = authenticateRequest(headers, 'expected-token', { nowMs: now, replayCache });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'unauthorized');

  headers.Authorization = 'Bearer expected-token';
  const accepted = authenticateRequest(headers, 'expected-token', { nowMs: now, replayCache });
  assert.equal(accepted.ok, true);
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
  assert.equal(result.bridge.isActive, false);
  assert.equal(typeof commands.get('vscode-browser-bridge.start'), 'function');
  assert.equal(typeof commands.get('vscode-browser-bridge.stop'), 'function');
  assert.equal(typeof commands.get('vscode-browser-bridge.copyToken'), 'function');
  assert.equal(typeof commands.get('vscode-browser-bridge.disable'), 'function');
  assert.ok(subscriptions.length >= 1);
});

test('extension lifecycle starts and closes its named-pipe server idempotently', async () => {
  const commands = new Map();
  const calls = [];
  const fakeVscode = {
    commands: {
      registerCommand(id, handler) {
        commands.set(id, handler);
        return { dispose() { commands.delete(id); } };
      }
    }
  };

  const result = activate({
    subscriptions: [],
    globalState: {
      get() { return { [require('../../../package.json').version]: true }; },
      async update() {}
    },
    secrets: {
      values: new Map(),
      async get(key) { return this.values.get(key); },
      async store(key, value) { this.values.set(key, value); },
      async delete(key) { this.values.delete(key); }
    }
  }, fakeVscode, {
    pipePath: '\\\\.\\pipe\\bridge-lifecycle-test',
    serverFactory(options) {
      calls.push({ type: 'create', pipePath: options.pipePath, requestHandler: options.requestHandler });
      return {
        async listen() { calls.push({ type: 'listen' }); },
        async close() { calls.push({ type: 'close' }); }
      };
    }
  });

  assert.equal(result.statusBar.getState(), 'off');
  await commands.get('vscode-browser-bridge.start')();
  await commands.get('vscode-browser-bridge.start')();
  assert.equal(result.statusBar.getState(), 'listening');
  assert.equal(calls.filter((call) => call.type === 'listen').length, 1);
  assert.equal(calls[0].pipePath, '\\\\.\\pipe\\bridge-lifecycle-test');
  assert.equal(typeof calls[0].requestHandler, 'function');

  await commands.get('vscode-browser-bridge.stop')();
  assert.equal(result.statusBar.getState(), 'off');
  assert.equal(calls.filter((call) => call.type === 'close').length, 1);
});

test('bridge requires modal consent and disable revokes its SecretStorage token', async () => {
  const commands = new Map();
  const stored = new Map();
  const globalValues = new Map();
  const clipboard = { value: '' };
  const prompts = ['Not now', 'Enable Bridge'];
  let listenCount = 0;
  let closeCount = 0;
  const fakeVscode = {
    commands: {
      registerCommand(id, handler) {
        commands.set(id, handler);
        return { dispose() { commands.delete(id); } };
      }
    },
    window: {
      async showWarningMessage(_message, options, ...items) {
        assert.equal(options.modal, true);
        assert.equal(items[0], 'Enable Bridge');
        return prompts.shift();
      },
      async showInformationMessage() {}
    },
    env: { clipboard: { async writeText(value) { clipboard.value = value; } } }
  };
  const context = {
    subscriptions: [],
    globalState: {
      get(key, fallback) { return globalValues.has(key) ? globalValues.get(key) : fallback; },
      async update(key, value) { globalValues.set(key, value); }
    },
    secrets: {
      async get(key) { return stored.get(key); },
      async store(key, value) { stored.set(key, value); },
      async delete(key) { stored.delete(key); }
    }
  };
  const result = activate(context, fakeVscode, {
    pipePath: '\\\\.\\pipe\\bridge-consent-test',
    serverFactory() {
      return {
        async listen() { listenCount += 1; },
        async close() { closeCount += 1; }
      };
    }
  });

  const denied = await commands.get('vscode-browser-bridge.start')();
  assert.equal(denied.ok, false);
  assert.equal(listenCount, 0);

  const started = await commands.get('vscode-browser-bridge.start')();
  assert.equal(started.ok, true);
  assert.equal(listenCount, 1);
  const token = await context.secrets.get('vscode-browser-bridge-token');
  assert.ok(token);

  const copied = await commands.get('vscode-browser-bridge.copyToken')();
  assert.equal(copied.ok, true);
  assert.equal(clipboard.value, token);

  await commands.get('vscode-browser-bridge.disable')();
  assert.equal(closeCount, 1);
  assert.equal(await context.secrets.get('vscode-browser-bridge-token'), undefined);
});

test('idle timeout closes the listener and updates bridge state', async () => {
  const commands = new Map();
  let closeCount = 0;
  const fakeVscode = {
    commands: {
      registerCommand(id, handler) {
        commands.set(id, handler);
        return { dispose() { commands.delete(id); } };
      }
    },
    window: {
      async showWarningMessage() { return 'Enable Bridge'; }
    }
  };
  const context = {
    subscriptions: [],
    globalState: {
      get() { return { [require('../../../package.json').version]: true }; },
      async update() {}
    },
    secrets: {
      values: new Map(),
      async get(key) { return this.values.get(key); },
      async store(key, value) { this.values.set(key, value); },
      async delete(key) { this.values.delete(key); }
    }
  };
  const result = activate(context, fakeVscode, {
    pipePath: '\\\\.\\pipe\\bridge-idle-test',
    idleShutdownTimeoutMs: 5,
    serverFactory() {
      return {
        async listen() {},
        async close() { closeCount += 1; }
      };
    }
  });

  await commands.get('vscode-browser-bridge.start')();
  assert.equal(result.bridge.isActive, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(closeCount, 1);
  assert.equal(result.bridge.isActive, false);
  assert.equal(result.statusBar.getState(), 'off');
});
