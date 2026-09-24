# Архітектура

## Принципи

- **Лише локально.** Жодних зовнішніх запитів і шрифтів (сторінка «Архів» використовує системні шрифти, сайдбар — шрифти, які вже завантажила сторінка Meet). Єдиний мережевий доступ — `http://localhost:8765` для dev-reload.
- **Без збірки й залежностей.** Розширення завантажується з `extension/` як є. Спільний код не імпортується модулями, а реєструється в `globalThis.MT`, тож той самий файл працює як контент-скрипт, як імпорт у service worker і як модуль у node-тестах.
- **Не втручатися в DOM Meet.** Власний UI живе в shadow roots. Meet ми змінюємо лише через CSS із маніфесту (`content/page.css`), маркерні атрибути (`data-mt-caption-root`, `data-mt-stage`) і кліки по його власних контролах (CC, мова).
- **Один записувач.** У `chrome.storage.local` пише лише service worker, через чергу, щоб паралельні повідомлення не губили індекс.

## Контексти виконання

```
meet.google.com
├── MAIN world, document_start
│   └── content/page-raf.js          rAF → setTimeout, поки вкладка прихована
└── isolated world, document_idle     (порядок = порядок у manifest.json)
    ├── shared/icons.js, util.js, strings.js, transcript.js, format.js
    ├── content/selectors.js          усі хуки DOM Meet (ланцюжки фолбеків)
    ├── content/meet-dom.js           read-only запити до DOM (MT.dom)
    ├── content/caption-tracker.js    MutationObserver → TranscriptBuilder
    ├── content/captions-control.js   CC, мова, згортання оверлея, remeasure
    ├── content/session.js            життєвий цикл мітингу (MT.MeetingSession)
    ├── content/sidebar/templates.js  HTML-шаблони (спільні з design/mockup.html)
    ├── content/sidebar/sidebar.js    панель, кнопка-пігулка, стиснення сцени
    ├── content/main.js               MT.send(), dev-reload пінги, старт
    └── content/page.css              CSS, що впливає на Meet (manifest "css")

service worker (module)
├── background/sw.js                  підключення chrome.* API: storage, alarms, downloads, tabs, scripting (перевставка)
├── background/router.js              протокол повідомлень (чистий, deps інжектуються)
├── background/store.js               схема сховища + черга записів (чистий)
└── background/dev-reload.js          автоперезавантаження розпакованого розширення

extension page
└── archive/archive.html|js|css       архів: читає storage напряму, пише через SW
```

## Потік даних

```
Meet DOM (region > .nMcdL блоки)
   │  MutationObserver (childList, subtree, characterData)
   ▼
CaptionTracker ── throttle 150 мс ──► MT.dom.parseBlocks() → [{key: <елемент>, speaker, text}]
   ▼
TranscriptBuilder.update(blocks) → entries [{id, block, speaker, text, startedAt, updatedAt, self?}], liveId
   ▼ onChange
MeetingSession ── debounce 1.5 с ──► MT.send('session:update', {id, patch})
   │                                        │
   ▼ emit('transcript')                     ▼ chrome.runtime.sendMessage
Sidebar.render()                     router → store.update() → chrome.storage.local
                                                              │ storage.onChanged
                                                              ▼
                                                        archive.js (живе оновлення)
```

### TranscriptBuilder

Meet підтримує в DOM **один блок на репліку мовця**. Слова дописуються кожні ~330 мс, хвіст переписується, коли розпізнавання уточнюється, і один блок може рости хвилинами. Будівник:

1. **Відстежує блок** за DOM-елементом (`key`). Новий елемент стає новим блоком, а зниклий елемент — фінальним.
2. **Ділить блок на сегменти** за паузами (`pauseMs`). Сегмент — це діапазон `[start, end)` тексту блоку, по одному entry на сегмент. Текст усіх сегментів перераховується з поточного тексту блоку, тож ревізії хвоста потрапляють у правильний абзац.
3. **Обробляє обрізання голови.** Якщо текст різко скоротився й не починається як попередній, будівник шукає, де новий текст починається всередині старого, і зсуває межі сегментів. Текст, що вийшов за межі вікна, зберігається в `base` сегмента, а сегмент, який повністю вийшов, заморожується.
4. **Робить адопцію.** Якщо Meet перемалював регіон, старі елементи зникають, а нові показують той самий текст. Новий блок із тим самим мовцем і початком тексту підхоплює entries нещодавно звільненого блоку (`adoptWindowMs`). Звільнення відбувається **до** обробки нових блоків у тому самому знімку.
5. **Замінює «You»/«Ви»** на власне імʼя, щойно воно відоме (`setSelfName`). Позначка `self` на entry дозволяє перейменувати й уже збережені репліки.
6. **Відкидає рядки без мовця** — системні повідомлення Meet.

## Життєвий цикл мітингу (`content/session.js`)

```
idle ──(зʼявилась кнопка call_end)──► session:start ──► waiting ──(регіон знайдено)──► recording
  ▲                                     │ resume, якщо той самий code,          │
  │                                     │ updatedAt < 10 хв і (не завершено      │ CC вимкнули → off
  │                                     │ або завершено < 5 хв тому)            │ регіону нема > 10 с → notfound
  │                                                                              ▼
  └──────── ended ◄── session:end ◄── 3 опитування поспіль без call_end ◄───────┘
```

- **Вхід у дзвінок.** Стан вважається «у дзвінку», коли є кнопка з лігатурою `call_end`. Сторінка `meet.google.com/new` заходить одразу, без екрана «Join now».
- **Після `session:start`.** Запускається трекер, вмикаються CC (`autoCaptions`). Коли регіон уперше знайдено, код позначає корінь оверлея, раз обирає `uk-UA` (`autoUkrainian`) і через 1.5 с перевіряє, чи Meet не зарезервував місце під субтитри. Якщо зарезервував, запускається `remeasure()`: CC вимикаються й знову вмикаються, щонайбільше 2 рази.
- **Назва мітингу** береться з `document.title`, у форматі «Meet - <назва або код>». Вона оновлюється лише тоді, коли змінюється в Meet, і надсилається в SW тільки після зміни. Так перейменування в архіві не затирається.
- **Втрата контексту.** Після оновлення розширення `chrome.runtime.id` зникає: сесія показує банер «Розширення оновлено — перезавантажте сторінку» й зупиняє роботу.

### Коли SW дізнається, що мітинг скінчився

Дозволу `tabs` немає, тому SW не стежить за навігаціями вкладок. Натомість:

| Подія | Що відбувається |
| --- | --- |
| Кнопка «Leave call» | Контент-скрипт помічає, що `call_end` зник (3 опитування), робить `saveNow()` і надсилає `session:end`. |
| Вкладку закрито | `chrome.tabs.onRemoved` → `router.tabGone(tabId)` (відповідність `tabId → meetingId` у `storage.session`). |
| Перезавантаження або перехід зі сторінки | `pagehide` → `tab:bye` → `alarms` через 1.5 хв. Скасовує alarm лише повторний вхід у той самий дзвінок (`session:start`). |
| У вкладці відкрилася інша сторінка Meet | `tab:hello` з іншим кодом мітингу або без нього (головна після «Leave» → «Return to home screen») одразу завершує мітинг цієї вкладки. `tab:hello` з тим самим кодом (перезавантаження, екран «Join now») лишає alarm. |
| Розширення перезавантажили чи оновили посеред дзвінка | Старий контент-скрипт «осиротів»: `chrome.runtime` недоступний, зберегти нічого не можна. Він гасить статус «запис» (`onContextLost`). SW на `onInstalled` вставляє свіжі копії скриптів у відкриті вкладки Meet (`scripting`). Нова копія шле DOM-подію `meet-transcriber:takeover`, стара знищує свій UI й таймери (`destroy()`), а нова продовжує той самий запис (`session:start` → резюм). |
| Звʼязок вкладки з мітингом загублено | `storage.session` очищається під час перезавантаження розширення й перезапуску браузера. `router.sweep()` (alarm раз на хвилину та `onStartup`) завершує відкриті мітинги, привʼязані до вкладки, якої вже немає, або не привʼязані й без оновлень довше за `STALE_MS`. `endedAt` = час останнього оновлення. |

Під час завершення (`router.endMeeting`) мітинг без реплік видаляється. В інших випадках, якщо ввімкнено `autoDownload`, `.md` зберігається через `chrome.downloads` (data: URL, `conflictAction: 'uniquify'`).

## Протокол повідомлень (`background/router.js`)

| Тип | Від кого | Дані | Відповідь |
| --- | --- | --- | --- |
| `tab:hello` | контент-скрипт під час старту | `code` | налаштування; якщо код не збігається з мітингом вкладки, завершує його |
| `tab:bye` | `pagehide` | — | планує завершення, якщо вкладка мала мітинг |
| `session:start` | вхід у дзвінок | `code`, `title`, `url` | `{meeting, resumed, settings}` |
| `session:update` | дебаунс / `pagehide` / вихід | `id`, `patch: {entries, speakers, language, title?}` | `true` / `false` |
| `session:end` | вихід із дзвінка | `id` | `true`, якщо саме цей виклик завершив мітинг |
| `settings:get` / `settings:set` | сайдбар, архів | `patch` | налаштування |
| `meeting:get` / `meeting:rename` / `meeting:delete` | архів | `id`, `title` | |
| `meeting:export` | сайдбар, архів | `id`, `format: md\|txt\|json` | `{id, filename}` |
| `archive:open` | сайдбар | `id` | відкриває `archive.html#<id>` у новій вкладці |
| `dev:status` / `dev:ping` | `main.js` | — | лише для розпакованого розширення з dev-сервером |

Відповідь SW завжди має вигляд `{ok, result}` або `{ok: false, error}`. `MT.send()` повертає `result`, а якщо контекст зник або сталася помилка — `null`.

## Схема сховища (`chrome.storage.local`)

```jsonc
{
  "settings": { "autoCaptions": true, "autoUkrainian": true, "showOverlay": false, "autoDownload": true },
  "meetings": [   // індекс, відсортований за startedAt ↓
    { "id": "rfz-xkor-aeo_1790258140796", "code": "rfz-xkor-aeo", "title": "…", "startedAt": 0, "updatedAt": 0,
      "endedAt": null, "speakers": ["…"], "entryCount": 8, "language": "Ukrainian (Ukraine)" }
  ],
  "meeting:rfz-xkor-aeo_1790258140796": {
    "id": "…", "code": "…", "url": "https://meet.google.com/…", "title": "…", "language": "…",
    "startedAt": 0, "updatedAt": 0, "endedAt": null, "speakers": ["…"],
    "entries": [ { "id": "e-1", "block": 1, "speaker": "Denys Danyliuk", "self": true,
                   "text": "…", "startedAt": 0, "updatedAt": 0 } ]
  },
  "__devLoadedVersion": "…"    // лише dev
}
```

`chrome.storage.session`: ключі `tab:<tabId>` → `meetingId`.

## UI

- **Сайдбар** (`content/sidebar/`) розміщено в shadow root `#meet-transcriber-root`, а стилі підключено через `adoptedStyleSheets` (CSS завантажується як web-accessible resource).
  - Панель поділена на слоти (header, meta, search, banner, list, footer, menu, snackbar). Кожен слот перерендерюється лише тоді, коли змінився його HTML.
  - Список звіряється по репліках (ключ — id першого entry репліки), тому живий сегмент оновлюється без втрати прокрутки й фокусу.
  - Поле пошуку рендериться один раз.
  - **Панель і кнопку видно лише під час дзвінка.** `Sidebar.inCall()` вимагає активної сесії й кнопки «Leave call»; щосекундний `tick()` перевіряє це знову. На головній сторінці Meet, на екрані «Join now» і після виходу панелі немає, а стиснення сцени знято.
  - **Панель відкривається лише кнопкою.** На кожному завантаженні сторінки й на кожному дзвінку вона закрита: `open` не зберігається, а коли сесія завершується, скидається в `false`.
  - **Виїзд як у рідних панелей Meet.** Під час дзвінка панель завжди відрендерена, а клас `.is-open` перемикає `transform: translateX(calc(100% + var(--mt-right)))` → `none` за 0.5 с `cubic-bezier(0.4, 0, 0.2, 1)`. Це ті самі значення, що в `ASIDE.R3Gmyc` Meet. `visibility` вимикається лише після виїзду, а `inert` одразу прибирає закриту панель із фокусу.
  - **Геометрія** береться з `MT.dom.sidePanelBox()`, тобто з *цільової* розкладки Meet в inline-стилях, а не з поточних прямокутників. Тому вона правильна вже на початку анімації Meet:
    - top/bottom — inline `top`/`bottom` слота рідних панелей плюс його padding; вони змінюються разом із панеллю реакцій (136 ↔ 88 px);
    - right — правий inline-відступ `<main>`: 16 px, а коли відкрита рідна панель, 392 px, тож наша стає ліворуч від неї.

    `MutationObserver` на атрибуті `style` сцени й слота одразу викликає `layout()`, а переходи `top/right/bottom` у CSS мають ту саму тривалість. Так наша панель рухається синхронно з рідною.
- **Кнопка-пігулка** стоїть ліворуч від правої групи кнопок Meet (`#1e1f20`, 56 px). Всередину групи її не вставлено, бо Meet тоді ховає свій чат і викидає чужий вузол. Якщо місця бракує, пігулка переїжджає над групою.
- **Стиснення сцени.** Поки сайдбар відкритий, `<main>` Meet отримує `data-mt-stage`, а `<html>` — клас `mt-panel-open` і змінні `--mt-stage-scale` / `--mt-stage-ty`. `page.css` застосовує `transform` з тим самим переходом 0.5 с, що й у панелі. Правило має `!important`, бо правило Meet для `<main>` специфічніше. Масштаб рахується з `MT.dom.stageSize()`: це ширина контейнера мінус inline-відступи Meet, тобто цільовий розмір, на який не впливає наша трансформація. Звузити сам `<main>` не вийде: Meet розкладає плитки за своєю моделлю й не перераховує їх, навіть з `right: … !important` і подією `resize` (перевірено 24.09.2026).
- **Архів** — звичайна сторінка розширення в стилі Material 3, зі світлою й темною темою через `prefers-color-scheme`. Сторінка читає `chrome.storage.local` напряму, а пише через SW.
- **Шаблони** (`templates.js`) — чисті функції від view model. Їх використовують і сайдбар, і `design/mockup.html`, тож макет завжди збігається з кодом.

## Dev-інфраструктура

- `dev/server.mjs` — статичний сервер репозиторію та `/__version` (sha1 від шляхів, розмірів і mtime файлів `extension/`).
- `background/dev-reload.js` вмикається лише для `installType === 'development'`, коли сервер відповідає. Контент-скрипт пінгує кожні 2 с (це також тримає SW живим), SW порівнює версію й викликає `chrome.runtime.reload()`. Версія, з якою стався reload, зберігається в `storage.local`: інакше правки, що прийшли під час перезавантаження, губилися б.
- `dev/chrome-shim.js` — `chrome.storage.local` поверх `localStorage` і `runtime.sendMessage` → `window.__harnessBackground`, куди `harness.html` та `dev/archive.html` підключають справжній `createRouter()`.
- `dev/meet-sim.js` — DOM Meet 1:1 за розвідкою і сценарій українських реплік. Сценарій містить ревізії хвоста, паузу, системний рядок, довгий монолог і `You`. Кнопки дев-панелі: play/pause/speed/re-render/leave/reset.
