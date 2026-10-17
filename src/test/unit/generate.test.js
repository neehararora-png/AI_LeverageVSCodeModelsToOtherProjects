//@ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { handleGenerate } = require('../../handlers/generate');

function dependencies(overrides = {}) {
  const state = { cancelled: 0, disposed: 0, token: { isCancellationRequested: false } };
  return {
    state,
    options: {
      availableModels: [{ id: 'gpt-4o', family: 'gpt-4o', vendor: 'copilot' }],
      confirmModelRequest: async () => true,
      cancellationTokenSourceFactory() {
        return {
          token: state.token,
          cancel() {
            state.cancelled += 1;
            state.token.isCancellationRequested = true;
          },
          dispose() { state.disposed += 1; }
        };
      },
      ...overrides
    }
  };
}

const request = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'hello' }],
  requestId: 'request-1'
};

test('generation times out, cancels its token, and releases its resources', async () => {
  const setup = dependencies({
    requestTimeoutMs: 10,
    chatClient: { generate: () => new Promise(() => {}) }
  });

  const result = await handleGenerate(request, setup.options);

  assert.equal(result.statusCode, 504);
  assert.equal(result.payload.error.code, 'request_timeout');
  assert.equal(setup.state.cancelled, 1);
  assert.equal(setup.state.disposed, 1);
});

test('client cancellation cancels an in-flight model request promptly', async () => {
  const controller = new AbortController();
  let passedToken;
  const setup = dependencies({
    chatClient: {
      generate(payload) {
        passedToken = payload.cancellationToken;
        return new Promise(() => {});
      }
    }
  });
  const pending = handleGenerate({ ...request, signal: controller.signal }, setup.options);
  setImmediate(() => controller.abort());

  const result = await pending;

  assert.equal(result.statusCode, 499);
  assert.equal(result.payload.error.code, 'client_disconnected');
  assert.equal(passedToken, setup.state.token);
  assert.equal(setup.state.cancelled, 1);
  assert.equal(setup.state.disposed, 1);
});

test('generation timeout also bounds a stalled user approval prompt', async () => {
  const setup = dependencies({
    requestTimeoutMs: 10,
    confirmModelRequest: () => new Promise(() => {}),
    chatClient: { generate: () => assert.fail('model must not run before approval') }
  });

  const result = await handleGenerate(request, setup.options);

  assert.equal(result.statusCode, 504);
  assert.equal(result.payload.error.code, 'request_timeout');
  assert.equal(setup.state.cancelled, 1);
  assert.equal(setup.state.disposed, 1);
});

test('client disconnect during approval cancels without starting generation', async () => {
  const controller = new AbortController();
  const setup = dependencies({
    confirmModelRequest: () => new Promise(() => {}),
    chatClient: { generate: () => assert.fail('model must not run after disconnect') }
  });
  const pending = handleGenerate({ ...request, signal: controller.signal }, setup.options);
  setImmediate(() => controller.abort());

  const result = await pending;

  assert.equal(result.statusCode, 499);
  assert.equal(result.payload.error.code, 'client_disconnected');
  assert.equal(setup.state.cancelled, 1);
  assert.equal(setup.state.disposed, 1);
});
