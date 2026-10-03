import dotenv from 'dotenv';
import fs from 'node:fs';
import crypto from 'node:crypto';

dotenv.config({ quiet: true });

// MOCK=1 — режим разработки: фейковые Threads и Claude, ключи не нужны
export const MOCK = process.env.MOCK === '1';

const MOCK_DEFAULTS = { ADMIN_PASSWORD: 'mock-password', THREADS_ACCESS_TOKEN: 'mock', RUNWARE_API_KEY: 'mock', ANTHROPIC_API_KEY: 'mock' };

const required = (key) => {
  const v = process.env[key] || (MOCK ? MOCK_DEFAULTS[key] : undefined);
  if (!v) throw new Error(`Не задана переменная ${key} в .env`);
  return v;
};
const readFile = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const password = required('ADMIN_PASSWORD');

// Модели для текста: Runware (по умолчанию) или напрямую Claude API.
// Если AI_PROVIDER не задан: есть ANTHROPIC_API_KEY без RUNWARE_API_KEY → anthropic, иначе runware.
const provider = (process.env.AI_PROVIDER ||
  (process.env.ANTHROPIC_API_KEY && !process.env.RUNWARE_API_KEY ? 'anthropic' : 'runware')).toLowerCase();
if (!['runware', 'anthropic'].includes(provider)) throw new Error('AI_PROVIDER должен быть runware или anthropic');
const MODEL_DEFAULTS = {
  runware: { filter: 'anthropic:claude@haiku-4.5', draft: 'anthropic:claude@sonnet-4.6' },
  anthropic: { filter: 'claude-haiku-4-5-20251001', draft: 'claude-sonnet-5-5' },
};
if (password.length < 10) throw new Error('ADMIN_PASSWORD должен быть не короче 10 символов');

export const config = {
  port: Number(process.env.PORT || 3000),
  // 127.0.0.1 — принимать соединения только с этого сервера (через nginx/Caddy). Пусто — все адреса
  host: process.env.HOST || undefined,
  admin: {
    password,
    // Без SESSION_SECRET сессии сбрасываются при каждом перезапуске
    sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    // Откуда разрешено открывать админку, если она лежит отдельно (Vercel).
    // Например: https://agent.weartstudio.io (несколько — через запятую)
    allowedOrigins: (process.env.ADMIN_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  },
  threads: {
    appId: process.env.THREADS_APP_ID,
    appSecret: process.env.THREADS_APP_SECRET,
    initialToken: required('THREADS_ACCESS_TOKEN'),
    apiBase: 'https://graph.threads.net/v1.0',
  },
  ai: {
    provider,
    apiKey: required(provider === 'runware' ? 'RUNWARE_API_KEY' : 'ANTHROPIC_API_KEY'),
    baseUrl: process.env.RUNWARE_BASE_URL || 'https://api.runware.ai/v1',
    filterModel: process.env.FILTER_MODEL || MODEL_DEFAULTS[provider].filter,
    draftModel: process.env.DRAFT_MODEL || MODEL_DEFAULTS[provider].draft,
  },
  schedule: {
    search: process.env.SEARCH_CRON || '0 */3 * * *',
    mentions: process.env.MENTIONS_CRON || '*/15 * * * *',
  },
  // Официальный лимит Meta — 500 поисков за 7 дней; держим запас
  searchesPerWeek: 450,
  dataFile: process.env.DATA_FILE || (MOCK ? './data/mock-db.json' : './data/db.json'),

  // Начальные настройки. Дальше они редактируются в админке и хранятся в data/db.json
  defaultSettings: {
    keywords: JSON.parse(readFile('../keywords.json')),
    productInfo: readFile('../product.md'),
    productUrl: 'https://weartstudio.io/sale1?utm_source=threads&utm_medium=agent',
    keywordsPerRun: 6,
    maxDraftsPerRun: 8,
    minScore: 7,
    maxRepliesPerDay: 20,
    userCooldownDays: 30,
    maxPostAgeHours: 48,
    autoApproveMentions: false,
  },
};
