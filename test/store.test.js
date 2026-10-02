import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Store } from '../src/store.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'store-')), 'db.json');

test('ключевые слова идут по кругу', () => {
  const s = new Store(tmp(), { keywords: [] });
  const all = ['a', 'b', 'c'];
  assert.deepEqual(s.nextKeywords(all, 2), ['a', 'b']);
  assert.deepEqual(s.nextKeywords(all, 2), ['c', 'a']);
});

test('пауза для автора', () => {
  const s = new Store(tmp(), {});
  assert.ok(s.canReplyToUser('x', 30));
  s.data.repliedUsers.x = Date.now();
  assert.ok(!s.canReplyToUser('x', 30));
  s.data.repliedUsers.x = Date.now() - 31 * 864e5;
  assert.ok(s.canReplyToUser('x', 30));
});

test('настройки по умолчанию дополняют сохранённые', () => {
  const file = tmp();
  fs.writeFileSync(file, JSON.stringify({ settings: { minScore: 5 } }));
  const s = new Store(file, { minScore: 7, maxRepliesPerDay: 20 });
  assert.equal(s.settings.minScore, 5);
  assert.equal(s.settings.maxRepliesPerDay, 20);
});
