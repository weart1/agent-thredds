// Сводка по работе агента для анализа (в том числе в Claude Code).
// Читает data/db.json, токены и секреты НЕ выводит.
// Использование: npm run report [-- --mock] [-- --days 14]
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.includes('--mock') ? './data/mock-db.json' : (process.env.DATA_FILE || './data/db.json');
const days = Number(args[args.indexOf('--days') + 1]) || 7;
if (!fs.existsSync(file)) {
  console.error(`Нет файла ${file}. Агент ещё не запускался?`);
  process.exit(1);
}
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const since = Date.now() - days * 864e5;
const s = db.settings || {};

const drafts = Object.values(db.drafts || {});
const scored = (db.scored || []).filter((p) => p.at > since);
const sent = drafts.filter((d) => d.status === 'sent' && d.sentAt > since);
const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});

console.log(`# Отчёт агента за ${days} дн.\n`);
console.log(`Порог оценки: ${s.minScore}, черновиков за прогон: ${s.maxDraftsPerRun}, ответов в сутки: ${s.maxRepliesPerDay}`);
console.log(`Ключевых слов: ${(s.keywords || []).length}. Пауза: ${db.paused ? 'да' : 'нет'}\n`);

console.log('## Черновики по статусам (всё время)');
console.log(count(drafts, (d) => d.status));
console.log(`\nОтправлено за период: ${sent.length}, со ссылкой: ${sent.filter((d) => d.includeLink).length}, автоматически: ${sent.filter((d) => d.sentBy === 'auto').length}`);

console.log('\n## Ключевые слова: постов оценено / средняя оценка / черновиков / отправлено');
const byKw = {};
for (const p of scored) {
  const k = (byKw[p.keyword || '(упоминания)'] ||= { n: 0, sum: 0, drafts: 0, sent: 0 });
  k.n++; k.sum += p.score; if (p.outcome === 'draft') k.drafts++;
}
for (const d of sent) if (d.keyword && byKw[d.keyword]) byKw[d.keyword].sent++;
const rows = Object.entries(byKw).sort((a, b) => b[1].sent - a[1].sent || b[1].drafts - a[1].drafts);
for (const [kw, v] of rows) console.log(`${kw}: ${v.n} / ${(v.sum / v.n).toFixed(1)} / ${v.drafts} / ${v.sent}`);
const unused = (s.keywords || []).filter((k) => !byKw[k]);
if (unused.length) console.log(`\nНет оценённых постов за период (ещё не искались или ничего не нашли): ${unused.join(', ')}`);

console.log('\n## Что стало с оценёнными постами');
console.log(count(scored, (p) => p.outcome));
console.log('\n## Распределение оценок');
console.log(count(scored, (p) => p.score));

const skipped = drafts.filter((d) => d.status === 'skipped' && d.createdAt > since);
console.log(`\n## Вы пропустили ${skipped.length} черновиков. Примеры (пост → ответ):`);
for (const d of skipped.slice(-8)) console.log(`- [${d.score}/10 «${d.keyword || 'упоминание'}»] ${String(d.postText).slice(0, 120)}\n  → ${String(d.text).slice(0, 160)}`);

const edited = sent.filter((d) => d.edited);
console.log(`\n## Отправлено с вашими правками: ${edited.length}. Примеры:`);
for (const d of edited.slice(-8)) console.log(`- ${String(d.sentText).slice(0, 200)}`);

const errors = (db.activity || []).filter((e) => e.type === 'error' && e.at > since);
console.log(`\n## Ошибок за период: ${errors.length}`);
for (const e of errors.slice(-10)) console.log(`- ${new Date(e.at).toISOString()} ${e.text}`);
