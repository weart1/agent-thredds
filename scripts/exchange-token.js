// Обмен короткоживущего токена Threads (1 час) на долгоживущий (60 дней).
// Использование: npm run token -- <короткий_токен>
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const shortToken = process.argv[2];
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
const json = await res.json();
if (!json.access_token) {
  console.error('Ошибка:', json.error?.message || json);
  process.exit(1);
}
console.log('\nДолгоживущий токен (вставьте в .env как THREADS_ACCESS_TOKEN):\n');
console.log(json.access_token);
console.log(`\nДействует ~${Math.round(json.expires_in / 86400)} дней. Агент будет продлевать его сам.`);
