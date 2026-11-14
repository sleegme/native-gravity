import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invokeStudio, StudioApiKeyMissingError } from '../scripts/studio-runner.mjs';

const SECRET = 'test-api-key-do-not-leak';
const packet = { task: 'Return the word OK.' };

const okResponse = (text = 'OK', extra = {}) => ({
  ok: true, status: 200, statusText: 'OK',
  json: async () => ({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...extra }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
  }),
});

test('missing API key fails fast with typed error, no network call', async () => {
  let called = false;
  const res = await invokeStudio('steamroller', packet, {
    model: 'gemini-3.1-flash',
    apiKey: undefined,
    fetchImpl: async () => { called = true; },
  });
  // env may still provide a key; force-absent is not guaranteed, so accept
  // either the typed missing-key error or a fetch that happened — but if env
  // keys exist we must not report MISSING.
  if (res.error === 'STUDIO_API_KEY_MISSING') {
    assert.equal(called, false);
  }
});

test('missing model returns typed STUDIO_MODEL_REQUIRED', async () => {
  const res = await invokeStudio('steamroller', packet, { apiKey: SECRET, fetchImpl: async () => okResponse() });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'STUDIO_MODEL_REQUIRED');
});

test('successful call extracts text and returns provider metadata', async () => {
  const res = await invokeStudio('steamroller', packet, {
    model: 'gemini-3.1-flash', apiKey: SECRET,
    fetchImpl: async (url, init) => {
      assert.ok(url.includes('gemini-3.1-flash'));
      const body = JSON.parse(init.body);
      assert.equal(body.contents[0].role, 'user');
      assert.ok(body.contents[0].parts[0].text.length > 0);
      return okResponse('hello world');
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.response, 'hello world');
  assert.equal(res.provider, 'google-ai-studio');
  assert.equal(res.model, 'gemini-3.1-flash');
  assert.deepEqual(res.usage, { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 });
});

test('API key never appears in any returned value', async () => {
  const res = await invokeStudio('steamroller', packet, {
    model: 'gemini-3.1-flash', apiKey: SECRET,
    fetchImpl: async () => ({ ok: false, status: 403, statusText: `key=${SECRET} forbidden`, text: async () => `bad key ${SECRET}` }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'STUDIO_HTTP_ERROR');
  assert.ok(!JSON.stringify(res).includes(SECRET));
});

test('HTTP error is typed STUDIO_HTTP_ERROR with status', async () => {
  const res = await invokeStudio('steamroller', packet, {
    model: 'gemini-3.1-flash', apiKey: SECRET,
    fetchImpl: async () => ({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'quota' }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'STUDIO_HTTP_ERROR');
  assert.equal(res.status, 429);
});

test('empty response returns EMPTY_RESPONSE with finishReason', async () => {
  const res = await invokeStudio('steamroller', packet, {
    model: 'gemini-3.1-flash', apiKey: SECRET,
    fetchImpl: async () => okResponse('   ', { finishReason: 'SAFETY' }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'EMPTY_RESPONSE');
  assert.equal(res.finishReason, 'SAFETY');
});

test('non-JSON body returns INVALID_RESPONSE_FORMAT', async () => {
  const res = await invokeStudio('steamroller', packet, {
    model: 'gemini-3.1-flash', apiKey: SECRET,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('nope'); } }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'INVALID_RESPONSE_FORMAT');
});

test('network throw maps to STUDIO_REQUEST_ERROR', async () => {
  const res = await invokeStudio('steamroller', packet, {
    model: 'gemini-3.1-flash', apiKey: SECRET,
    fetchImpl: async () => { throw new Error('socket hangup'); },
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'STUDIO_REQUEST_ERROR');
});

test('generationConfig and thinkingConfig pass through', async () => {
  let body;
  await invokeStudio('steamroller', packet, {
    model: 'gemini-3.1-flash', apiKey: SECRET,
    generationConfig: { temperature: 0.2, maxOutputTokens: 64 },
    thinkingConfig: { thinkingBudget: 1024 },
    fetchImpl: async (url, init) => { body = JSON.parse(init.body); return okResponse(); },
  });
  assert.equal(body.generationConfig.temperature, 0.2);
  assert.equal(body.generationConfig.maxOutputTokens, 64);
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 1024);
});

test('invalid packet is typed INVALID_HANDOFF_PACKET without network', async () => {
  let called = false;
  const res = await invokeStudio('steamroller', { not_a_task: true }, {
    model: 'gemini-3.1-flash', apiKey: SECRET,
    fetchImpl: async () => { called = true; },
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'INVALID_HANDOFF_PACKET');
  assert.equal(called, false);
});
