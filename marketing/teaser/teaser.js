// Deterministic timeline: seek(t) sets every style from the time alone, so any frame can be
// rendered in any order. The only stateful pieces are the orb iframes, which run on the
// virtual clock in virtual-time.js and are stepped forward one frame at a time.
(() => {
  const DURATION = 19.4;

  // Seconds.
  const T = {
    openerIn: 0.2,
    openerOut: 2.2,
    deviceIn: 2.35,
    homeHead: [2.75, 4.95],
    tapRead: 4.35,
    push: 4.6,
    readHead: [5.0, 8.7],
    caretStart: 5.45,
    toMono: 8.7,
    monoHead: [8.95, 12.6],
    tapReady: 9.95,
    fog: 10.02,
    live: 10.32,
    monoTalk: 10.75,
    toConvo: 12.6,
    convoHead: [12.85, 16.05],
    convoTalk: 13.05,
    userTurn: 15.45,
    deviceOut: 16.05,
    endIn: 16.55,
    fadeOut: 18.9,
  };

  const PASSAGE =
    'This morning the ship sits quiet in the harbor while sheep graze on the green hill above the shore. A child points at the sheep then at the ship and laughs because the two words sound almost the same in her mind. The guide asks her to say ship when she means the boat and sheep when she means the animals. Clear speech matters here because a wrong vowel can send a listener looking at the wrong thing.';
  const MONO_TRANSCRIPT = 'Most mornings start with coffee, and then the hunt for my keys.';
  const CONVO_OPEN = 'Paper book or phone screen when you travel — why?';

  const SUBTITLE_WIDTH = 354;
  const SUBTITLE = { gap: 5, ink: 0.62, blur: 14, enter: 0.45, hold: 0.35, settleGap: 0.12, followUp: 0.7 };

  // ---------------------------------------------------------------- math

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const prog = (t, start, dur) => clamp((t - start) / dur);
  const outCubic = (x) => 1 - Math.pow(1 - x, 3);
  const outQuint = (x) => 1 - Math.pow(1 - x, 5);
  const inCubic = (x) => x * x * x;
  const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  // SwiftUI .easeOut is a cubic bezier (0, 0, 0.58, 1); outCubic is close enough at these sizes.
  const easeOut = outCubic;
  // Critically damped spring, SwiftUI response r: 1 - (1 + wt) e^(-wt), w = 2π / r.
  const spring = (dt, response = 0.35) => {
    if (dt <= 0) return 0;
    const w = (2 * Math.PI) / response;
    return 1 - (1 + w * dt) * Math.exp(-w * dt);
  };

  // Speech-like level: syllable pulses inside word groups inside phrases.
  function speechLevel(t, seed) {
    const syl = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.3 * t + seed + 0.8 * Math.sin(2 * Math.PI * 1.1 * t + seed));
    const word = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.6 * t + seed * 1.7);
    const phrase = clamp(0.7 + 0.45 * Math.sin(2 * Math.PI * 0.41 * t + seed * 2.3));
    return clamp(0.08 + 0.62 * Math.pow(syl, 1.5) * (0.55 + 0.45 * word) * phrase + 0.12 * phrase);
  }

  // Word onsets for a line of speech, starting at `start`.
  function speechTimes(words, start, pace = 1) {
    const times = [];
    let at = start;
    for (const word of words) {
      times.push(at);
      const letters = word.replace(/[^A-Za-z']/g, '').length;
      at += (0.11 + 0.052 * letters) / pace;
      if (/[,.?!—]$/.test(word) || word === '—') at += 0.2 / pace;
    }
    return times;
  }

  // ---------------------------------------------------------------- dom

  const $ = (id) => document.getElementById(id);
  const el = {
    glow: $('glow'),
    opener: $('opener'),
    heads: {
      home: $('h-home'),
      reading: $('h-reading'),
      mono: $('h-mono'),
      convo: $('h-convo'),
    },
    device: $('device'),
    home: $('home'),
    homeDim: $('home-dim'),
    rowRead: $('row-read'),
    reading: $('reading'),
    words: $('passage-words'),
    monoPlan: $('mono-plan'),
    readyPill: $('ready-pill'),
    monoLive: $('mono-live'),
    clock: $('take-clock'),
    monoSubtitle: $('mono-subtitle'),
    convo: $('convo'),
    convoSubtitle: $('convo-subtitle'),
    fog: $('fog'),
    endcard: $('endcard'),
    fade: $('fade'),
  };

  function style(node, { opacity, x = 0, y = 0, scale = 1, blur = 0, visible }) {
    const o = opacity ?? 1;
    const show = visible ?? o > 0.001;
    node.style.visibility = show ? 'visible' : 'hidden';
    node.style.opacity = String(o);
    node.style.transform = `translate3d(${x.toFixed(3)}px, ${y.toFixed(3)}px, 0) scale(${scale.toFixed(5)})`;
    node.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
  }

  // ---------------------------------------------------------------- reading

  const passageWords = PASSAGE.split(' ');
  const passageTimes = speechTimes(passageWords, T.caretStart, 1.05);
  let wordSpans = [];

  function buildPassage() {
    el.words.innerHTML = '';
    wordSpans = passageWords.map((word) => {
      const span = document.createElement('span');
      span.textContent = word;
      el.words.appendChild(span);
      return span;
    });
  }

  function currentWord(t) {
    if (t < T.caretStart) return -1;
    let index = 0;
    while (index + 1 < passageTimes.length && passageTimes[index + 1] <= t) index++;
    return index;
  }

  // ---------------------------------------------------------------- subtitle

  let measureCtx;
  function measure(word) {
    if (!measureCtx) {
      measureCtx = document.createElement('canvas').getContext('2d');
      measureCtx.font = '16px "System Serif"';
    }
    return measureCtx.measureText(word).width;
  }

  // Mirrors SpeechSubtitle: append words on one line; on overflow hold, fade the line, then
  // present the next one. Returns a schedule so a frame is a pure function of time.
  function subtitleSchedule(words, times) {
    const pages = [];
    let current = [];
    let used = 0;
    words.forEach((word, i) => {
      const extra = current.length ? measure(word) + SUBTITLE.gap : measure(word);
      if (current.length && used + extra > SUBTITLE_WIDTH) {
        pages.push(current);
        current = [];
        used = 0;
      }
      current.push(i);
      used += current.length === 1 ? measure(word) : extra;
    });
    if (current.length) pages.push(current);

    let show = times[0];
    return pages.map((indexes, p) => {
      const appear = indexes.map((i) => Math.max(times[i], show));
      const next = pages[p + 1];
      let fadeStart = Infinity;
      if (next) {
        const overflowAt = times[next[0]];
        fadeStart = overflowAt <= show ? show + SUBTITLE.followUp : overflowAt + SUBTITLE.hold;
      }
      const page = { indexes, appear, show, fadeStart };
      show = fadeStart + SUBTITLE.enter + SUBTITLE.settleGap;
      return page;
    });
  }

  function renderSubtitle(node, words, schedule, t) {
    const page = [...schedule].reverse().find((p) => p.show <= t);
    if (!page || t >= page.fadeStart + SUBTITLE.enter) {
      node.innerHTML = '';
      return;
    }
    const fading = t >= page.fadeStart ? easeOut(prog(t, page.fadeStart, SUBTITLE.enter)) : 0;
    const visible = page.indexes.filter((_, k) => page.appear[k] <= t);
    // Older words start where the shorter, centered line had them and spring to the new center.
    const groups = [];
    page.appear.forEach((at, k) => {
      if (at > t || (k > 0 && page.appear[k - 1] === at)) return;
      const batch = page.indexes.filter((_, j) => page.appear[j] === at);
      const growth = batch.reduce((sum, i) => sum + measure(words[i]) + SUBTITLE.gap, 0) - (k === 0 ? SUBTITLE.gap : 0);
      groups.push({ at, growth, firstK: k });
    });

    const html = visible.map((i, k) => {
      const at = page.appear[k];
      const enter = easeOut(prog(t, at, SUBTITLE.enter));
      let shift = 0;
      for (const g of groups) {
        if (g.firstK > k) shift += (g.growth / 2) * (1 - spring(t - g.at));
      }
      const opacity = SUBTITLE.ink * enter * (1 - fading);
      const blur = SUBTITLE.blur * (1 - enter) + SUBTITLE.blur * fading;
      return `<span style="opacity:${opacity.toFixed(3)};filter:blur(${blur.toFixed(2)}px);transform:translateX(${shift.toFixed(2)}px)">${words[i]}</span>`;
    });
    node.innerHTML = html.join('');
  }

  const monoWords = MONO_TRANSCRIPT.split(' ');
  const monoTimes = speechTimes(monoWords, T.monoTalk, 1.1);
  const convoWords = CONVO_OPEN.split(' ');
  const convoTimes = speechTimes(convoWords, T.convoTalk, 0.95);
  let monoSchedule;
  let convoSchedule;

  // ---------------------------------------------------------------- take clock

  const clockLabel = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // .contentTransition(.numericText(countsDown: true)) with the settle spring.
  function renderClock(t) {
    const elapsed = t < T.live ? 0 : Math.floor(t - T.live);
    const label = clockLabel(240 - elapsed);
    const previous = clockLabel(240 - Math.max(0, elapsed - 1));
    const tick = T.live + elapsed;
    const k = elapsed > 0 ? spring(t - tick, 0.35) : 1;
    node(el.clock, label, previous, k);

    function node(container, now, before, a) {
      const parts = [];
      for (let i = 0; i < now.length; i++) {
        const c = now[i];
        const p = before[i];
        if (c === p || a >= 0.985) {
          parts.push(`<span class="ch"><span class="sizer">${c}</span><span>${c}</span></span>`);
        } else {
          const inY = (-(1 - a) * 0.32).toFixed(3);
          const outY = (a * 0.32).toFixed(3);
          parts.push(
            `<span class="ch"><span class="sizer">${c}</span>` +
              `<span style="transform:translateY(${inY}em);opacity:${a.toFixed(3)};filter:blur(${((1 - a) * 5).toFixed(2)}px)">${c}</span>` +
              `<span style="transform:translateY(${outY}em);opacity:${Math.pow(1 - a, 2).toFixed(3)};filter:blur(${(a * 5).toFixed(2)}px)">${p}</span></span>`,
          );
        }
      }
      container.innerHTML = parts.join('');
    }
  }

  // ---------------------------------------------------------------- orbs

  const orbs = [];

  function orbSignal(name, t) {
    switch (name) {
      case 'reading':
        return { state: 'listening', input: t >= T.caretStart ? speechLevel(t, 0.3) : 0.06, output: 0 };
      case 'mono':
        return { state: 'listening', input: t >= T.monoTalk ? speechLevel(t, 1.9) : 0.06, output: 0 };
      case 'convo':
        if (t < T.userTurn) {
          return { state: 'speaking', input: 0, output: t >= T.convoTalk - 0.1 ? speechLevel(t, 3.4) : 0.1 };
        }
        return { state: 'listening', input: t >= T.userTurn + 0.25 ? speechLevel(t, 5.2) * 0.9 : 0.06, output: 0 };
      default:
        return { state: 'listening', input: 0, output: 0 };
    }
  }

  const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function waitFor(check, label, timeoutMs = 20000) {
    let waited = 0;
    while (!check()) {
      if (waited > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      waited += 50;
    }
  }

  // ---------------------------------------------------------------- frame

  function headline(node, t, [start, end]) {
    const a = outCubic(prog(t, start, 0.75));
    const b = inCubic(prog(t, end - 0.4, 0.4));
    style(node, {
      opacity: a * (1 - b),
      y: 16 * (1 - a) - 10 * b,
      blur: 8 * (1 - a) + 6 * b,
    });
  }

  function apply(t) {
    // Opener
    {
      const a = outCubic(prog(t, T.openerIn, 1.1));
      const s = outCubic(prog(t, T.openerIn + 0.45, 0.9));
      const b = inCubic(prog(t, T.openerOut, 0.5));
      const [mark, sub] = el.opener.children;
      style(el.opener, { opacity: 1 - b, y: -14 * b, blur: 8 * b });
      style(mark, { opacity: a, scale: lerp(1.05, 1, a), blur: 14 * (1 - a) });
      style(sub, { opacity: s, y: 8 * (1 - s), blur: 6 * (1 - s) });
    }

    // Device in, slow drift, out
    {
      const a = outQuint(prog(t, T.deviceIn, 1.25));
      const b = inOutCubic(prog(t, T.deviceOut, 0.8));
      const drift = 1 + 0.022 * inOutCubic(prog(t, T.deviceIn + 1, T.deviceOut - T.deviceIn - 1));
      style(el.device, {
        opacity: a * (1 - b),
        y: 90 * (1 - a) + 70 * b,
        scale: lerp(0.93, 1, a) * drift * lerp(1, 0.95, b),
        blur: 5 * b,
      });
      style(el.glow, { opacity: a * (1 - b) });
    }

    headline(el.heads.home, t, T.homeHead);
    headline(el.heads.reading, t, T.readHead);
    headline(el.heads.mono, t, T.monoHead);
    headline(el.heads.convo, t, T.convoHead);

    // Home, then a push to Reading
    const push = outQuint(prog(t, T.push, 0.62));
    {
      const press = spring(t - T.tapRead, 0.22) * (1 - spring(t - (T.tapRead + 0.22), 0.3));
      style(el.rowRead, { scale: 1 - 0.035 * press });
      el.rowRead.querySelector('.flare').style.opacity = String(press);
      style(el.home, { opacity: t < T.push + 0.62 ? 1 : 0, x: -0.3 * 402 * push });
      el.homeDim.style.opacity = String(0.4 * push);
    }

    // Reading
    {
      const shown = t >= T.push && t < T.toMono + 0.5;
      style(el.reading, { opacity: shown ? 1 : 0, x: 402 * (1 - push) });
      const index = currentWord(t);
      wordSpans.forEach((span, i) => span.classList.toggle('current', i === index));
    }

    // Monologue: planning, I'm ready, fog, live take
    {
      const cross = inOutCubic(prog(t, T.toMono, 0.5));
      const planShown = t >= T.toMono && t < T.live;
      style(el.monoPlan, { opacity: planShown ? cross : 0, scale: lerp(1.015, 1, cross) });
      const press = spring(t - T.tapReady, 0.22) * (1 - spring(t - (T.tapReady + 0.18), 0.3));
      style(el.readyPill, { scale: 1 - 0.03 * press, opacity: 1 - 0.08 * press });

      const fogUp = spring(t - T.fog, 0.35);
      const fogDown = spring(t - T.live, 0.35);
      el.fog.style.opacity = String(clamp(fogUp * (1 - fogDown)));
      el.fog.style.visibility = fogUp * (1 - fogDown) > 0.002 ? 'visible' : 'hidden';

      const liveShown = t >= T.live && t < T.toConvo + 0.5;
      style(el.monoLive, { opacity: liveShown ? 1 : 0 });
      renderClock(t);
      renderSubtitle(el.monoSubtitle, monoWords, monoSchedule, t);
    }

    // Conversation
    {
      const cross = inOutCubic(prog(t, T.toConvo, 0.5));
      style(el.convo, { opacity: t >= T.toConvo ? cross : 0, scale: lerp(1.015, 1, cross) });
      renderSubtitle(el.convoSubtitle, convoWords, convoSchedule, t);
    }

    // End card
    {
      const [icon, mark, sub, modes] = el.endcard.children;
      const i = outQuint(prog(t, T.endIn, 1.1));
      const m = outCubic(prog(t, T.endIn + 0.2, 1.0));
      const s = outCubic(prog(t, T.endIn + 0.5, 0.9));
      const d = outCubic(prog(t, T.endIn + 0.85, 0.9));
      style(el.endcard, { opacity: t >= T.endIn ? 1 : 0 });
      style(icon, { opacity: i, scale: lerp(0.86, 1, i), y: 10 * (1 - i), blur: 10 * (1 - i) });
      style(mark, { opacity: m, y: 12 * (1 - m), blur: 10 * (1 - m) });
      style(sub, { opacity: s, y: 8 * (1 - s), blur: 6 * (1 - s) });
      style(modes, { opacity: d, y: 6 * (1 - d), blur: 4 * (1 - d) });
    }

    el.fade.style.opacity = String(inOutCubic(prog(t, T.fadeOut, DURATION - T.fadeOut)));
  }

  async function seek(t) {
    apply(t);
    for (const orb of orbs) {
      const { state, input, output } = orbSignal(orb.name, t);
      orb.win.orbSetSignal(state, input, output);
    }
    // React inside each orb commits the new signal on a scheduler task before the next frame draws.
    await macrotask();
    await macrotask();
    for (const orb of orbs) orb.win.__vt.advanceTo(t * 1000);
    window.__vt?.advanceTo(t * 1000);
  }

  async function ready() {
    await Promise.all([
      document.fonts.load('51px "Instrument Serif"'),
      document.fonts.load('17px "System"'),
      document.fonts.load('500 17px "System"'),
      document.fonts.load('600 17px "System"'),
      document.fonts.load('22px "System Serif"'),
    ]);
    await document.fonts.ready;
    buildPassage();
    monoSchedule = subtitleSchedule(monoWords, monoTimes);
    convoSchedule = subtitleSchedule(convoWords, convoTimes);

    const frames = [...document.querySelectorAll('iframe.orb')];
    for (const frame of frames) {
      await waitFor(() => frame.contentWindow?.orbReady === true && frame.contentWindow.__vt, `orb ${frame.dataset.orb}`);
      const win = frame.contentWindow;
      win.orbSetParked(false);
      orbs.push({ name: frame.dataset.orb, win });
    }
    await seek(0);
  }

  window.teaser = { duration: DURATION, ready, seek, T };
})();
