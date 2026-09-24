# Коли Google Meet змінив DOM: ранбук

Розширення не має API і повністю залежить від DOM Meet. Класи там обфусковані (`nMcdL`, `fJsklc`, …) і змінюються між релізами. Цей документ описує, як швидко знайти, що саме зламалося, і полагодити, не зламавши решту.

Усі хуки Meet зібрані в одному місці, `extension/content/selectors.js`. Код читає їх лише через `extension/content/meet-dom.js`. Поведінкові знахідки (що Meet міряє, коли перемальовує тощо) записано в [meet-dom.md](meet-dom.md).

## 1. Симптом → ймовірна причина → де лагодити

| Симптом | Ймовірна причина | Де дивитися |
| --- | --- | --- |
| Статус «Не вдається знайти субтитри» (`notfound`), CC увімкнені | Не знаходиться регіон субтитрів | `sel.captionsRegion`, `dom.findRegion()` |
| Статус «Запис», але репліки не зʼявляються | Змінилися блоки, мовець або текст | `sel.captionBlock`, `captionSpeaker`, `captionText`, `dom.parseBlocks()` |
| Замість імені мовця порожньо, або записуються системні рядки («… joined») | Селектор мовця збігається з рядком-повідомленням або не збігається з реальним мовцем | `sel.captionSpeaker`. Рядки без мовця свідомо відкидаються в `TranscriptBuilder.update()` |
| Власні репліки підписані «Ви», а не вашим імʼям | Не знайдено плитку self-view або імʼя на ній | `sel.selfTileIcons`, `sel.tileName`, `dom.selfName()` |
| Після демонстрації екрана чи зміни розкладки історія дублюється | Meet перемалював регіон і текст блоку змінився | `adopt()` та `adoptWindowMs` у `shared/transcript.js` |
| CC не вмикаються автоматично | Змінилися лігатури або `jsname` кнопки CC | `MT.ligature.ccOff/ccOn`, `sel.ccButtonJsname`, `dom.captionsState()` |
| Мова не перемикається на українську, зʼявляється банер | Не знаходиться combobox мови або опція | `dom.languageCombobox()` (шукає іконку `language`), `sel.languageOptionUk` |
| Субтитри видно, хоча «Субтитри на екрані» вимкнено | CSS не знаходить корінь оверлея | `content/page.css`, `sel.captionRoot`, `captions.markRoot()` |
| Під відео чорна смуга, відео не на весь екран | Meet зарезервував місце під субтитри: `:has()`-правило не спрацювало раніше за замір | `content/page.css`, `captions.spaceReserved()`, `session.reclaimSpaceSoon()` |
| Кнопки «Транскрипт» немає, або вона не там | Не знаходиться права група кнопок | `sel.panelIcons`, `dom.controlBarAnchor()`, `Sidebar.positionButton()` |
| Сайдбар перекриває рідну панель Meet (чат, люди) | Не знаходиться рідна панель | `sel.nativePanel`, `dom.nativePanel()` |
| Відео не зсувається, коли сайдбар відкритий | Не знаходиться сцена | `dom.stage()` (шукає `[data-participant-id]` → `closest('main')`) |
| Мітинг не завершується, файл не зберігається | Не розпізнається кнопка виходу | `MT.ligature.callEnd`, `sel.leaveButtonJsname`, `dom.isInCall()` |
| Неправильна назва мітингу | Змінився формат `document.title` | `dom.meetingTitle()`, `sel.meetingTitle` |
| У фоновій вкладці субтитри «застигають» і приходять пачкою, коли вкладку відкриваєш | Meet рендерить уже не через rAF, або захопив rAF до нашого патча | `content/page-raf.js` (див. сніпет 8) |
| CC самі вимикаються й вмикаються | Цикл `remeasure()`: `spaceReserved()` хибно спрацьовує | Має міряти layout-бокс (`offset*`), а не `getBoundingClientRect()` |

## 2. Відтворення

1. Запустіть dev-сервер: `npm run dev`. Розпаковане розширення тоді саме підхоплює зміни.
2. Через Claude in Chrome відкрийте `https://meet.google.com/new`. Сторінка одразу заходить у порожній дзвінок з вашим акаунтом.
3. Тримайте вкладку видимою. Коли вкладка у фоні, CDP-скріншоти падають, а таймери пригальмовуються.
4. Говоріть самі або запустіть голос:

   ```bash
   say -v Lesya "Добрий день, колеги. Це перевірка субтитрів."
   ```

   Голос виходить із динаміків, і мікрофон його чує. У навушниках це не працює.
5. Перевірте консоль: `read_console_messages` із шаблоном `meet-transcriber|Uncaught`.

Особливості інструментів:
- `javascript_tool` виконує код у **MAIN world**. Там видно DOM і наші відкриті shadow roots (`#meet-transcriber-root`), але немає `MT` і `chrome.runtime` контент-скрипта.
- Інструмент блокує вивід, схожий на токени чи base64 («[BLOCKED: …]»). Не виводьте `outerHTML` і довгі рядки класів, користуйтеся структурним дампом (сніпет 2) і `slice()`.
- Claude in Chrome не відкриває `chrome://extensions` і сторінки `chrome-extension://`. Архів перевіряйте через `dev/archive.html` або просіть користувача.
- Після перезавантаження розширення відкрита вкладка Meet лишається зі старим, «осиротілим» контент-скриптом. Перезавантажте вкладку й натисніть «Join now». Команда `await` усередині `javascript_tool`, яка триває під час навігації, завершується помилкою.

## 3. Сніпети для діагностики (`javascript_tool`)

**1. Які іконки та кнопки є зараз.** Лігатури не залежать від мови UI.

```js
const icons = {};
for (const i of document.querySelectorAll('i.google-symbols, i.google-material-icons')) icons[i.textContent.trim()] = true;
({ icons: Object.keys(icons), buttons: [...document.querySelectorAll('button')].filter(b => b.querySelector('i')).map(b => ({
  icon: b.querySelector('i').textContent.trim(), aria: b.getAttribute('aria-label'), jsname: b.getAttribute('jsname'),
  w: Math.round(b.getBoundingClientRect().width) })) })
```

**2. Структурний дамп регіону субтитрів.** Показує лише безпечні атрибути.

```js
function dump(el, d = 0, max = 8) {
  if (d > max) return '';
  const attrs = ['class','jsname','role','aria-label','tabindex','jscontroller'].map(a => el.getAttribute?.(a) ? `${a}="${String(el.getAttribute(a)).slice(0,40)}"` : '').filter(Boolean).join(' ');
  const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' | ').slice(0, 50);
  let out = `${'  '.repeat(d)}<${el.tagName.toLowerCase()} ${attrs}>${own ? ` "${own}"` : ''}\n`;
  if (el.tagName !== 'BUTTON') for (const c of el.children) out += dump(c, d + 1, max);
  return out;
}
const region = [...document.querySelectorAll('[role="region"]')].find(r => r.querySelector('img') || /aption|убтитр/i.test(r.getAttribute('aria-label') || ''));
region ? dump(region, 0, 6) : [...document.querySelectorAll('[role="region"]')].map(r => r.getAttribute('aria-label'))
```

Очікувана структура (09.2026): `region > .nMcdL (блок) > [.adE6rb > img + .KcIKyf > span.NWpY1d (мовець)] + .ygicle (текст)`. В останніх двох дочірніх елементах регіону субтитрів немає.

**3. Як Meet оновлює текст.** Логер мутацій, заодно й для перевірки фонової вкладки.

```js
window.__log = [];
const region = document.querySelector('[jsname="dsyhDe"] [role="region"]');
window.__obs?.disconnect();
window.__obs = new MutationObserver(m => __log.push({ t: performance.now() | 0, hidden: document.hidden, n: m.length,
  tail: region.textContent.replace(/\s+/g, ' ').slice(-60) }));
window.__obs.observe(region, { subtree: true, childList: true, characterData: true });
'ok'   // далі: say -v Lesya "…", потім прочитати __log
```

**4. Мова субтитрів і доступні опції.**

```js
const combo = [...document.querySelectorAll('[role="combobox"]')].find(c => [...c.querySelectorAll('i')].some(i => i.textContent.trim() === 'language'));
combo.click(); await new Promise(r => setTimeout(r, 800));
const opts = [...document.querySelectorAll('[role="option"]')].map(o => `${o.getAttribute('data-value')} ${o.textContent.trim().slice(0, 30)}`);
combo.click(); ({ current: combo.textContent.trim(), uk: opts.filter(o => /uk|ukrain/i.test(o)) })
```

**5. Чи резервує Meet місце під субтитри.** Норма: `inset … 136px`, резерв: `… 352px`.

```js
const main = document.querySelector('[data-participant-id]')?.closest('main');
const leave = [...document.querySelectorAll('i.google-symbols')].find(i => i.textContent.trim() === 'call_end')?.closest('button');
const bottom = main.offsetParent.getBoundingClientRect().top + main.offsetTop + main.offsetHeight;
({ inset: main.getAttribute('style'), gap: Math.round(leave.getBoundingClientRect().top - bottom),
   htmlClass: document.documentElement.className,
   captionRoots: [...document.querySelectorAll('.fJsklc')].filter(e => e.querySelector('[jsname="dsyhDe"]')).map(e => e.getBoundingClientRect().height) })
```

**6. Права група кнопок і наша пігулка.**

```js
const r = el => { const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
const chat = [...document.querySelectorAll('i.google-symbols')].filter(i => i.textContent.trim() === 'chat').map(i => i.closest('button')).find(b => b?.getBoundingClientRect().width > 0);
let g = chat; while (g && g.parentElement && g.parentElement.children.length < 3) g = g.parentElement;
({ group: g && r(g.parentElement), kids: g ? [...g.parentElement.children].map(c => `${String(c.className).slice(0, 20)} ${r(c)}`) : null,
   pill: r(document.getElementById('meet-transcriber-root').shadowRoot.querySelector('.mt-cb-float') || document.body) })
```

**7. Стан нашого UI (shadow DOM відкритий).** Закрита панель не рендерить слоти, тому сніпет спершу її відкриває.

```js
const sh = document.getElementById('meet-transcriber-root').shadowRoot;
if (sh.querySelector('.mt-panel').hidden) { sh.querySelector('.mt-cb-float [data-action="toggle-panel"]')?.click(); await new Promise(r => setTimeout(r, 500)); }
({ chip: sh.querySelector('.mt-chip')?.textContent, banner: sh.querySelector('.mt-banner')?.textContent.trim().slice(0, 80),
   turns: [...sh.querySelectorAll('.mt-turn')].slice(-3).map(t => t.querySelector('.mt-speaker').textContent + ': ' + t.textContent.slice(-80)) })
```

**8. Фонова вкладка.** Запустіть сніпет 3, переведіть вкладку у фон, програйте фразу, прочитайте `__log`. Якщо всі записи мають `hidden: false` або записів немає, поки вкладка прихована, отже rAF-патч більше не допомагає. Далі:
- перевірте, що `window.__meetTranscriberRaf === true` (патч установлено);
- можливо, Meet перейшов на інший планувальник (`requestIdleCallback`, `scheduler.postTask`, `IntersectionObserver`), і тоді патч треба розширити;
- ще одна можлива причина: Meet перевіряє `document.hidden`. У розвідці підміна `visibilityState` виявилася не потрібна, але це варто перевірити знову.

## 4. Як лагодити

1. **Додавайте, а не замінюйте.** Новий селектор ставте на початок ланцюжка в `selectors.js`, а старий лишайте: Meet часто роздає версії UI поступово, і різні користувачі бачать різний DOM.
2. **Перевага мовно-незалежним хукам.** Порядок: лігатура іконки, `role`, `jsname`, клас. `aria-label` використовуйте лише як останній фолбек: він локалізований (`Captions` / `Субтитри`).
3. **Текст читайте тільки через `textContent`.** Сховані елементи дають порожній `innerText`.
4. **Не вставляйте вузли в DOM Meet.** Meet викидає чужі вузли й перебудовує адаптивні панелі. Наш UI живе у власних shadow roots, позиціонується за прямокутниками елементів Meet і впливає на Meet лише через CSS (`page.css`) та атрибути-маркери.
5. **Не вимикайте субтитри й не ставте `display:none`, щоб їх сховати.** Тоді регіон зникає з DOM.
6. **Відобразіть нову структуру в симуляторі** `dev/meet-sim.js` (класи, `jsname`, лігатури), щоб harness відповідав реальному Meet.
7. **Якщо змінилася поведінка злиття** (наприклад, Meet знову почав обрізати голову блоку), спершу додайте тест у `test/transcript.test.js`, а потім правте `shared/transcript.js`.

## 5. Перевірка після виправлення

1. `npm test`: усі тести проходять.
2. `http://localhost:8765/dev/harness.html?speed=4`: репліки зʼявляються в сайдбарі, CC вмикаються самі, мова стає `uk-UA`, оверлей схований. Кнопка «re-render region» не повинна створювати дублів.
3. Реальний дзвінок, щоразу з видимою вкладкою:
   - вхід: CC вмикаються, мова українська, чорної смуги під відео немає (сніпет 5 → `136px`);
   - `say -v Lesya` → репліки з вашим іменем зʼявляються в сайдбарі;
   - відкрити й закрити сайдбар → відео зсувається й повертається, пігулка стоїть поруч із групою, чат видно;
   - «Субтитри на екрані» → оверлей видно; вимкнути → місце повертається, CC перевмикаються щонайбільше раз;
   - вкладка у фоні + фраза → текст доходить (сніпет 8);
   - «Leave call» → файл у `~/Downloads/Meet Transcripts/` (`ls` у терміналі).
4. Запишіть знахідки в [meet-dom.md](meet-dom.md) із датою. Якщо змінився поріг, оновіть [parameters.md](parameters.md).
