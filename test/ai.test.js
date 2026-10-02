import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceBrand, composeReply } from '../src/ai.js';

test('название всегда «WeArt Studio»', () => {
  assert.equal(enforceBrand('Попробуйте WeArt'), 'Попробуйте WeArt Studio');
  assert.equal(enforceBrand('We build WeArt AI'), 'We build WeArt Studio');
  assert.equal(enforceBrand('WeArt Studio уже правильно'), 'WeArt Studio уже правильно');
  assert.equal(enforceBrand('сайт weartstudio.io не трогаем'), 'сайт weartstudio.io не трогаем');
});

test('ссылка добавляется только когда включена', () => {
  const url = 'https://weartstudio.io/x';
  assert.equal(composeReply({ text: 'Привет', includeLink: false }, url), 'Привет');
  assert.equal(composeReply({ text: 'Привет', includeLink: true }, url), `Привет\n\n${url}`);
});
