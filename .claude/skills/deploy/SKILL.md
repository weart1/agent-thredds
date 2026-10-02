---
name: deploy
description: Выкладка агента на сервер (VPS с pm2). Только по явной просьбе пользователя.
disable-model-invocation: true
---

# Деплой на сервер

Данные сервера бери из `CLAUDE.local.md` (адрес, папка, домен). Если файла или данных нет,
спроси у пользователя и предложи сохранить их в `CLAUDE.local.md`.

1. Проверка перед выкладкой: `npm run check && npm test`. Если что-то упало — остановись и сообщи.
2. Покажи пользователю, что будет выложено (`git status` / список изменений), и получи подтверждение.
3. Копирование кода без секретов и данных:
   ```
   rsync -az --delete --exclude node_modules --exclude data --exclude .env \
     --exclude CLAUDE.local.md --exclude .git ./ <сервер>:<папка>/
   ```
4. Установка зависимостей и перезапуск:
   ```
   ssh <сервер> "cd <папка> && npm ci --omit=dev && (pm2 restart threads-agent || pm2 start src/index.js --name threads-agent) && pm2 save"
   ```
5. Проверка:
   - `ssh <сервер> "pm2 logs threads-agent --lines 30 --nostream"` — в логах должна быть строка «Агент запущен».
   - `curl -s <домен>/healthz` должен вернуть `{"ok":true}`.
6. Коротко сообщи результат. Если в логах ошибка про токен Threads — пользователю нужно обновить
   `THREADS_ACCESS_TOKEN` в `.env` на сервере (`npm run token -- <короткий_токен>`).

Никогда не копируй `.env` и `data/` на сервер или с сервера и не выводи их содержимое.
