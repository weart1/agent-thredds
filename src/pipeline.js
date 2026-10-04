import { composeReply, charLen, THREADS_MAX } from './ai.js';

const HOUR = 60 * 60 * 1000;
const short = (s, n = 80) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return charLen(t) > n ? [...t].slice(0, n).join('') + '…' : t;
};

export function createPipeline(app) {
  const { config, store, threads, ai } = app;
  const S = () => store.settings;
  let searchRunning = false;
  let mentionsRunning = false;

  const ageHours = (ts) => (ts ? (Date.now() - new Date(ts).getTime()) / HOUR : 0);

  function createDraft(post, draft) {
    const d = {
      id: String(post.id),
      postId: String(post.id),
      username: post.username,
      permalink: post.permalink,
      postText: post.text,
      postedAt: post.timestamp || null,
      keyword: post.keyword || null,
      source: post.source,
      score: post.score ?? null,
      intent: post.intent ?? null,
      reason: post.reason ?? null,
      text: draft.text,
      includeLink: draft.includeLink,
      status: 'pending',
      createdAt: Date.now(),
    };
    store.data.drafts[d.id] = d;
    store.save();
    app.events.emit('draft', d);
    return d;
  }

  /** Публикует черновик в Threads. by — 'admin' или 'auto'. */
  async function publish(d, { by = 'admin' } = {}) {
    const { maxRepliesPerDay } = S();
    if (store.repliesLast24h() >= maxRepliesPerDay) {
      throw new Error(`Достигнут лимит ${maxRepliesPerDay} ответов за 24 часа. Его можно поднять в настройках.`);
    }
    const text = composeReply(d, S().productUrl);
    if (charLen(text) > THREADS_MAX) throw new Error(`Текст длиннее ${THREADS_MAX} символов (${charLen(text)}).`);

    const r = await threads.reply(d.postId, text);
    d.status = 'sent';
    d.sentAt = Date.now();
    d.sentBy = by;
    d.sentText = text;
    d.replyId = r.id;
    d.replyPermalink = r.permalink || null;
    store.data.repliedUsers[d.username] = Date.now();
    store.data.sentLog.push({ at: Date.now(), postId: d.postId, username: d.username, link: d.includeLink, source: d.source });
    store.save();
    app.log('sent', `Ответ отправлен @${d.username}${by === 'auto' ? ' (автоматически)' : ''}`, { draftId: d.id, url: d.replyPermalink });
    app.events.emit('draft', d);
    return d;
  }

  /** Поиск по ключевым словам → оценка → черновики. */
  async function runSearch({ manual = false } = {}) {
    if (searchRunning) return { message: 'Поиск уже идёт' };
    if (store.data.paused && !manual) return { message: 'Агент на паузе' };
    searchRunning = true;
    app.events.emit('status', { searchRunning: true });
    const stats = { keywords: [], found: 0, candidates: 0, relevant: 0, drafts: 0 };
    try {
      const budget = config.searchesPerWeek - store.searchesLast7d();
      if (budget <= 0) {
        app.log('warn', 'Недельный лимит поисковых запросов Meta исчерпан, поиск пропущен');
        return { message: 'Недельный лимит поиска исчерпан' };
      }

      const keywords = store.nextKeywords(S().keywords, Math.min(S().keywordsPerRun, budget));
      stats.keywords = keywords;
      app.log('search', `${manual ? 'Ручной' : 'Плановый'} поиск: ${keywords.join(', ')}`);
      const candidates = [];
      const dropped = { seen: 0, own: 0, old: 0, cooldown: 0 };
      // Один автор — один черновик: пропускаем тех, кому уже есть ответ в очереди
      const busyUsers = new Set(store.draftsByStatus('pending').map((d) => d.username));

      for (const kw of keywords) {
        let posts = [];
        try {
          posts = await threads.keywordSearch(kw);
        } catch (e) {
          app.log('error', `Поиск «${kw}» не удался: ${e.message}`);
          continue;
        } finally {
          store.logSearch();
        }
        stats.found += posts.length;
        for (const p of posts) {
          if (!p.text || store.isSeen(p.id)) { dropped.seen++; continue; }
          store.markSeen(p.id);
          if (p.username === app.me?.username) { dropped.own++; continue; }
          if (ageHours(p.timestamp) > S().maxPostAgeHours) { dropped.old++; continue; }
          if (store.isBlocked(p.username)) { dropped.cooldown++; continue; }
          if (busyUsers.has(p.username) || !store.canReplyToUser(p.username, S().userCooldownDays)) { dropped.cooldown++; continue; }
          busyUsers.add(p.username);
          candidates.push({ ...p, keyword: kw, source: 'search' });
        }
      }
      store.save();
      stats.candidates = candidates.length;
      app.log('search',
        `Найдено ${stats.found} постов, новых к оценке: ${candidates.length}` +
        ` (уже видели: ${dropped.seen}, старые: ${dropped.old}, автору уже отвечали или ответ ждёт в очереди: ${dropped.cooldown})`);
      if (!candidates.length) return stats;

      const scored = await ai.filterPosts(candidates);
      const minScore = S().minScore;
      // Языки рынка: пусто — любые. Пост без определённого языка не отсекаем
      const langs = S().languages || [];
      const langOk = (p) => !langs.length || !p.lang || langs.includes(p.lang);
      const passing = scored
        .filter((p) => langOk(p) && p.score >= minScore && p.intent !== 'off_topic')
        .sort((a, b) => b.score - a.score);
      const best = passing.slice(0, S().maxDraftsPerRun);
      const bestIds = new Set(best.map((p) => p.id));

      for (const p of scored) {
        store.addScored({
          id: p.id, keyword: p.keyword, username: p.username, text: p.text, permalink: p.permalink,
          score: p.score, intent: p.intent, reason: p.reason,
          lang: p.lang || null,
          outcome: bestIds.has(p.id) ? 'pending' : !langOk(p) ? 'other_language'
            : p.score >= minScore && p.intent !== 'off_topic' ? 'limit' : 'below_threshold',
        });
      }
      stats.relevant = best.length;
      app.log('filter', `Оценено ${scored.length} постов, подходят ${passing.length}, в работу взято ${best.length}`);

      for (const post of best) {
        try {
          const draft = await ai.draftReply(post);
          if (draft.skip) {
            store.setScoredOutcome(post.id, 'model_skipped', draft.reason);
            app.log('skip', `Пропущен пост @${post.username}: ${draft.reason}`, { url: post.permalink });
            continue;
          }
          createDraft(post, draft);
          store.setScoredOutcome(post.id, 'draft');
          stats.drafts++;
          app.log('draft', `Черновик для @${post.username} (${post.score}/10): «${short(draft.text)}»`, { draftId: post.id });
        } catch (e) {
          store.setScoredOutcome(post.id, 'error', e.message);
          app.log('error', `Не удалось написать ответ для @${post.username}: ${e.message}`);
        }
      }
      return stats;
    } finally {
      searchRunning = false;
      store.save();
      app.events.emit('status', { searchRunning: false });
    }
  }

  /** Упоминания вашего аккаунта. */
  async function runMentions({ manual = false } = {}) {
    if (mentionsRunning) return { message: 'Проверка упоминаний уже идёт' };
    if (store.data.paused && !manual) return { message: 'Агент на паузе' };
    mentionsRunning = true;
    let drafts = 0;
    try {
      const mentions = await threads.mentions();
      const fresh = mentions.filter((p) => p.text && !store.isSeen(p.id));
      if (manual || fresh.length) app.log('mention', `Проверка упоминаний: новых ${fresh.length}`);
      for (const p of fresh) {
        store.markSeen(p.id);
        if (p.username === app.me?.username || store.isBlocked(p.username)) continue;
        if (ageHours(p.timestamp) > S().maxPostAgeHours) continue;

        const post = { ...p, source: 'mention' };
        const draft = await ai.draftReply(post);
        if (draft.skip) {
          app.log('skip', `Упоминание от @${p.username} пропущено: ${draft.reason}`, { url: p.permalink });
          continue;
        }
        const d = createDraft(post, draft);
        drafts++;
        app.log('draft', `Черновик ответа на упоминание от @${p.username}`, { draftId: d.id });

        if (S().autoApproveMentions) {
          try {
            await publish(d, { by: 'auto' });
          } catch (e) {
            app.log('error', `Автоответ @${p.username} не отправлен, ждёт вас в очереди: ${e.message}`);
          }
        }
      }
      return { mentions: mentions.length, drafts };
    } finally {
      mentionsRunning = false;
      store.save();
    }
  }

  const MAX_WATCH_POSTS = 300;
  const WATCH_PER_RUN = 15;   // аккаунтов за один прогон (лимит Profile Discovery — 1000 запросов в сутки)
  let watchRunning = false;

  /** Свежие посты отслеживаемых аккаунтов → вкладка «Отслеживаемые». Черновик — по кнопке. */
  async function runWatch({ manual = false } = {}) {
    const users = S().watchUsers || [];
    if (!users.length) return { message: 'Список отслеживаемых аккаунтов пуст' };
    if (watchRunning) return { message: 'Обновление уже идёт' };
    if (store.data.paused && !manual) return { message: 'Агент на паузе' };
    watchRunning = true;
    let added = 0;
    try {
      const n = Math.min(WATCH_PER_RUN, users.length);
      const start = (store.data.watchCursor || 0) % users.length;
      const batch = Array.from({ length: n }, (_, i) => users[(start + i) % users.length]);
      store.data.watchCursor = (start + n) % users.length;
      const known = new Set(store.data.watchPosts.map((p) => p.id));
      const errors = [];
      for (const u of batch) {
        let posts = [];
        try {
          posts = await threads.profilePosts(u);
        } catch (e) {
          errors.push(`@${u}: ${e.message}`);
          continue;
        }
        for (const p of posts) {
          if (!p.text || known.has(String(p.id)) || store.isBlocked(p.username || u)) continue;
          if (ageHours(p.timestamp) > S().maxPostAgeHours) continue;
          known.add(String(p.id));
          store.data.watchPosts.push({
            at: Date.now(), id: String(p.id), username: p.username || u, text: p.text,
            permalink: p.permalink || null, postedAt: p.timestamp || null,
          });
          added++;
        }
      }
      if (store.data.watchPosts.length > MAX_WATCH_POSTS) store.data.watchPosts.splice(0, store.data.watchPosts.length - MAX_WATCH_POSTS);
      if (manual || added || errors.length) {
        app.log('watch', `Отслеживаемые: проверено ${batch.length} акк., новых постов ${added}`);
      }
      if (errors.length) app.log('error', `Не удалось получить посты: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` и ещё ${errors.length - 3}` : ''}`);
      app.events.emit('watch', { added });
      return { checked: batch.length, added };
    } finally {
      watchRunning = false;
      store.save();
    }
  }

  /** Черновик ответа на пост отслеживаемого аккаунта (по кнопке в админке). */
  async function draftForWatchPost(id) {
    const wp = store.data.watchPosts.find((p) => p.id === id);
    if (!wp) throw Object.assign(new Error('Пост не найден, обновите список'), { status: 404 });
    const existing = store.data.drafts[id];
    if (existing && existing.status === 'pending') return existing;
    if (existing && existing.status === 'sent') throw Object.assign(new Error('На этот пост уже отправлен ответ'), { status: 409 });
    if (!store.canReplyToUser(wp.username, S().userCooldownDays)) {
      throw Object.assign(new Error(`@${wp.username} уже отвечали за последние ${S().userCooldownDays} дн. (пауза для автора в настройках)`), { status: 409 });
    }
    if (store.draftsByStatus('pending').some((d) => d.username === wp.username)) {
      throw Object.assign(new Error(`Для @${wp.username} уже есть черновик в очереди`), { status: 409 });
    }
    const post = { id: wp.id, username: wp.username, text: wp.text, permalink: wp.permalink, timestamp: wp.postedAt, source: 'watch' };
    const draft = await ai.draftReply(post);
    if (draft.skip) throw Object.assign(new Error(`Модель предлагает не отвечать: ${draft.reason}`), { status: 422 });
    const d = createDraft(post, draft);
    app.log('draft', `Черновик для @${wp.username} (отслеживаемый аккаунт)`, { draftId: d.id });
    return d;
  }

  const status = () => ({ searchRunning, mentionsRunning, watchRunning });

  return { runSearch, runMentions, runWatch, draftForWatchPost, publish, status };
}
