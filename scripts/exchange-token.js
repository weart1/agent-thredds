// Обмен короткоживущего токена Threads (1 час) на долгоживущий (60 дней)
// и запись его в .env как THREADS_ACCESS_TOKEN.
// Использование: npm run token -- <короткий_токен>          (сохранить в .env)
//                npm run token -- <короткий_токен> --print  (только показать, .env не трогать)
import fs from 'node:fs';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const args = process.argv.slice(2);
const print = args.includes('--print');
// Пробелы и переносы строк могли попасть при копировании — убираем
const shortToken = args.filter((a) => a !== '--print').join('').replace(/\s+/g, '');
const secret = process.env.THREADS_APP_SECRET;
if (!shortToken || !secret) {
  console.error('Использование: npm run token -- <короткий_токен>\n(THREADS_APP_SECRET должен быть в .env)');
  process.exit(1);
}

const url = new URL('https://graph.threads.net/access_token');
url.search = new URLSearchParams({
  grant_type: 'th_exchange_token',
  client_secret: secret,
  access_token: shortToken,
}).toString();

const res = await fetch(url);
const json = await res.json().catch(() => ({}));
if (!json.access_token) {
  console.error('Ошибка Meta:', json.error?.message || `HTTP ${res.status}`);
  console.error('Частые причины: короткий токен старше часа, скопирован не целиком или от другого приложения; неверный THREADS_APP_SECRET.');
  process.exit(1);
}
const days = Math.round((json.expires_in || 0) / 86400);

if (print) {
  console.log('\nДолгоживущий токен (вставьте в .env как THREADS_ACCESS_TOKEN):\n');
  console.log(json.access_token);
} else {
  const file = '.env';
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.startsWith('THREADS_ACCESS_TOKEN=')) : [];
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push(`THREADS_ACCESS_TOKEN=${json.access_token}`, '');
  fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  console.log('\nДолгоживущий токен сохранён в .env (THREADS_ACCESS_TOKEN).');
}
console.log(`Действует ~${days} дней. Агент будет продлевать его сам.`);
