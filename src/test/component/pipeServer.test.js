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
