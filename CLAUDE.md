# Агент WeArt Studio для Threads

Node.js-сервис: по расписанию ищет в Threads посты, где люди ищут AI-инструменты,
оценивает их нейросетью (через Runware), пишет ответы с упоминанием WeArt Studio и показывает их
в веб-админке на одобрение. Админка лежит на Vercel, агент с API — на VPS (DigitalOcean). Подробности для пользователя: @README.md

## Команды

- `npm run dev:mock` — запуск с фейковыми Threads и Claude (без ключей, ничего не публикует).
  Админка на http://localhost:3000, пароль `mock-password`. Перезапускается при изменении файлов.
- `MOCK=1 MOCK_AI=0 ...` — тестовые посты Threads, но настоящая нейросеть (нужен `RUNWARE_API_KEY`). Ничего не публикует,
  тратит немного денег Runware. Так проверяют качество ответов до подключения Threads.
- `npm test` — тесты (node:test, всё на моках, сеть не нужна).
- `npm run check` — проверка синтаксиса всех файлов.
- `npm run report` — сводка по реальной работе агента; `npm run report -- --mock` — по mock-базе.
- `API_URL=https://... npm run build:web` — сборка админки для Vercel в `dist/` (Vercel делает это сам).
- `npm start` — боевой режим с настоящими ключами из .env. Публикует в Threads по-настоящему.

После любых изменений кода запускай `npm run check && npm test`.

## Архитектура

- `src/index.js` — сборка приложения, cron-расписание. Объект `app` передаётся во все модули.
- `src/pipeline.js` — логика: поиск → фильтр → оценка → черновики; `publish()` с лимитами.
- `src/ai.js` — вызовы модели: дешёвая фильтрует, сильная пишет; промпты, `enforceBrand()`.
  Провайдер по умолчанию Runware (OpenAI-совместимый `/v1/chat/completions` с tools), запасной — Claude API (`AI_PROVIDER=anthropic`).
- `src/threads.js` — клиент официального Threads API (graph.threads.net).
- `src/server.js` — Express: вход по паролю (подписанная cookie), REST API, SSE `/api/events`.
  CORS только для origin из `ADMIN_ORIGIN`; изменяющие запросы с чужих origin получают 403.
- `src/store.js` — всё состояние в одном JSON-файле `data/db.json`.
- `src/mock.js` — фейковые Threads и Claude для `MOCK=1` и тестов.
- `public/` — админка: чистый JS без фреймворков. Адрес API берётся из `public/config.js` (`window.API_BASE`, пусто — тот же сервер).
  `scripts/build-web.js` копирует её в `dist/`, прописывает `API_URL` и CSP для Vercel (`vercel.json`).
- `keywords.json`, `product.md` — только начальные значения при первом запуске.
  Дальше ключевые слова, описание продукта, ссылка и лимиты живут в `data/db.json`
  и редактируются в админке (раздел «Настройки»).

События: модули зовут `app.log(type, text, meta)` для ленты и `app.events.emit('draft' | 'stats' | 'status')`;
сервер транслирует их в админку через SSE.

## Правила проекта

- Продукт всегда называется **«WeArt Studio»**, никогда «WeArt» или «WeArt AI».
  Это касается промптов, текстов интерфейса и примеров. `enforceBrand()` страхует, но не полагайся только на неё.
- Не публикуй ничего в настоящий Threads при разработке и проверках: используй `MOCK=1` и тесты.
  `npm start` запускай, только если пользователь прямо попросил.
- Не читай `.env` и `data/` — там токены и ключи. Для анализа данных есть `npm run report`, он секреты не выводит.
- Админка: весь пользовательский текст только через `textContent` (хелпер `h()` в `public/app.js`), никакого `innerHTML` с данными.
  CSP запрещает inline-скрипты и атрибуты `style` — стили через классы или `el.style` (CSSOM).
- Интерфейс и тексты на русском, кратко и по делу.
- Новые зависимости — только если без них никак. Сейчас: express, @anthropic-ai/sdk, node-cron, dotenv. Runware вызывается через встроенный `fetch`.
- Сохраняй защиту от бана: дневной лимит ответов, пауза для автора, один черновик на автора, ссылка не всегда.
- Сроки хранения данных (`POST_DAYS`, `SENT_DAYS` в `src/store.js`) обещаны в политике конфиденциальности (`META.md`, раздел 1.9).
  Меняешь сроки или начинаешь хранить новые данные о пользователях — обнови политику и скажи пользователю.

## Ограничения Threads API

- Поиск по ключевым словам: 500 запросов за 7 дней (в коде держим 450).
- Публикация: 250 постов и 1000 ответов в сутки на профиль.
- Ответ публикуется в два шага: создание контейнера (`/me/threads`), затем `/me/threads_publish`.
- Токен живёт 60 дней, агент продлевает его раз в неделю (`refreshTokenIfNeeded`).
- Без одобрения `threads_keyword_search` в App Review поиск возвращает в основном собственные посты.

## Деплой

- Агент и API: VPS DigitalOcean, поддомен `api-agent.weartstudio.io`. Команда `/deploy`.
  - Отдельный пользователь `agent`, код в `/home/agent/threads-agent` (git-клон, `git pull` для обновления).
  - Node 22 через nvm только у `agent`; свой pm2 у `agent` (`pm2-agent.service`), процесс `threads-agent`.
  - Агент слушает `127.0.0.1:3100` (`HOST`, `PORT` в `.env`), снаружи — nginx + certbot,
    файл `/etc/nginx/sites-available/api-agent.weartstudio.io`.
- **На этом сервере работают другие проекты пользователя** (сайт weartstudio.io, `backend.weartstudio.io`,
  digitaldevils; pm2 у root: `platform-api`, `platform-web`, `digitaldevils`).
  Никогда не трогай pm2 у root (`pm2 kill/stop/delete/restart` без `su - agent`), чужие конфиги nginx,
  системный Node и файрвол. Перед любой командой на сервере сначала проверь, что она затрагивает только агента.
- Админка: Vercel, сам собирает из GitHub при пуше в `main` (`vercel.json`, переменная `API_URL`), поддомен `agent.weartstudio.io`.
- Админка и API должны быть поддоменами одного домена, иначе браузер не отправит cookie сессии.

Детали сервера пользователь хранит в `CLAUDE.local.md`.
