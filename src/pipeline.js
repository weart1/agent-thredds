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
      const passing = scored
        .filter((p) => p.score >= minScore && p.intent !== 'off_topic')
        .sort((a, b) => b.score - a.score);
      const best = passing.slice(0, S().maxDraftsPerRun);
      const bestIds = new Set(best.map((p) => p.id));

      for (const p of scored) {
        store.addScored({
          id: p.id, keyword: p.keyword, username: p.username, text: p.text, permalink: p.permalink,
          score: p.score, intent: p.intent, reason: p.reason,
          outcome: bestIds.has(p.id) ? 'pending' : p.score >= minScore && p.intent !== 'off_topic' ? 'limit' : 'below_threshold',
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

  const status = () => ({ searchRunning, mentionsRunning });

  return { runSearch, runMentions, publish, status };
}
