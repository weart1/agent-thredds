const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

/** Минимальный клиент официального Threads API. */
export class ThreadsClient {
  constructor(store, cfg) {
    this.store = store;
    this.cfg = cfg;
  }

  get token() {
    return this.store.data.token || this.cfg.initialToken;
  }

  async request(method, endpoint, params = {}) {
    const url = new URL(`${this.cfg.apiBase}/${endpoint}`);
    const body = new URLSearchParams({ ...params, access_token: this.token });
    let res;
    if (method === 'GET') {
      url.search = body.toString();
      res = await fetch(url);
    } else {
      res = await fetch(url, { method, body });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      const err = new Error(`Threads API (${endpoint}): ${json.error?.message || `HTTP ${res.status}`}`);
      err.code = json.error?.code;
      throw err;
    }
    return json;
  }

  me() {
    return this.request('GET', 'me', { fields: 'id,username' });
  }

  /** Поиск публичных постов по ключевому слову (тратит 1 из 500 недельных запросов). */
  async keywordSearch(q, { searchType = 'RECENT', limit = 25 } = {}) {
    const r = await this.request('GET', 'keyword_search', {
      q,
      search_type: searchType,
      fields: 'id,text,username,permalink,timestamp,media_type',
      limit: String(limit),
    });
    return r.data || [];
  }

  /** Посты, в которых упомянули ваш аккаунт. */
  async mentions(limit = 25) {
    const r = await this.request('GET', 'me/mentions', {
      fields: 'id,text,username,permalink,timestamp,media_type',
      limit: String(limit),
    });
    return r.data || [];
  }

  /** Публичные посты аккаунта по имени (Profile Discovery, разрешение threads_profile_discovery). */
  async profilePosts(username, limit = 10) {
    const r = await this.request('GET', 'profile_posts', {
      username,
      fields: 'id,text,username,permalink,timestamp,media_type',
      limit: String(limit),
    });
    return r.data || [];
  }

  /** Публикует текстовый ответ на пост: создание контейнера → публикация. */
  async reply(replyToId, text) {
    const container = await this.request('POST', 'me/threads', {
      media_type: 'TEXT',
      text,
      reply_to_id: replyToId,
    });
    await sleep(3000); // Meta советует дать контейнеру обработаться перед публикацией
    const published = await this.request('POST', 'me/threads_publish', { creation_id: container.id });
    try {
      const m = await this.request('GET', published.id, { fields: 'permalink' });
      return { id: published.id, permalink: m.permalink };
    } catch {
      return { id: published.id };
    }
  }

  /** Продлевает долгоживущий токен (он живёт 60 дней). Делаем это раз в неделю. */
  async refreshTokenIfNeeded() {
    const last = this.store.data.tokenRefreshedAt;
    // Первый запуск: токен только что выдан, а Meta продлевает токены не раньше чем через сутки.
    // Запоминаем время и продлеваем через неделю.
    if (!last) {
      this.store.data.tokenRefreshedAt = Date.now();
      this.store.save();
      return false;
    }
    if (Date.now() - last < 7 * DAY) return false;
    const url = new URL('https://graph.threads.net/refresh_access_token');
    url.search = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: this.token }).toString();
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    if (!json.access_token) {
      throw new Error(`Не удалось продлить токен Threads: ${json.error?.message || res.status}`);
    }
    this.store.data.token = json.access_token;
    this.store.data.tokenRefreshedAt = Date.now();
    this.store.save();
    return true;
  }
}
