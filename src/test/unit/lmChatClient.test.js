//@ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createChatClient } = require('../../lm/chatClient');

test('chat client selects allowed models, converts messages, and collects response text', async () => {
  const requests = [];
  const models = [{
    id: 'gpt-4o',
    name: 'GPT-4o',
    family: 'gpt-4o',
    vendor: 'copilot',
    async sendRequest(messages, options) {
      requests.push({ messages, options, token: arguments[2] });
      return {
        text: (async function* () {
          yield 'hello';
          yield ' world';
        }())
      };
    }
  }];
  const vscodeApi = {
    lm: {
      async selectChatModels(selector) {
        assert.equal(selector.vendor, 'copilot');
        return models;
      }
    },
    LanguageModelChatMessage: {
      User(content) { return { role: 'user', content }; },
      Assistant(content) { return { role: 'assistant', content }; }
    }
  };
  const client = createChatClient(vscodeApi);

  const listed = await client.listModels();
  assert.equal(listed[0].id, 'gpt-4o');
  const output = await client.generate({
    model: 'gpt-4o',
    messages: [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'context' }
    ]
  });

  assert.equal(output.response, 'hello world');
  assert.deepEqual(requests[0].messages, [
    { role: 'user', content: 'question' },
    { role: 'assistant', content: 'context' }
  ]);
  assert.match(requests[0].options.justification, /trusted local application/i);
});

test('chat client forwards the per-request cancellation token to VS Code', async () => {
  const token = { isCancellationRequested: false };
  let receivedToken;
  const client = createChatClient({
    lm: {
      async selectChatModels() {
        return [{
          id: 'gpt-4o',
          async sendRequest(_messages, _options, cancellationToken) {
            receivedToken = cancellationToken;
            return { text: (async function* () { yield 'ok'; }()) };
          }
        }];
      }
    },
    LanguageModelChatMessage: {
      User(content) { return { role: 'user', content }; },
      Assistant(content) { return { role: 'assistant', content }; }
    }
  });

  await client.generate({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }], cancellationToken: token });
  assert.equal(receivedToken, token);
});

test('chat client fails closed when VS Code LM is unavailable', async () => {
  const client = createChatClient(null);
  assert.deepEqual(await client.listModels(), []);
  await assert.rejects(client.generate({ model: 'copilot', messages: [] }), { code: 'model_unavailable' });
});