// Админка агента WeArt Studio. Без сборки и фреймворков.
// Весь пользовательский текст вставляется через textContent — защита от XSS.

const THREADS_MAX = 500;
const root = document.getElementById('root');

const state = {
  stats: null,
  settings: null,
  view: 'queue',
  scoredFilter: 'all',
  events: null,
};

// ── Утилиты ─────────────────────────────────────────────────────
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style') el.style.cssText = v; // CSSOM: разрешено политикой CSP
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = Boolean(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const charLen = (s) => [...String(s ?? '')].length;
const finalLen = (text, includeLink) =>
  charLen(text) + (includeLink && state.settings ? 2 + charLen(state.settings.productUrl) : 0);

const safeUrl = (u) => {
  try { const x = new URL(u); return x.protocol === 'https:' ? x.toString() : null; } catch { return null; }
};

function timeAgo(ts) {
  if (!ts) return '';
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} ч назад`;
  return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
const clock = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (ts) => {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};

function toast(text, kind = '') {
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
}

// Адрес API. Пусто — тот же сайт; на Vercel задаётся при сборке в config.js
const API_BASE = String(window.API_BASE || '').replace(/\/$/, '');

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
  } catch {
    const e = new Error('Сервер агента недоступен. Проверьте, что он запущен, и обновите страницу.');
    e.offline = true;
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    showLogin();
    throw new Error('Нужно войти');
  }
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

async function withBusy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

// ── Вход ────────────────────────────────────────────────────────
function showLogin(notice) {
  state.events?.close();
  state.events = null;
  const err = h('p', { class: 'error', hidden: !notice }, notice || '');
  const input = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Войти');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      await withBusy(btn, async () => {
        try {
          await api('/login', { method: 'POST', body: { password: input.value } });
          boot();
        } catch (x) {
          err.textContent = x.message;
          err.hidden = false;
        }
      });
    },
  },
    h('h1', {}, 'Агент WeArt Studio'),
    h('p', {}, 'Админка ответов в Threads'),
    h('label', { for: 'pw', class: 'sr-only' }, 'Пароль'),
    input, err, btn,
  );
  root.replaceChildren(h('div', { class: 'login' }, form));
  input.focus();
}

// ── Каркас ──────────────────────────────────────────────────────
const VIEWS = {
  queue: { title: 'Очередь', render: renderQueue },
  feed: { title: 'Что делает агент', render: renderFeed },
  scored: { title: 'Оценки постов', render: renderScored },
  sent: { title: 'Отправленные', render: renderSent },
  settings: { title: 'Настройки', render: renderSettings },
};

let pageEl, statusEl, countEl, navEl;

function renderShell() {
  countEl = h('span', { class: 'count' });
  navEl = h('nav', { class: 'nav', 'aria-label': 'Разделы' },
    h('a', { href: '#queue', 'data-view': 'queue' }, 'Очередь', countEl),
    h('a', { href: '#feed', 'data-view': 'feed' }, 'Что делает агент'),
    h('a', { href: '#scored', 'data-view': 'scored' }, 'Оценки постов'),
    h('a', { href: '#sent', 'data-view': 'sent' }, 'Отправленные'),
    h('a', { href: '#settings', 'data-view': 'settings' }, 'Настройки'),
  );
  const logout = h('button', {
    class: 'btn quiet', onclick: async () => { await api('/logout', { method: 'POST' }).catch(() => {}); showLogin(); },
  }, 'Выйти');
  statusEl = h('div', { class: 'status' });
  pageEl = h('main', { class: 'page', id: 'page' });
  root.replaceChildren(
    h('div', { class: 'shell' },
      h('aside', { class: 'side' },
        h('div', { class: 'brand' }, h('strong', {}, 'WeArt Studio'), h('span', {}, 'Агент для Threads')),
        navEl,
        h('div', { class: 'bottom' }, logout),
      ),
      h('div', { class: 'main' }, statusEl, pageEl),
    ),
  );
}

function renderStatus() {
  const s = state.stats;
  if (!s || !statusEl) return;
  countEl.textContent = s.pending ? String(s.pending) : '';
  document.title = s.pending ? `(${s.pending}) Агент WeArt Studio` : 'Агент WeArt Studio';

  const busy = s.searchRunning;
  const stateEl = h('div', { class: `state ${busy ? 'busy' : s.paused ? 'paused' : ''}` },
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    busy ? 'Ищет посты…' : s.paused ? 'На паузе' : 'Работает',
    s.account ? h('span', { class: 'account' }, `@${s.account}`) : null,
  );
  const meter = (label, used, max) => {
    const pct = Math.min(100, Math.round((used / Math.max(max, 1)) * 100));
    return h('div', { class: `meter ${used >= max ? 'full' : ''}` },
      h('span', {}, label, ' ', h('b', {}, `${used} из ${max}`)),
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': used, 'aria-valuemax': max, 'aria-label': label },
        h('i', { style: `width:${pct}%` })),
    );
  };
  const next = s.nextSearchAt && !s.paused
    ? h('span', { class: 'next' }, `Следующий поиск в ${clock(s.nextSearchAt)}`) : null;

  const runBtn = h('button', {
    class: 'btn primary', disabled: busy,
    onclick: async (e) => {
      await withBusy(e.currentTarget, async () => {
        try {
          await api('/run/search', { method: 'POST' });
          toast('Поиск запущен — следите за разделом «Что делает агент»');
        } catch (x) { toast(x.message, 'error'); }
      });
    },
  }, 'Найти посты сейчас');
  const mentionsBtn = h('button', {
    class: 'btn',
    onclick: async (e) => {
      await withBusy(e.currentTarget, async () => {
        try { await api('/run/mentions', { method: 'POST' }); toast('Проверяю упоминания'); }
        catch (x) { toast(x.message, 'error'); }
      });
    },
  }, 'Проверить упоминания');
  const pauseBtn = h('button', {
    class: 'btn',
    onclick: async (e) => {
      await withBusy(e.currentTarget, async () => {
        try { state.stats = await api('/pause', { method: 'POST', body: { paused: !s.paused } }); renderStatus(); }
        catch (x) { toast(x.message, 'error'); }
      });
    },
  }, s.paused ? 'Возобновить' : 'Пауза');

  statusEl.replaceChildren(...[
    stateEl,
    meter('Поиски за неделю', s.searches7d, s.searchesPerWeek),
    meter('Ответы за сутки', s.replies24h, s.maxRepliesPerDay),
    next,
    h('div', { class: 'actions' }, runBtn, mentionsBtn, pauseBtn),
  ].filter(Boolean));
}

function navigate() {
  const v = location.hash.slice(1);
  state.view = VIEWS[v] ? v : 'queue';
  for (const a of navEl.querySelectorAll('a')) {
    if (a.dataset.view === state.view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  pageEl.replaceChildren();
  VIEWS[state.view].render().catch((e) => {
    if (e.message !== 'Нужно войти') pageEl.replaceChildren(h('div', { class: 'empty' }, h('strong', {}, 'Не удалось загрузить раздел'), e.message));
  });
}

function head(title, sub, extra) {
  return h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), sub ? h('p', {}, sub) : null), extra || null);
}

// ── Очередь ─────────────────────────────────────────────────────
const INTENTS = {
  looking_for_tool: 'Ищет инструмент',
  asking_how_to: 'Спрашивает, как сделать',
  discussion: 'Обсуждение',
  off_topic: 'Не по теме',
};

function postTurn(d, { withLine = true } = {}) {
  const url = safeUrl(d.permalink);
  const name = url
    ? h('a', { class: 'name', href: url, target: '_blank', rel: 'noopener noreferrer' }, `@${d.username}`)
    : h('span', { class: 'name' }, `@${d.username}`);
  const src = d.source === 'mention' ? 'упомянул вас' : d.keyword ? `по запросу «${d.keyword}»` : null;
  return h('div', { class: 'turn' },
    h('div', { class: 'rail' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, (d.username || '?').slice(0, 1)),
      withLine ? h('div', { class: 'line' }) : null),
    h('div', { class: 'body' },
      h('div', { class: 'who' },
        name,
        src ? h('span', { class: 'src' }, src) : null,
        h('span', { class: 'time' }, timeAgo(d.postedAt || d.createdAt)),
        d.score != null ? h('span', { class: 'score', title: INTENTS[d.intent] || '' }, `${d.score}/10`) : null,
      ),
      h('p', { class: 'post-text' }, d.postText),
    ),
  );
}

function draftCard(d) {
  const ta = h('textarea', { 'aria-label': `Ответ для @${d.username}`, value: d.text, rows: 4 });
  const counter = h('span');
  const linkBox = h('input', { type: 'checkbox', checked: d.includeLink });
  const linkLine = h('div', { class: 'link-line' }, state.settings?.productUrl || '');
  let saved = { text: d.text, includeLink: d.includeLink };

  const sync = () => {
    const len = finalLen(ta.value.trim(), linkBox.checked);
    counter.textContent = `${len} из ${THREADS_MAX} символов`;
    counter.className = len > THREADS_MAX ? 'over' : '';
    linkLine.hidden = !linkBox.checked;
    sendBtn.disabled = len > THREADS_MAX || !ta.value.trim();
  };
  const dirty = () => ta.value.trim() !== saved.text || linkBox.checked !== saved.includeLink;

  async function saveIfDirty() {
    if (!dirty()) return;
    const upd = await api(`/drafts/${encodeURIComponent(d.id)}`, {
      method: 'PATCH', body: { text: ta.value, includeLink: linkBox.checked },
    });
    saved = { text: upd.text, includeLink: upd.includeLink };
    ta.value = upd.text;
  }

  const card = h('article', { class: 'card', 'data-id': d.id });
  const leave = () => {
    card.classList.add('leaving');
    setTimeout(() => { card.remove(); if (!pageEl.querySelector('.queue .card')) navigate(); }, 220);
  };

  const sendBtn = h('button', {
    class: 'btn primary',
    onclick: (e) => withBusy(e.currentTarget, async () => {
      e.currentTarget.textContent = 'Отправляю…';
      try {
        await saveIfDirty();
        await api(`/drafts/${encodeURIComponent(d.id)}/send`, { method: 'POST' });
        toast(`Ответ @${d.username} отправлен`);
        leave();
      } catch (x) { toast(x.message, 'error'); }
    }),
  }, 'Отправить');
  const regenBtn = h('button', {
    class: 'btn',
    onclick: (e) => withBusy(e.currentTarget, async () => {
      e.currentTarget.textContent = 'Пишу…';
      try {
        const upd = await api(`/drafts/${encodeURIComponent(d.id)}/regenerate`, { method: 'POST' });
        saved = { text: upd.text, includeLink: upd.includeLink };
        ta.value = upd.text;
        linkBox.checked = upd.includeLink;
        sync();
      } catch (x) { toast(x.message, 'error'); }
    }),
  }, 'Другой вариант');
  const skipBtn = h('button', {
    class: 'btn quiet',
    onclick: (e) => withBusy(e.currentTarget, async () => {
      try { await api(`/drafts/${encodeURIComponent(d.id)}/skip`, { method: 'POST' }); leave(); }
      catch (x) { toast(x.message, 'error'); }
    }),
  }, 'Пропустить');

  ta.addEventListener('input', sync);
  ta.addEventListener('blur', () => saveIfDirty().catch((x) => toast(x.message, 'error')));
  linkBox.addEventListener('change', () => { sync(); saveIfDirty().catch((x) => toast(x.message, 'error')); });

  const replyTurn = h('div', { class: 'turn reply' },
    h('div', { class: 'rail' }, h('div', { class: 'avatar ours', 'aria-hidden': 'true' }, 'WS')),
    h('div', { class: 'body' },
      h('div', { class: 'who' }, h('span', { class: 'name' }, 'WeArt Studio'), h('span', { class: 'src' }, 'черновик ответа')),
      ta, linkLine,
      h('div', { class: 'reply-tools' },
        h('label', { class: 'switch' }, linkBox, 'Ссылка на сайт'),
        counter),
    ),
  );

  card.append(
    h('div', { class: 'thread' }, postTurn(d), replyTurn),
    h('div', { class: 'card-foot' },
      h('div', { class: 'why' }, d.reason ? `Почему этот пост: ${d.reason}` : d.source === 'mention' ? 'Вас упомянули в посте' : ''),
      h('div', { class: 'btns' }, skipBtn, regenBtn, sendBtn),
    ),
  );
  sync();
  return card;
}

async function renderQueue() {
  const drafts = await api('/drafts?status=pending');
  if (state.view !== 'queue') return;
  const subtitle = 'Агент нашёл эти посты и написал ответы. Текст можно поправить прямо в поле.';
  if (!drafts.length) {
    pageEl.replaceChildren(
      head('Очередь', subtitle),
      h('div', { class: 'empty' },
        h('strong', {}, 'Новых черновиков нет'),
        'Агент ищет посты по расписанию. Запустите поиск сейчас или добавьте ключевые слова в настройках.',
        h('div', {}, h('a', { class: 'btn', href: '#settings' }, 'Открыть настройки')),
      ),
    );
    return;
  }
  pageEl.replaceChildren(head('Очередь', subtitle), h('div', { class: 'queue' }, drafts.map(draftCard)));
}

// ── Лента активности ────────────────────────────────────────────
const KINDS = {
  search: 'Поиск', filter: 'Оценка', draft: 'Черновик', sent: 'Отправлено', skip: 'Пропуск',
  error: 'Ошибка', warn: 'Внимание', mention: 'Упоминания', system: 'Система',
};

function feedItem(e, fresh = false) {
  const url = safeUrl(e.meta?.url);
  return h('li', { class: fresh ? 'fresh' : '', 'data-day': new Date(e.at).toDateString() },
    h('time', { datetime: new Date(e.at).toISOString() }, clock(e.at)),
    h('span', { class: `kind k-${e.type}` }, KINDS[e.type] || e.type),
    h('span', { class: 'text' }, e.text,
      url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Открыть') : null,
      e.meta?.draftId && e.type === 'draft' ? h('a', { href: '#queue' }, 'В очередь') : null),
  );
}

async function renderFeed() {
  const items = await api('/activity?limit=400');
  if (state.view !== 'feed') return;
  const list = h('ul', { class: 'feed', id: 'feed' });
  let lastDay = null;
  for (const e of items) {
    const day = dayLabel(e.at);
    if (day !== lastDay) { list.append(h('li', { class: 'day', role: 'presentation' }, day)); lastDay = day; }
    list.append(feedItem(e));
  }
  pageEl.replaceChildren(
    head('Что делает агент', 'Каждый шаг: какие запросы искал, сколько нашёл, что оценил и почему пропустил. Обновляется сам.'),
    items.length ? list : h('div', { class: 'empty' }, h('strong', {}, 'Пока пусто'), 'Здесь появятся действия агента после первого поиска.'),
  );
}

function prependFeed(e) {
  const list = document.getElementById('feed');
  if (!list) { if (state.view === 'feed') navigate(); return; }
  const first = list.querySelector('li.day');
  const today = dayLabel(e.at);
  if (!first || first.textContent !== today) {
    list.prepend(feedItem(e, true));
    list.prepend(h('li', { class: 'day', role: 'presentation' }, today));
  } else {
    first.after(feedItem(e, true));
  }
}

// ── Оценки ──────────────────────────────────────────────────────
const OUTCOMES = {
  draft: ['Черновик создан', 'ok'],
  pending: ['В работе', 'muted'],
  below_threshold: ['Низкая оценка', 'muted'],
  limit: ['Не вошёл в лимит прогона', 'warn'],
  other_language: ['Другой язык', 'muted'],
  model_skipped: ['Модель решила не отвечать', 'warn'],
  admin_skipped: ['Вы пропустили', 'muted'],
  error: ['Ошибка', 'danger'],
};

async function renderScored() {
  const all = await api('/scored');
  if (state.view !== 'scored') return;
  const minScore = state.settings?.minScore ?? 7;
  const filters = {
    all: ['Все', () => true],
    taken: ['Взяты в работу', (p) => p.outcome === 'draft'],
    dropped: ['Отсеяны', (p) => p.outcome !== 'draft'],
  };
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Фильтр' },
    Object.entries(filters).map(([k, [label]]) => h('button', {
      class: 'chip', 'aria-pressed': String(state.scoredFilter === k),
      onclick: () => { state.scoredFilter = k; renderScored(); },
    }, label)));
  const list = all.filter(filters[state.scoredFilter][1]);
  const rows = list.map((p) => {
    const url = safeUrl(p.permalink);
    const [olabel, okind] = OUTCOMES[p.outcome] || [p.outcome, 'muted'];
    return h('div', { class: 'row' },
      h('div', { class: `num ${p.score >= minScore ? 'hi' : ''}`, 'aria-label': `Оценка ${p.score} из 10` }, String(p.score)),
      h('div', {},
        h('div', { class: 'meta' },
          url ? h('a', { class: 'name', href: url, target: '_blank', rel: 'noopener noreferrer' }, `@${p.username}`) : h('span', { class: 'name' }, `@${p.username}`),
          p.keyword ? h('span', {}, `«${p.keyword}»`) : null,
          h('span', {}, INTENTS[p.intent] || ''),
          h('span', {}, timeAgo(p.at)),
          h('span', { class: `tag ${okind}` }, olabel)),
        h('p', { class: 'excerpt' }, charLen(p.text) > 280 ? [...p.text].slice(0, 280).join('') + '…' : p.text),
        p.reason || p.note ? h('p', { class: 'reason' }, [p.reason, p.note].filter(Boolean).join('. ')) : null,
      ),
    );
  });
  pageEl.replaceChildren(
    head('Оценки постов', `Все посты, которые агент показал модели. В работу идут оценки от ${minScore} и выше.`, chips),
    rows.length ? h('div', { class: 'scored' }, rows) : h('div', { class: 'empty' }, h('strong', {}, 'Нет постов'), 'Оценки появятся после поиска.'),
  );
}

// ── Отправленные ────────────────────────────────────────────────
async function renderSent() {
  const list = await api('/drafts?status=sent');
  if (state.view !== 'sent') return;
  const cards = list.map((d) => {
    const replyUrl = safeUrl(d.replyPermalink);
    return h('article', { class: 'card' },
      h('div', { class: 'thread' },
        postTurn(d),
        h('div', { class: 'turn' },
          h('div', { class: 'rail' }, h('div', { class: 'avatar ours', 'aria-hidden': 'true' }, 'WS')),
          h('div', { class: 'body' },
            h('div', { class: 'who' },
              h('span', { class: 'name' }, 'WeArt Studio'),
              h('span', { class: 'time' }, `отправлено ${timeAgo(d.sentAt)}`),
              d.sentBy === 'auto' ? h('span', { class: 'tag muted' }, 'автоматически') : null,
              replyUrl ? h('a', { href: replyUrl, target: '_blank', rel: 'noopener noreferrer', class: 'src' }, 'Открыть в Threads') : null),
            h('p', { class: 'reply-text' }, d.finalText),
          ),
        ),
      ),
    );
  });
  pageEl.replaceChildren(
    head('Отправленные', `Всего ${state.stats?.sentTotal ?? list.length}, со ссылкой ${state.stats?.sentWithLink ?? 0}.`),
    cards.length ? h('div', { class: 'sent' }, cards) : h('div', { class: 'empty' }, h('strong', {}, 'Ещё ничего не отправлено'), 'Отправленные ответы появятся здесь со ссылками на них в Threads.'),
  );
}

// ── Настройки ───────────────────────────────────────────────────
async function renderSettings() {
  const s = await api('/settings');
  state.settings = s;
  if (state.view !== 'settings') return;

  const kw = h('textarea', { id: 'kw', value: s.keywords.join('\n') });
  const langs = h('input', { id: 'langs', type: 'text', value: (s.languages || []).join(', '), placeholder: 'en' });
  const info = h('textarea', { id: 'info', class: 'tall', value: s.productInfo });
  const url = h('input', { id: 'url', type: 'url', value: s.productUrl });
  const num = (id, label, hint, value, min, max) => {
    const input = h('input', { id, type: 'number', value, min, max, step: 1 });
    return [h('div', { class: 'field' }, h('label', { for: id }, label), input, h('small', {}, hint)), input];
  };
  const [fMin, iMin] = num('minScore', 'Минимальная оценка', 'От 0 до 10. Ниже — пост не берётся в работу.', s.minScore, 0, 10);
  const [fDr, iDr] = num('maxDrafts', 'Черновиков за прогон', 'Сколько лучших постов брать за один поиск.', s.maxDraftsPerRun, 1, 50);
  const [fKw, iKw] = num('kwRun', 'Запросов за прогон', 'Расходует недельный лимит Meta (450).', s.keywordsPerRun, 1, 30);
  const [fRep, iRep] = num('maxReplies', 'Ответов в сутки', 'Больше 20–30 — риск ограничений аккаунта.', s.maxRepliesPerDay, 1, 200);
  const [fCd, iCd] = num('cooldown', 'Пауза для одного автора, дней', 'Не отвечать одному человеку чаще.', s.userCooldownDays, 0, 365);
  const [fAge, iAge] = num('age', 'Возраст поста, часов', 'Старые посты пропускаются.', s.maxPostAgeHours, 1, 336);
  const auto = h('input', { type: 'checkbox', checked: s.autoApproveMentions });

  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Сохранить настройки');
  const form = h('form', {
    class: 'settings',
    onsubmit: (e) => {
      e.preventDefault();
      withBusy(saveBtn, async () => {
        try {
          state.settings = await api('/settings', {
            method: 'PUT',
            body: {
              keywords: kw.value, languages: langs.value, productInfo: info.value, productUrl: url.value,
              minScore: Number(iMin.value), maxDraftsPerRun: Number(iDr.value), keywordsPerRun: Number(iKw.value),
              maxRepliesPerDay: Number(iRep.value), userCooldownDays: Number(iCd.value), maxPostAgeHours: Number(iAge.value),
              autoApproveMentions: auto.checked,
            },
          });
          toast('Настройки сохранены');
        } catch (x) { toast(x.message, 'error'); }
      });
    },
  },
    h('fieldset', {},
      h('legend', {}, 'Что искать'),
      h('div', { class: 'field' },
        h('label', { for: 'kw' }, 'Ключевые слова'),
        kw,
        h('small', {}, 'По одному на строку. Агент проходит их по кругу, по несколько за прогон.')),
      h('div', { class: 'field' },
        h('label', { for: 'langs' }, 'Языки постов'),
        langs,
        h('small', {}, 'Коды через запятую: en — только английские посты. Пусто — любые. Упоминаний не касается.')),
    ),
    h('fieldset', {},
      h('legend', {}, 'Что говорить о продукте'),
      h('div', { class: 'field' },
        h('label', { for: 'info' }, 'Описание WeArt Studio для агента'),
        info,
        h('small', {}, 'Агент берёт факты только отсюда. Добавляйте новые модели и функции, убирайте то, что нельзя обещать.')),
      h('div', { class: 'field' },
        h('label', { for: 'url' }, 'Ссылка в ответах'),
        url,
        h('small', {}, 'С UTM-метками, чтобы видеть переходы из Threads в аналитике.')),
    ),
    h('fieldset', {},
      h('legend', {}, 'Лимиты'),
      h('div', { class: 'grid2' }, fMin, fDr, fKw, fRep, fCd, fAge),
      h('label', { class: 'switch' }, auto, 'Отвечать на упоминания без проверки'),
    ),
    h('div', { class: 'save-bar' }, saveBtn),
  );

  // Удаление данных по запросу человека (политика конфиденциальности)
  const who = h('input', { id: 'forget', type: 'text', placeholder: '@username', autocomplete: 'off' });
  const forgetBtn = h('button', { class: 'btn', type: 'submit' }, 'Удалить данные');
  const forget = h('form', {
    class: 'settings forget',
    onsubmit: (e) => {
      e.preventDefault();
      const name = who.value.trim();
      if (!name) return;
      if (!confirm(`Удалить все данные о ${name}? Агент больше никогда не будет ему отвечать. Отменить нельзя.`)) return;
      withBusy(forgetBtn, async () => {
        try {
          const r = await api('/forget', { method: 'POST', body: { username: name } });
          who.value = '';
          toast(`Удалено записей: ${r.removed}`);
        } catch (x) { toast(x.message, 'error'); }
      });
    },
  },
    h('fieldset', {},
      h('legend', {}, 'Удаление данных по запросу'),
      h('div', { class: 'field' },
        h('label', { for: 'forget' }, 'Имя пользователя Threads'),
        who,
        h('small', {}, 'Если человек попросил удалить его данные: стираются его посты, черновики и история, агент больше ему не отвечает.')),
      h('div', {}, forgetBtn),
    ),
  );
  // Подключение аккаунта Threads: вход на странице Threads, токен сохраняется на сервере
  const connect = h('div', { class: 'settings forget' },
    h('fieldset', {},
      h('legend', {}, 'Подключение Threads'),
      h('p', {}, state.stats?.account ? `Сейчас подключён @${state.stats.account}.` : 'Аккаунт Threads не подключён.'),
      h('small', {}, 'Откроется страница Threads: войдите аккаунтом бренда и нажмите «Разрешить». Токен сохранится на сервере сам. Пригодится и когда токен истёк.'),
      h('div', {}, h('a', { class: 'btn', href: `${API_BASE}/api/oauth/threads/start` }, 'Подключить Threads')),
    ),
  );
  pageEl.replaceChildren(head('Настройки', 'Изменения применяются со следующего прогона.'), form, connect, forget);
}

// ── Живые обновления ────────────────────────────────────────────
function connectEvents() {
  state.events?.close();
  const es = new EventSource(`${API_BASE}/api/events`, { withCredentials: true });
  state.events = es;
  es.addEventListener('stats', (m) => { state.stats = JSON.parse(m.data); renderStatus(); });
  es.addEventListener('activity', (m) => {
    const e = JSON.parse(m.data);
    if (state.view === 'feed') prependFeed(e);
    if (e.type === 'error') toast(e.text, 'error');
  });
  es.addEventListener('draft', (m) => {
    const d = JSON.parse(m.data);
    refreshStats();
    if (state.view !== 'queue') return;
    const existing = pageEl.querySelector(`.card[data-id="${CSS.escape(d.id)}"]`);
    if (d.status === 'pending' && !existing) {
      const queue = pageEl.querySelector('.queue');
      if (queue) queue.prepend(draftCard(d)); else navigate();
    } else if (d.status !== 'pending' && existing) {
      existing.remove();
      if (!pageEl.querySelector('.queue .card')) navigate();
    }
  });
  es.onerror = () => {
    // EventSource переподключается сам; проверим, не истекла ли сессия
    api('/me').catch(() => {});
  };
}

let statsTimer = null;
function refreshStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(async () => {
    try { state.stats = await api('/stats'); renderStatus(); } catch {}
  }, 300);
}

// ── Запуск ──────────────────────────────────────────────────────
async function boot() {
  try {
    await api('/me');
  } catch (e) {
    if (e.offline) showLogin(e.message); // иначе showLogin уже вызван в api()
    return;
  }
  renderShell();
  [state.stats, state.settings] = await Promise.all([api('/stats'), api('/settings')]);
  renderStatus();
  navigate();
  connectEvents();
}

window.addEventListener('hashchange', () => { if (navEl) navigate(); });
setInterval(() => { if (state.stats) renderStatus(); }, 60000);
boot();
