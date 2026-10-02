# Этап 1. Meta: приложение, разрешения и заявка на проверку

Всё для этапа 1 в одном файле: куда нажимать, что вписывать и готовые тексты для заявки.
Кабинет Meta часто меняет названия кнопок. Если пункт называется иначе, ищите похожий
по смыслу или пришлите мне скриншот.

Что потребуется: аккаунт Facebook, к которому привязан Instagram/Threads бренда,
телефон для подтверждения, доступ к сайту weartstudio.io (чтобы добавить 2 страницы).

---

## 1.1. Подготовка аккаунта Threads (10 минут)

1. Аккаунт Threads бренда **публичный**: Threads → Профиль → ☰ → Конфиденциальность → «Закрытый профиль» выключен.
2. Профиль оформлен: аватар, описание («AI-платформа для картинок, видео и музыки»), ссылка на weartstudio.io.
3. Есть хотя бы 5–10 своих постов. Если их нет, опубликуйте несколько полезных постов до запуска агента.
4. Включена двухфакторная аутентификация (в Instagram: Настройки → Центр аккаунтов → Пароль и безопасность).

## 1.2. Аккаунт разработчика (5 минут)

1. Откройте **developers.facebook.com** → **Get Started** (или «Начать»).
2. Войдите аккаунтом Facebook, который связан с Instagram бренда.
3. Подтвердите телефон и email, примите условия, роль: **Developer**.

## 1.3. Бизнес-портфолио (рекомендуется, 10 минут + ожидание)

Для одобрения разрешений Meta часто требует **подтверждённый бизнес**. Лучше начать сразу.

1. **business.facebook.com** → создайте бизнес-портфолио WeArt Studio (если его ещё нет).
2. **Настройки компании → Центр безопасности → Подтверждение компании** → «Начать».
   Понадобятся юридическое название, адрес, телефон и сайт, иногда документы о регистрации.
   Проверка занимает от 1 до нескольких дней.

## 1.4. Создание приложения (10 минут)

1. developers.facebook.com → **My Apps** → **Create App**.
2. **App name:** `WeArt Studio Agent`. **Contact email:** рабочая почта.
3. **Use case:** выберите **Access the Threads API**.
4. **Business:** выберите бизнес-портфолио WeArt Studio (если просят).
5. Нажмите **Create app** и подтвердите паролем.

## 1.5. Разрешения (5 минут)

Откройте **Use cases → Access the Threads API → Customize** (или «Настроить»).
Включите (кнопка **Add** у каждого):

| Разрешение | Для чего агенту |
|---|---|
| `threads_basic` | узнать имя и ID аккаунта |
| `threads_content_publish` | публиковать ответы |
| `threads_manage_replies` | публиковать ответы на чужие посты |
| `threads_keyword_search` | искать посты по ключевым словам |
| `threads_manage_mentions` | читать упоминания вашего аккаунта |

Если какого-то разрешения нет в списке, пришлите мне скриншот списка: Meta иногда переименовывает их.

## 1.6. Тестировщик (5 минут)

1. В приложении: **App Roles → Roles → Add People** → роль **Threads Tester** →
   введите юзернейм аккаунта Threads бренда.
2. Откройте Threads (на телефоне или threads.net) от имени этого аккаунта:
   **Настройки → Аккаунт → Разрешения веб-сайтов → Приглашения** → **Принять**.

Пока заявка не одобрена, агент работает только с аккаунтами-тестировщиками. Этого достаточно,
чтобы настроить всё и записать видео для Meta.

## 1.7. Настройки приложения (10 минут)

**App settings → Basic**:

| Поле | Что вписать |
|---|---|
| App icon | логотип WeArt Studio 1024×1024 |
| Privacy Policy URL | `https://weartstudio.io/privacy` (страница из раздела 1.9) |
| Terms of Service URL | ваша страница условий, если есть |
| User data deletion | выберите **Data deletion instructions URL** → `https://weartstudio.io/data-deletion` |
| Category | **Business and pages** (или ближайшая по смыслу) |

**Use cases → Access the Threads API → Settings**: здесь находятся **Threads App ID** и **Threads App Secret**.
Они понадобятся на этапе 3. **Секрет мне не присылайте.**

Там же есть поля **Redirect callback URLs**, **Uninstall callback URL** и **Delete callback URL**.
Агент их не использует. Если кабинет требует их заполнить, впишите
`https://api-agent.weartstudio.io/healthz` и напишите мне. Я добавлю в агент настоящие обработчики.

## 1.8. Заявка на проверку (App Review)

**Отправлять заявку будем на этапе 6**, когда админка заработает и можно будет записать видео.
Сейчас заполните текстовые поля и сохраните заявку как черновик.

**App Review → Requests** (или **Permissions and features**) → у каждого разрешения из 1.5
**Request advanced access** / **Request**. Тексты ниже на английском: заявки проверяют на английском.

### Общее описание приложения (App description / How will your app use...)

> WeArt Studio Agent is an internal moderation tool for the WeArt Studio brand account on Threads.
> It finds public posts where people ask for recommendations on AI tools for images, video and music,
> and prepares a short, helpful reply draft. A team member reviews every draft in a private,
> password-protected admin panel, can edit or reject it, and manually decides whether to publish it.
> The app only acts on behalf of our own brand account. It does not message users privately,
> does not follow, like or repost, and limits itself to a small number of replies per day
> (20 maximum, at most one reply per author every 30 days).

### `threads_keyword_search`

> We use keyword search to find recent public posts in which people ask for advice about AI tools
> (for example, "which AI video generator should I use" or "midjourney alternative").
> Search runs a few times per day on a fixed list of keywords managed by our team. Found posts are
> scored for relevance and shown in our internal admin panel. A team member reads each post and decides
> whether a helpful reply is appropriate. We store only the post ID, text, author username, permalink and
> timestamp, for up to 30 days, to avoid replying twice. We do not build profiles of users and do not
> share this data with third parties.

### `threads_content_publish`

> Used to publish replies from our brand account. Every reply is reviewed and approved by a team member
> in our admin panel before publishing. Replies first answer the person's question and then honestly
> mention that WeArt Studio is our product.

### `threads_manage_replies`

> Used to publish replies to public posts and to mentions of our brand account. Replies are always
> approved manually by a team member, with daily limits (maximum 20 per day) and at most one reply
> per author every 30 days.

### `threads_manage_mentions`

> Used to see posts where people mention our brand account, so that our team can answer their
> questions. Each mention appears in our admin panel with a draft reply that a team member reviews,
> edits if needed and publishes manually.

### `threads_basic`

> Used to read the username and ID of our own brand account to show which account the tool is
> connected to, and to avoid replying to our own posts.

### Сценарий видео (screencast), записываем на этапе 6

Длина 1,5–3 минуты, разрешение не меньше 1080p, без звука, с подписями на английском
(можно добавить текстом в редакторе или показывать на экране).

1. **Caption:** "WeArt Studio Agent — internal admin panel." Откройте https://agent.weartstudio.io,
   войдите по паролю.
2. **Caption:** "Keyword search (threads_keyword_search)." Нажмите «Найти посты сейчас», покажите
   ленту «Что делает агент» с найденными постами.
3. **Caption:** "Every found post is scored; only relevant ones get a draft." Откройте «Оценки постов».
4. **Caption:** "A team member reviews and edits the draft." Откройте «Очередь», поправьте текст.
5. **Caption:** "Publishing a reply after manual approval (threads_content_publish, threads_manage_replies)."
   Нажмите «Отправить», откройте ответ в Threads по ссылке из «Отправленных».
6. **Caption:** "Mentions of our account (threads_manage_mentions)." Нажмите «Проверить упоминания»,
   покажите черновик ответа на упоминание.
7. **Caption:** "Daily limits and author cooldown." Откройте «Настройки», покажите лимиты.

Интерфейс админки на русском. В подписях кратко поясняйте по-английски, что происходит на экране.

---

## 1.9. Страницы на сайте (обязательно до заявки)

Нужны две страницы на weartstudio.io. Ниже шаблоны на английском. **Это шаблоны, а не юридическая
консультация.** Если у WeArt Studio уже есть политика конфиденциальности, добавьте в неё раздел про Threads
и не создавайте вторую. Подставьте название юрлица, страну и email.

### `https://weartstudio.io/privacy` (раздел про Threads)

```
Threads integration

WeArt Studio operates a brand account on Threads and uses the official Threads API (Meta) to find
public posts where people ask for recommendations on AI creative tools, and to reply to them on behalf
of our brand account.

What we process: for public Threads posts that match our search keywords or mention our account,
we process the post ID, post text, author username, permalink and publication time. We do not access
private messages, private accounts, contact details or any non-public information.

Why: to identify relevant public conversations and to let our team decide whether to post a helpful
reply from our brand account. Every reply is reviewed and published manually by a team member.

How long: data about posts we did not reply to is deleted automatically after 30 days.
For posts we replied to, the post, our reply and the author username are kept for 90 days, so that
we do not contact the same person repeatedly. Then they are deleted automatically.

Sharing: the post text and author username are sent to our AI service provider (Runware) only
to assess relevance and draft a reply. We do not sell this data and do not use it for advertising
or profiling.

Your choices: to have data about your posts deleted, follow the instructions at
https://weartstudio.io/data-deletion or contact [EMAIL].

Controller: [ЮРЛИЦО], [АДРЕС/СТРАНА]. Contact: [EMAIL].
```

### `https://weartstudio.io/data-deletion`

```
Data deletion instructions — WeArt Studio Threads integration

If WeArt Studio has processed one of your public Threads posts and you want this data deleted:

1. Send an email to [EMAIL] with the subject "Threads data deletion".
2. Include your Threads username.
3. We will delete all data related to your posts and your username from our systems within 7 days
   and confirm by email. After that our account will not reply to your posts again. To make this
   possible we keep only a one-way hash of your username, from which the username cannot be recovered.

Even without a request, data about posts is deleted automatically: after 30 days if we did not reply,
and after 90 days if we did.
```

**Как выполнить запрос на удаление:** админка → «Настройки» → «Удаление данных по запросу» → впишите
`@username` → «Удалить данные». Агент сотрёт всё об этом человеке и больше не будет ему отвечать.
Затем ответьте человеку на письмо, что данные удалены.

Сроки в тексте совпадают с кодом агента: 30 дней для постов без ответа, 90 дней для постов с ответом.
Если поставить в настройках «Паузу для одного автора» больше 90 дней, имя автора будет храниться
столько же. Тогда поправьте срок и в политике.

---

## 📤 Что прислать мне после этапа 1

- [ ] Скриншот списка разрешений из 1.5. Секрет приложения на скриншоте закройте.
- [ ] Что вышло с бизнес-верификацией: начата, пройдена или Meta её не просит.
- [ ] Ссылки на страницы privacy и data-deletion. Если их сделать не можете, напишите,
      на чём сделан сайт, я подскажу, как их добавить.
- [ ] Принято ли приглашение тестировщика (да/нет).
- [ ] Всё, что в кабинете выглядит не так, как здесь описано: скриншотом.

**Не присылайте:** Threads App Secret, токены, пароли.
