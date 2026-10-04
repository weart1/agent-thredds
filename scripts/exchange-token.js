// Обмен короткоживущего токена Threads (1 час) на долгоживущий (60 дней)
// и запись его в .env как THREADS_ACCESS_TOKEN.
// Использование: npm run token -- <короткий_токен>          (сохранить в .env)
//                npm run token -- <короткий_токен> --print  (только показать, .env не трогать)
import { exchangeForLongLived, saveEnvValue } from '../src/oauth.js';
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

let json;
try {
  json = await exchangeForLongLived({ appSecret: secret, shortToken });
} catch (e) {
  console.error('Ошибка Meta:', e.message);
  console.error('Частые причины: короткий токен старше часа, скопирован не целиком или от другого приложения; неверный THREADS_APP_SECRET.');
  process.exit(1);
}
const days = Math.round((json.expires_in || 0) / 86400);

if (print) {
  console.log('\nДолгоживущий токен (вставьте в .env как THREADS_ACCESS_TOKEN):\n');
  console.log(json.access_token);
} else {
  saveEnvValue('THREADS_ACCESS_TOKEN', json.access_token);
  console.log('\nДолгоживущий токен сохранён в .env (THREADS_ACCESS_TOKEN).');
}
console.log(`Действует ~${days} дней. Агент будет продлевать его сам.`);
