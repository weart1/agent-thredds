// Сборка админки для Vercel: копирует public/ в dist/ и прописывает адрес API.
// Использование: API_URL=https://api-agent.weartstudio.io node scripts/build-web.js
import fs from 'node:fs';

const raw = process.env.API_URL;
if (!raw) {
  console.error('Не задана переменная API_URL (адрес API агента, например https://api-agent.weartstudio.io).\n' +
    'На Vercel: Project → Settings → Environment Variables.');
  process.exit(1);
}
let api;
try { api = new URL(raw); } catch {
  console.error(`API_URL некорректен: ${raw}`);
  process.exit(1);
}
if (api.protocol !== 'https:' && api.hostname !== 'localhost') {
  console.error('API_URL должен начинаться с https://');
  process.exit(1);
}

const src = new URL('../public/', import.meta.url);
const out = new URL('../dist/', import.meta.url);
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

fs.writeFileSync(new URL('config.js', out),
  `// Сгенерировано scripts/build-web.js\nwindow.API_BASE = ${JSON.stringify(api.origin)};\n`);

// CSP как в src/server.js, плюс разрешение ходить в API
const csp = "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  `img-src 'self' data:; connect-src 'self' ${api.origin}; base-uri 'none'; form-action 'self'`;
const indexFile = new URL('index.html', out);
const html = fs.readFileSync(indexFile, 'utf8')
  .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`);
fs.writeFileSync(indexFile, html);

console.log(`Админка собрана в dist/, API: ${api.origin}`);
