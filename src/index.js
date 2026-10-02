import { EventEmitter } from 'node:events';
import cron from 'node-cron';
import { config, MOCK } from './config.js';
import { Store } from './store.js';
import { ThreadsClient } from './threads.js';
import { createAI } from './ai.js';
import { createPipeline } from './pipeline.js';
import { createServer } from './server.js';

const app = { config, events: new EventEmitter() };
app.events.setMaxListeners(50);
app.store = new Store(config.dataFile, config.defaultSettings);
app.log = (type, text, meta) => {
  const entry = app.store.addActivity(type, text, meta);
  console.log(`[${type}] ${text}`);
  app.events.emit('activity', entry);
  return entry;
};
if (MOCK) {
  const { createMockThreads, createMockAI } = await import('./mock.js');
  app.threads = createMockThreads();
  app.ai = createMockAI();
  console.log('⚠️  MOCK-режим: Threads и Claude подменены, в Threads ничего не публикуется. Пароль: mock-password');
} else {
  app.threads = new ThreadsClient(app.store, config.threads);
  app.ai = createAI(config, () => app.store.settings);
}
app.pipeline = createPipeline(app);

const tasks = {};
app.nextRun = (name) => {
  try { return tasks[name]?.getNextRun?.()?.getTime() ?? null; } catch { return null; }
};

async function main() {
  const server = createServer(app);
  server.listen(config.port, () => console.log(`Админка: http://localhost:${config.port}`));

  try {
    if (await app.threads.refreshTokenIfNeeded()) app.log('system', 'Токен Threads продлён');
  } catch (e) {
    app.log('error', e.message);
  }

  try {
    app.me = await app.threads.me();
    app.log('system', `Агент запущен, аккаунт @${app.me.username}`);
  } catch (e) {
    app.log('error', `Не удалось подключиться к Threads: ${e.message}. Проверьте THREADS_ACCESS_TOKEN.`);
  }

  const safe = (name, fn) => async () => {
    try {
      await fn();
    } catch (e) {
      app.log('error', `${name}: ${e.message}`);
    } finally {
      app.events.emit('stats', app.stats?.());
    }
  };

  tasks.search = cron.schedule(config.schedule.search, safe('Поиск', () => app.pipeline.runSearch()));
  tasks.mentions = cron.schedule(config.schedule.mentions, safe('Упоминания', () => app.pipeline.runMentions()));
  tasks.maintenance = cron.schedule('0 4 * * *', safe('Обслуживание', async () => {
    if (await app.threads.refreshTokenIfNeeded()) app.log('system', 'Токен Threads продлён');
    const expired = app.store.prune();
    if (expired) app.log('system', `Устарело черновиков: ${expired}`);
  }));
}

const shutdown = () => {
  app.store.save();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => {
  console.error('Не удалось запустить агента:', e);
  process.exit(1);
});
