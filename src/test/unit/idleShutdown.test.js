//@ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createIdleShutdown } = require('../../transport/idleShutdown');

test('idle shutdown closes the server and reports completion once', async () => {
  let closeCount = 0;
  let shutdownCount = 0;
  const idle = createIdleShutdown({
    async close() { closeCount += 1; }
  }, {
    timeoutMs: 5,
    onShutdown() { shutdownCount += 1; }
  });

  idle.reset();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(closeCount, 1);
  assert.equal(shutdownCount, 1);
  idle.stop();
});

test('idle shutdown reset postpones closure and stop cancels it', async () => {
  let closeCount = 0;
  const idle = createIdleShutdown({
    async close() { closeCount += 1; }
  }, { timeoutMs: 20 });

  idle.reset();
  await new Promise((resolve) => setTimeout(resolve, 8));
  idle.reset();
  await new Promise((resolve) => setTimeout(resolve, 8));
  assert.equal(closeCount, 0);
  idle.stop();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(closeCount, 0);
});