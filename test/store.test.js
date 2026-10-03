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

test('удаление данных пользователя по запросу', () => {
  const s = new Store(tmp(), { userCooldownDays: 30 });
  s.data.drafts.p1 = { id: 'p1', username: 'Anna_K', status: 'sent' };
  s.data.drafts.p2 = { id: 'p2', username: 'other', status: 'pending' };
  s.data.scored.push({ id: 'p1', username: 'anna_k', at: Date.now() });
  s.data.sentLog.push({ username: 'anna_k', at: Date.now() });
  s.data.repliedUsers.anna_k = Date.now();
  s.addActivity('sent', 'Ответ отправлен @anna_k');
  s.addActivity('sent', 'Ответ отправлен @anna_kk');

  assert.equal(s.forgetUser('@anna_k'), 5);
  assert.deepEqual(Object.keys(s.data.drafts), ['p2']);
  assert.equal(s.data.scored.length, 0);
  assert.equal(s.data.activity.length, 1);
  assert.ok(s.isBlocked('ANNA_K'));
  assert.ok(!s.isBlocked('other'));
  assert.ok(!JSON.stringify(s.data).includes('anna_k"'), 'имя не хранится в открытом виде');
});

test('автоочистка по срокам хранения', () => {
  const s = new Store(tmp(), { userCooldownDays: 30, maxPostAgeHours: 48 });
  const old = (days) => Date.now() - days * 864e5;
  s.data.drafts.a = { id: 'a', username: 'x', status: 'sent', createdAt: old(100), sentAt: old(95) };
  s.data.drafts.b = { id: 'b', username: 'y', status: 'sent', createdAt: old(20), sentAt: old(20) };
  s.data.scored.push({ id: 'c', at: old(31) }, { id: 'd', at: old(1) });
  s.data.activity.push({ text: 'old', at: old(31) });
  s.data.repliedUsers = { x: old(91), y: old(20) };
  s.prune();
  assert.deepEqual(Object.keys(s.data.drafts), ['b']);
  assert.deepEqual(s.data.scored.map((p) => p.id), ['d']);
  assert.equal(s.data.activity.length, 0);
  assert.deepEqual(Object.keys(s.data.repliedUsers), ['y']);
});
