// Google Meet simulator for dev/harness.html. Reproduces the DOM structure recorded in docs/meet-dom.md
// (class names, jsnames, icon ligatures, roles) and streams a scripted Ukrainian conversation into the
// captions region the way Meet does: word by word, with tail revisions, pauses and speaker changes.
(function () {
  const params = new URLSearchParams(location.search);
  const sim = (window.meetSim = {
    speed: Number(params.get('speed') || 1),
    playing: false,
    captionsOn: params.get('cc') === 'on',
    // ?ccmenu=1: the newer UI (11.2026), where a "Captions and translation" button opens a popup with the toggle.
    ccMenu: params.get('ccmenu') === '1',
    language: 'English',
    inCall: true,
    // Meet persists the reactions bar across calls; the user who reported the bug has it on. `?reactions=0` starts
    // without it, `?reactionsbug=1` makes the simulator "forget" the bar after the captions popup closes (the
    // failure seen once in the real Meet) so the extension's guard can be exercised.
    reactions: params.get('reactions') !== '0',
    reactionsBug: params.get('reactionsbug') === '1',
    nativePanel: false,
    log: [],
  });

  const WORD_MS = 330;
  const SCRIPT = [
    { speaker: 'Олена Коваль', text: 'Добрий день усім. Почнімо з короткого огляду релізу.', fix: [['релізу', 'реліз']] },
    { speaker: 'Олена Коваль', pause: 5000, text: 'Нагадаю, що в пʼятницю в нас дедлайн по платіжному модулю.' },
    { speaker: 'Андрій Мельник', text: 'Бекенд готовий, лишилися інтеграційні тести на оплату.', fix: [['оплату', 'оплаті']] },
    { notice: 'Ірина Шевчук приєдналася до зустрічі' },
    { speaker: 'You', text: 'Чудово. Тоді фіксуємо: тести до середи, ревʼю дизайну до четверга.' },
    { speaker: 'Ірина Шевчук', text: 'По фронтенду сторінку профілю переробили, зараз чекаємо на ревʼю дизайну від команди.' },
    {
      speaker: 'Андрій Мельник',
      text: 'Ще кілька слів про ризики. Міграція бази даних пройшла без проблем, але навантажувальне тестування ми ще не робили, тому пропоную запланувати його на понеділок і перевірити пошук під навантаженням.',
    },
    { speaker: 'You', text: 'Добре, дякую всім. На сьогодні все.' },
  ];

  const $ = (sel, el = document) => el.querySelector(sel);
  const icon = (name) => `<i class="quRWN-Bz112c google-symbols notranslate" aria-hidden="true">${name}</i>`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms / sim.speed));

  function render() {
    document.body.insertAdjacentHTML('afterbegin', `
      <div class="sim-stage" id="sim-stage">
        <div class="sim-top"><span>14:32</span><span class="sep"></span><span jsname="NeC6gb">Щотижневий синк команди</span></div>
        <main class="axUSnc sim-main" style="inset: 64px 16px 136px;">
          <div class="sim-grid">
            <div class="sim-tile" data-participant-id="p1"><div class="sim-av">О</div><span class="notranslate">Олена Коваль</span></div>
            <div class="sim-tile" data-participant-id="p2"><div class="sim-av">А</div><span class="notranslate">Андрій Мельник</span></div>
            <div class="sim-tile" data-participant-id="p3"><div class="sim-av">І</div><span class="notranslate">Ірина Шевчук</span></div>
            <div class="sim-tile" data-participant-id="p0">
              <div class="sim-av">D</div><span class="notranslate">Denys Danyliuk</span>
              <div class="sim-self-tools"><button aria-label="Reframe">${icon('frame_person')}</button><button aria-label="Apply visual effects">${icon('visual_effects')}</button></div>
            </div>
          </div>
        </main>
        <div class="fJsklc Didmac ZmuLbd nulMpf Y7BRKe CZ5y7b" id="sim-panel-slot" style="right: 0px; top: 52px; bottom: 128px;">
          <aside class="R3Gmyc WSJBnb qdulke P9KVBf" aria-label="Side panel" jsname="ME4pNd"><div class="sim-aside-title">In-call messages</div></aside>
        </div>
        <div class="gPfPb" jsname="TUXR0d" id="sim-slot"></div>
        <div class="fJsklc nulMpf Didmac G03iKb hLkVuf" id="sim-caption-root">
          <div class="a4cQT P9KVBf"><div class="NmXUuc P9KVBf IGXezb"><div class="qUPVAc">
            <div role="combobox" aria-label="Meeting language" jsname="oYxtQd" class="sim-combo" tabindex="0" aria-expanded="false">${icon('language')}<span class="sim-lang">English</span>${icon('arrow_drop_down')}</div>
            <ul role="listbox" class="sim-listbox" hidden>
              <li role="option" data-value="en-US" aria-selected="true">English</li>
              <li role="option" data-value="de-DE">German (Germany)</li>
              <li role="option" data-value="uk-UA">Ukrainian (Ukraine) BETA</li>
            </ul>
          </div></div></div>
          <div class="DtJ7e"><div class="iOzk7" jsname="dsyhDe" id="sim-dsyhDe"></div></div>
        </div>
        <div class="sim-controls" role="region" aria-label="Call controls">
          <button aria-label="Turn off microphone" class="sim-btn">${icon('mic')}</button>
          <button aria-label="Turn off camera" class="sim-btn">${icon('videocam')}</button>
          <button aria-label="Send a reaction" jsname="G0pghc" aria-pressed="${sim.reactions}" class="sim-btn" id="sim-reactions">${icon('mood')}</button>
          ${sim.ccMenu
            ? `<button aria-label="Captions and translation" aria-haspopup="dialog" aria-pressed="false" class="sim-btn sim-cc" id="sim-ccmenu">${icon('translate_cc')}</button>`
            : `<button aria-label="Turn on captions" jsname="RrG0hf" class="sim-btn sim-cc" id="sim-cc">${icon('closed_caption_off')}</button>`}
          <button aria-label="Raise hand" class="sim-btn">${icon('back_hand')}</button>
          <button aria-label="More options" class="sim-btn">${icon('more_vert')}</button>
          <button aria-label="Leave call" jsname="CQylAd" class="sim-btn sim-end" id="sim-end">${icon('call_end')}</button>
        </div>
        <div class="tMdQNe Dg8mNb sim-right">
          <div class="cKYX7b"><div><div class="r6xAKc"><span><button aria-label="Chat with everyone" class="sim-rbtn">${icon('chat')}</button></span><div class="IxCbn"></div></div></div></div>
          <div></div>
          <div class="cKYX7b"><div><div class="r6xAKc"><span><button aria-label="Meeting tools" class="sim-rbtn">${icon('apps')}</button></span><div class="IxCbn"></div></div></div></div>
          <div class="ZB3xMd"><div class="r6xAKc"><span><button aria-label="Host controls" class="sim-rbtn">${icon('lock_person')}</button></span></div></div>
        </div>
      </div>`);

    $('#sim-cc')?.addEventListener('click', () => setCaptions(!sim.captionsOn));
    $('#sim-ccmenu')?.addEventListener('click', toggleCaptionsPopup);
    $('#sim-reactions').addEventListener('click', () => setReactions(!sim.reactions));
    $('#sim-end').addEventListener('click', leaveCall);
    $('.sim-rbtn[aria-label="Chat with everyone"]').addEventListener('click', () => setNativePanel(!sim.nativePanel));
    renderBottomSlot();
    applyInsets();
    const combo = $('.sim-combo');
    const listbox = $('.sim-listbox');
    combo.addEventListener('click', () => {
      listbox.hidden = !listbox.hidden;
      combo.setAttribute('aria-expanded', String(!listbox.hidden));
    });
    listbox.addEventListener('click', (e) => {
      const opt = e.target.closest('[role="option"]');
      if (!opt) return;
      sim.language = opt.textContent.replace(/\s*BETA$/, '');
      $('.sim-lang').textContent = sim.language;
      listbox.querySelectorAll('[role="option"]').forEach((o) => o.setAttribute('aria-selected', String(o === opt)));
      listbox.hidden = true;
      combo.setAttribute('aria-expanded', 'false');
      sim.log.push(`language → ${opt.dataset.value}`);
    });
    setCaptions(sim.captionsOn);
  }

  function regionHtml() {
    return `<div class="vNKgIf UDinHf" role="region" aria-label="Captions" tabindex="0" jscontroller="KPn5nb">
      <div><div class="GvZY2" jscontroller="kXGfg"></div></div>
      <div class="IMKgW"><button jsname="Xke7ne" aria-label="Jump to most recent captions">${icon('arrow_downward')}Jump to bottom</button></div>
    </div>`;
  }

  function region() {
    return $('#sim-dsyhDe [role="region"]');
  }

  // The slot above the controls (`[jsname=TUXR0d]`) shows either the reactions bar or the captions popup, both as
  // role=dialog; the popup replaces the bar while open and Meet brings the bar back afterwards. The popup's
  // "Live captions" and "Translate speech" are both button[jsname=RrG0hf]. Meet writes the layout it means to
  // reach into inline styles: <main> bottom 136 px with the bar, 88 px without; the side-panel slot 128 / 80.
  function renderBottomSlot() {
    const slot = $('#sim-slot');
    if (!slot) return;
    if (sim.popupOpen) {
      slot.setAttribute('role', 'dialog');
      slot.setAttribute('aria-label', 'Captions and translation');
      slot.innerHTML = `<div class="sim-popup">
        <div jsname="wOezY"><button jsname="RrG0hf" class="sim-chip" id="sim-livecc"></button></div>
        <div jsname="zRRQAf"><button jsname="RrG0hf" class="sim-chip" aria-label="Turn on speech translation">${icon('translate_spark')}Translate speech</button></div>
      </div>`;
      $('#sim-livecc').addEventListener('click', () => setCaptions(!sim.captionsOn));
      renderLiveToggle();
    } else if (sim.reactions) {
      slot.setAttribute('role', 'dialog');
      slot.setAttribute('aria-label', 'Send a reaction');
      slot.innerHTML = `<div class="sim-reactions">${['💖', '👍', '🎉', '👏', '😂', '😮', '😢', '🤔', '👎'].map((e) => `<button class="sim-emoji" aria-label="Send ${e}">${e}</button>`).join('')}</div>`;
    } else {
      slot.removeAttribute('role');
      slot.removeAttribute('aria-label');
      slot.innerHTML = '';
    }
    $('#sim-reactions')?.setAttribute('aria-pressed', String(sim.reactions));
  }

  function applyInsets() {
    const bottom = sim.reactions || sim.popupOpen ? 136 : 88;
    const main = $('main.sim-main');
    if (main) main.style.inset = sim.nativePanel ? `64px 392px ${bottom}px 16px` : `64px 16px ${bottom}px`;
    const slot = $('#sim-panel-slot');
    if (slot) slot.style.bottom = `${bottom - 8}px`;
  }

  function toggleCaptionsPopup() {
    sim.popupOpen = !sim.popupOpen;
    sim.log.push(sim.popupOpen ? 'captions popup opened' : 'captions popup closed');
    if (!sim.popupOpen && sim.reactionsBug && sim.reactions) {
      sim.reactions = false;
      sim.log.push('reactions bar lost (simulated bug)');
    }
    renderBottomSlot();
    applyInsets();
  }

  function setReactions(on) {
    sim.reactions = on;
    sim.log.push(on ? 'reactions bar shown' : 'reactions bar hidden');
    renderBottomSlot();
    applyInsets();
  }

  // Meet's own side panel (chat): the aside slides in from past the right edge and <main> gets right: 392px.
  function setNativePanel(open) {
    sim.nativePanel = open;
    const aside = $('aside.R3Gmyc');
    aside.classList.toggle('qdulke', !open);
    sim.log.push(open ? 'native panel opened' : 'native panel closed');
    applyInsets();
  }

  function renderLiveToggle() {
    const btn = $('#sim-livecc');
    if (!btn) return;
    btn.innerHTML = `${icon(sim.captionsOn ? 'check' : 'closed_caption_off')}${sim.captionsOn ? 'Live captions' : 'Turn on captions'}`;
    btn.setAttribute('aria-label', sim.captionsOn ? 'Turn off live captions' : 'Turn on captions');
  }

  function setCaptions(on) {
    sim.captionsOn = on;
    const btn = $('#sim-cc');
    if (btn) {
      btn.querySelector('i').textContent = on ? 'closed_caption' : 'closed_caption_off';
      btn.setAttribute('aria-label', on ? 'Turn off captions' : 'Turn on captions');
      btn.classList.toggle('is-on', on);
    }
    const menu = $('#sim-ccmenu');
    if (menu) {
      menu.setAttribute('aria-pressed', String(on));
      menu.classList.toggle('is-on', on);
      renderLiveToggle();
    }
    $('#sim-dsyhDe').innerHTML = on ? regionHtml() : '';
    $('#sim-caption-root').style.display = on ? '' : 'none';
  }

  // Meet replaces the region with fresh nodes that repeat the history (layout change).
  sim.rerender = function rerender() {
    const r = region();
    if (!r) return;
    const clone = r.cloneNode(true);
    r.replaceWith(clone);
    sim.log.push('region re-rendered');
  };

  // Meet's "Open picture-in-picture" (Document PiP, also opened automatically on a tab switch): a separate
  // document with the call tiles, a captions band under them and its own copy of the captions region.
  // Structure as recorded on 2026-11-09 (docs/meet-dom.md); the band's inline height is Meet's.
  // requestWindow() needs a user gesture, so the harness calls this from a toolbar button.
  sim.openPip = async function openPip() {
    if (!window.documentPictureInPicture) return sim.log.push('no Document PiP API');
    const pip = await documentPictureInPicture.requestWindow({ width: 411, height: 774 });
    const d = pip.document;
    d.head.innerHTML = `<style>
      body { margin: 0; background: #131314; color: #e3e3e3; font: 14px system-ui, sans-serif; height: 100vh; display: flex; flex-direction: column; }
      .zqL4Ue { display: flex; flex: 1 1 auto; min-height: 0; }
      .xHjUnc { display: flex; flex-direction: column; flex: 1 0 0; position: relative; }
      .fXfIsf { flex: 1 0 auto; display: grid; place-items: center; background: #3c4043; margin: 4px 8px 0; border-radius: 12px; }
      .epgFze { display: flex; padding: 8px 0 2px; }
      .iOzk7 { position: absolute; left: 0; right: 0; bottom: 10px; max-height: 146px; overflow: hidden; padding: 0 12px; }
      .Tmb7Fd { height: 72px; display: grid; place-items: center; }
    </style>`;
    d.body.innerHTML = `<div class="zqL4Ue"><div class="xHjUnc">
        <div class="fXfIsf" jsname="B57Zse">video</div>
        <div class="epgFze XUNlS" style="height: 160px;"><div class="DtJ7e"><div class="iOzk7" jsname="dsyhDe"></div></div></div>
      </div></div>
      <div class="Tmb7Fd" role="region" aria-label="Call controls">${icon('call_end')}</div>`;
    const mirror = setInterval(() => {
      const target = d.querySelector('[jsname="dsyhDe"]');
      if (target) target.innerHTML = region() ? region().outerHTML : '';
    }, 500);
    pip.addEventListener('pagehide', () => clearInterval(mirror));
    sim.log.push('picture-in-picture opened');
  };

  function leaveCall() {
    sim.inCall = false;
    sim.playing = false;
    $('#sim-stage').remove();
    document.body.insertAdjacentHTML('afterbegin', `<div class="sim-left"><h1>You left the meeting</h1><button id="sim-rejoin">Rejoin</button></div>`);
    $('#sim-rejoin').addEventListener('click', () => location.reload());
  }

  // Pre-join screen ("Ready to join?"): no call UI, no Leave button — like Meet before joining.
  function preJoin() {
    sim.inCall = false;
    document.body.insertAdjacentHTML('afterbegin', `<div class="sim-left" id="sim-prejoin"><h1>Ready to join?</h1><button id="sim-join">Join now</button></div>`);
    $('#sim-join').addEventListener('click', () => sim.join());
  }

  sim.join = function join() {
    $('#sim-prejoin')?.remove();
    sim.inCall = true;
    render();
    sim.log.push('joined');
    if (params.get('autoplay') !== '0') sim.play();
  };

  function newBlock(speaker) {
    const r = region();
    const block = document.createElement('div');
    block.className = 'nMcdL bj4p3b';
    block.innerHTML = `<div class="adE6rb"><img class="Z6byG r6DyN" alt=""><div class="KcIKyf jxFHg"><span class="NWpY1d">${speaker}</span></div></div><div class="ygicle VbkSUe"></div>`;
    r.insertBefore(block, r.children[r.children.length - 2]);
    return block;
  }

  function lastBlock() {
    const blocks = region()?.querySelectorAll('.nMcdL');
    return blocks?.length ? blocks[blocks.length - 1] : null;
  }

  async function speak(line) {
    if (line.notice) {
      // Meet shows some system rows without a speaker name; they must be ignored.
      const r = region();
      if (!r) return;
      const row = document.createElement('div');
      row.className = 'nMcdL bj4p3b';
      row.innerHTML = `<div class="adE6rb"><img class="Z6byG r6DyN" alt=""></div><div class="ygicle VbkSUe">${line.notice}</div>`;
      r.insertBefore(row, r.children[r.children.length - 2]);
      return;
    }
    if (line.pause) await sleep(line.pause);
    let block = lastBlock();
    const lastSpeaker = block?.querySelector('.NWpY1d')?.textContent;
    if (!block || lastSpeaker !== line.speaker || !block.querySelector('.NWpY1d')) block = newBlock(line.speaker);
    const textEl = block.querySelector('.ygicle');
    const words = line.text.replace(/[.,:]/g, '').toLowerCase().split(' '); // Meet's uk captions: no punctuation
    const fixes = new Map((line.fix || []).map(([good, bad]) => [good.toLowerCase(), bad.toLowerCase()]));
    let chunk = document.createTextNode('');
    textEl.append(chunk, document.createTextNode(' '));
    for (let i = 0; i < words.length; i++) {
      while (!sim.playing) await sleep(200);
      if (!region() || !block.isConnected) return; // captions turned off / re-rendered mid-line
      const w = words[i];
      const shown = fixes.has(w) ? fixes.get(w) : w;
      chunk.textContent = (chunk.textContent ? chunk.textContent + ' ' : '') + shown;
      await sleep(WORD_MS);
      if (fixes.has(w)) {
        chunk.textContent = chunk.textContent.replace(new RegExp(`${shown}$`), w); // tail revision
        await sleep(WORD_MS);
      }
      if (i % 6 === 5) { // Meet splits a turn into several text nodes
        chunk = document.createTextNode('');
        textEl.append(chunk, document.createTextNode(' '));
      }
    }
    await sleep(1200);
  }

  sim.play = async function play() {
    if (sim.running) { sim.playing = true; return; }
    sim.running = true;
    sim.playing = true;
    if (!sim.captionsOn) sim.log.push('waiting for captions');
    for (const line of SCRIPT) {
      while (!sim.captionsOn || !sim.playing) {
        if (!sim.inCall) return;
        await sleep(200);
      }
      await speak(line);
    }
    sim.running = false;
    sim.done = true;
    sim.log.push('script finished');
  };
  sim.pause = () => { sim.playing = false; };
  sim.setCaptions = setCaptions;
  sim.setReactions = setReactions;
  sim.setNativePanel = setNativePanel;
  sim.leave = leaveCall;
  sim.lastBlock = lastBlock;

  if (params.get('prejoin') === '1') preJoin();
  else sim.join();
})();
