// ID поста Threads из ссылки вида https://www.threads.com/@user/post/<код>.
// Код — число в base64 с алфавитом Instagram (A–Z, a–z, 0–9, -, _).
// Официального способа нет; проверка на реальных данных — npm run check-links.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function parsePostLink(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (!/(^|\.)threads\.(net|com)$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/@([\w.]{1,30})\/post\/([A-Za-z0-9_-]{5,})\/?$/);
  if (!m) return null;
  return { username: m[1].toLowerCase(), code: m[2], id: codeToId(m[2]), permalink: `https://www.threads.com/@${m[1]}/post/${m[2]}` };
}

export function codeToId(code) {
  let n = 0n;
  for (const ch of code) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    n = n * 64n + BigInt(v);
  }
  return n.toString();
}
