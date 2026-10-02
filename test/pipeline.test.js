import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mockEnv } from './helpers.js';

mockEnv();
const { config } = await import('../src/config.js');
const { Store } = await import('../src/store.js');
const { createPipeline } = await import('../src/pipeline.js');
const { createMockThreads, createMockAI } = await import('../src/mock.js');

function makeApp() {
  const app = { config, events: new EventEmitter() };
  app.store = new Store(config.dataFile + Math.random(), config.defaultSettings);
  app.log = (type, text, meta) => app.store.addActivity(type, text, meta);
  app.threads = createMockThreads();
  app.ai = createMockAI();
  app.me = { username: 'weartstudio_mock' };
  app.pipeline = createPipeline(app);
  return app;
}

test('поиск создаёт черновики только по релевантным постам, по одному на автора', async () => {
  const app = makeApp();
  const r = await app.pipeline.runSearch({ manual: true });
  assert.ok(r.found > 0);
  const drafts = app.store.draftsByStatus('pending');
  assert.ok(drafts.length > 0, 'есть черновики');
  for (const d of drafts) {
    assert.ok(d.score >= config.defaultSettings.minScore);
    assert.match(d.text, /WeArt Studio/);
    assert.doesNotMatch(d.text, /WeArt(?! Studio)/);
  }
  const users = drafts.map((d) => d.username);
  assert.equal(new Set(users).size, users.length, 'не больше одного черновика на автора');
});

test('публикация учитывает дневной лимит', async () => {
  const app = makeApp();
  app.store.settings.maxRepliesPerDay = 1;
  await app.pipeline.runSearch({ manual: true });
  const [a, b] = app.store.draftsByStatus('pending');
  assert.ok(a && b, 'нужно минимум два черновика');
  await app.pipeline.publish(a);
  assert.equal(a.status, 'sent');
  await assert.rejects(() => app.pipeline.publish(b), /лимит/);
});

test('пауза останавливает плановый поиск, но не ручной', async () => {
  const app = makeApp();
  app.store.data.paused = true;
  assert.equal((await app.pipeline.runSearch()).message, 'Агент на паузе');
  assert.ok((await app.pipeline.runSearch({ manual: true })).found > 0);
});
