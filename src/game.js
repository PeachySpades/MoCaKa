// Echo Caves: Moka the bat flies through a pitch-black cave.
// Squeaking sends out a ring of sound that briefly lights the walls,
// but it also wakes up whatever is sleeping nearby.
(() => {
  'use strict';

  // ---- Tuning ----------------------------------------------------------
  const VIEW_TILES = 9;        // how many tiles fit vertically on screen
  const MOKA_R = 0.28;         // Moka's collision radius, in tiles
  const ACCEL = 30, MAX_SPEED = 4.6, DRAG = 3.4;
  const RING_SPEED = 11, RING_MAX = 8.5, SQUEAK_COOLDOWN = 0.45;
  const LIGHT_FADE = 0.7;      // lit walls fade over ~1.4s
  const MAX_HEARTS = 3, HURT_TIME = 1.3;
  const MAX_ECHOES = 15, CRYSTAL_ECHOES = 3;
  // Cave Run: the screen scrolls right on its own, speeding up over time
  const RUN_START_SPEED = 2.0, RUN_MAX_SPEED = 4.0, RUN_SPEEDUP = 0.025;

  const COL = {
    bg: '#05060d',
    wall: '74, 222, 255',      // neon cyan, as "r, g, b" for rgba()
    wallFill: '18, 52, 80',
    moth: '255, 226, 120',
    exit: '120, 255, 170',
    danger: '255, 84, 104',
    owl: '255, 196, 64',
    crystal: '150, 240, 255',
    moka: '#8b6cff',
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const isTouch = matchMedia('(pointer: coarse)').matches;

  // ---- Storage (best stars per cave) -----------------------------------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ---- Audio -------------------------------------------------------------
  // Everything is synthesized: no sound files. Sound effects and music each
  // have their own volume, and both go through one master switch (the ♪ button).
  let ac = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let muted = !!store.get('echo-muted');
  function unlockAudio() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; }
      if (ac) {
        master = ac.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(ac.destination);
        sfxBus = ac.createGain(); sfxBus.connect(master);
        musicBus = ac.createGain(); musicBus.gain.value = 0.55; musicBus.connect(master);
        noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
    }
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
    // iPhones mute Web Audio when the ring switch is on silent, unless a media
    // element is playing too: a silent looping clip switches it to "playback"
    if (!silentLoop) {
      try {
        silentLoop = new Audio('data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==');
        silentLoop.loop = true;
        silentLoop.setAttribute('playsinline', '');
        silentLoop.play().catch(() => { silentLoop = null; });
      } catch { silentLoop = null; }
    }
  }
  let silentLoop = null;
  // any first touch or key unlocks sound, so the menus can play music too
  addEventListener('pointerdown', () => unlockAudio(), { passive: true });
  addEventListener('keydown', () => unlockAudio());
  function setMuted(m) {
    muted = m;
    store.set('echo-muted', m);
    if (master) master.gain.setTargetAtTime(m ? 0 : 1, ac.currentTime, 0.03);
    const b = $('sound-toggle');
    b.classList.toggle('off', m);
    b.setAttribute('aria-pressed', String(!m));
    b.title = m ? 'Sound off' : 'Sound on';
  }
  function tone(f0, f1, dur, type = 'sine', vol = 0.12, delay = 0, dest = sfxBus) {
    if (!ac) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  // a burst of filtered noise: hats, snares, whooshes, rumbles
  function hiss(dur, vol, freq, at, dest = sfxBus, type = 'highpass') {
    if (!ac) return;
    const t = at ?? ac.currentTime;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf;
    f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }
  const sfx = {
    squeak() { tone(2300, 3600, 0.08, 'sine', 0.1); tone(2300, 3600, 0.08, 'sine', 0.03, 0.22); },
    moth() { tone(880, 1320, 0.14, 'triangle', 0.1); tone(1320, 1760, 0.18, 'triangle', 0.07, 0.08); },
    hurt() { tone(240, 70, 0.3, 'square', 0.07); },
    wake() { tone(320, 160, 0.25, 'sawtooth', 0.035); },
    crash() { tone(180, 40, 0.35, 'triangle', 0.12); hiss(0.4, 0.08, 400, undefined, sfxBus, 'lowpass'); },
    empty() { tone(260, 180, 0.12, 'sine', 0.06); },
    crystal() { tone(1500, 2600, 0.12, 'sine', 0.08); tone(2600, 3200, 0.1, 'sine', 0.05, 0.07); },
    chomp() { tone(420, 90, 0.16, 'square', 0.09); tone(300, 60, 0.18, 'square', 0.07, 0.12); hiss(0.08, 0.1, 2000); },
    slurp() { tone(300, 1400, 0.3, 'sine', 0.08); },
    dash() { tone(900, 260, 0.14, 'sawtooth', 0.045); hiss(0.18, 0.09, 1800, undefined, sfxBus, 'bandpass'); },
    burp() { tone(140, 90, 0.28, 'sawtooth', 0.06); tone(110, 70, 0.2, 'sawtooth', 0.04, 0.12); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.22, 'triangle', 0.1, i * 0.11)); tone(1047, 1050, 0.6, 'sine', 0.06, 0.44); },
    // battle
    stun() { for (let k = 0; k < 4; k++) tone(700 - k * 60, 900 - k * 60, 0.09, 'triangle', 0.06, k * 0.08); },
    block() { tone(1200, 1180, 0.25, 'sine', 0.08); tone(1800, 1790, 0.2, 'sine', 0.05, 0.02); hiss(0.1, 0.05, 3000); },
    power() { [660, 880, 1100, 1320].forEach((f, i) => tone(f, f * 1.02, 0.1, 'square', 0.035, i * 0.05)); },
    beep() { tone(880, 880, 0.12, 'square', 0.05); },
    go() { tone(1320, 1320, 0.3, 'square', 0.06); tone(660, 660, 0.3, 'square', 0.04); },
    charged() { tone(1200, 2400, 0.12, 'sine', 0.05); },
    beam() { tone(2400, 300, 0.35, 'sawtooth', 0.07); tone(1600, 200, 0.3, 'square', 0.04, 0.02); hiss(0.25, 0.08, 3000); },
    warn() { tone(90, 60, 1.2, 'sawtooth', 0.05); hiss(1.2, 0.05, 300, undefined, sfxBus, 'lowpass'); },
  };

  // Music: an upbeat jazz band (horns, piano, bass, guitar, vibes, drums),
  // synthesized on the fly with its own tune per mode; see src/music.js
  const music = window.makeEchoMusic({ ctx: () => ac, bus: () => musicBus, noise: () => noiseBuf });
  window.EchoAudio = { sfx, music, unlock: unlockAudio };

  // ---- Level -------------------------------------------------------------
  let L;          // the current level's runtime state
  function loadLevel(def) {
    const rows = def.map;
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const grid = new Uint8Array(w * h);
    const lv = {
      def, w, h, grid, lit: new Float32Array(w * h),
      start: { x: 1.5, y: 1.5 }, exit: { x: 1.5, y: 1.5 },
      moths: [], crystals: [], hazards: [],
    };
    const ch = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? '#' : (rows[y][x] || '#');
    const shaft = (x, y) => {
      let top = y, bot = y;
      while (ch(x, top - 1) !== '#') top--;
      while (ch(x, bot + 1) !== '#') bot++;
      return { top, bot };
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = ch(x, y);
        grid[y * w + x] = c === '#' ? 1 : 0;
        const cx = x + 0.5, cy = y + 0.5;
        if (c === 'S') lv.start = { x: cx, y: cy };
        else if (c === 'E') lv.exit = { x: cx, y: cy };
        else if (c === 'm') lv.moths.push({ x: cx, y: cy, got: false, phase: Math.random() * 6 });
        else if (c === 'e') lv.crystals.push({ x: cx, y: cy, got: false, phase: Math.random() * 6 });
        else if (c === 's') {
          const { top, bot } = shaft(x, y);
          lv.hazards.push({ kind: 'spider', x: cx, y: cy, restY: cy, top: top + 0.45, bot: bot + 0.55, r: 0.3, awake: 0, t: 0, lit: 0 });
        } else if (c === 'r') {
          const { top } = shaft(x, y);
          lv.hazards.push({ kind: 'rock', x: cx, y: top + 0.32, r: 0.26, state: 'hang', shake: 0, vy: 0, lit: 0 });
        } else if (c === 'o') {
          lv.hazards.push({ kind: 'owl', x: cx, y: cy, homeX: cx, homeY: cy, r: 0.34, state: 'sleep', t: 0, lit: 0 });
        }
      }
    }
    return lv;
  }
  const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= L.w || ty >= L.h || L.grid[ty * L.w + tx] === 1;

  function hitsWall(px, py, r) {
    for (let ty = Math.floor(py - r); ty <= Math.floor(py + r); ty++) {
      for (let tx = Math.floor(px - r); tx <= Math.floor(px + r); tx++) {
        if (!solid(tx, ty)) continue;
        const nx = Math.max(tx, Math.min(px, tx + 1));
        const ny = Math.max(ty, Math.min(py, ty + 1));
        if ((px - nx) ** 2 + (py - ny) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  // ---- Game state --------------------------------------------------------
  let state = 'title';          // title | play | win | lose | duel
  let mode = 'cave';            // cave (explore a hand-made cave) | run (side-scroller) | duel (battle)
  let duelCfg = { humans: 1, cpus: 1 };
  let levelIndex = 0;
  let moka, rings, particles, cam, stats, shake, hintTimer, clock, scroll, endReason;

  function startGame(newMode, i = 0) {
    mode = newMode;
    levelIndex = i;
    L = loadLevel(mode === 'run' ? window.makeRunLevel(Math.floor(Math.random() * 1e9)) : window.ECHO_LEVELS[i]);
    moka = {
      x: L.start.x, y: L.start.y, vx: 0, vy: 0, face: 1,
      hearts: MAX_HEARTS, hurt: 0, cooldown: 0, echoes: L.def.echoes, noEcho: 0,
    };
    rings = [];
    particles = [];
    scroll = { x: 0, speed: RUN_START_SPEED };
    cam = { x: moka.x, y: moka.y };
    if (mode === 'run') cam.x = W / PX / 2;
    stats = { moths: 0, squeaks: 0, time: 0 };
    endReason = '';
    shake = 0;
    hintTimer = 6;
    clock = 0;
    state = 'play';
    showOverlay(null);
  }

  // ---- Input -------------------------------------------------------------
  const keys = new Set();
  let stick = null;             // the finger or mouse button steering Moka
  const STICK_RANGE = 56;       // px of drag for full speed

  addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat && inMatch()) { pauseOpen ? resume() : openPause(); return; }
    if (pauseOpen) return;
    if (state === 'duel' || mode === 'duel') return;   // the battle handles its own keys
    if (state !== 'play') {
      if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) primaryAction();
      return;
    }
    keys.add(e.code);
    if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) squeak();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); stick = null; });

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state !== 'play') return;
    unlockAudio();
    if (!stick) {
      stick = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      canvas.setPointerCapture?.(e.pointerId);
    } else {
      squeak(); // a second finger taps while the first steers
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!stick || stick.id !== e.pointerId) return;
    stick.x = e.clientX;
    stick.y = e.clientY;
    if (Math.hypot(stick.x - stick.sx, stick.y - stick.sy) > 14) stick.moved = true;
  });
  const endStick = (e) => {
    if (!stick || stick.id !== e.pointerId) return;
    if (!stick.moved && performance.now() - stick.t < 280) squeak();
    stick = null;
  };
  canvas.addEventListener('pointerup', endStick);
  canvas.addEventListener('pointercancel', endStick);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function readInput() {
    let ix = 0, iy = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) ix -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) ix += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) iy -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) iy += 1;
    if (stick) {
      const dx = stick.x - stick.sx, dy = stick.y - stick.sy, len = Math.hypot(dx, dy);
      if (len > 8) {
        const mag = Math.min(len / STICK_RANGE, 1);
        ix += (dx / len) * mag;
        iy += (dy / len) * mag;
      }
    }
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    return { ix, iy };
  }

  // ---- Actions -----------------------------------------------------------
  function squeak() {
    if (state !== 'play' || moka.cooldown > 0) return;
    if (moka.echoes <= 0) {
      moka.noEcho = 0.6;
      moka.cooldown = SQUEAK_COOLDOWN;
      sfx.empty();
      return;
    }
    moka.cooldown = SQUEAK_COOLDOWN;
    moka.echoes--;
    stats.squeaks++;
    rings.push({ x: moka.x, y: moka.y, r: 0 });
    hintTimer = Math.min(hintTimer, 2.5);
    sfx.squeak();
  }

  function wake(h) {
    if (h.kind === 'spider') {
      if (!h.awake) {
        h.t = 0;
        const mid = (h.top + h.bot) / 2, amp = (h.bot - h.top) / 2;
        h.phase = amp > 0.05 ? Math.acos(Math.max(-1, Math.min(1, (h.restY - mid) / amp))) : 0;
        sfx.wake();
      }
      h.awake = 6;
    } else if (h.kind === 'rock' && h.state === 'hang') {
      h.state = 'shake';
      h.shake = 0.4;
      sfx.wake();
    } else if (h.kind === 'owl') {
      if (h.state !== 'chase') sfx.wake();
      h.state = 'chase';
      h.t = 4;
    }
  }

  function hurt(fromX, fromY) {
    if (moka.hurt > 0) return;
    moka.hearts--;
    moka.hurt = HURT_TIME;
    const dx = moka.x - fromX, dy = moka.y - fromY, d = Math.hypot(dx, dy) || 1;
    moka.vx = (dx / d) * 5;
    moka.vy = (dy / d) * 5;
    shake = 0.35;
    burst(moka.x, moka.y, COL.danger, 14);
    sfx.hurt();
    if (moka.hearts <= 0) endGame(false, 'hearts');
  }

  function burst(x, y, rgb, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.5, rgb });
    }
  }

  function endGame(won, reason = '') {
    state = won ? 'win' : 'lose';
    endReason = reason;
    stick = null;
    keys.clear();
    if (won) sfx.win();
    if (mode === 'run') endRun(won);
    else endCave(won);
    $('end-button').textContent = won ? 'Play again' : 'Try again';
    $('end-button').hidden = false;
    $('end-wait').hidden = true;
    $('menu-button').textContent = 'Menu';
    setTimeout(() => { if (state === 'win' || state === 'lose') showOverlay('end'); }, won ? 500 : 700);
  }

  function endCave(won) {
    if (won) {
      const allMoths = stats.moths === L.moths.length;
      const spare = moka.echoes >= L.def.spare;
      const stars = 1 + (allMoths ? 1 : 0) + (spare ? 1 : 0);
      const key = 'echo-caves-best-' + levelIndex;
      store.set(key, Math.max(stars, store.get(key) || 0));
      $('end-title').textContent = 'Out of the dark!';
      $('end-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
      $('end-stars').setAttribute('aria-label', stars + ' of 3 stars');
      $('end-detail').innerHTML =
        `<li class="got">Found the exit</li>` +
        `<li class="${allMoths ? 'got' : ''}">Moths ${stats.moths} of ${L.moths.length}</li>` +
        `<li class="${spare ? 'got' : ''}">Echoes left ${moka.echoes}, need ${L.def.spare}</li>`;
    } else {
      $('end-title').textContent = 'Moka needs a rest';
      $('end-stars').textContent = '☆☆☆';
      $('end-stars').setAttribute('aria-label', 'No stars');
      $('end-detail').innerHTML = `<li>Squeak less near sleeping things, or fly past before they wake.</li>`;
    }
  }

  function endRun(won) {
    const dist = runDistance();
    const best = Math.max(dist, store.get('echo-caves-run-best') || 0);
    const isBest = dist >= best && dist > 0;
    store.set('echo-caves-run-best', best);
    $('end-title').textContent = won ? 'You flew the whole tunnel!'
      : endReason === 'dark' ? 'Caught by the dark' : 'Moka needs a rest';
    $('end-stars').textContent = `${dist} m`;
    $('end-stars').setAttribute('aria-label', `${dist} metres`);
    $('end-detail').innerHTML =
      `<li class="${isBest ? 'got' : ''}">${isBest ? 'New best distance!' : `Best ${best} m`}</li>` +
      `<li class="${stats.moths ? 'got' : ''}">Moths ${stats.moths}</li>` +
      (endReason === 'dark' ? `<li>Keep up with the screen. If a wall pins you at the left edge, the dark catches you.</li>` : '');
    updateBests();
  document.addEventListener('visibilitychange', () => { if (document.hidden) music.set(false); });
  }

  const runDistance = () => Math.max(0, Math.floor(moka.x - L.start.x));

  // ---- Update ------------------------------------------------------------
  function update(dt) {
    clock += dt;
    stats.time += dt;
    moka.cooldown = Math.max(0, moka.cooldown - dt);
    moka.hurt = Math.max(0, moka.hurt - dt);
    moka.noEcho = Math.max(0, moka.noEcho - dt);
    hintTimer -= dt;
    shake = Math.max(0, shake - dt);

    // Moka
    const { ix, iy } = readInput();
    if (ix || iy) {
      moka.vx += ix * ACCEL * dt;
      moka.vy += iy * ACCEL * dt;
    } else {
      moka.vx -= moka.vx * DRAG * dt;
      moka.vy -= moka.vy * DRAG * dt;
    }
    const sp = Math.hypot(moka.vx, moka.vy);
    if (sp > MAX_SPEED) { moka.vx *= MAX_SPEED / sp; moka.vy *= MAX_SPEED / sp; }
    if (Math.abs(moka.vx) > 0.2) moka.face = Math.sign(moka.vx);
    const nx = moka.x + moka.vx * dt;
    if (!hitsWall(nx, moka.y, MOKA_R)) moka.x = nx; else moka.vx *= -0.25;
    const ny = moka.y + moka.vy * dt;
    if (!hitsWall(moka.x, ny, MOKA_R)) moka.y = ny; else moka.vy *= -0.25;

    // Cave Run: the left edge of the screen keeps moving right and pushes Moka along
    if (mode === 'run') {
      scroll.speed = Math.min(RUN_MAX_SPEED, RUN_START_SPEED + stats.time * RUN_SPEEDUP);
      scroll.x = Math.min(L.w - W / PX, scroll.x + scroll.speed * dt);
      const left = scroll.x + MOKA_R + 0.05, right = scroll.x + W / PX - MOKA_R - 0.3;
      if (moka.x > right) { moka.x = right; moka.vx = Math.min(moka.vx, 0); }
      if (moka.x < left) {
        moka.x = left;
        moka.vx = Math.max(moka.vx, scroll.speed);
        if (hitsWall(moka.x, moka.y, MOKA_R)) {
          burst(moka.x, moka.y, COL.danger, 20);
          sfx.hurt();
          shake = 0.4;
          endGame(false, 'dark');
          return;
        }
      }
    }

    // Light fades
    const lit = L.lit;
    for (let i = 0; i < lit.length; i++) if (lit[i] > 0) lit[i] = Math.max(0, lit[i] - dt * LIGHT_FADE);
    for (const h of L.hazards) h.lit = Math.max(0, h.lit - dt * LIGHT_FADE);

    // Sound rings light walls and wake hazards as they pass
    for (const ring of rings) {
      const prev = ring.r;
      ring.r += RING_SPEED * dt;
      const r = ring.r;
      const x0 = Math.max(0, Math.floor(ring.x - r - 1)), x1 = Math.min(L.w - 1, Math.ceil(ring.x + r + 1));
      const y0 = Math.max(0, Math.floor(ring.y - r - 1)), y1 = Math.min(L.h - 1, Math.ceil(ring.y + r + 1));
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const d = Math.hypot(tx + 0.5 - ring.x, ty + 0.5 - ring.y);
          if (d >= prev - 0.6 && d < r + 0.6) lit[ty * L.w + tx] = 1;
        }
      }
      for (const h of L.hazards) {
        const d = Math.hypot(h.x - ring.x, h.y - ring.y);
        if (d >= prev && d < r) { h.lit = 1; wake(h); }
      }
    }
    rings = rings.filter((ring) => ring.r < RING_MAX);

    // Hazards
    for (const h of L.hazards) {
      if (h.kind === 'spider') {
        if (h.awake > 0) {
          h.awake -= dt;
          h.t += dt;
          const mid = (h.top + h.bot) / 2, amp = (h.bot - h.top) / 2;
          h.y = mid + amp * Math.cos(h.phase + h.t * 1.9);
          if (h.awake <= 0) { h.awake = 0; h.restY = h.y; }
        }
      } else if (h.kind === 'rock') {
        if (h.state === 'shake') {
          h.shake -= dt;
          if (h.shake <= 0) h.state = 'fall';
        } else if (h.state === 'fall') {
          h.vy += 24 * dt;
          h.y += h.vy * dt;
          if (solid(Math.floor(h.x), Math.floor(h.y + h.r))) {
            h.state = 'gone';
            burst(h.x, h.y, COL.wall, 12);
            sfx.crash();
          }
        }
      } else if (h.kind === 'owl') {
        if (h.state === 'chase') {
          h.t -= dt;
          steer(h, moka.x, moka.y, 2.5, dt);
          if (h.t <= 0) h.state = 'home';
        } else if (h.state === 'home') {
          steer(h, h.homeX, h.homeY, 3, dt);
          if (Math.hypot(h.x - h.homeX, h.y - h.homeY) < 0.1) { h.state = 'sleep'; h.x = h.homeX; h.y = h.homeY; }
        }
      }
      const harmful = h.kind === 'spider' || (h.kind === 'rock' && h.state === 'fall') || (h.kind === 'owl' && h.state !== 'sleep');
      if (harmful && Math.hypot(h.x - moka.x, h.y - moka.y) < h.r + MOKA_R) hurt(h.x, h.y);
    }
    if (state !== 'play') return;

    // Moths and exit
    for (const m of L.moths) {
      if (!m.got && Math.hypot(m.x - moka.x, m.y - moka.y) < 0.6) {
        m.got = true;
        stats.moths++;
        burst(m.x, m.y, COL.moth, 16);
        sfx.moth();
      }
    }
    for (const c of L.crystals) {
      if (!c.got && Math.hypot(c.x - moka.x, c.y - moka.y) < 0.6) {
        c.got = true;
        moka.echoes = Math.min(MAX_ECHOES, moka.echoes + CRYSTAL_ECHOES);
        burst(c.x, c.y, COL.crystal, 14);
        sfx.crystal();
      }
    }
    if (Math.hypot(L.exit.x - moka.x, L.exit.y - moka.y) < 0.6) endGame(true);

    // Particles
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    // Camera follows Moka, clamped to the cave
    const vw = W / PX, vh = H / PX;
    const k = 1 - Math.exp(-dt * 6);
    if (mode === 'run') cam.x = scroll.x + vw / 2;
    else cam.x += (moka.x - cam.x) * k;
    cam.y += (moka.y - cam.y) * k;
    cam.x = L.w <= vw ? L.w / 2 : Math.max(vw / 2, Math.min(L.w - vw / 2, cam.x));
    cam.y = L.h <= vh ? L.h / 2 : Math.max(vh / 2, Math.min(L.h - vh / 2, cam.y));
  }

  function steer(h, tx, ty, speed, dt) {
    const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy);
    if (d < 0.001) return;
    const step = Math.min(d, speed * dt);
    h.x += (dx / d) * step;
    h.y += (dy / d) * step;
  }

  // ---- Render ------------------------------------------------------------
  let W = 0, H = 0, DPR = 1, PX = 40;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    PX = Math.min(H, W) / VIEW_TILES;
  }
  addEventListener('resize', resize);

  // Faint "whisker sense" right around Moka so tight spots stay fair
  const nearGlow = (x, y) => {
    const d = Math.hypot(x - moka.x, y - moka.y);
    return Math.max(0, Math.min(1, 1 - (d - 0.7) / 1.4)) * 0.3;
  };

  let view3d = store.get('echo-view') !== '2d';
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const sx = shake > 0 ? (Math.random() - 0.5) * shake * 18 : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * shake * 18 : 0;
    // In 3D the rock is drawn by view3d.js underneath; this canvas then only
    // carries the creatures, rings, sparks and HUD, lined up with the 3D cave.
    const in3d = !!L && view3d && !!window.EchoCave3D && window.EchoCave3D.render({
      W, H, PX, cam, shake: { x: sx, y: sy }, level: L, near: nearGlow, moka, clock,
      bg: COL.bg, wall: COL.wall, fill: COL.wallFill, mokaColor: COL.moka, mokaR: MOKA_R,
    });
    if (in3d) ctx.clearRect(0, 0, W, H);
    else {
      window.EchoDuel3D?.hide();
      ctx.fillStyle = COL.bg;
      ctx.fillRect(0, 0, W, H);
    }
    if (!L) return;

    const ox = W / 2 - cam.x * PX + sx, oy = H / 2 - cam.y * PX + sy;
    const toX = (x) => ox + x * PX, toY = (y) => oy + y * PX;

    // Walls: only the faces that touch open air are drawn, as neon edges
    const tx0 = Math.max(0, Math.floor(cam.x - W / PX / 2) - 1), tx1 = Math.min(L.w - 1, Math.ceil(cam.x + W / PX / 2) + 1);
    const ty0 = Math.max(0, Math.floor(cam.y - H / PX / 2) - 1), ty1 = Math.min(L.h - 1, Math.ceil(cam.y + H / PX / 2) + 1);
    ctx.lineCap = 'round';
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!solid(tx, ty)) continue;
        const open = [!solid(tx, ty - 1), !solid(tx + 1, ty), !solid(tx, ty + 1), !solid(tx - 1, ty)];
        if (!open.some(Boolean)) continue;
        const a = Math.max(L.lit[ty * L.w + tx], nearGlow(tx + 0.5, ty + 0.5));
        if (a < 0.02) continue;
        const x = toX(tx), y = toY(ty), s = PX;
        // in 3D the block is already there; keep only its neon outline
        if (!in3d) { ctx.fillStyle = `rgba(${COL.wallFill}, ${a * 0.8})`; ctx.fillRect(x, y, s + 0.5, s + 0.5); }
        const edges = [[x, y, x + s, y], [x + s, y, x + s, y + s], [x, y + s, x + s, y + s], [x, y, x, y + s]];
        for (let i = 0; i < 4; i++) {
          if (!open[i]) continue;
          const [x0, y0, x1, y1] = edges[i];
          ctx.strokeStyle = `rgba(${COL.wall}, ${a * 0.25})`;
          ctx.lineWidth = 7;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.strokeStyle = `rgba(${COL.wall}, ${a})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
      }
    }

    // Exit: a soft green glow that is always faintly visible
    const pulse = 0.55 + 0.25 * Math.sin(clock * 2.4);
    glow(toX(L.exit.x), toY(L.exit.y), PX * 1.3, COL.exit, pulse * 0.7);
    ctx.strokeStyle = `rgba(${COL.exit}, ${pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(toX(L.exit.x), toY(L.exit.y), PX * 0.32, 0, Math.PI * 2);
    ctx.stroke();

    // Moths glow on their own
    for (const m of L.moths) {
      if (m.got) continue;
      const mx = toX(m.x + Math.cos(clock * 1.3 + m.phase) * 0.12);
      const my = toY(m.y + Math.sin(clock * 2.1 + m.phase) * 0.15);
      glow(mx, my, PX * 0.9, COL.moth, 0.55);
      const flap = Math.abs(Math.sin(clock * 14 + m.phase));
      ctx.fillStyle = `rgba(${COL.moth}, 0.95)`;
      ctx.beginPath();
      ctx.ellipse(mx - PX * 0.09, my, PX * 0.1, PX * 0.04 + PX * 0.07 * flap, -0.5, 0, Math.PI * 2);
      ctx.ellipse(mx + PX * 0.09, my, PX * 0.1, PX * 0.04 + PX * 0.07 * flap, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Echo crystals glow too, so a player low on echoes can steer toward them
    for (const c of L.crystals) {
      if (c.got) continue;
      const cx = toX(c.x), cy = toY(c.y + Math.sin(clock * 2 + c.phase) * 0.1);
      glow(cx, cy, PX * 0.8, COL.crystal, 0.45);
      ctx.fillStyle = `rgba(${COL.crystal}, 0.95)`;
      ctx.beginPath();
      ctx.moveTo(cx, cy - PX * 0.24); ctx.lineTo(cx + PX * 0.14, cy);
      ctx.lineTo(cx, cy + PX * 0.24); ctx.lineTo(cx - PX * 0.14, cy);
      ctx.closePath(); ctx.fill();
    }

    // Hazards: bodies show while lit or close by; awake eyes always show
    for (const h of L.hazards) {
      if (h.kind === 'rock' && h.state === 'gone') continue;
      const a = Math.max(h.lit, nearGlow(h.x, h.y) * 2);
      const x = toX(h.x), y = toY(h.y);
      if (h.kind === 'spider') drawSpider(h, x, y, a, toY);
      else if (h.kind === 'rock') drawRock(h, x, y, a);
      else drawOwl(h, x, y, a);
    }

    // Sound rings
    for (const ring of rings) {
      const f = 1 - ring.r / RING_MAX;
      ctx.strokeStyle = `rgba(${COL.wall}, ${f * 0.9})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(toX(ring.x), toY(ring.y), ring.r * PX, 0, Math.PI * 2); ctx.stroke();
      if (ring.r > 0.8) {
        ctx.strokeStyle = `rgba(${COL.wall}, ${f * 0.35})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(toX(ring.x), toY(ring.y), (ring.r - 0.6) * PX, 0, Math.PI * 2); ctx.stroke();
      }
    }

    for (const p of particles) {
      ctx.fillStyle = `rgba(${p.rgb}, ${Math.min(1, p.life * 1.6)})`;
      ctx.fillRect(toX(p.x) - 2, toY(p.y) - 2, 4, 4);
    }

    if (!in3d) drawMoka(toX(moka.x), toY(moka.y));
    if (mode === 'run') {
      // the creeping dark at the left edge
      const g = ctx.createLinearGradient(0, 0, PX * 1.6, 0);
      g.addColorStop(0, 'rgba(255, 84, 104, 0.28)');
      g.addColorStop(1, 'rgba(255, 84, 104, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, PX * 1.6, H);
    }
    drawHud();
    drawStick();
  }

  function glow(x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${a})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function eyes(x, y, rgb, gap, size) {
    glow(x, y, PX * 0.45, rgb, 0.35);
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.beginPath();
    ctx.arc(x - gap, y, size, 0, Math.PI * 2);
    ctx.arc(x + gap, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSpider(h, x, y, a, toY) {
    if (a > 0.02) {
      ctx.strokeStyle = `rgba(220, 230, 255, ${a * 0.5})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, toY(h.top - 0.45)); ctx.lineTo(x, y); ctx.stroke();
      ctx.strokeStyle = `rgba(${COL.danger}, ${a})`;
      ctx.lineWidth = 2;
      const legs = h.awake ? Math.sin(clock * 16) * 0.1 : 0;
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const ang = (-0.6 + i * 0.4 + legs) * side;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + side * PX * 0.25, y + (ang - 0.3) * PX * 0.25, x + side * PX * 0.32, y + ang * PX * 0.3 + PX * 0.1);
          ctx.stroke();
        }
      }
      ctx.fillStyle = `rgba(60, 14, 28, ${a})`;
      ctx.beginPath(); ctx.arc(x, y, PX * 0.16, 0, Math.PI * 2); ctx.fill();
    }
    if (h.awake) eyes(x, y - PX * 0.03, COL.danger, PX * 0.05, PX * 0.035);
  }

  function drawRock(h, x, y, a) {
    if (h.state === 'hang' && a < 0.02) return;
    const jx = h.state === 'shake' ? (Math.random() - 0.5) * 4 : 0;
    const vis = h.state === 'hang' ? a : 1;
    ctx.fillStyle = `rgba(${h.state === 'hang' ? COL.wall : COL.danger}, ${vis * 0.85})`;
    ctx.beginPath();
    ctx.moveTo(x + jx - PX * 0.24, y - PX * 0.32);
    ctx.lineTo(x + jx + PX * 0.24, y - PX * 0.32);
    ctx.lineTo(x + jx, y + PX * 0.32);
    ctx.closePath();
    ctx.fill();
  }

  function drawOwl(h, x, y, a) {
    const awake = h.state !== 'sleep';
    if (a > 0.02 || awake) {
      const vis = awake ? 1 : a;
      const flap = awake ? Math.sin(clock * 12) * PX * 0.15 : 0;
      ctx.fillStyle = `rgba(110, 82, 60, ${vis})`;
      ctx.beginPath();
      ctx.ellipse(x - PX * 0.3, y + PX * 0.05 - flap, PX * 0.2, PX * 0.1, -0.4, 0, Math.PI * 2);
      ctx.ellipse(x + PX * 0.3, y + PX * 0.05 - flap, PX * 0.2, PX * 0.1, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(150, 112, 80, ${vis})`;
      ctx.beginPath(); ctx.ellipse(x, y, PX * 0.24, PX * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (awake) eyes(x, y - PX * 0.08, COL.owl, PX * 0.09, PX * 0.06);
    else if (a > 0.05) {
      ctx.strokeStyle = `rgba(40, 24, 16, ${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - PX * 0.14, y - PX * 0.08); ctx.lineTo(x - PX * 0.04, y - PX * 0.08);
      ctx.moveTo(x + PX * 0.04, y - PX * 0.08); ctx.lineTo(x + PX * 0.14, y - PX * 0.08);
      ctx.stroke();
    }
  }

  function drawMoka(x, y) {
    if (moka.hurt > 0 && Math.floor(moka.hurt * 12) % 2 === 0) return;
    glow(x, y, PX * 0.9, '139, 108, 255', 0.25);
    const flap = Math.sin(clock * 18);
    const r = PX * MOKA_R;
    ctx.fillStyle = COL.moka;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * r * 0.6, y - r * 0.2);
      ctx.lineTo(x + side * r * 2.3, y - r * (0.2 + flap * 0.9));
      ctx.lineTo(x + side * r * 1.8, y + r * 0.25);
      ctx.lineTo(x + side * r * 1.3, y + r * 0.05);
      ctx.lineTo(x + side * r * 0.9, y + r * 0.45);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // ears
    ctx.beginPath();
    ctx.moveTo(x - r * 0.75, y - r * 0.5); ctx.lineTo(x - r * 0.45, y - r * 1.35); ctx.lineTo(x - r * 0.1, y - r * 0.8);
    ctx.moveTo(x + r * 0.75, y - r * 0.5); ctx.lineTo(x + r * 0.45, y - r * 1.35); ctx.lineTo(x + r * 0.1, y - r * 0.8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    const lx = moka.face * r * 0.18;
    ctx.beginPath();
    ctx.arc(x - r * 0.32 + lx, y - r * 0.1, r * 0.2, 0, Math.PI * 2);
    ctx.arc(x + r * 0.32 + lx, y - r * 0.1, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1030';
    ctx.beginPath();
    ctx.arc(x - r * 0.28 + lx * 1.4, y - r * 0.08, r * 0.1, 0, Math.PI * 2);
    ctx.arc(x + r * 0.36 + lx * 1.4, y - r * 0.08, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  const HUD_FONT = '"Nunito", "Segoe UI", system-ui, sans-serif';
  function drawHud() {
    const pad = 16, size = Math.max(14, Math.min(20, H / 26));
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${size}px ${HUD_FONT}`;
    // hearts
    for (let i = 0; i < MAX_HEARTS; i++) {
      const x = pad + i * size * 1.5 + size * 0.5, y = pad + size * 0.6;
      heart(x, y, size * 0.5, i < moka.hearts);
    }
    // moths
    const my = pad + size * 1.9;
    glow(pad + size * 0.5, my, size * 0.9, COL.moth, 0.5);
    ctx.fillStyle = `rgb(${COL.moth})`;
    ctx.beginPath(); ctx.arc(pad + size * 0.5, my, size * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8ecff';
    ctx.textAlign = 'left';
    ctx.fillText(mode === 'run' ? `${stats.moths}` : `${stats.moths} / ${L.moths.length}`, pad + size * 1.3, my);
    // echoes left, shown as a row of small rings
    const low = moka.echoes <= 2;
    const flash = moka.noEcho > 0 && Math.floor(moka.noEcho * 10) % 2 === 0;
    const ecol = flash || low ? COL.danger : COL.wall;
    ctx.textAlign = 'right';
    ctx.fillStyle = `rgb(${ecol})`;
    ctx.fillText(`Echoes ${moka.echoes}`, W - pad, pad + size * 0.6);
    const pr = size * 0.22, gap = size * 0.62;
    for (let i = 0; i < MAX_ECHOES; i++) {
      const x = W - pad - pr - (MAX_ECHOES - 1 - i) * gap, y = pad + size * 1.75;
      ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2);
      const on = MAX_ECHOES - 1 - i < moka.echoes;
      if (on) { ctx.fillStyle = `rgba(${ecol}, 0.9)`; ctx.fill(); }
      else { ctx.strokeStyle = 'rgba(232, 236, 255, 0.18)'; ctx.lineWidth = 1; ctx.stroke(); }
    }
    if (mode === 'run') {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e8ecff';
      ctx.fillText(`${runDistance()} m`, W / 2, 62 + size * 0.6);   // under the pause button
    }
    // first-time hint
    if (hintTimer > 0 && state === 'play') {
      ctx.textAlign = 'center';
      ctx.font = `600 ${size}px ${HUD_FONT}`;
      ctx.fillStyle = `rgba(232, 236, 255, ${Math.min(1, hintTimer) * 0.85})`;
      ctx.fillText(isTouch ? 'Drag to fly  ·  Tap to squeak' : 'Arrow keys or drag to fly  ·  Space or click to squeak', W / 2, H - pad - size);
      if (mode === 'run') {
        ctx.font = `500 ${size * 0.85}px ${HUD_FONT}`;
        ctx.fillText('Keep moving right. The dark is coming.', W / 2, H - pad - size * 2.4);
      }
    }
  }

  function heart(x, y, s, full) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.8);
    ctx.bezierCurveTo(x - s * 1.2, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.2, y - s * 0.1, x, y + s * 0.8);
    if (full) { ctx.fillStyle = `rgb(${COL.danger})`; ctx.fill(); }
    else { ctx.strokeStyle = `rgba(${COL.danger}, 0.6)`; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  function drawStick() {
    if (!stick || !stick.moved) return;
    const rect = canvas.getBoundingClientRect();
    const bx = stick.sx - rect.left, by = stick.sy - rect.top;
    let dx = stick.x - stick.sx, dy = stick.y - stick.sy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RANGE) { dx *= STICK_RANGE / len; dy *= STICK_RANGE / len; }
    ctx.strokeStyle = 'rgba(232, 236, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx, by, STICK_RANGE, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(232, 236, 255, 0.22)';
    ctx.beginPath(); ctx.arc(bx + dx, by + dy, 20, 0, Math.PI * 2); ctx.fill();
  }

  // ---- Screens -----------------------------------------------------------
  function showOverlay(which) {
    $('title-screen').hidden = which !== 'title';
    $('end-screen').hidden = which !== 'end';
    $('battle-screen').hidden = which !== 'battle';
    $('online-screen').hidden = which !== 'online';
    $('pause-screen').hidden = which !== 'pause';
    if (which !== 'pause') { pauseOpen = false; paused = false; window.EchoDuel?.setPaused?.(false); }
  }

  // ---- Pause ---------------------------------------------------------------
  // Offline games freeze; an online match keeps running for everyone else.
  let paused = false, pauseOpen = false;
  const inMatch = () => state === 'play' || (mode === 'duel' && state === 'duel' && window.EchoDuel.active && !window.EchoDuel.over);
  const online = () => mode === 'duel' && duelCfg.online;
  function openPause() {
    if (!inMatch()) return;
    showOverlay('pause');
    pauseOpen = true;
    paused = !online();
    window.EchoDuel.setPaused(paused);
    keys.clear(); stick = null;
    $('pause-title').textContent = online() ? 'Menu' : 'Paused';
    $('pause-note').hidden = !online();
    $('pause-restart').hidden = online();
    $('pause-menu').textContent = online() ? 'Leave match' : 'Main menu';
  }
  function resume() { showOverlay(null); }
  function toMenu() {
    const wasOnline = online();
    if (wasOnline) duelCfg.leave();
    window.EchoDuel.stop();
    mode = 'cave';
    state = 'title';
    L = null;
    showOverlay(wasOnline ? 'online' : 'title');
  }

  function enterGame(newMode) {
    unlockAudio();
    try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not allowed here */ }
    try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch { /* not supported */ }
    startGame(newMode, 0);
  }

  function primaryAction() {
    unlockAudio();
    if (mode === 'duel') (duelCfg.rematch || (() => startDuel(duelCfg)))();
    else if (state === 'title') enterGame('cave');
    else if (state === 'win' || state === 'lose') startGame(mode, levelIndex);
  }

  function startDuel(cfg) {
    unlockAudio();
    try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not allowed here */ }
    try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch { /* not supported */ }
    mode = 'duel';
    duelCfg = { ...cfg };
    state = 'duel';
    L = null;
    showOverlay(null);
    window.EchoDuel.setView(store.get('echo-view') || '3d');
    window.EchoDuel.start({ ...cfg, onEnd: (result) => { cfg.onResult?.(result); endDuel(result); } });
  }

  // Online guests get the result from the host and can only wait for a rematch or go back to the room
  function endDuel({ winner, winnerCpu, standings, humans }, { guest = false } = {}) {
    if (!duelCfg.online && guest) return;
    sfx.win();
    const me = duelCfg.online ? ['Mo', 'Ka', 'Ca', 'Bo'][duelCfg.mode === 'host' ? 0 : duelCfg.mySlot] : null;
    $('end-title').textContent = me === winner ? 'You win!'
      : winnerCpu && (humans === 1 || duelCfg.online) ? `${winner} (CPU) ate everyone!` : `${winner} wins!`;
    $('end-stars').textContent = standings.map((p) => p.score).join(' – ');
    $('end-stars').setAttribute('aria-label', 'Final bites ' + standings.map((p) => `${p.name} ${p.score}`).join(', '));
    $('end-detail').innerHTML = standings
      .map((p, k) => `<li class="${k === 0 ? 'got' : ''}" style="color:${p.color}">${p.name}${p.cpu ? ' (CPU)' : ''}${p.name === me ? ' (you)' : ''}: ${p.score} bite${p.score === 1 ? '' : 's'}</li>`)
      .join('');
    $('end-button').textContent = 'Rematch';
    $('end-button').hidden = guest;
    $('menu-button').textContent = duelCfg.online ? 'Room' : 'Menu';
    $('end-wait').hidden = !guest;
    showOverlay('end');
  }

  $('sound-toggle').addEventListener('click', () => { unlockAudio(); setMuted(!muted); });
  setMuted(muted);
  $('play-button').addEventListener('click', () => enterGame('cave'));
  $('run-button').addEventListener('click', () => enterGame('run'));
  $('end-button').addEventListener('click', primaryAction);
  $('battle-button').addEventListener('click', () => { unlockAudio(); showOverlay('battle'); });
  // Battle setup: you are always P1 (one player per device); fill the other
  // slots with CPU bats, pick their level, and flip through the arena modes.
  const ARENA_CHOICES = [
    { id: 'shift', name: 'Shifting', desc: 'A new cave every 25s' },
    { id: 'morph', name: 'Morphing', desc: 'The walls slowly reshape' },
    { id: 'chaos', name: 'Chaos', desc: 'A new cave every 9s' },
    { id: 'sky', name: 'Open Sky', desc: 'No cave, just the night' },
  ];
  const pick = { humans: 1, cpus: Math.min(3, Math.max(1, store.get('echo-cpus') || 1)), level: store.get('echo-cpu-level') || 'normal', arenaMode: store.get('echo-arena-mode') || 'shift' };
  if (!ARENA_CHOICES.some((a) => a.id === pick.arenaMode)) pick.arenaMode = 'shift';
  // a little map of the arena, drawn from its tiles
  function drawArenaPreview() {
    const c = $('arena-preview'), g = c.getContext('2d');
    const arenas = window.ECHO_ARENAS;
    const def = pick.arenaMode === 'sky' ? arenas.find((a) => a.open) : arenas[{ shift: 0, morph: 2, chaos: 1 }[pick.arenaMode]];
    const w = def.map[0].length, h = def.map.length, s = Math.min(c.width / w, c.height / h);
    const x0 = (c.width - w * s) / 2, y0 = (c.height - h * s) / 2;
    g.fillStyle = def.theme.bg; g.fillRect(0, 0, c.width, c.height);
    def.map.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '#') { g.fillStyle = `rgba(${def.theme.wall}, 0.85)`; g.fillRect(x0 + x * s, y0 + y * s, s + 0.3, s + 0.3); }
      else if ('ABCD'.includes(ch)) { g.fillStyle = ['#8b6cff', '#ff7ad9', '#9dff6a', '#ffb347']['ABCD'.indexOf(ch)]; g.beginPath(); g.arc(x0 + (x + 0.5) * s, y0 + (y + 0.5) * s, s * 0.8, 0, Math.PI * 2); g.fill(); }
    }));
    if (def.open) {
      g.fillStyle = 'rgba(255, 244, 214, 0.8)';
      g.beginPath(); g.arc(c.width * 0.8, c.height * 0.3, 7, 0, Math.PI * 2); g.fill();
    }
  }
  function renderPickers() {
    document.querySelectorAll('[data-slot]').forEach((b) => {
      const on = +b.dataset.slot <= pick.cpus;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('.add').textContent = on ? 'CPU rival' : '+ Add CPU';
    });
    document.querySelectorAll('[data-level]').forEach((b) => { b.classList.toggle('on', b.dataset.level === pick.level); b.setAttribute('aria-pressed', String(b.dataset.level === pick.level)); });
    const a = ARENA_CHOICES.find((x) => x.id === pick.arenaMode);
    $('arena-name').textContent = a.name;
    $('arena-desc').textContent = a.desc;
    drawArenaPreview();
  }
  document.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => {
    const k = +b.dataset.slot;
    pick.cpus = k <= pick.cpus ? Math.max(1, k - 1) : k;   // at least one rival
    store.set('echo-cpus', pick.cpus);
    renderPickers();
  }));
  document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => {
    pick.level = b.dataset.level; store.set('echo-cpu-level', pick.level); renderPickers();
  }));
  const stepArena = (d) => {
    const i = ARENA_CHOICES.findIndex((x) => x.id === pick.arenaMode);
    pick.arenaMode = ARENA_CHOICES[(i + d + ARENA_CHOICES.length) % ARENA_CHOICES.length].id;
    store.set('echo-arena-mode', pick.arenaMode);
    renderPickers();
  };
  $('arena-prev').addEventListener('click', () => stepArena(-1));
  $('arena-next').addEventListener('click', () => stepArena(1));
  renderPickers();
  $('duel-start').addEventListener('click', () => startDuel(pick));
  $('duel-back').addEventListener('click', () => showOverlay('title'));
  $('menu-button').addEventListener('click', () => {
    if (mode === 'duel' && duelCfg.online) { duelCfg.lobby(); return; }
    toMenu();
  });
  // 3D or flat view for battles; each device picks its own
  function setView(v) {
    v = v === '2d' ? '2d' : '3d';
    store.set('echo-view', v);
    view3d = v === '3d';
    window.EchoDuel?.setView(v);
    document.querySelectorAll('[data-view]').forEach((b) => { b.classList.toggle('on', b.dataset.view === v); b.setAttribute('aria-pressed', String(b.dataset.view === v)); });
    $('pause-view').textContent = v === '3d' ? 'Switch to 2D view' : 'Switch to 3D view';
  }
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('pause-view').addEventListener('click', () => { setView(store.get('echo-view') === '2d' ? '3d' : '2d'); resume(); });
  setView(store.get('echo-view') || '3d');
  $('pause-button').addEventListener('click', openPause);
  $('pause-resume').addEventListener('click', resume);
  $('pause-restart').addEventListener('click', () => {
    if (mode === 'duel') startDuel(duelCfg);
    else { showOverlay(null); startGame(mode, levelIndex); }
  });
  $('pause-menu').addEventListener('click', toMenu);

  // Used by the online rooms (net.js)
  window.EchoGame = { startDuel, showEnd: endDuel, showOverlay };

  function updateBests() {
    const best = store.get('echo-caves-best-0');
    $('best-cave').textContent = best ? `Best ${'★'.repeat(best)}${'☆'.repeat(3 - best)}` : 'Explore one cave';
    const run = store.get('echo-caves-run-best');
    $('best-run').textContent = run ? `Best ${run} m` : 'Endless side-scroller';
  }
  updateBests();

  // ---- Main loop ---------------------------------------------------------
  const portrait = matchMedia('(orientation: portrait) and (pointer: coarse)');
  let last = performance.now();
  function frame(now) {
    // phones (iOS especially) can report the old size right after rotating, which
    // stretches the picture; re-check every frame and resize as soon as it changes
    if (canvas.clientWidth !== W || canvas.clientHeight !== H || Math.min(window.devicePixelRatio || 1, 2) !== DPR) resize();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // jazz everywhere: each mode has its own tune, and the menus have a mellow one
    const fighting = mode === 'duel' && state === 'duel' && window.EchoDuel.active && !window.EchoDuel.over;
    if (portrait.matches || document.hidden) music.set(false);
    else music.set(state === 'play' ? (mode === 'run' ? 'run' : 'explore') : fighting ? 'battle' : 'lobby');
    $('pause-button').hidden = !inMatch() || pauseOpen;
    const frozen = paused || portrait.matches || document.hidden;
    if (mode === 'duel' && state === 'duel') {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (!portrait.matches && !document.hidden) window.EchoDuel.frame(frozen ? 0 : dt, ctx, W, H);
      requestAnimationFrame(frame);
      return;
    }
    if (state === 'play' && !frozen) update(dt);
    else if (state === 'win' || state === 'lose') {
      clock += dt;
      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    }
    render();
    requestAnimationFrame(frame);
  }

  resize();
  showOverlay('title');
  requestAnimationFrame(frame);

  // Small hook for automated play tests
  window.__echo = {
    get state() { return state; },
    get moka() { return moka; },
    get stats() { return stats; },
    get level() { return L; },
    get scroll() { return scroll; },
    start: (m = 'cave') => startGame(m, 0),
    squeak,
  };
})();
