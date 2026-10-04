import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DAY = 24 * 60 * 60 * 1000;
const MAX_ACTIVITY = 1500;
const MAX_SCORED = 600;
// Сроки хранения. Совпадают с политикой конфиденциальности (META.md, раздел 1.9) — менять вместе.
const POST_DAYS = 30;  // посты, оценки, лента действий, необработанные черновики
const SENT_DAYS = 90;  // отправленные ответы и пауза для авторов

/** Необратимый хэш имени: позволяет не отвечать человеку снова, не храня само имя. */
const userHash = (username) =>
  crypto.createHash('sha256').update(String(username).replace(/^@/, '').trim().toLowerCase()).digest('hex');

const EMPTY = {
  token: null,
  tokenRefreshedAt: null,
  paused: false,
  keywordCursor: 0,
  settings: null,
  seenPosts: {},   // postId -> timestamp
  searchLog: [],   // timestamps поисковых запросов
  drafts: {},      // postId -> черновик
  repliedUsers: {},// username -> timestamp
  blockedUsers: {}, // sha256(username) -> timestamp: попросили удалить данные, больше не отвечаем
  sentLog: [],
  activity: [],    // лента действий агента (новые в конце)
  scored: [],      // все оценённые посты с причинами (новые в конце)
  watchPosts: [],  // свежие посты отслеживаемых аккаунтов (новые в конце)
  watchCursor: 0,
};

/** Хранилище в JSON-файле. Для одного агента этого достаточно. */
export class Store {
  constructor(file, defaultSettings) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    this.data = { ...structuredClone(EMPTY), ...saved };
    this.data.settings = { ...defaultSettings, ...(saved.settings || {}) };
    this.saveTimer = null;
  }

  get settings() { return this.data.settings; }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** Отложенное сохранение для частых мелких изменений (лента активности). */
  saveSoon() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 1000);
  }

  addActivity(type, text, meta = {}) {
    const entry = { id: crypto.randomUUID(), at: Date.now(), type, text, meta };
    this.data.activity.push(entry);
    if (this.data.activity.length > MAX_ACTIVITY) this.data.activity.splice(0, this.data.activity.length - MAX_ACTIVITY);
    this.saveSoon();
    return entry;
  }

  addScored(entry) {
    this.data.scored.push({ at: Date.now(), ...entry });
    if (this.data.scored.length > MAX_SCORED) this.data.scored.splice(0, this.data.scored.length - MAX_SCORED);
  }

  setScoredOutcome(id, outcome, note) {
    for (let i = this.data.scored.length - 1; i >= 0; i--) {
      if (this.data.scored[i].id === id) {
        this.data.scored[i].outcome = outcome;
        if (note) this.data.scored[i].note = note;
        return;
      }
    }
  }

  isSeen(id) { return Boolean(this.data.seenPosts[id]); }
  markSeen(id) { this.data.seenPosts[id] = Date.now(); }

  searchesLast7d() {
    const cutoff = Date.now() - 7 * DAY;
    this.data.searchLog = this.data.searchLog.filter((t) => t > cutoff);
    return this.data.searchLog.length;
  }
  logSearch() { this.data.searchLog.push(Date.now()); }

  /** Следующие n ключевых слов по кругу. */
  nextKeywords(all, n) {
    if (!all.length || n <= 0) return [];
    const start = this.data.keywordCursor % all.length;
    const out = [];
    for (let i = 0; i < Math.min(n, all.length); i++) out.push(all[(start + i) % all.length]);
    this.data.keywordCursor = (start + out.length) % all.length;
    return out;
  }

  repliesLast24h() {
    const cutoff = Date.now() - DAY;
    return this.data.sentLog.filter((s) => s.at > cutoff).length;
  }

  canReplyToUser(username, cooldownDays) {
    const last = this.data.repliedUsers[username];
    return !last || Date.now() - last > cooldownDays * DAY;
  }

  isBlocked(username) { return Boolean(this.data.blockedUsers[userHash(username)]); }

  /** Удаляет всё о пользователе (запрос на удаление данных) и запрещает отвечать ему снова. */
  forgetUser(username) {
    const name = String(username).replace(/^@/, '').trim();
    if (!name) return 0;
    const same = (u) => String(u || '').toLowerCase() === name.toLowerCase();
    let removed = 0;
    for (const [id, d] of Object.entries(this.data.drafts)) {
      if (same(d.username)) { delete this.data.drafts[id]; delete this.data.seenPosts[id]; removed++; }
    }
    const keep = (arr, pred) => {
      const before = arr.length;
      const out = arr.filter(pred);
      removed += before - out.length;
      return out;
    };
    this.data.scored = keep(this.data.scored, (p) => !same(p.username));
    this.data.watchPosts = keep(this.data.watchPosts, (p) => !same(p.username));
    this.data.sentLog = keep(this.data.sentLog, (s) => !same(s.username));
    const mention = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w|\\.\\w)`, 'i');
    this.data.activity = keep(this.data.activity, (e) => !mention.test(e.text));
    for (const u of Object.keys(this.data.repliedUsers)) {
      if (same(u)) { delete this.data.repliedUsers[u]; removed++; }
    }
    this.data.blockedUsers[userHash(name)] = Date.now();
    this.save();
    return removed;
  }

  draftsByStatus(status) {
    return Object.values(this.data.drafts).filter((d) => !status || d.status === status);
  }

  prune() {
    const now = Date.now();
    const maxAge = this.settings.maxPostAgeHours * 60 * 60 * 1000;
    let expired = 0;
    for (const [id, t] of Object.entries(this.data.seenPosts)) {
      if (now - t > POST_DAYS * DAY) delete this.data.seenPosts[id];
    }
    for (const [id, d] of Object.entries(this.data.drafts)) {
      if (d.status === 'pending' && now - d.createdAt > maxAge) { d.status = 'expired'; expired++; }
      if (d.status !== 'pending' && d.status !== 'sent' && now - d.createdAt > POST_DAYS * DAY) delete this.data.drafts[id];
      if (d.status === 'sent' && now - (d.sentAt || d.createdAt) > SENT_DAYS * DAY) delete this.data.drafts[id];
    }
    this.data.scored = this.data.scored.filter((p) => now - p.at < POST_DAYS * DAY);
    this.data.watchPosts = this.data.watchPosts.filter((p) => now - p.at < POST_DAYS * DAY);
    this.data.activity = this.data.activity.filter((e) => now - e.at < POST_DAYS * DAY);
    this.data.sentLog = this.data.sentLog.filter((s) => now - s.at < SENT_DAYS * DAY);
    // Имя автора держим, пока действует пауза, но не меньше SENT_DAYS
    const replyKeep = Math.max(SENT_DAYS, this.settings.userCooldownDays || 0) * DAY;
    for (const [u, t] of Object.entries(this.data.repliedUsers)) {
      if (now - t > replyKeep) delete this.data.repliedUsers[u];
    }
    this.save();
    return expired;
  }
}
