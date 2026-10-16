// Проверка: совпадает ли ID, вычисленный из ссылки на пост, с настоящим ID из Threads API.
// Берёт посты, которые агент уже получал (поиск, упоминания, отслеживаемые). Секреты не выводит.
// Использование: npm run check-links
import fs from 'node:fs';
import { parsePostLink } from '../src/shortcode.js';

const file = process.env.DATA_FILE || './data/db.json';
if (!fs.existsSync(file)) { console.error(`Нет файла ${file}`); process.exit(1); }
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const pairs = [
  ...(db.scored || []).map((p) => [p.id, p.permalink]),
  ...Object.values(db.drafts || {}).map((d) => [d.postId, d.permalink]),
  ...(db.watchPosts || []).map((p) => [p.id, p.permalink]),
].filter(([id, link]) => id && link);

let ok = 0, bad = 0;
const seen = new Set();
for (const [id, link] of pairs) {
  if (seen.has(id)) continue;
  seen.add(id);
  const parsed = parsePostLink(link);
  if (parsed && parsed.id === String(id)) ok++; else bad++;
}
console.log(`Проверено постов: ${ok + bad}. Совпало: ${ok}. Не совпало: ${bad}.`);
if (!ok && !bad) console.log('Пока не с чем сравнить: агенту нужны хотя бы несколько постов из поиска или упоминаний.');
else if (bad === 0) console.log('✅ «Ответить по ссылке» будет работать.');
else console.log('⚠️ ID из ссылок не совпадают — «Ответить по ссылке» не сработает, сообщите разработчику.');
