//@ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const { createBridgeRequestHandler } = require('../../transport/requestHandler');

async function send(handler, method, url, headers = {}, body = '') {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  request.method = method;
  request.url = url;
  request.headers = headers;

  const response = {
    headersSent: false,
    destroyed: false,
    writeHead(statusCode, responseHeaders) {
      this.statusCode = statusCode;
      this.headers = responseHeaders;
      this.headersSent = true;
    },
    end(responseBody) {
      this.body = JSON.parse(responseBody);
    }
  };

  await handler(request, response);
  return response;
}

function authHeaders(nonce, token = 'test-token') {
  return {
    Authorization: `Bearer ${token}`,
    'X-Bridge-Client': 'component-test',
    'X-Bridge-Nonce': nonce,
    'X-Bridge-Timestamp': String(Date.now())
  };
}

test('request handler serves authenticated health and awaits generate routes', async () => {
  const limiter = {
    active: 0,
    acquire() {
      this.active += 1;
      return { ok: true, release: () => { this.active -= 1; } };
    }
  };
  const handler = createBridgeRequestHandler({
    expectedToken: 'test-token',
    availableModels: [{ id: 'gpt-4o', family: 'copilot' }],
    confirmModelRequest: async (request) => request.messageCount === 1,
    rateLimiter: limiter,
    chatClient: {
      async generate(payload) {
        assert.equal(limiter.active, 1);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { model: payload.model, response: 'model output' };
      }
    }
  });
  const health = await send(handler, 'GET', '/v1/health', authHeaders('health-nonce'));
  assert.equal(health.statusCode, 200);
  assert.equal(health.headers['Cache-Control'], 'no-store');
  assert.equal(health.body.ok, true);
  assert.equal(typeof health.body.requestId, 'string');

  const modelList = await send(handler, 'GET', '/v1/models', authHeaders('models-nonce'));
  assert.equal(modelList.statusCode, 200);
  assert.deepEqual(modelList.body.models.map((model) => model.id), ['gpt-4o']);

  const generate = await send(handler, 'POST', '/v1/generate', {
    ...authHeaders('generate-nonce'),
    'Content-Type': 'application/json'
  }, JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }));
  assert.equal(generate.statusCode, 200);
  assert.equal(generate.body.response, 'model output');
  assert.equal(generate.body.model, 'gpt-4o');
  assert.equal(limiter.active, 0);

  const unauthorized = await send(handler, 'GET', '/v1/health', authHeaders('unauthorized-nonce', 'wrong-token'));
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.error.code, 'unauthorized');

  const wrongMethod = await send(handler, 'POST', '/v1/health', authHeaders('method-nonce'));
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.Allow, 'GET');
});

test('request handler rejects oversized generate bodies with 413', async () => {
  const handler = createBridgeRequestHandler({
    expectedToken: 'test-token',
    maxBodyBytes: 32
  });
  const result = await send(handler, 'POST', '/v1/generate', {
    ...authHeaders('oversized-nonce'),
    'Content-Type': 'application/json'
  }, JSON.stringify({ model: 'copilot', messages: [{ role: 'user', content: 'this body is over the configured limit' }] }));
  assert.equal(result.statusCode, 413);
  assert.equal(result.body.error.code, 'payload_too_large');
});

test('request handler reports unavailable model instead of returning mock output', async () => {
  const handler = createBridgeRequestHandler({ expectedToken: 'test-token' });
  const result = await send(handler, 'POST', '/v1/generate', {
    ...authHeaders('no-model-nonce'),
    'Content-Type': 'application/json'
  }, JSON.stringify({ model: 'copilot', messages: [{ role: 'user', content: 'hello' }] }));

  assert.equal(result.statusCode, 503);
  assert.equal(result.body.error.code, 'model_unavailable');
  assert.notEqual(result.body.response, 'Generated response');
});

test('request handler requires explicit user approval before model generation', async () => {
  let generationCount = 0;
  const handler = createBridgeRequestHandler({
    expectedToken: 'test-token',
    availableModels: [{ id: 'gpt-4o', family: 'gpt-4o', vendor: 'copilot' }],
    confirmModelRequest: async () => false,
    chatClient: {
      async generate() {
        generationCount += 1;
        return { model: 'gpt-4o', response: 'should not run' };
      }
    }
  });
  const result = await send(handler, 'POST', '/v1/generate', {
    ...authHeaders('denied-model-request'),
    'Content-Type': 'application/json'
  }, JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }));

  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, 'model_request_denied');
  assert.equal(generationCount, 0);
});