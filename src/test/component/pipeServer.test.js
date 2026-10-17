//@ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createPipeServer } = require('../../transport/pipeServer');
const { thePipePath } = require('../../transport/pipePath');

test('pipe server serves a request on a named pipe', async () => {
  const pipe = thePipePath(`bridge-test-${Date.now()}`);
  const server = createPipeServer({
    pipePath: pipe,
    requestHandler(req, res) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'bridge' }));
    },
    onError(error) {
      if (error && error.code !== 'EACCES') {
        assert.ifError(error);
      }
    }
  });

  try {
    await server.listen();
  } catch (error) {
    if (error && error.code === 'EACCES') {
      return;
    }
    throw error;
  }

  await new Promise((resolve, reject) => {
    const req = http.request({ socketPath: pipe, path: '/', method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
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

test('pipe server converts rejected async request handlers into 500 responses', async () => {
  const pipe = thePipePath(`bridge-async-error-${Date.now()}`);
  const reportedErrors = [];
  const server = createPipeServer({
    pipePath: pipe,
    async requestHandler() {
      throw new Error('internal handler detail');
    },
    onError(error) {
      reportedErrors.push(error);
    }
  });

  await server.listen();
  try {
    const result = await new Promise((resolve, reject) => {
      const request = http.request({ socketPath: pipe, path: '/', method: 'GET' }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ statusCode: response.statusCode, body }));
      });
      request.on('error', reject);
      request.end();
    });

    assert.equal(result.statusCode, 500);
    assert.equal(result.body, 'Internal Server Error');
    assert.equal(reportedErrors.length, 1);
    assert.doesNotMatch(result.body, /internal handler detail/);
  } finally {
    await server.close();
  }
});
