// Google Meet simulator for dev/harness.html. Reproduces the DOM structure recorded in docs/meet-dom.md
// (class names, jsnames, icon ligatures, roles) and streams a scripted Ukrainian conversation into the
// captions region the way Meet does: word by word, with tail revisions, pauses and speaker changes.
(function () {
  const params = new URLSearchParams(location.search);
  const sim = (window.meetSim = {
    speed: Number(params.get('speed') || 1),
    playing: false,
    captionsOn: params.get('cc') === 'on',
    language: 'English',
    inCall: true,
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
        <div class="sim-grid">
          <div class="sim-tile" data-participant-id="p1"><div class="sim-av">О</div><span class="notranslate">Олена Коваль</span></div>
          <div class="sim-tile" data-participant-id="p2"><div class="sim-av">А</div><span class="notranslate">Андрій Мельник</span></div>
          <div class="sim-tile" data-participant-id="p3"><div class="sim-av">І</div><span class="notranslate">Ірина Шевчук</span></div>
          <div class="sim-tile" data-participant-id="p0">
            <div class="sim-av">D</div><span class="notranslate">Denys Danyliuk</span>
            <div class="sim-self-tools"><button aria-label="Reframe">${icon('frame_person')}</button><button aria-label="Apply visual effects">${icon('visual_effects')}</button></div>
          </div>
        </div>
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
          <button aria-label="Turn on captions" jsname="RrG0hf" class="sim-btn sim-cc" id="sim-cc">${icon('closed_caption_off')}</button>
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

    $('#sim-cc').addEventListener('click', () => setCaptions(!sim.captionsOn));
    $('#sim-end').addEventListener('click', leaveCall);
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

  function setCaptions(on) {
    sim.captionsOn = on;
    const btn = $('#sim-cc');
    btn.querySelector('i').textContent = on ? 'closed_caption' : 'closed_caption_off';
    btn.setAttribute('aria-label', on ? 'Turn off captions' : 'Turn on captions');
    btn.classList.toggle('is-on', on);
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
  sim.leave = leaveCall;
  sim.lastBlock = lastBlock;

  if (params.get('prejoin') === '1') preJoin();
  else sim.join();
})();
