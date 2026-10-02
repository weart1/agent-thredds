import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mockEnv } from './helpers.js';

mockEnv();
process.env.ADMIN_ORIGIN = 'https://agent.example.com';
const { config } = await import('../src/config.js');
const { Store } = await import('../src/store.js');
const { createPipeline } = await import('../src/pipeline.js');
const { createServer } = await import('../src/server.js');
const { createMockThreads, createMockAI } = await import('../src/mock.js');

let server, base, cookie = '';

before(async () => {
  const app = { config, events: new EventEmitter() };
  app.store = new Store(config.dataFile, config.defaultSettings);
  app.log = (type, text, meta) => app.store.addActivity(type, text, meta);
  app.threads = createMockThreads();
  app.ai = createMockAI();
  app.me = { username: 'weartstudio_mock' };
  app.pipeline = createPipeline(app);
  await app.pipeline.runSearch({ manual: true });
  server = createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

const call = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, data: await res.json() };
};

test('без входа API закрыт', async () => {
  assert.equal((await call('/stats')).status, 401);
});

test('неверный пароль не пускает', async () => {
  assert.equal((await call('/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
});

test('вход, правка, отправка черновика', async () => {
  assert.equal((await call('/login', { method: 'POST', body: { password: 'mock-password' } })).status, 200);
  const { data: drafts } = await call('/drafts');
  assert.ok(drafts.length > 0);
  const id = drafts[0].id;

  const patched = await call(`/drafts/${id}`, { method: 'PATCH', body: { text: 'Попробуйте WeArt', includeLink: false } });
  assert.equal(patched.data.finalText, 'Попробуйте WeArt Studio');

  const tooLong = await call(`/drafts/${id}`, { method: 'PATCH', body: { text: 'я'.repeat(600) } });
  assert.equal(tooLong.status, 400);

  const sent = await call(`/drafts/${id}/send`, { method: 'POST' });
  assert.equal(sent.data.status, 'sent');
  assert.equal((await call(`/drafts/${id}/send`, { method: 'POST' })).status, 409);
});

test('настройки проверяются', async () => {
  assert.equal((await call('/settings', { method: 'PUT', body: { minScore: 15 } })).status, 400);
  assert.equal((await call('/settings', { method: 'PUT', body: { productUrl: 'http://x.com' } })).status, 400);
  const ok = await call('/settings', { method: 'PUT', body: { keywords: 'a\nb\na' } });
  assert.deepEqual(ok.data.keywords, ['a', 'b']);
});

test('CORS: админка с разрешённого поддомена, чужие сайты отклоняются', async () => {
  const pre = await fetch(`${base}/drafts/x`, { method: 'OPTIONS', headers: { Origin: 'https://agent.example.com' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://agent.example.com');
  assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');

  const evil = await fetch(`${base}/pause`, { method: 'POST', headers: { Origin: 'https://evil.example.com', cookie } });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);

  const ok = await fetch(`${base}/stats`, { headers: { Origin: 'https://agent.example.com', cookie } });
  assert.equal(ok.status, 200);
});
