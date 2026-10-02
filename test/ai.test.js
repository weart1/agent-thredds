import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceBrand, composeReply, createAI } from '../src/ai.js';

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

test('Runware: запрос в формате OpenAI и разбор вызова инструмента', async () => {
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      choices: [{ message: { tool_calls: [{ type: 'function', function: {
        name: 'write_reply',
        arguments: JSON.stringify({ skip: false, reply: 'Попробуйте WeArt https://x.io', include_link: true }),
      } }] } }],
    }), { status: 200 });
  };
  const config = { ai: { provider: 'runware', apiKey: 'rw-key', baseUrl: 'https://api.runware.ai/v1', filterModel: 'f', draftModel: 'd' } };
  const ai = createAI(config, () => ({ productInfo: 'WeArt Studio', productUrl: 'https://weartstudio.io' }), { fetch: fakeFetch });

  const r = await ai.draftReply({ username: 'u', text: 'Посоветуйте нейросеть' });
  assert.equal(sent.url, 'https://api.runware.ai/v1/chat/completions');
  assert.equal(sent.init.headers.Authorization, 'Bearer rw-key');
  assert.equal(sent.body.model, 'd');
  assert.equal(sent.body.messages[0].role, 'system');
  assert.equal(sent.body.tool_choice.function.name, 'write_reply');
  assert.deepEqual(r, { skip: false, text: 'Попробуйте WeArt Studio', includeLink: true });
});

test('Runware: ошибка API понятна', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ errors: [{ message: 'Invalid API key' }] }), { status: 401 });
  const config = { ai: { provider: 'runware', apiKey: 'x', baseUrl: 'https://api.runware.ai/v1', filterModel: 'f', draftModel: 'd' } };
  const ai = createAI(config, () => ({}), { fetch: fakeFetch });
  await assert.rejects(ai.filterPosts([{ id: '1', text: 'a' }]), /Runware \(f\): Invalid API key/);
});
