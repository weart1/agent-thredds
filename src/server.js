import express from 'express';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { composeReply, enforceBrand, charLen, THREADS_MAX } from './ai.js';

const COOKIE = 'wa_session';
const SESSION_DAYS = 14;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createServer(app) {
  const { config, store } = app;
  const server = express();
  server.disable('x-powered-by');
  server.set('trust proxy', 1);
  server.use(express.json({ limit: '300kb' }));

  server.use((req, res, next) => {
    res.set({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
        "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    next();
  });

  // Проверка, что сервер жив (для деплоя и мониторинга). Без авторизации и без данных.
  server.get('/healthz', (req, res) => res.json({ ok: true }));

  // ── Сессии: подписанная cookie, без внешних библиотек ──────────
  const sign = (v) => crypto.createHmac('sha256', config.admin.sessionSecret).update(v).digest('base64url');
  const makeToken = () => {
    const exp = String(Date.now() + SESSION_DAYS * 864e5);
    return `${exp}.${sign(exp)}`;
  };
  const validToken = (t) => {
    if (!t) return false;
    const [exp, sig] = t.split('.');
    if (!exp || !sig) return false;
    const expected = sign(exp);
    if (sig.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) && Number(exp) > Date.now();
  };
  const readCookie = (req) => {
    const raw = req.headers.cookie || '';
    const m = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
    return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
  };
  const cookieAttrs = `Path=/; HttpOnly; SameSite=Strict${config.admin.cookieSecure ? '; Secure' : ''}`;

  // Защита от подбора пароля: 5 ошибок → блокировка на 15 минут
  const attempts = new Map();
  const passwordOk = (input) => {
    const a = crypto.createHash('sha256').update(String(input)).digest();
    const b = crypto.createHash('sha256').update(config.admin.password).digest();
    return crypto.timingSafeEqual(a, b);
  };

  server.post('/api/login', async (req, res) => {
    const key = req.ip;
    const rec = attempts.get(key) || { count: 0, until: 0 };
    if (rec.until > Date.now()) {
      return res.status(429).json({ error: 'Слишком много попыток. Попробуйте через 15 минут.' });
    }
    if (!passwordOk(req.body?.password ?? '')) {
      rec.count++;
      if (rec.count >= 5) { rec.until = Date.now() + 15 * 60 * 1000; rec.count = 0; }
      attempts.set(key, rec);
      await new Promise((r) => setTimeout(r, 600));
      app.log('warn', `Неудачная попытка входа в админку (${key})`);
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    attempts.delete(key);
    res.set('Set-Cookie', `${COOKIE}=${makeToken()}; ${cookieAttrs}; Max-Age=${SESSION_DAYS * 86400}`);
    res.json({ ok: true });
  });

  server.post('/api/logout', (req, res) => {
    res.set('Set-Cookie', `${COOKIE}=; ${cookieAttrs}; Max-Age=0`);
    res.json({ ok: true });
  });

  const auth = (req, res, next) => {
    if (validToken(readCookie(req))) return next();
    res.status(401).json({ error: 'Нужно войти' });
  };

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const getDraft = (id, { pending = true } = {}) => {
    const d = store.data.drafts[id];
    if (!d) throw new HttpError(404, 'Черновик не найден');
    if (pending && d.status !== 'pending') throw new HttpError(409, 'Этот черновик уже обработан');
    return d;
  };
  const withPreview = (d) => ({ ...d, finalText: d.sentText || composeReply(d, store.settings.productUrl) });

  const api = express.Router();
  api.use(auth);

  api.get('/me', (req, res) => res.json({ ok: true, account: app.me?.username || null }));

  api.get('/stats', (req, res) => res.json(stats()));

  function stats() {
    const sent = store.data.sentLog;
    return {
      account: app.me?.username || null,
      paused: store.data.paused,
      ...app.pipeline.status(),
      searches7d: store.searchesLast7d(),
      searchesPerWeek: config.searchesPerWeek,
      replies24h: store.repliesLast24h(),
      maxRepliesPerDay: store.settings.maxRepliesPerDay,
      pending: store.draftsByStatus('pending').length,
      sentTotal: sent.length,
      sentWithLink: sent.filter((s) => s.link).length,
      nextSearchAt: app.nextRun?.('search') || null,
    };
  }
  app.stats = stats;

  api.get('/drafts', (req, res) => {
    const status = String(req.query.status || 'pending');
    const list = store.draftsByStatus(status)
      .sort((a, b) => (status === 'sent' ? (b.sentAt || 0) - (a.sentAt || 0) : b.createdAt - a.createdAt))
      .slice(0, 200)
      .map(withPreview);
    res.json(list);
  });

  api.patch('/drafts/:id', (req, res) => {
    const d = getDraft(req.params.id);
    const next = { ...d };
    if (typeof req.body.text === 'string') {
      const t = enforceBrand(req.body.text.trim());
      if (!t) throw new HttpError(400, 'Текст ответа пустой');
      next.text = t;
    }
    if (typeof req.body.includeLink === 'boolean') next.includeLink = req.body.includeLink;
    const len = charLen(composeReply(next, store.settings.productUrl));
    if (len > THREADS_MAX) throw new HttpError(400, `Слишком длинно: ${len} из ${THREADS_MAX} символов с учётом ссылки`);
    Object.assign(d, { text: next.text, includeLink: next.includeLink, edited: true });
    store.save();
    app.events.emit('draft', d);
    res.json(withPreview(d));
  });

  api.post('/drafts/:id/send', wrap(async (req, res) => {
    const d = getDraft(req.params.id);
    await app.pipeline.publish(d, { by: 'admin' });
    res.json(withPreview(d));
  }));

  api.post('/drafts/:id/skip', (req, res) => {
    const d = getDraft(req.params.id);
    d.status = 'skipped';
    d.skippedAt = Date.now();
    store.setScoredOutcome(d.id, 'admin_skipped');
    store.save();
    app.log('skip', `Вы пропустили пост @${d.username}`, { draftId: d.id });
    app.events.emit('draft', d);
    res.json(withPreview(d));
  });

  api.post('/drafts/:id/regenerate', wrap(async (req, res) => {
    const d = getDraft(req.params.id);
    const nd = await app.ai.draftReply(d, { previous: d.text });
    if (nd.skip) throw new HttpError(422, `Модель предлагает пропустить пост: ${nd.reason}`);
    Object.assign(d, { text: nd.text, includeLink: nd.includeLink, edited: false });
    store.save();
    app.events.emit('draft', d);
    res.json(withPreview(d));
  }));

  api.get('/activity', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 300, 1500);
    res.json(store.data.activity.slice(-limit).reverse());
  });

  api.get('/scored', (req, res) => {
    res.json(store.data.scored.slice(-400).reverse());
  });

  api.get('/settings', (req, res) => res.json(store.settings));

  api.put('/settings', (req, res) => {
    const b = req.body || {};
    const s = { ...store.settings };
    const int = (k, min, max) => {
      if (b[k] === undefined) return;
      const v = Number(b[k]);
      if (!Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `Поле «${k}»: целое число от ${min} до ${max}`);
      s[k] = v;
    };
    if (b.keywords !== undefined) {
      const list = (Array.isArray(b.keywords) ? b.keywords : String(b.keywords).split('\n'))
        .map((k) => String(k).trim()).filter(Boolean);
      const unique = [...new Set(list)];
      if (!unique.length) throw new HttpError(400, 'Нужно хотя бы одно ключевое слово');
      if (unique.length > 200) throw new HttpError(400, 'Не больше 200 ключевых слов');
      s.keywords = unique;
    }
    if (b.productInfo !== undefined) {
      if (!String(b.productInfo).trim()) throw new HttpError(400, 'Описание продукта не может быть пустым');
      s.productInfo = String(b.productInfo).slice(0, 20000);
    }
    if (b.productUrl !== undefined) {
      let u;
      try { u = new URL(String(b.productUrl)); } catch { throw new HttpError(400, 'Ссылка на продукт некорректна'); }
      if (u.protocol !== 'https:') throw new HttpError(400, 'Ссылка должна начинаться с https://');
      s.productUrl = u.toString();
    }
    int('keywordsPerRun', 1, 30);
    int('maxDraftsPerRun', 1, 50);
    int('minScore', 0, 10);
    int('maxRepliesPerDay', 1, 200);
    int('userCooldownDays', 0, 365);
    int('maxPostAgeHours', 1, 24 * 14);
    if (typeof b.autoApproveMentions === 'boolean') s.autoApproveMentions = b.autoApproveMentions;
    store.data.settings = s;
    store.save();
    app.log('system', 'Настройки обновлены');
    app.events.emit('stats', stats());
    res.json(s);
  });

  api.post('/pause', (req, res) => {
    store.data.paused = Boolean(req.body?.paused);
    store.save();
    app.log('system', store.data.paused ? 'Агент поставлен на паузу' : 'Агент снова работает');
    app.events.emit('stats', stats());
    res.json(stats());
  });

  // Запуск в фоне: результат придёт в ленту через события
  api.post('/run/search', (req, res) => {
    app.pipeline.runSearch({ manual: true })
      .then((r) => { if (r?.message) app.log('system', r.message); })
      .catch((e) => app.log('error', `Поиск упал: ${e.message}`))
      .finally(() => app.events.emit('stats', stats()));
    res.status(202).json({ ok: true });
  });

  api.post('/run/mentions', (req, res) => {
    app.pipeline.runMentions({ manual: true })
      .then((r) => { if (r?.message) app.log('system', r.message); })
      .catch((e) => app.log('error', `Проверка упоминаний упала: ${e.message}`))
      .finally(() => app.events.emit('stats', stats()));
    res.status(202).json({ ok: true });
  });

  // Живые обновления для админки (Server-Sent Events)
  api.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const onActivity = (e) => send('activity', e);
    const onDraft = (d) => send('draft', withPreview(d));
    const onStats = (s) => send('stats', s);
    const onStatus = () => send('stats', stats());
    app.events.on('activity', onActivity);
    app.events.on('draft', onDraft);
    app.events.on('stats', onStats);
    app.events.on('status', onStatus);
    send('stats', stats());
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      app.events.off('activity', onActivity);
      app.events.off('draft', onDraft);
      app.events.off('stats', onStats);
      app.events.off('status', onStatus);
    });
  });

  server.use('/api', api);
  server.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { index: 'index.html' }));

  server.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Внутренняя ошибка' });
  });

  return server;
}
