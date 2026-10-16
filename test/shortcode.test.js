import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePostLink, codeToId } from '../src/shortcode.js';

test('код поста → число (алфавит Instagram)', () => {
  assert.equal(codeToId('B'), '1');
  assert.equal(codeToId('BA'), '64');
  assert.equal(codeToId('_'), '63');
  assert.equal(codeToId('a!'), null);
});

test('разбор ссылки на пост', () => {
  const p = parsePostLink('https://www.threads.net/@Some.User/post/C8abc_-1?xmt=1');
  assert.equal(p.username, 'some.user');
  assert.equal(p.code, 'C8abc_-1');
  assert.equal(p.id, codeToId('C8abc_-1'));
  assert.equal(parsePostLink('https://example.com/@a/post/C8abcde'), null);
  assert.equal(parsePostLink('https://www.threads.com/@a'), null);
  assert.equal(parsePostLink('не ссылка'), null);
});
