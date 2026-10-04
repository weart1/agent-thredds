// Получение токена Threads через обычный вход (OAuth) — без User Token Generator в кабинете Meta.
import fs from 'node:fs';

export const THREADS_SCOPES = [
  'threads_basic',
  'threads_content_publish',
  'threads_manage_replies',
  'threads_keyword_search',
  'threads_manage_mentions',
];

export function authorizeUrl({ appId, redirectUri, state }) {
  const url = new URL('https://threads.net/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: THREADS_SCOPES.join(','),
    response_type: 'code',
    state,
  }).toString();
  return url.toString();
}

async function readJson(res) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(json.error?.message || json.error_message || `HTTP ${res.status}`);
  }
  return json;
}

/** Короткий токен (1 час) → долгоживущий (60 дней). */
export async function exchangeForLongLived({ appSecret, shortToken }) {
  const url = new URL('https://graph.threads.net/access_token');
  url.search = new URLSearchParams({
    grant_type: 'th_exchange_token',
    client_secret: appSecret,
    access_token: shortToken,
  }).toString();
  return readJson(await fetch(url));
}

/** Код после входа → короткий токен → долгоживущий. */
export async function exchangeCode({ appId, appSecret, redirectUri, code }) {
  const short = await readJson(await fetch('https://graph.threads.net/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
  }));
  return exchangeForLongLived({ appSecret, shortToken: short.access_token });
}

/** Записывает KEY=value в .env (заменяя старую строку), права 600. */
export function saveEnvValue(key, value, file = process.env.ENV_FILE || '.env') {
  const lines = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.startsWith(`${key}=`))
    : [];
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push(`${key}=${value}`, '');
  fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
