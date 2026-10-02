// Фейковые Threads и Claude для разработки и тестов (MOCK=1).
// Ничего не отправляют наружу и не тратят деньги.
import { enforceBrand } from './ai.js';

const SAMPLE_POSTS = [
  { username: 'anna_k', text: 'Посоветуйте нейросеть, которая делает видео сразу со звуком? Нужно для рилсов' },
  { username: 'mike.creates', text: 'What AI tool do you guys use for product photos? Midjourney is getting expensive' },
  { username: 'olga_smm', text: 'Как сделать AI-клип под свою песню? Пробовала разные сервисы, всё не то' },
  { username: 'devon', text: 'AI art is killing real creativity, change my mind' },
  { username: 'tanya.design', text: 'Ищу одну платформу, где есть и картинки, и видео, надоело платить за пять подписок' },
  { username: 'news_ai', text: 'OpenAI announced new funding round today' },
  { username: 'lena_photo', text: 'Nano Banana или GPT Image — что лучше для редактирования фото с текстом?' },
  { username: 'random_guy', text: 'Сегодня отличная погода, пошёл гулять' },
];

let counter = 0;

export function createMockThreads() {
  return {
    async me() { return { id: 'mock', username: 'weartstudio_mock' }; },
    async refreshTokenIfNeeded() { return false; },
    async keywordSearch() {
      const now = Date.now();
      return SAMPLE_POSTS.slice()
        .sort(() => Math.random() - 0.5)
        .slice(0, 5)
        .map((p) => {
          counter++;
          return {
            ...p,
            id: `mock${now}${counter}`,
            permalink: `https://www.threads.net/@${p.username}/post/mock${counter}`,
            timestamp: new Date(now - Math.random() * 6 * 3600e3).toISOString(),
            media_type: 'TEXT_POST',
          };
        });
    },
    async mentions() { return []; },
    async reply(id) {
      await new Promise((r) => setTimeout(r, 400));
      return { id: `reply_${id}`, permalink: `https://www.threads.net/@weartstudio_mock/post/reply_${id}` };
    },
  };
}

const score = (text) => {
  const t = text.toLowerCase();
  if (/посоветуйте|ищу|what ai tool|что лучше|recommend/.test(t)) return { score: 9, intent: 'looking_for_tool', reason: 'Прямо ищет инструмент' };
  if (/как сделать|how to/.test(t)) return { score: 7, intent: 'asking_how_to', reason: 'Спрашивает, как сделать AI-контент' };
  if (/ai|нейросет/.test(t)) return { score: 3, intent: 'discussion', reason: 'Общее обсуждение, реклама неуместна' };
  return { score: 0, intent: 'off_topic', reason: 'Не по теме' };
};

export function createMockAI() {
  return {
    async filterPosts(posts) {
      return posts.map((p) => ({ ...p, ...score(p.text) }));
    },
    async draftReply(post, { previous } = {}) {
      await new Promise((r) => setTimeout(r, 300));
      const ru = /[а-яё]/i.test(post.postText ?? post.text);
      const text = previous
        ? (ru ? 'Другой вариант: попробуйте собрать всё в одном месте — мы делаем WeArt, там есть и картинки, и видео.' : 'Another take: we build WeArt AI, it has image and video models in one place.')
        : (ru ? 'Для этого хорошо подходит Seedance 2.5, он делает видео сразу со звуком. Мы делаем WeArt Studio, там он есть вместе с другими моделями.' : 'Seedance 2.5 handles this well. We build WeArt Studio, where it sits next to other image and video models.');
      // enforceBrand здесь нарочно: мок пишет «WeArt», как могла бы модель
      return { skip: false, text: enforceBrand(text), includeLink: score(post.postText ?? post.text).score >= 9 };
    },
  };
}
