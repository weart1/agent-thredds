import Anthropic from '@anthropic-ai/sdk';

const THREADS_MAX = 500;
const charLen = (s) => [...s].length;

/** Название продукта всегда полностью: «WeArt» и «WeArt AI» → «WeArt Studio». */
export function enforceBrand(text) {
  return text.replace(/\bWeArt\b(?!\s+Studio)(?:\s+AI\b)?/gi, 'WeArt Studio');
}

/** Итоговый текст ответа: черновик + ссылка (если включена). */
export function composeReply(draft, url) {
  return draft.includeLink ? `${draft.text}\n\n${url}` : draft.text;
}

const FILTER_TOOL = {
  name: 'report_relevance',
  description: 'Вернуть оценку релевантности для каждого поста',
  input_schema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            intent: { type: 'string', enum: ['looking_for_tool', 'asking_how_to', 'discussion', 'off_topic'] },
            lang: { type: 'string', description: 'Язык поста: код ISO 639-1 (en, ru, es, ...)' },
            score: { type: 'integer', minimum: 0, maximum: 10 },
            reason: { type: 'string' },
          },
          required: ['id', 'intent', 'score'],
        },
      },
    },
    required: ['results'],
  },
};

const DRAFT_TOOL = {
  name: 'write_reply',
  description: 'Вернуть ответ на пост или пропустить его',
  input_schema: {
    type: 'object',
    properties: {
      skip: { type: 'boolean', description: 'true, если отвечать не стоит' },
      skip_reason: { type: 'string' },
      reply: { type: 'string', description: 'Текст ответа БЕЗ ссылки' },
      include_link: { type: 'boolean', description: 'Добавить ли ссылку на WeArt Studio' },
    },
    required: ['skip'],
  },
};

const FILTER_SYSTEM = `Ты помогаешь команде WeArt Studio (AI-платформа для генерации изображений, видео, аудио и чата с ИИ) находить в Threads посты, где уместно вежливо помочь человеку и упомянуть продукт.

Оцени каждый пост от 0 до 10:
- 9–10: человек прямо ищет сервис/нейросеть для картинок, видео, музыки, озвучки или спрашивает, что выбрать.
- 7–8: спрашивает, как сделать AI-контент (видео, арт, клип), и рекомендация инструмента будет естественной.
- 4–6: общее обсуждение AI-генерации, где реклама выглядела бы навязчиво.
- 0–3: не по теме, новости, критика ИИ, мемы, реклама других сервисов, посты компаний-конкурентов, политика, трагедии, NSFW, всё, что связано с детьми.

Будь строгим: лучше пропустить пост, чем ответить там, где это неуместно.

Для каждого поста укажи lang — язык поста кодом ISO 639-1 (en, ru, es, ...).`;

const draftSystem = (productInfo, url) => `Ты пишешь ответы в Threads от лица команды WeArt Studio.

О продукте:
${productInfo}

Правила:
1. Название продукта — ВСЕГДА полностью «WeArt Studio». Никогда не пиши просто «WeArt» или «WeArt AI».
2. Сначала по-настоящему помоги: 1–2 предложения по сути вопроса (какая модель подойдёт, совет по промпту, подход).
3. Упоминай WeArt Studio естественно и честно говори, что это ваш продукт («мы делаем WeArt Studio…», «у нас в WeArt Studio…»).
4. Пиши на языке поста. Тон живой и дружелюбный, как у человека, а не рекламы.
5. До 350 символов. Без хэштегов, максимум одно эмодзи, без капса и рекламных штампов.
6. НЕ вставляй ссылку в текст — система добавит её сама (${url}). Ставь include_link=true только если человек прямо ищет сервис или спрашивает, где это сделать.
7. Не выдумывай цены, бесплатный доступ и функции, которых нет в описании. Не принижай конкурентов.
8. Если ответ будет выглядеть навязчиво или пост не подходит — skip=true.`;

/** Вызов модели через Claude API напрямую. Возвращает аргументы инструмента. */
function anthropicCaller(cfg) {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  return async ({ model, system, user, tool, maxTokens }) => {
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
    });
    const block = res.content.find((b) => b.type === 'tool_use');
    if (!block) throw new Error('Модель не вернула структурированный ответ');
    return block.input;
  };
}

/** Вызов модели через Runware (OpenAI-совместимый /chat/completions). Возвращает аргументы инструмента. */
function runwareCaller(cfg, fetchFn) {
  return async ({ model, system, user, tool, maxTokens }) => {
    const res = await fetchFn(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        tools: [{ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }],
        tool_choice: { type: 'function', function: { name: tool.name } },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error || json.errors?.length) {
      const msg = json.error?.message || json.errors?.[0]?.message || `HTTP ${res.status}`;
      throw new Error(`Runware (${model}): ${msg}`);
    }
    const message = json.choices?.[0]?.message;
    const call = message?.tool_calls?.find((c) => c.function?.name === tool.name) || message?.tool_calls?.[0];
    const raw = call?.function?.arguments ?? String(message?.content || '').match(/\{[\s\S]*\}/)?.[0];
    if (!raw) throw new Error('Модель не вернула структурированный ответ');
    if (typeof raw === 'object') return raw;
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('Модель вернула некорректный JSON');
    }
  };
}

export function createAI(config, getSettings, { fetch: fetchFn = fetch } = {}) {
  const cfg = config.ai;
  const callTool = cfg.provider === 'anthropic' ? anthropicCaller(cfg) : runwareCaller(cfg, fetchFn);

  /** Оценивает посты пачками по 20 штук дешёвой моделью. */
  async function filterPosts(posts) {
    const out = [];
    for (let i = 0; i < posts.length; i += 20) {
      const batch = posts.slice(i, i + 20);
      const user = batch
        .map((p) => `<post id="${p.id}">\n${String(p.text).slice(0, 800)}\n</post>`)
        .join('\n\n');
      const r = await callTool({
        model: cfg.filterModel,
        system: FILTER_SYSTEM,
        user,
        tool: FILTER_TOOL,
        maxTokens: 4000,
      });
      const byId = new Map((r.results || []).map((x) => [String(x.id), x]));
      for (const p of batch) {
        const v = byId.get(String(p.id));
        if (v) out.push({ ...p, intent: v.intent, score: v.score, reason: v.reason, lang: v.lang ? String(v.lang).toLowerCase().slice(0, 5) : null });
      }
    }
    return out;
  }

  /** Пишет ответ на пост. previous — прошлый вариант, если нужен другой. */
  async function draftReply(post, { previous } = {}) {
    let user = `Пост от @${post.username}${post.keyword ? ` (найден по запросу «${post.keyword}»)` : ''}:\n<post>\n${post.postText ?? post.text}\n</post>`;
    if (previous) {
      user += `\n\nПредыдущий вариант ответа не подошёл:\n<previous>${previous}</previous>\nНапиши заметно другой вариант.`;
    }
    const { productInfo, productUrl } = getSettings();
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await callTool({
        model: cfg.draftModel,
        system: draftSystem(productInfo, productUrl),
        user,
        tool: DRAFT_TOOL,
        maxTokens: 1000,
      });
      if (r.skip || !r.reply) return { skip: true, reason: r.skip_reason || 'модель решила пропустить' };
      const text = enforceBrand(r.reply.replace(/https?:\/\/\S+/g, '').trim());
      const includeLink = Boolean(r.include_link);
      const full = composeReply({ text, includeLink }, productUrl);
      if (charLen(full) <= THREADS_MAX) return { skip: false, text, includeLink };
      user += `\n\nТвой ответ получился слишком длинным (${charLen(full)} символов с ссылкой). Сократи до 300 символов.`;
    }
    return { skip: true, reason: 'не удалось уложиться в 500 символов' };
  }

  return { filterPosts, draftReply };
}

export { charLen, THREADS_MAX };
