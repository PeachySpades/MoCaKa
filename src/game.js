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
  // Hidden hearts (h) each add one heart, up to two above the starting three.
  // Checkpoints (K): after losing every heart Moka can go back to the last one
  // passed, with full hearts and at least CP_MIN_ECHOES echoes.
  const BONUS_HEARTS = 2, CP_MIN_ECHOES = 6;
  // Dash: a short burst the way Moka is flying, the same as in battle
  const DASH_SPEED = 12, DASH_TIME = 0.16, DASH_COOLDOWN = 1.6;
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
    checkpoint: '255, 196, 120',   // a warm lantern glow
    heart: '255, 107, 138',
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
    // Explore: a checkpoint lantern lights (a soft bell chime), a hidden heart (a warm rising "ba-dum")
    checkpoint() { [784, 988, 1175, 1568].forEach((f, i) => { tone(f, f, 0.5, 'sine', 0.07, i * 0.09); tone(f * 2, f * 2, 0.25, 'triangle', 0.02, i * 0.09); }); },
    heartUp() { tone(330, 440, 0.12, 'triangle', 0.1); tone(440, 660, 0.14, 'triangle', 0.1, 0.13); [880, 1109, 1319].forEach((f, i) => tone(f, f * 1.01, 0.22, 'sine', 0.05, 0.28 + i * 0.07)); },
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
    // the dash-bite: a whoosh in, a hard snap of teeth, then a meaty crunch (duel.js)
    bigChomp() {
      hiss(0.16, 0.12, 1400, undefined, sfxBus, 'bandpass'); tone(500, 1400, 0.12, 'sawtooth', 0.04);
      tone(1800, 300, 0.05, 'square', 0.12, 0.11); hiss(0.05, 0.18, 4000, ac && ac.currentTime + 0.11);
      tone(160, 45, 0.3, 'square', 0.11, 0.13); tone(95, 40, 0.35, 'triangle', 0.14, 0.13);
      for (let k = 0; k < 4; k++) hiss(0.06, 0.1 - k * 0.018, 900 + k * 500, ac && ac.currentTime + 0.17 + k * 0.055, sfxBus, 'bandpass');
    },
    // echo parry: a bright metallic ting with a rising shimmer (duel.js)
    parry() { tone(2600, 2500, 0.3, 'triangle', 0.09); tone(3900, 3850, 0.22, 'sine', 0.06, 0.01); tone(1300, 2600, 0.12, 'square', 0.04); hiss(0.08, 0.08, 5000); },
    // special power-ups (duel.js): fireball whoosh and burst, thunder crack, stone wall, ice, twister, ghost
    fire() { hiss(0.35, 0.12, 900, undefined, sfxBus, 'bandpass'); tone(320, 120, 0.3, 'sawtooth', 0.05); tone(900, 300, 0.2, 'triangle', 0.04); },
    boom() { tone(150, 40, 0.4, 'square', 0.09); hiss(0.45, 0.14, 700, undefined, sfxBus, 'lowpass'); hiss(0.12, 0.08, 3000); },
    thunder() { hiss(0.06, 0.25, 4000); for (let k = 0; k < 5; k++) hiss(0.05, 0.16 - k * 0.025, 2500 - k * 300, ac && ac.currentTime + 0.02 + k * 0.045, sfxBus, 'bandpass'); tone(90, 32, 1.1, 'sawtooth', 0.1, 0.05); hiss(1.3, 0.12, 220, ac && ac.currentTime + 0.08, sfxBus, 'lowpass'); },
    wallUp() { tone(70, 140, 0.25, 'square', 0.08); hiss(0.3, 0.12, 500, undefined, sfxBus, 'lowpass'); tone(220, 110, 0.12, 'triangle', 0.07, 0.22); },
    crumble() { for (let k = 0; k < 6; k++) hiss(0.08, 0.1, 300 + k * 120, ac && ac.currentTime + k * 0.07, sfxBus, 'lowpass'); tone(120, 50, 0.5, 'triangle', 0.06); },
    freeze() { [2600, 3100, 3700, 4200].forEach((f, i) => tone(f, f * 0.98, 0.25, 'sine', 0.05, i * 0.04)); hiss(0.4, 0.08, 6000); tone(500, 1600, 0.2, 'triangle', 0.04); },
    vortex() { hiss(1.2, 0.1, 600, undefined, sfxBus, 'bandpass'); tone(140, 420, 0.9, 'sawtooth', 0.035); tone(420, 140, 0.9, 'sawtooth', 0.025, 0.4); },
    ghost() { tone(500, 900, 0.5, 'sine', 0.06); tone(750, 1350, 0.5, 'sine', 0.04, 0.08); tone(400, 300, 0.6, 'triangle', 0.03, 0.2); },
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
      moths: [], crystals: [], hazards: [], checkpoints: [], hearts: [],
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
        else if (c === 'h') lv.hearts.push({ x: cx, y: cy, got: false, phase: Math.random() * 6 });
        else if (c === 'K') {
          // the roost hangs from the ceiling; flying through its column (between the walls) lights it
          const { top, bot } = shaft(x, y);
          lv.checkpoints.push({ x: cx, y: cy, top, bot: bot + 1, ceil: top, on: false, flash: 0 });
        } else if (c === 's') {
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
  // battles and co-op runs share the match plumbing (pause, menus, rooms); this is whichever is running
  const engine = () => (duelCfg.coop ? window.EchoCoop : window.EchoDuel);
  let levelIndex = 0;
  let moka, rings, particles, cam, stats, shake, hintTimer, clock, scroll, endReason;
  // Explore: the last checkpoint passed (what to restore), and floating "Checkpoint!" / "+1" pops
  let checkpoint = null, pops = [];

  function startGame(newMode, i = 0) {
    mode = newMode;
    levelIndex = i;
    L = loadLevel(mode === 'run' ? window.makeRunLevel(Math.floor(Math.random() * 1e9)) : window.ECHO_LEVELS[i]);
    moka = {
      x: L.start.x, y: L.start.y, vx: 0, vy: 0, face: 1,
      hearts: MAX_HEARTS, hurt: 0, cooldown: 0, echoes: L.def.echoes, noEcho: 0,
      dashT: 0, dashCd: 0,
    };
    rings = [];
    particles = [];
    scroll = { x: 0, speed: RUN_START_SPEED };
    cam = { x: moka.x, y: moka.y };
    if (mode === 'run') cam.x = W / PX / 2;
    stats = { moths: 0, squeaks: 0, time: 0, retries: 0 };
    checkpoint = null;
    pops = [];
    endReason = '';
    shake = 0;
    hintTimer = 6;
    clock = 0;
    state = 'play';
    showOverlay(null);
  }

  // ---- Checkpoints -------------------------------------------------------
  // Passing a roost saves what Moka has so far; losing every heart later can
  // go back there instead of to the cave start.
  function reachCheckpoint(cp) {
    cp.on = true;
    cp.flash = 1;
    const got = (list) => list.map((o) => o.got);
    checkpoint = {
      index: L.checkpoints.indexOf(cp), x: cp.x, y: cp.y, echoes: moka.echoes, moths: stats.moths,
      mothsGot: got(L.moths), crystalsGot: got(L.crystals), heartsGot: got(L.hearts), cpsOn: L.checkpoints.map((c) => c.on),
    };
    burst(cp.x, cp.y + 0.3, COL.checkpoint, 22);
    pop(cp.x, cp.y - 0.6, 'Checkpoint!', COL.checkpoint);
    sfx.checkpoint();
  }

  // Back to the last checkpoint: hearts refilled to the cave's start, echoes as
  // they were there (at least CP_MIN_ECHOES), moths and crystals taken before it
  // kept, everything after it (and every hazard) put back as it was.
  function restartFromCheckpoint() {
    if (!checkpoint || mode !== 'cave') { startGame(mode, levelIndex); return; }
    const cp = checkpoint;
    L = loadLevel(L.def);
    const put = (list, got) => list.forEach((o, i) => { o.got = !!got[i]; });
    put(L.moths, cp.mothsGot); put(L.crystals, cp.crystalsGot); put(L.hearts, cp.heartsGot);
    L.checkpoints.forEach((c, i) => { c.on = !!cp.cpsOn[i]; });
    moka = {
      x: cp.x, y: cp.y, vx: 0, vy: 0, face: 1,
      hearts: MAX_HEARTS, hurt: 0, cooldown: 0, echoes: Math.min(MAX_ECHOES, Math.max(cp.echoes, CP_MIN_ECHOES)), noEcho: 0,
      dashT: 0, dashCd: 0,
    };
    rings = [];
    particles = [];
    pops = [];
    cam = { x: moka.x, y: moka.y };
    stats.moths = cp.moths;
    stats.retries++;
    endReason = '';
    shake = 0;
    hintTimer = 0;
    state = 'play';
    showOverlay(null);
    burst(cp.x, cp.y, COL.checkpoint, 18);
    pop(cp.x, cp.y - 0.6, 'Back at the checkpoint', COL.checkpoint);
    sfx.checkpoint();
  }

  function pop(x, y, text, rgb) { pops.push({ x, y, text, rgb, t: 0 }); }

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
    if ((e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyF') && !e.repeat) squeak();
    if ((e.code === 'KeyG' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) dash();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); stick = null; });

  // the DASH button, bottom right on touch screens (in the same spot as in battle)
  let touchUsed = isTouch;
  const dashButton = () => ({ x: W - 64, y: H - Math.max(124, H * 0.3), r: 42 });
  const inDashButton = (cx, cy) => {
    const rect = canvas.getBoundingClientRect(), b = dashButton();
    return Math.hypot(cx - rect.left - b.x, cy - rect.top - b.y) < b.r + 8;
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state !== 'play') return;
    unlockAudio();
    if (e.pointerType === 'touch') touchUsed = true;
    // a press on DASH only dashes: it never squeaks or starts steering
    if (touchUsed && inDashButton(e.clientX, e.clientY)) { dash(); return; }
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
    const dt = performance.now() - stick.t, dx = stick.x - stick.sx, dy = stick.y - stick.sy, d = Math.hypot(dx, dy);
    if (!stick.moved && dt < 280) squeak();
    else if (dt < 230 && d > 30) dash(dx / d, dy / d);   // a quick flick dashes, as in battle
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

  // a quick burst the way Moka is steering (or flying, or facing), then a short cooldown
  function dash(dx, dy) {
    if (state !== 'play' || paused || moka.dashCd > 0) return;
    let ux = dx, uy = dy;
    if (!(Math.hypot(ux || 0, uy || 0) > 0.1)) {
      const { ix, iy } = readInput(), sp = Math.hypot(moka.vx, moka.vy);
      if (Math.hypot(ix, iy) > 0.2) { ux = ix; uy = iy; }
      else if (sp > 0.5) { ux = moka.vx / sp; uy = moka.vy / sp; }
      else { ux = moka.face; uy = 0; }
    }
    const len = Math.hypot(ux, uy) || 1;
    moka.vx = (ux / len) * DASH_SPEED;
    moka.vy = (uy / len) * DASH_SPEED;
    if (Math.abs(ux) > 0.2) moka.face = Math.sign(ux);
    moka.dashT = DASH_TIME;
    moka.dashCd = DASH_COOLDOWN;
    sfx.dash();
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
    updateBests();
    const moreCaves = mode !== 'run' && levelIndex < window.ECHO_LEVELS.length - 1;
    // after a checkpoint, the main button goes back there and a second one restarts the cave
    const toCheckpoint = !won && mode === 'cave' && !!checkpoint;
    $('end-button').textContent = toCheckpoint ? 'Back to checkpoint' : !won ? 'Try again' : moreCaves ? 'Next cave' : 'Play again';
    $('end-button').hidden = false;
    $('end-wait').hidden = true;
    $('menu-button').textContent = 'Menu';
    setTimeout(() => {
      if (state !== 'win' && state !== 'lose') return;
      showOverlay('end');
      endAlt.hidden = !toCheckpoint;
    }, won ? 500 : 700);
  }
  // "Restart cave" on the lose screen, shown only when there's a checkpoint to go back to
  const endAlt = document.createElement('button');
  endAlt.id = 'end-restart';
  endAlt.type = 'button';
  endAlt.className = 'btn ghost';
  endAlt.textContent = 'Restart cave';
  endAlt.hidden = true;
  $('end-button').before(endAlt);
  endAlt.addEventListener('click', () => { unlockAudio(); startGame('cave', levelIndex); });

  function endCave(won) {
    if (won) {
      const allMoths = stats.moths === L.moths.length;
      const spare = moka.echoes >= L.def.spare;
      const stars = 1 + (allMoths ? 1 : 0) + (spare ? 1 : 0);
      const key = 'echo-caves-best-' + levelIndex;
      store.set(key, Math.max(stars, store.get(key) || 0));
      // Explore picks up from the next cave; after the last one it starts over
      const last = levelIndex >= window.ECHO_LEVELS.length - 1;
      store.set('echo-caves-next', last ? 0 : levelIndex + 1);
      $('end-title').textContent = last ? 'You escaped all three caves!' : `Cave ${levelIndex + 1} cleared!`;
      $('end-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
      $('end-stars').setAttribute('aria-label', stars + ' of 3 stars');
      $('end-detail').innerHTML =
        `<li class="got">Found the exit${last ? ' of the last cave' : `. Next: ${window.ECHO_LEVELS[levelIndex + 1].name}`}</li>` +
        `<li class="${allMoths ? 'got' : ''}">Moths ${stats.moths} of ${L.moths.length}</li>` +
        `<li class="${spare ? 'got' : ''}">Echoes left ${moka.echoes}, need ${L.def.spare}</li>` +
        (L.hearts.length ? `<li>Hidden hearts found ${L.hearts.filter((h) => h.got).length} of ${L.hearts.length}</li>` : '');
    } else {
      $('end-title').textContent = 'Moka needs a rest';
      $('end-stars').textContent = '☆☆☆';
      $('end-stars').setAttribute('aria-label', 'No stars');
      $('end-detail').innerHTML = `<li>Squeak less near sleeping things, or fly past before they wake.</li>` +
        (checkpoint ? `<li>Back at the checkpoint you get full hearts and keep the moths found before it.</li>` : '');
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
    moka.dashCd = Math.max(0, moka.dashCd - dt);
    if (moka.dashT > 0) {
      // dashing: no steering, just the burst (and a trail of sparks)
      moka.dashT -= dt;
      if (Math.random() < 0.7) particles.push({ x: moka.x, y: moka.y, vx: 0, vy: 0, life: 0.3, rgb: '139, 108, 255' });
    } else if (ix || iy) {
      moka.vx += ix * ACCEL * dt;
      moka.vy += iy * ACCEL * dt;
    } else {
      moka.vx -= moka.vx * DRAG * dt;
      moka.vy -= moka.vy * DRAG * dt;
    }
    const maxSp = moka.dashT > 0 ? DASH_SPEED : MAX_SPEED;
    const sp = Math.hypot(moka.vx, moka.vy);
    if (sp > maxSp) { moka.vx *= maxSp / sp; moka.vy *= maxSp / sp; }
    if (Math.abs(moka.vx) > 0.2) moka.face = Math.sign(moka.vx);
    // move in small steps so a dash (or a slow frame) can never skip through a wall
    const steps = Math.max(1, Math.ceil((Math.hypot(moka.vx, moka.vy) * dt) / 0.2)), sdt = dt / steps;
    for (let k = 0; k < steps; k++) {
      const nx = moka.x + moka.vx * sdt;
      if (!hitsWall(nx, moka.y, MOKA_R)) moka.x = nx; else { moka.vx *= -0.25; if (moka.dashT > 0) moka.dashT = 0; }
      const ny = moka.y + moka.vy * sdt;
      if (!hitsWall(moka.x, ny, MOKA_R)) moka.y = ny; else { moka.vy *= -0.25; if (moka.dashT > 0) moka.dashT = 0; }
    }

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
    // hidden hearts: +1 heart, up to BONUS_HEARTS above the start
    for (const hh of L.hearts) {
      if (!hh.got && Math.hypot(hh.x - moka.x, hh.y - moka.y) < 0.6) {
        hh.got = true;
        moka.hearts = Math.min(MAX_HEARTS + BONUS_HEARTS, moka.hearts + 1);
        burst(hh.x, hh.y, COL.heart, 22);
        pop(hh.x, hh.y - 0.5, '+1 heart!', COL.heart);
        sfx.heartUp();
      }
    }
    // checkpoints light up as Moka flies through their column (or close by)
    for (const cp of L.checkpoints) {
      cp.flash = Math.max(0, cp.flash - dt);
      if (cp.on) continue;
      const across = Math.abs(moka.x - cp.x) < 0.5 && moka.y > cp.top && moka.y < cp.bot;
      if (across || Math.hypot(cp.x - moka.x, cp.y - moka.y) < 1) reachCheckpoint(cp);
    }
    for (const p of pops) p.t += dt;
    pops = pops.filter((p) => p.t < 1.6);
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
  // The flat (2D) view paints the same cracked blue-violet stone as the 3D one
  const CAVE_BG = '#06071a';
  let stoneTile = null;
  function stonePattern() {
    if (stoneTile) return stoneTile;
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    let seed = 99;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.fillStyle = 'rgb(46, 46, 108)'; g.fillRect(0, 0, S, S);
    const wrap = (fn) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.save(); g.translate(dx, dy); fn(); g.restore(); } };
    for (let k = 0; k < 14; k++) {
      const x = rnd() * S, y = rnd() * S, r = S * (0.1 + rnd() * 0.25), dark = rnd() < 0.6;
      wrap(() => {
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, dark ? 'rgba(10, 8, 40, 0.35)' : 'rgba(150, 150, 230, 0.16)');
        gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      });
    }
    for (let k = 0; k < 260; k++) {
      g.fillStyle = rnd() < 0.55 ? 'rgba(8, 8, 30, 0.25)' : 'rgba(190, 190, 255, 0.12)';
      g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
    }
    for (let k = 0; k < 5; k++) {
      let x = rnd() * S, y = rnd() * S, a = rnd() * 6.28;
      const pts = [[x, y]];
      for (let i = 0; i < 4; i++) { a += (rnd() - 0.5) * 1.5; x += Math.cos(a) * S * 0.08; y += Math.sin(a) * S * 0.08; pts.push([x, y]); }
      wrap(() => {
        g.strokeStyle = 'rgba(6, 4, 26, 0.75)'; g.lineWidth = 1.2;
        g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke();
      });
    }
    for (let k = 0; k < 4; k++) {
      g.fillStyle = k % 2 ? 'rgba(175, 135, 255, 0.9)' : 'rgba(120, 235, 255, 0.9)';
      g.beginPath(); g.arc(rnd() * S, rnd() * S, 1.1, 0, Math.PI * 2); g.fill();
    }
    return (stoneTile = ctx.createPattern(c, 'repeat'));
  }
  // the same per-tile hash as the 3D view, so ledge decorations match and never flicker
  const tileHash = (x, y, k = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };
  const DECO_CYAN = '120, 235, 255', DECO_VIOLET = '175, 125, 255';
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const sx = shake > 0 ? (Math.random() - 0.5) * shake * 18 : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * shake * 18 : 0;
    // In 3D the rock is drawn by view3d.js underneath; this canvas then only
    // carries the creatures, rings, sparks and HUD, lined up with the 3D cave.
    const in3d = !!L && view3d && !!window.EchoCave3D && window.EchoCave3D.render({
      W, H, PX, cam, shake: { x: sx, y: sy }, level: L, near: nearGlow, moka, clock,
      bg: CAVE_BG, wall: COL.wall, fill: COL.wallFill, mokaColor: COL.moka, mokaR: MOKA_R, look: mokaLook(),
    });
    if (in3d) ctx.clearRect(0, 0, W, H);
    else {
      window.EchoDuel3D?.hide();
      ctx.fillStyle = CAVE_BG;
      ctx.fillRect(0, 0, W, H);
    }
    if (!L) return;

    const ox = W / 2 - cam.x * PX + sx, oy = H / 2 - cam.y * PX + sy;
    const toX = (x) => ox + x * PX, toY = (y) => oy + y * PX;

    const tx0 = Math.max(0, Math.floor(cam.x - W / PX / 2) - 1), tx1 = Math.min(L.w - 1, Math.ceil(cam.x + W / PX / 2) + 1);
    const ty0 = Math.max(0, Math.floor(cam.y - H / PX / 2) - 1), ty1 = Math.min(L.h - 1, Math.ceil(cam.y + H / PX / 2) + 1);
    // 2D: stone where sound or Moka's senses reach, a dimmer back wall behind open air,
    // and the odd crystal or mushroom on a ledge
    if (!in3d) {
      const pat = stonePattern();
      pat.setTransform(new DOMMatrix([PX / 64, 0, 0, PX / 64, ox, oy]));
      ctx.fillStyle = pat;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const a = Math.max(L.lit[ty * L.w + tx], nearGlow(tx + 0.5, ty + 0.5));
          if (a < 0.02) continue;
          ctx.globalAlpha = solid(tx, ty) ? Math.min(1, a * 1.15) : a * 0.32;
          ctx.fillRect(toX(tx), toY(ty), PX + 0.5, PX + 0.5);
        }
      }
      ctx.globalAlpha = 1;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (!solid(tx, ty)) continue;
          const a = Math.max(L.lit[ty * L.w + tx], nearGlow(tx + 0.5, ty + 0.5));
          if (a < 0.02) continue;
          const hsh = tileHash(tx, ty), up = !solid(tx, ty - 1), down = !solid(tx, ty + 1);
          const rgb = tileHash(tx, ty, 3) < 0.55 ? DECO_CYAN : DECO_VIOLET;
          ctx.globalAlpha = Math.min(1, a * 1.25);
          if (up && hsh < 0.12) {
            const n = 2 + Math.floor(tileHash(tx, ty, 1) * 3);
            glow(toX(tx + 0.5), toY(ty), PX * 0.6, DECO_CYAN, 0.35);
            for (let j = 0; j < n; j++) {
              const mx = toX(tx + 0.2 + tileHash(tx, ty, 20 + j) * 0.6), sc = PX * (0.9 + tileHash(tx, ty, 10 + j)) * 0.1, my = toY(ty);
              ctx.fillStyle = `rgba(${DECO_CYAN}, 0.75)`;
              ctx.fillRect(mx - sc * 0.15, my - sc * 1.2, sc * 0.3, sc * 1.2);
              ctx.fillStyle = `rgb(${DECO_CYAN})`;
              ctx.beginPath(); ctx.ellipse(mx, my - sc * 1.2, sc * 0.7, sc * 0.45, 0, Math.PI, 0); ctx.fill();
            }
          } else if ((up && hsh < 0.2) || (down && hsh > 0.92)) {
            const n = 2 + Math.floor(tileHash(tx, ty, 1) * 3), hang = !(up && hsh < 0.2), by = toY(hang ? ty + 1 : ty), dir = hang ? 1 : -1;
            glow(toX(tx + 0.5), by + dir * PX * 0.2, PX * 0.7, rgb, 0.4);
            for (let j = 0; j < n; j++) {
              const hh = PX * (j ? 0.3 + tileHash(tx, ty, 10 + j) * 0.4 : 0.55 + tileHash(tx, ty, 11) * 0.35) * 0.55;
              const cx = toX(tx + 0.3 + tileHash(tx, ty, 20 + j) * 0.4), lean = (j - (n - 1) / 2) * 0.35 * hh, w = PX * 0.06;
              ctx.fillStyle = `rgb(${rgb})`;
              ctx.beginPath(); ctx.moveTo(cx - w, by); ctx.lineTo(cx - lean * 0.2 - w * 0.9, by + dir * hh * 0.72);
              ctx.lineTo(cx - lean, by + dir * hh); ctx.lineTo(cx - lean * 0.2 + w * 0.9, by + dir * hh * 0.72); ctx.lineTo(cx + w, by); ctx.closePath(); ctx.fill();
              ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
              ctx.beginPath(); ctx.moveTo(cx, by); ctx.lineTo(cx - lean, by + dir * hh); ctx.lineTo(cx - lean * 0.2 + w * 0.9, by + dir * hh * 0.72); ctx.lineTo(cx + w, by); ctx.closePath(); ctx.fill();
            }
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // Walls: the faces that touch open air get glowing neon edges, in both views
    ctx.lineCap = 'round';
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!solid(tx, ty)) continue;
        const open = [!solid(tx, ty - 1), !solid(tx + 1, ty), !solid(tx, ty + 1), !solid(tx - 1, ty)];
        if (!open.some(Boolean)) continue;
        const a = Math.max(L.lit[ty * L.w + tx], nearGlow(tx + 0.5, ty + 0.5));
        if (a < 0.02) continue;
        const x = toX(tx), y = toY(ty), s = PX;
        const edges = [[x, y, x + s, y], [x + s, y, x + s, y + s], [x, y + s, x + s, y + s], [x, y, x, y + s]];
        for (let i = 0; i < 4; i++) {
          if (!open[i]) continue;
          const [x0, y0, x1, y1] = edges[i];
          ctx.strokeStyle = `rgba(${COL.wall}, ${a * 0.22})`;
          ctx.lineWidth = 7;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.strokeStyle = `rgba(${COL.wall}, ${a * 0.95})`;
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

    // Checkpoint roosts: a lantern hanging from the ceiling, dim until Moka passes, then warm and bright
    for (const cp of L.checkpoints) drawCheckpoint(cp, toX(cp.x), toY(cp.y), toY(cp.ceil));
    // Hidden hearts glow and sparkle on their own, like moths, so a sharp eye can spot the pocket
    for (const hh of L.hearts) if (!hh.got) drawHeartPickup(hh, toX(hh.x), toY(hh.y + Math.sin(clock * 2.2 + hh.phase) * 0.08));

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

    for (const p of pops) drawPop(p, toX(p.x), toY(p.y - p.t * 0.7));
    if (!in3d) drawMoka(toX(moka.x), toY(moka.y));
    if (mode === 'run') {
      // the creeping dark at the left edge
      const g = ctx.createLinearGradient(0, 0, PX * 1.6, 0);
      g.addColorStop(0, 'rgba(255, 84, 104, 0.28)');
      g.addColorStop(1, 'rgba(255, 84, 104, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, PX * 1.6, H);
    }
    // darkened corners, the cave closing in around the light (same as in battle)
    if (!vignette || vignette.w !== W || vignette.h !== H) {
      const g = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.hypot(W, H) * 0.6);
      g.addColorStop(0, 'rgba(4, 3, 16, 0)'); g.addColorStop(1, 'rgba(4, 3, 16, 0.55)');
      vignette = { g, w: W, h: H };
    }
    ctx.fillStyle = vignette.g;
    ctx.fillRect(0, 0, W, H);
    drawHud();
    if (touchUsed && state === 'play') drawDashButton();
    drawStick();
  }
  let vignette = null;

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

  // A roost lantern on a chain from the ceiling, with a little perch bar for a bat
  // to hang from. Unlit it's a faint amber outline; lit, it glows and flickers.
  function drawCheckpoint(cp, x, y, ceilY) {
    const on = cp.on, fl = on ? 0.85 + 0.15 * Math.sin(clock * 9 + x) * Math.sin(clock * 5.3) : 0.35 + 0.1 * Math.sin(clock * 2);
    const s = PX * 0.2;
    glow(x, y, PX * (on ? 1.9 : 1.1), COL.checkpoint, on ? 0.5 * fl : 0.12);
    if (cp.flash > 0) {
      // a ring of light spreads out when it's lit
      const k = 1 - cp.flash;
      ctx.strokeStyle = `rgba(${COL.checkpoint}, ${cp.flash})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, PX * (0.4 + k * 2.6), 0, Math.PI * 2); ctx.stroke();
    }
    // chain
    ctx.strokeStyle = `rgba(${COL.checkpoint}, ${on ? 0.7 : 0.3})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, ceilY); ctx.lineTo(x, y - s * 1.6); ctx.stroke();
    ctx.setLineDash([]);
    // cap, glass and base
    ctx.fillStyle = on ? 'rgb(120, 78, 40)' : 'rgba(120, 78, 40, 0.5)';
    ctx.beginPath(); ctx.moveTo(x - s * 0.5, y - s * 1.6); ctx.lineTo(x + s * 0.5, y - s * 1.6); ctx.lineTo(x + s * 0.95, y - s * 1.05); ctx.lineTo(x - s * 0.95, y - s * 1.05); ctx.closePath(); ctx.fill();
    ctx.fillRect(x - s * 0.95, y + s * 0.95, s * 1.9, s * 0.35);
    ctx.fillStyle = on ? `rgba(255, 226, 160, ${fl})` : 'rgba(255, 196, 120, 0.12)';
    ctx.strokeStyle = `rgba(${COL.checkpoint}, ${on ? 0.95 : 0.45})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(x - s * 0.75, y - s * 1.05, s * 1.5, s * 2); ctx.fill(); ctx.stroke();
    if (on) {
      // the flame
      ctx.fillStyle = 'rgba(255, 250, 230, 0.95)';
      ctx.beginPath(); ctx.ellipse(x, y + s * 0.1, s * 0.22, s * (0.45 + 0.08 * Math.sin(clock * 13)), 0, 0, Math.PI * 2); ctx.fill();
    }
    // the perch bar underneath
    ctx.strokeStyle = on ? 'rgb(160, 110, 60)' : 'rgba(160, 110, 60, 0.5)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x, y + s * 1.3); ctx.lineTo(x, y + s * 1.9); ctx.moveTo(x - s * 1.5, y + s * 1.9); ctx.lineTo(x + s * 1.5, y + s * 1.9); ctx.stroke();
  }

  // A hidden heart: pink, pulsing, with sparkles twinkling around it
  function drawHeartPickup(hh, x, y) {
    const beat = 1 + 0.12 * Math.max(0, Math.sin(clock * 6 + hh.phase)) ** 6;
    glow(x, y, PX * 1.1, COL.heart, 0.45 + 0.15 * Math.sin(clock * 3 + hh.phase));
    heart(x, y, PX * 0.24 * beat, true, ctx);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath(); ctx.ellipse(x - PX * 0.09 * beat, y - PX * 0.08 * beat, PX * 0.05, PX * 0.035, -0.6, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 4; k++) {
      const a = clock * 1.4 + hh.phase + k * Math.PI / 2, d = PX * (0.42 + 0.06 * Math.sin(clock * 3 + k));
      const tw = Math.max(0, Math.sin(clock * 5 + k * 1.7 + hh.phase));
      if (tw < 0.05) continue;
      const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d * 0.8, r = PX * 0.08 * tw;
      ctx.fillStyle = `rgba(255, 236, 244, ${tw})`;
      ctx.beginPath();
      ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r * 0.25, sy - r * 0.25); ctx.lineTo(sx + r, sy); ctx.lineTo(sx + r * 0.25, sy + r * 0.25);
      ctx.lineTo(sx, sy + r); ctx.lineTo(sx - r * 0.25, sy + r * 0.25); ctx.lineTo(sx - r, sy); ctx.lineTo(sx - r * 0.25, sy - r * 0.25);
      ctx.closePath(); ctx.fill();
    }
  }

  // "Checkpoint!" and "+1 heart!" float up and fade
  function drawPop(p, x, y) {
    const a = Math.min(1, p.t * 6) * (1 - Math.max(0, p.t - 1) / 0.6), sc = 0.7 + 0.3 * Math.min(1, p.t * 5);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `700 ${Math.round(Math.max(15, PX * 0.42) * sc)}px ${HUD_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10, 6, 30, 0.85)';
    ctx.strokeText(p.text, x, y);
    ctx.fillStyle = `rgb(${p.rgb})`;
    ctx.fillText(p.text, x, y);
    ctx.restore();
  }

  // Moka wears this device's bat look (looks.js) when there is one; it's read
  // about once a second and only replaced when it actually changes
  let lookCache = null, lookAt = -1e9;
  function mokaLook() {
    const E = window.EchoLooks;
    if (!E || !E.mine) return null;
    const now = performance.now();
    if (now - lookAt > 1000) {
      lookAt = now;
      try {
        const l = E.mine();
        if (!lookCache || JSON.stringify(l) !== JSON.stringify(lookCache)) lookCache = l;
      } catch { /* keep the last look */ }
    }
    return lookCache;
  }

  function drawMoka(x, y) {
    if (moka.hurt > 0 && Math.floor(moka.hurt * 12) % 2 === 0) return;
    glow(x, y, PX * 0.9, '139, 108, 255', moka.dashT > 0 ? 0.5 : 0.25);
    const r = PX * MOKA_R;
    const look = mokaLook();
    if (look && window.EchoLooks.draw2D) {
      const tilt = Math.max(-0.35, Math.min(0.35, moka.vy * 0.05)) * moka.face;
      window.EchoLooks.draw2D(ctx, look, x, y, r, { face: moka.face, flap: (clock * (moka.dashT > 0 ? 40 : 18)) / (2 * Math.PI), alpha: 1, angle: tilt });
      return;
    }
    const flap = Math.sin(clock * (moka.dashT > 0 ? 40 : 18));
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

  const HUD_FONT = '"Fredoka", "Nunito", system-ui, sans-serif';
  // Glass pills like the battle scoreboard: hearts and moths top-left, echoes
  // top-right, the run's distance under the pause button
  // glass pill shapes for the HUD, drawn on whichever context is given
  function hudShapes(ctx) {
    const roundRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    };
    const pill = (x, y, w, h, edge, blur = 10) => {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(26, 22, 64, 0.78)');
      g.addColorStop(1, 'rgba(8, 8, 26, 0.82)');
      ctx.fillStyle = g;
      roundRect(x, y, w, h, h / 2); ctx.fill();
      // soft halo from wide faint strokes (canvas shadows are slow on phones)
      const a0 = ctx.globalAlpha;
      ctx.strokeStyle = edge;
      ctx.globalAlpha = a0 * 0.01 * blur; ctx.lineWidth = 11; ctx.stroke();
      ctx.globalAlpha = a0 * 0.022 * blur; ctx.lineWidth = 6; ctx.stroke();
      ctx.globalAlpha = a0; ctx.lineWidth = 2; ctx.stroke();
    };
    return { roundRect, pill };
  }
  const hudPillH = () => Math.max(30, Math.min(40, H * 0.085));
  const echoColor = () => (moka.echoes <= 2 || (moka.noEcho > 0 && Math.floor(moka.noEcho * 10) % 2 === 0) ? COL.danger : COL.wall);

  // Glass pills like the battle scoreboard: hearts and moths top-left, echoes
  // top-right, the run's distance under the pause button. They only change when
  // a number does, so they're drawn into a cached layer that is stamped each frame.
  let hudLayer = null;
  function drawHud() {
    const ph = hudPillH(), stripH = Math.ceil(58 + ph + 14);
    const key = [W, H, DPR, mode, moka.hearts, moka.hurt > 0, stats.moths, L.moths.length, moka.echoes, echoColor(), mode === 'run' ? runDistance() : 0].join();
    if (!hudLayer) { const c = document.createElement('canvas'); hudLayer = { c, g: c.getContext('2d'), key: '' }; }
    if (hudLayer.key !== key) {
      const { c, g } = hudLayer;
      if (c.width !== Math.round(W * DPR) || c.height !== Math.round(stripH * DPR)) { c.width = Math.round(W * DPR); c.height = Math.round(stripH * DPR); }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      hudTop(g, ph);
      hudLayer.key = key;
    }
    ctx.drawImage(hudLayer.c, 0, 0, W, stripH);
    drawHint();
  }

  function hudTop(ctx, ph) {
    const { roundRect, pill } = hudShapes(ctx);
    const pad = 10, top = 8, cy = top + ph / 2;
    ctx.textBaseline = 'middle';

    // hearts and moths
    const hs = ph * 0.2, hg = ph * 0.56;
    ctx.font = `700 ${Math.round(ph * 0.42)}px ${HUD_FONT}`;
    const mothText = mode === 'run' ? `${stats.moths}` : `${stats.moths} / ${L.moths.length}`;
    // bonus hearts from hidden pickups get extra slots, with a gold rim
    const slots = Math.max(MAX_HEARTS, moka.hearts);
    const lw = ph * 0.45 + slots * hg + ph * 0.35 + ph * 0.55 + ctx.measureText(mothText).width + ph * 0.45;
    pill(pad, top, lw, ph, moka.hurt > 0 ? `rgb(${COL.danger})` : 'rgba(150, 125, 255, 0.85)');
    for (let i = 0; i < slots; i++) {
      const hx = pad + ph * 0.45 + hg * (i + 0.5) - hg * 0.1;
      heart(hx, cy, hs * 1.15, i < moka.hearts, ctx);
      if (i >= MAX_HEARTS) { ctx.strokeStyle = 'rgba(255, 214, 120, 0.95)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    const dx = pad + ph * 0.45 + slots * hg + ph * 0.05;
    ctx.fillStyle = 'rgba(214, 208, 255, 0.2)';
    ctx.fillRect(dx, cy - ph * 0.25, 1.5, ph * 0.5);
    const mx = dx + ph * 0.42;
    const mg = ctx.createRadialGradient(mx, cy, 0, mx, cy, ph * 0.45);
    mg.addColorStop(0, `rgba(${COL.moth}, 0.45)`); mg.addColorStop(1, `rgba(${COL.moth}, 0)`);
    ctx.fillStyle = mg; ctx.fillRect(mx - ph * 0.45, cy - ph * 0.45, ph * 0.9, ph * 0.9);
    ctx.fillStyle = `rgb(${COL.moth})`;
    ctx.beginPath();
    ctx.ellipse(mx - ph * 0.08, cy, ph * 0.1, ph * 0.065, -0.5, 0, Math.PI * 2);
    ctx.ellipse(mx + ph * 0.08, cy, ph * 0.1, ph * 0.065, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#efeaff';
    ctx.textAlign = 'left';
    ctx.fillText(mothText, mx + ph * 0.28, cy + 1);

    // echoes left: the count in a lozenge, then a row of pips
    const ecol = echoColor();
    const pr = Math.max(2.2, ph * 0.07), gap = pr * 2.55;
    ctx.font = `600 ${Math.round(ph * 0.28)}px ${HUD_FONT}`;
    const label = 'ECHOES', lbw = ctx.measureText(label).width;
    const sh = ph * 0.66, sw = sh * 1.45;
    const rw = ph * 0.2 + sw + ph * 0.25 + lbw + ph * 0.3 + (MAX_ECHOES - 1) * gap + pr * 2 + ph * 0.42;
    const rx = W - pad - rw;
    pill(rx, top, rw, ph, `rgba(${ecol}, 0.85)`);
    const sx = rx + ph * 0.2;
    roundRect(sx, cy - sh / 2, sw, sh, sh / 2);
    ctx.fillStyle = `rgb(${ecol})`; ctx.fill();
    ctx.globalAlpha = 0.25; ctx.strokeStyle = `rgb(${ecol})`; ctx.lineWidth = 5; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#0c1430';
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(sh * 0.72)}px ${HUD_FONT}`;
    ctx.fillText(String(moka.echoes), sx + sw / 2, cy + 1);
    ctx.textAlign = 'left';
    ctx.font = `600 ${Math.round(ph * 0.28)}px ${HUD_FONT}`;
    ctx.fillStyle = 'rgba(214, 208, 255, 0.75)';
    ctx.fillText(label, sx + sw + ph * 0.25, cy + 1);
    const px0 = rx + rw - ph * 0.42 - pr - (MAX_ECHOES - 1) * gap;
    for (let i = 0; i < MAX_ECHOES; i++) {
      ctx.beginPath(); ctx.arc(px0 + i * gap, cy, pr, 0, Math.PI * 2);
      ctx.fillStyle = i < moka.echoes ? `rgb(${ecol})` : 'rgba(214, 208, 255, 0.16)';
      ctx.fill();
    }

    if (mode === 'run') {
      // distance, in a small pill under the pause button
      ctx.font = `700 ${Math.round(ph * 0.4)}px ${HUD_FONT}`;
      const txt = `${runDistance()} m`, dh = ph * 0.78, dw = Math.max(dh * 2.4, ctx.measureText(txt).width + dh);
      const dy = 58;
      pill(W / 2 - dw / 2, dy, dw, dh, 'rgba(120, 255, 170, 0.75)', 8);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#efeaff';
      ctx.fillText(txt, W / 2, dy + dh / 2 + 1);
    }
  }

  // The DASH button: the battle's glassy violet disc, its ring filling up again
  // while the dash recharges
  function drawDashButton() {
    const b = dashButton(), ready = moka.dashCd <= 0, k = ready ? 1 : 0.55;
    const g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, `rgba(120, 90, 235, ${0.55 * k})`);
    g.addColorStop(1, `rgba(36, 22, 92, ${0.72 * k})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    // soft halo from wide faint strokes (canvas shadows are slow on phones)
    if (ready) {
      ctx.strokeStyle = 'rgba(160, 120, 255, 1)';
      ctx.globalAlpha = 0.1; ctx.lineWidth = 12.5; ctx.stroke();
      ctx.globalAlpha = 0.22; ctx.lineWidth = 7.5; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = 'rgba(80, 60, 160, 0.7)'; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.strokeStyle = '#a68bff';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, 1 - moka.dashCd / DASH_COOLDOWN)); ctx.stroke();
    ctx.font = `700 ${Math.round(b.r * 0.4)}px ${HUD_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = ready ? '#f4f1ff' : 'rgba(244, 241, 255, 0.45)';
    ctx.fillText('DASH', b.x, b.y - b.r * 0.12);
    // a little flying-bat silhouette under the word
    const x = b.x, y = b.y + b.r * 0.38, s = b.r * 0.31;
    ctx.fillStyle = ready ? '#8f6dff' : 'rgba(143, 109, 255, 0.45)';
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.22);
    ctx.lineTo(x - s * 0.14, y - s * 0.42); ctx.lineTo(x - s * 0.2, y - s * 0.2);
    ctx.quadraticCurveTo(x - s * 0.6, y - s * 0.5, x - s, y - s * 0.38);
    ctx.quadraticCurveTo(x - s * 0.8, y - s * 0.1, x - s * 0.82, y + s * 0.12);
    ctx.quadraticCurveTo(x - s * 0.62, y - s * 0.02, x - s * 0.5, y + s * 0.16);
    ctx.quadraticCurveTo(x - s * 0.36, y + s * 0.02, x - s * 0.2, y + s * 0.3);
    ctx.lineTo(x, y + s * 0.42);
    ctx.lineTo(x + s * 0.2, y + s * 0.3);
    ctx.quadraticCurveTo(x + s * 0.36, y + s * 0.02, x + s * 0.5, y + s * 0.16);
    ctx.quadraticCurveTo(x + s * 0.62, y - s * 0.02, x + s * 0.82, y + s * 0.12);
    ctx.quadraticCurveTo(x + s * 0.8, y - s * 0.1, x + s, y - s * 0.38);
    ctx.quadraticCurveTo(x + s * 0.6, y - s * 0.5, x + s * 0.2, y - s * 0.2);
    ctx.lineTo(x + s * 0.14, y - s * 0.42);
    ctx.closePath(); ctx.fill();
  }

  function drawHint() {
    if (!(hintTimer > 0 && state === 'play')) return;
    const { pill } = hudShapes(ctx);
    const size = Math.max(14, Math.min(20, H / 26));
    ctx.textBaseline = 'middle';
    // first-time hint, in an info pill along the bottom with lines reaching out
    {
      const k = Math.min(1, hintTimer);
      ctx.globalAlpha = k;
      ctx.font = `600 ${Math.round(size * 0.78)}px ${HUD_FONT}`;
      const hint = touchUsed ? 'DRAG TO FLY  ·  TAP TO SQUEAK  ·  FLICK OR TAP DASH' : 'ARROWS OR DRAG TO FLY  ·  SPACE OR CLICK TO SQUEAK  ·  G TO DASH';
      const iw = ctx.measureText(hint).width + 40, ih = size * 1.55, iy = H - ih - 10, ly = iy + ih / 2, ll = Math.min(48, W * 0.05);
      ctx.strokeStyle = 'rgba(150, 130, 255, 0.45)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 - iw / 2 - 12, ly); ctx.lineTo(W / 2 - iw / 2 - 12 - ll, ly);
      ctx.moveTo(W / 2 + iw / 2 + 12, ly); ctx.lineTo(W / 2 + iw / 2 + 12 + ll, ly);
      ctx.stroke();
      pill(W / 2 - iw / 2, iy, iw, ih, 'rgba(150, 130, 255, 0.75)', 8);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(234, 230, 255, 0.9)';
      ctx.fillText(hint, W / 2, ly + 1);
      if (mode === 'run') {
        ctx.font = `600 ${Math.round(size * 0.85)}px ${HUD_FONT}`;
        ctx.fillStyle = 'rgba(234, 230, 255, 0.9)';
        ctx.fillText('Keep moving right. The dark is coming.', W / 2, iy - size * 0.9);
      } else if (L.def.name) {
        // which cave this is, e.g. "Cave 2: The Hollows"
        ctx.font = `700 ${Math.round(size * 0.95)}px ${HUD_FONT}`;
        ctx.fillStyle = 'rgba(234, 230, 255, 0.95)';
        ctx.fillText(L.def.name, W / 2, iy - size * 0.95);
      }
      ctx.globalAlpha = 1;
    }
  }

  function heart(x, y, s, full, ctx = canvas.getContext('2d')) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.8);
    ctx.bezierCurveTo(x - s * 1.2, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.2, y - s * 0.1, x, y + s * 0.8);
    if (full) {
      ctx.fillStyle = '#ff6b8a'; ctx.fill();
      ctx.globalAlpha = 0.25; ctx.strokeStyle = '#ff6b8a'; ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = 1;
    } else { ctx.strokeStyle = 'rgba(255, 120, 150, 0.45)'; ctx.lineWidth = 1.5; ctx.stroke(); }
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
    $('powers-screen').hidden = true;
    window.EchoBackdrop?.altar?.(which !== 'battle');
    if (which !== 'battle') { myPreview?.dispose?.(); myPreview = null; }   // free the lobby's 3D bat   // the lobby's bottom bar sits where the altar is
    $('pause-screen').hidden = which !== 'pause';
    endAlt.hidden = true;   // Explore's "Restart cave" shows again only on a lose screen after a checkpoint
    if (which !== 'pause') { pauseOpen = false; paused = false; window.EchoDuel?.setPaused?.(false); window.EchoCoop?.setPaused?.(false); }
  }

  // ---- Pause ---------------------------------------------------------------
  // Offline games freeze; an online match keeps running for everyone else.
  let paused = false, pauseOpen = false;
  const inMatch = () => state === 'play' || (mode === 'duel' && state === 'duel' && engine().active && !engine().over);
  const online = () => mode === 'duel' && duelCfg.online;
  function openPause() {
    if (!inMatch()) return;
    showOverlay('pause');
    pauseOpen = true;
    paused = !online();
    engine().setPaused(paused);
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
    window.EchoCoop?.stop();
    mode = 'cave';
    state = 'title';
    L = null;
    showOverlay(wasOnline ? 'battle' : 'title');
  }

  function enterGame(newMode) {
    unlockAudio();
    try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not allowed here */ }
    try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch { /* not supported */ }
    // Explore carries on from the next cave not yet flown
    const next = Math.max(0, Math.min(window.ECHO_LEVELS.length - 1, store.get('echo-caves-next') || 0));
    startGame(newMode, newMode === 'cave' ? next : 0);
  }

  function primaryAction() {
    unlockAudio();
    if (mode === 'duel') (duelCfg.rematch || (() => startDuel(duelCfg)))();
    else if (state === 'title') enterGame('cave');
    else if (state === 'win' && mode === 'cave') startGame(mode, (levelIndex + 1) % window.ECHO_LEVELS.length);
    else if (state === 'lose' && mode === 'cave' && checkpoint) restartFromCheckpoint();
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
    if (cfg.coop) {
      window.EchoDuel.stop();
      window.EchoCoop.setView(store.get('echo-view') || '3d');
      window.EchoCoop.start({ ...cfg, onEnd: (result, info) => { cfg.onResult?.(result); endCoop(result, info); } });
      return;
    }
    window.EchoCoop?.stop();
    window.EchoDuel.setView(store.get('echo-view') || '3d');
    window.EchoDuel.start({ ...cfg, onEnd: (result) => { cfg.onResult?.(result); endDuel(result); } });
  }
  // Co-op Cave Run goes through the same match plumbing as battles
  const startCoop = (cfg) => startDuel({ ...cfg, coop: true });

  function endCoop(result, { guest = false } = {}) {
    if (result.won) sfx.win();
    const mySlot = duelCfg.mode === 'client' ? duelCfg.mySlot : 0;
    const d = window.EchoCoop.describe(result, mySlot);
    $('end-title').textContent = d.title;
    $('end-stars').textContent = d.big;
    $('end-stars').removeAttribute('aria-label');
    $('end-detail').innerHTML = d.lines.map((l) => `<li class="${l.got ? 'got' : ''}"${l.color ? ` style="color:${l.color}"` : ''}>${l.text}</li>`).join('');
    $('end-button').textContent = result.won ? 'Play again' : 'Try again';
    $('end-button').hidden = guest;
    $('menu-button').textContent = duelCfg.online ? 'Room' : 'Menu';
    $('end-wait').hidden = !guest;
    showOverlay('end');
  }

  // Online guests get the result from the host and can only wait for a rematch or go back to the room
  function endDuel({ winner, winnerCpu, standings, humans, rule }, { guest = false } = {}) {
    const unit = rule === 'survivor' ? 'round' : 'bite';
    if (!duelCfg.online && guest) return;
    sfx.win();
    const me = duelCfg.online ? ['Mo', 'Ka', 'Ca', 'Bo'][duelCfg.mode === 'host' ? 0 : duelCfg.mySlot] : null;
    $('end-title').textContent = me === winner ? 'You win!'
      : winnerCpu && (humans === 1 || duelCfg.online) ? `${winner} (CPU) ate everyone!` : `${winner} wins!`;
    $('end-stars').textContent = standings.map((p) => p.score).join(' – ');
    $('end-stars').setAttribute('aria-label', `Final ${unit}s ` + standings.map((p) => `${p.name} ${p.score}`).join(', '));
    $('end-detail').innerHTML = standings
      .map((p, k) => `<li class="${k === 0 ? 'got' : ''}" style="color:${p.color}">${p.name}${p.cpu ? ' (CPU)' : ''}${p.name === me ? ' (you)' : ''}: ${p.score} ${unit}${p.score === 1 ? '' : 's'}</li>`)
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
  // Multiplayer: the title card opens the lobby; its tabs pick Bites, Last Bite or Co-op Run
  $('battle-button').addEventListener('click', () => { unlockAudio(); openLobby(); });
  // The lobby: one screen for CPU matches and online rooms (net.js drives the room part).
  // Seats fill in order: the people in the room (just you when offline), then CPU bats.
  const BAT_SEATS = [
    { name: 'Mo', c: 'var(--mo)' }, { name: 'Ka', c: 'var(--ka)' },
    { name: 'Ca', c: 'var(--ca)' }, { name: 'Bo', c: 'var(--bo)' },
  ];
  const LEVELS = ['easy', 'normal', 'hard'];
  const LEVEL_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
  // arenas: one that slowly reshapes, one of the four caves kept still, or open sky
  const ARENA_CHOICES = [
    { id: 'morph', name: 'Morphing', desc: 'The walls slowly reshape', mode: 'morph' },
    ...['Crystal Grotto', 'Lava Hollow', 'Mossy Den', 'Frozen Cavern'].map((name, i) => ({ id: `still-${i}`, name, desc: 'Stays the same all match', mode: 'still', arena: i })),
    { id: 'sky', name: 'Open Sky', desc: 'No cave, just the night', mode: 'sky' },
  ];
  const RULES = {
    bites: { hint: (n) => `first to ${n} bites` },
    survivor: { hint: (n) => `last bat standing · ${n} round wins` },
    coop: { hint: () => 'co-op run' },
  };
  const VARIANTS = {
    classic: 'Fly to the end together. Squeak to stun monsters, dash to smash them.',
    escape: 'Run away! Monsters chase you and can’t be beaten. Reach the exit.',
    hunt: 'Hunt them down! Beat enough monsters to open the exit.',
  };
  const FREQS = ['off', 'low', 'normal', 'high'];
  const FREQ_NAMES = { off: 'Off', low: 'Low', normal: 'Normal', high: 'High' };
  const powerList = () => window.EchoDuel?.POWER_LIST || [];
  const arenaOpts = (p) => { const a = ARENA_CHOICES.find((x) => x.id === p.arenaId) || ARENA_CHOICES[0]; return { arenaMode: a.mode, arena: a.arena }; };
  const cleanPowers = (pw) => {
    const on = {};
    for (const p of powerList()) on[p.id] = pw?.on?.[p.id] !== false;
    return { on, freq: FREQS.includes(pw?.freq) ? pw.freq : 'normal' };
  };
  const savedPick = () => {
    const lv = store.get('echo-cpu-levels');
    const p = {
      humans: 1,
      cpus: Math.min(3, Math.max(0, store.get('echo-cpus') ?? 1)),
      level: store.get('echo-cpu-level') || 'normal',
      cpuLevels: [0, 1, 2].map((k) => (Array.isArray(lv) && LEVEL_NAMES[lv[k]] ? lv[k] : 'normal')),
      arenaId: store.get('echo-arena') || 'morph',
      rule: store.get('echo-rule') || 'bites',
      firstTo: [3, 5, 7].includes(store.get('echo-first-to')) ? store.get('echo-first-to') : 3,
      variant: store.get('echo-coop-variant') || 'classic',
      powers: store.get('echo-powers') || null,
    };
    if (!ARENA_CHOICES.some((a) => a.id === p.arenaId)) p.arenaId = 'morph';
    if (!RULES[p.rule]) p.rule = 'bites';
    if (!LEVEL_NAMES[p.level]) p.level = 'normal';
    if (!VARIANTS[p.variant]) p.variant = 'classic';
    p.powers = cleanPowers(p.powers);
    return p;
  };
  const pick = savedPick();
  // CPU bats get a fresh random look each visit; everyone sees the same ones online
  let cpuSeed = Math.floor(Math.random() * 1e6);
  // room: null offline, else { role: 'host' | 'guest', code, people: [{ slot, me, look }] }
  let room = null;
  const canEdit = () => !room || room.role === 'host';
  const people = () => (room ? room.people : [{ slot: 0, me: true }]);
  const Looks = () => window.EchoLooks;
  const myLook = () => Looks()?.mine?.() || null;
  // the look of every seat: people bring their own, CPU bats get a random one
  function seatLooks() {
    const ppl = people(), n = ppl.length, L = Looks();
    return BAT_SEATS.map((_, k) => {
      const p = ppl.find((q) => q.slot === k);
      if (p) return p.me ? myLook() : p.look ? L?.clean?.(p.look) || null : L?.preset?.(k) || null;
      if (k < n + pick.cpus) return L?.random?.(cpuSeed + k) || null;
      return null;
    });
  }
  // CPU skill per seat, in seat order after the people
  const levelsBySlot = () => {
    const n = people().length;
    return BAT_SEATS.map((_, k) => (k >= n && k < n + pick.cpus ? pick.cpuLevels[k - n] || 'normal' : null));
  };
  // a little map of the arena, drawn from its tiles
  function drawArenaPreview() {
    const c = $('arena-preview'), g = c.getContext('2d');
    const arenas = window.ECHO_ARENAS;
    const ch = ARENA_CHOICES.find((x) => x.id === pick.arenaId) || ARENA_CHOICES[0];
    const def = ch.mode === 'sky' ? arenas.find((a) => a.open) : arenas[ch.mode === 'morph' ? 2 : ch.arena];
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
    const ppl = people(), n = ppl.length, edit = canEdit(), coop = pick.rule === 'coop';
    pick.cpus = Math.max(0, Math.min(pick.cpus, 4 - n));
    const cpus = pick.cpus, total = n + cpus;
    // seats: people, then CPU bats, then empty seats to add a CPU or invite a friend
    const empties = 4 - total;
    $('seats').innerHTML = BAT_SEATS.map((bat, k) => {
      const p = ppl.find((q) => q.slot === k);
      const cpu = !p && k >= n && k < total;
      const num = `<span class="num">${k + 1}</span>`;
      if (p) {
        const host = room && k === 0;
        const name = p.me ? `You${host || !room ? ' <svg aria-label="leader"><use href="#i-crown"/></svg>' : ''}` : 'Friend';
        return `<div class="slot you" style="--c: ${bat.c}">${num}${host && !p.me ? '<span class="host-tag">Host</span>' : ''}`
          + `<div class="seat-art"><canvas class="seat-bat" data-seat-bat="${k}"></canvas></div><b>${name}</b>`
          + '<span class="pill ok ready"><svg><use href="#i-check"/></svg>Ready</span></div>';
      }
      if (cpu) {
        const lv = pick.cpuLevels[k - n] || 'normal', i = LEVELS.indexOf(lv);
        const steps = `<div class="stepper"><button type="button" data-lv="-1" data-seat="${k}" aria-label="Easier" ${!edit || i === 0 ? 'disabled' : ''}>‹</button>`
            + `<span>${LEVEL_NAMES[lv]}</span><button type="button" data-lv="1" data-seat="${k}" aria-label="Harder" ${!edit || i === 2 ? 'disabled' : ''}>›</button></div>`;
        return `<div class="slot on" style="--c: ${bat.c}">${num}`
          + (edit ? `<button type="button" class="x" data-remove="${k}" aria-label="Remove CPU">✕</button>` : '')
          + `<div class="seat-art"><canvas class="seat-bat" data-seat-bat="${k}"></canvas></div><b>${coop ? 'Buddy' : 'CPU'}</b>${steps}</div>`;
      }
      // the last empty seat invites a friend (when there's room for one), the rest add CPU bats
      const invite = room?.role !== 'guest' && empties >= 2 && k === 3;
      if (!edit) return `<div class="slot open" style="--c: ${bat.c}">${num}<span class="plus">+</span><b>Open</b><small>Waiting for the host</small></div>`;
      if (invite) return `<button type="button" class="slot add" data-invite style="--c: ${bat.c}">${num}<span class="plus">+</span><b>Add Player</b><small>${room ? 'Share the code' : 'Invite online'}</small></button>`;
      return `<button type="button" class="slot add" data-add="${k}" style="--c: ${bat.c}">${num}<span class="plus">+</span><b>${coop ? 'Add Buddy' : 'Add CPU'}</b><small>${coop ? 'A CPU bat on your team' : 'Easy / Normal / Hard'}</small></button>`;
    }).join('');
    $('seat-dots').innerHTML = BAT_SEATS.map((bat, k) => `<i class="${k < n ? 'full' : k < total ? 'cpu' : ''}" style="--c: ${bat.c}"></i>`).join('');
    $('headcount').textContent = n;
    // settings
    const mark = (sel, key, val, lock = true) => document.querySelectorAll(sel).forEach((b) => {
      const on = String(b.dataset[key]) === String(val);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      if (lock) b.disabled = !edit;
    });
    mark('[data-level]', 'level', pick.level);
    mark('[data-first]', 'first', pick.firstTo);
    mark('[data-rule]', 'rule', pick.rule);
    mark('[data-variant]', 'variant', pick.variant);
    $('first-label').textContent = pick.rule === 'survivor' ? 'Round wins' : 'First to';
    $('arena-pick').hidden = $('first-row').hidden = $('powers-row').hidden = coop;
    $('variant-row').hidden = $('variant-desc').hidden = $('monster-row').hidden = !coop;
    $('variant-desc').textContent = VARIANTS[pick.variant];
    $('arena-prev').disabled = $('arena-next').disabled = !edit;
    const a = ARENA_CHOICES.find((x) => x.id === pick.arenaId) || ARENA_CHOICES[0];
    $('arena-name').textContent = a.name;
    $('arena-desc').textContent = a.desc;
    drawArenaPreview();
    const list = powerList(), onCount = list.filter((p) => pick.powers.on[p.id] !== false).length;
    $('powers-sum').textContent = pick.powers.freq === 'off' || (list.length && !onCount) ? 'Off'
      : `${!list.length || onCount === list.length ? 'All' : onCount} · ${FREQ_NAMES[pick.powers.freq]}`;
    // room bar and start
    $('room-none').hidden = !!room;
    $('room-box').hidden = !room;
    $('room-code').innerHTML = room ? [...room.code].map((ch) => `<b>${ch}</b>`).join('') : '';
    $('room-code').setAttribute('aria-label', room ? `Room code ${room.code}` : '');
    $('back-label').textContent = room ? 'Leave' : 'Back';
    const guest = room?.role === 'guest';
    $('duel-start').hidden = guest;
    const need = coop ? 1 : 2;
    $('start-text').textContent = coop ? "Let's Fly!" : "Let's Fight!";
    $('duel-start').disabled = total < need;
    $('start-hint').textContent = guest ? 'Waiting for the host to start…' : total < need ? 'Add a CPU or invite a friend'
      : coop ? `${total} bat${total > 1 ? 's' : ''} · ${pick.variant === 'classic' ? 'co-op run' : pick.variant}` : `${total} bats · ${RULES[pick.rule].hint(pick.firstTo)}`;
    paintBats(0);
  }
  // ---- the bats on the seats and in "My bat", drawn with EchoLooks and gently flapping
  const KINDS = ['classic', 'fruit', 'longear', 'vampire', 'ghost', 'crystal'];
  const KIND_NAMES = { classic: 'Classic bat', fruit: 'Fruit bat', longear: 'Long-eared bat', vampire: 'Vampire bat', ghost: 'Ghost bat', crystal: 'Crystal bat' };
  function fitCanvas(c) {
    const r = c.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (w && h && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; }
    return { w: r.width, h: r.height, d };
  }
  function drawBatIn(c, look, t, k) {
    const { w, h, d } = fitCanvas(c);
    if (!w || !h) return;
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(d, 0, 0, d, 0, 0);
    const r = Math.min(w / 5.4, h / 3.6);
    const y = h * 0.55 + Math.sin(t * 2 + k) * r * 0.08;
    const glowG = g.createRadialGradient(w / 2, y, 0, w / 2, y, r * 2.6);
    glowG.addColorStop(0, `${look?.body || '#8b6cff'}55`); glowG.addColorStop(1, 'transparent');
    g.fillStyle = glowG; g.fillRect(0, 0, w, h);
    if (look && Looks()?.draw2D) Looks().draw2D(g, look, w / 2, y, r, { face: 1, flap: t * 1.4 + k * 0.23 });
    else {   // looks.js missing: a plain bat shape
      g.fillStyle = look?.body || '#8b6cff';
      g.beginPath(); g.arc(w / 2, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  let batT = 0, myPreview = null;
  function paintBats(dt) {
    batT += dt;
    if ($('battle-screen').hidden) return;
    const looks = seatLooks();
    document.querySelectorAll('[data-seat-bat]').forEach((c) => drawBatIn(c, looks[+c.dataset.seatBat], batT, +c.dataset.seatBat));
    if (!$('side-bat').hidden) {
      // a 3D bat you can drag to spin; the flat drawing only if 3D can't start
      if (!myPreview && Looks()?.preview3D && window.THREE) myPreview = Looks().preview3D($('my-bat'), myLook);
      if (!myPreview) drawBatIn($('my-bat'), myLook(), batT, 0);
    }
  }
  // quick sliders under the preview; the full creator has every part
  const QUICK = [['scheme', 'Colours'], ['hat', 'Hat']];
  const optionsFor = (field) => window.EchoLooks?.OPTIONS?.[field] || [];
  function renderMyBat() {
    const look = myLook();
    $('kind-name').textContent = optionsFor('kind').find((o) => o.id === look?.kind)?.name || KIND_NAMES[look?.kind] || 'Your bat';
    $('quick-parts').innerHTML = QUICK.filter(([f]) => optionsFor(f).length).map(([f, label]) => {
      const cur = optionsFor(f).find((o) => o.id === look?.[f]);
      return `<div class="quick"><span>${label}</span><button type="button" class="round sm" data-part="${f}" data-d="-1" aria-label="Previous ${label}">‹</button>`
        + `<b>${cur?.name || '—'}</b><button type="button" class="round sm" data-part="${f}" data-d="1" aria-label="Next ${label}">›</button></div>`;
    }).join('');
    paintBats(0);
  }
  function saveMyLook(look) {
    if (!look || !Looks()) return;
    const clean = Looks().clean(look);
    store.set('echo-look', clean);
    renderMyBat();
    myPreview?.refresh?.(); myPreview?.pop?.();
    lobby.onLook?.(clean);
  }
  const stepPart = (f, d) => {
    const look = myLook(), opts = optionsFor(f);
    if (!look || !opts.length) return;
    const i = Math.max(0, opts.findIndex((o) => o.id === look[f]));
    saveMyLook({ ...look, [f]: opts[(i + d + opts.length) % opts.length].id });
  };
  $('quick-parts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-part]');
    if (b) stepPart(b.dataset.part, +b.dataset.d);
  });
  const stepKind = (dlt) => {
    const look = myLook();
    if (!look) return;
    const kinds = optionsFor('kind').length ? optionsFor('kind').map((o) => o.id) : KINDS;
    const i = Math.max(0, kinds.indexOf(look.kind));
    const kind = kinds[(i + dlt + kinds.length) % kinds.length];
    // a new kind brings its own ears and wings, but keeps your colours and hat
    const base = Looks().clean({ kind });
    saveMyLook({ ...look, kind, ears: base.ears, wings: base.wings });
  };
  $('kind-prev').addEventListener('click', () => stepKind(-1));
  $('kind-next').addEventListener('click', () => stepKind(1));
  $('customize').addEventListener('click', () => Looks()?.openEditor?.((look) => saveMyLook(look || myLook())));
  const showSide = (which) => {
    $('side-bat').hidden = which !== 'bat';
    $('side-rules').hidden = which !== 'rules';
    document.querySelectorAll('[data-side]').forEach((b) => { b.classList.toggle('on', b.dataset.side === which); b.setAttribute('aria-pressed', String(b.dataset.side === which)); });
    paintBats(0);
  };
  document.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => showSide(b.dataset.side)));
  showSide('bat');
  (function batLoop() {
    let last = performance.now();
    const tick = (now) => {
      requestAnimationFrame(tick);
      if (now - last < 40) return;
      paintBats(Math.min(0.1, (now - last) / 1000));
      last = now;
    };
    requestAnimationFrame(tick);
  })();
  addEventListener('resize', () => paintBats(0));

  // ---- power-up picker
  function renderPowers() {
    const list = powerList(), edit = canEdit();
    $('powers-list').innerHTML = list.length ? list.map((p) => `<button type="button" class="power ${pick.powers.on[p.id] !== false ? 'on' : ''}" data-power="${p.id}" style="--pc: ${p.color || '#ffd23f'}" ${edit ? '' : 'disabled'} aria-pressed="${pick.powers.on[p.id] !== false}">`
      + `<i>${p.icon || '★'}</i><b>${p.name}</b><small>${p.desc || ''}</small></button>`).join('')
      : '<p class="small">Power-ups are on.</p>';
    document.querySelectorAll('[data-freq]').forEach((b) => { const on = b.dataset.freq === pick.powers.freq; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.disabled = !edit; });
  }
  $('powers-open').addEventListener('click', () => { renderPowers(); $('powers-screen').hidden = false; });
  $('powers-done').addEventListener('click', () => { $('powers-screen').hidden = true; });
  $('powers-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-power]');
    if (!b || !canEdit()) return;
    pick.powers.on[b.dataset.power] = pick.powers.on[b.dataset.power] === false;
    store.set('echo-powers', pick.powers);
    renderPowers(); changed();
  });
  document.querySelectorAll('[data-freq]').forEach((b) => b.addEventListener('click', () => {
    if (!canEdit()) return;
    pick.powers.freq = b.dataset.freq;
    store.set('echo-powers', pick.powers);
    renderPowers(); changed();
  }));

  // net.js tells the lobby when a room opens, changes or closes, and gets told about setting changes
  const lobby = {
    pick,
    get room() { return room; },
    get cpuSeed() { return cpuSeed; },
    onChange: null,
    onLook: null,
    myLook,
    seatLooks,
    levelsBySlot,
    setRoom(r) {
      const wasGuest = room?.role === 'guest';
      room = r;
      if (!r && wasGuest) { Object.assign(pick, savedPick()); cpuSeed = Math.floor(Math.random() * 1e6); }   // back to your own settings
      renderPickers();
    },
    applyHost(s) {   // a guest mirrors the host's settings
      for (const k of ['cpus', 'level', 'arenaId', 'rule', 'firstTo', 'variant', 'cpuSeed']) if (s[k] != null) (k === 'cpuSeed' ? (cpuSeed = s[k]) : (pick[k] = s[k]));
      if (Array.isArray(s.cpuLevels)) pick.cpuLevels = s.cpuLevels.map((l) => (LEVEL_NAMES[l] ? l : 'normal'));
      if (s.powers) pick.powers = cleanPowers(s.powers);
      renderPickers();
    },
  };
  lobby.arenaOpts = arenaOpts;
  window.EchoLobby = lobby;
  const changed = () => { renderPickers(); lobby.onChange?.(); };
  const openLobby = (rule) => {
    if (rule && canEdit()) { pick.rule = rule; store.set('echo-rule', rule); }
    showOverlay('battle');
    changed();
    renderMyBat();
  };
  $('seats').addEventListener('click', (e) => {
    if (!canEdit()) return;
    const n = people().length;
    const add = e.target.closest('[data-add]'), rm = e.target.closest('[data-remove]'), lv = e.target.closest('[data-lv]');
    if (e.target.closest('[data-invite]')) { if (room) window.EchoNet?.invite?.(); else window.EchoNet?.createRoom?.(); return; }
    if (add) pick.cpus = Math.min(4 - n, pick.cpus + 1);
    else if (rm) {   // take that CPU out; the ones after it move up a seat
      const j = +rm.dataset.remove - n;
      pick.cpuLevels.splice(j, 1); pick.cpuLevels.push('normal');
      pick.cpus = Math.max(0, pick.cpus - 1);
    } else if (lv) {
      const j = +lv.dataset.seat - n, i = LEVELS.indexOf(pick.cpuLevels[j] || 'normal');
      pick.cpuLevels[j] = LEVELS[Math.max(0, Math.min(2, i + +lv.dataset.lv))];
      store.set('echo-cpu-levels', pick.cpuLevels);
    } else return;
    store.set('echo-cpus', pick.cpus);
    store.set('echo-cpu-levels', pick.cpuLevels);
    changed();
  });
  document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => {
    if (!canEdit()) return;
    pick.level = b.dataset.level; store.set('echo-cpu-level', pick.level); changed();
  }));
  document.querySelectorAll('[data-first]').forEach((b) => b.addEventListener('click', () => {
    if (!canEdit()) return;
    pick.firstTo = +b.dataset.first; store.set('echo-first-to', pick.firstTo); changed();
  }));
  document.querySelectorAll('[data-rule]').forEach((b) => b.addEventListener('click', () => {
    if (!canEdit()) return;
    pick.rule = b.dataset.rule; store.set('echo-rule', pick.rule); changed();
  }));
  document.querySelectorAll('[data-variant]').forEach((b) => b.addEventListener('click', () => {
    if (!canEdit()) return;
    pick.variant = b.dataset.variant; store.set('echo-coop-variant', pick.variant); changed();
  }));
  const stepArena = (d) => {
    if (!canEdit()) return;
    const i = Math.max(0, ARENA_CHOICES.findIndex((x) => x.id === pick.arenaId));
    pick.arenaId = ARENA_CHOICES[(i + d + ARENA_CHOICES.length) % ARENA_CHOICES.length].id;
    store.set('echo-arena', pick.arenaId);
    changed();
  };
  $('arena-prev').addEventListener('click', () => stepArena(-1));
  $('arena-next').addEventListener('click', () => stepArena(1));
  renderPickers();
  renderMyBat();
  // everything a match needs from the lobby, offline or as the host
  lobby.matchOpts = () => ({
    cpus: pick.cpus, level: pick.level, levels: levelsBySlot(), looks: seatLooks(),
    ...(pick.rule === 'coop' ? { variant: pick.variant } : { ...arenaOpts(pick), rule: pick.rule, firstTo: pick.firstTo, powerups: pick.powers }),
  });
  $('duel-start').addEventListener('click', () => {
    if (room?.role === 'host') window.EchoNet.startMatch();
    else if (!room && pick.rule === 'coop') startCoop({ mode: 'local', humans: 1, ...lobby.matchOpts() });
    else if (!room && pick.cpus > 0) startDuel({ mode: 'local', humans: 1, ...lobby.matchOpts() });
  });
  $('duel-back').addEventListener('click', () => {
    if (room) window.EchoNet.leave();
    else { window.EchoNet?.clearStatus?.(); showOverlay('title'); }
  });
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
    window.EchoCoop?.setView(v);
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
  window.EchoGame = { startDuel, startCoop, showEnd: (r, o) => (duelCfg.coop ? endCoop(r, o) : endDuel(r, o)), showOverlay };

  function updateBests() {
    // Explore: which cave is next, and the stars earned across all three
    const n = window.ECHO_LEVELS.length, next = Math.min(n - 1, store.get('echo-caves-next') || 0);
    const stars = window.ECHO_LEVELS.reduce((t, _, i) => t + (store.get('echo-caves-best-' + i) || 0), 0);
    $('best-cave').textContent = stars ? `Cave ${next + 1} of ${n} · ${stars}/${n * 3} ★` : `${n} caves to explore`;
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
    const fighting = mode === 'duel' && state === 'duel' && engine().active && !engine().over;
    if (portrait.matches || document.hidden) music.set(false);
    else music.set(state === 'play' ? (mode === 'run' ? 'run' : 'explore') : fighting ? (duelCfg.coop ? 'run' : 'battle') : 'lobby');
    $('pause-button').hidden = !inMatch() || pauseOpen;
    const frozen = paused || portrait.matches || document.hidden;
    if (mode === 'duel' && state === 'duel') {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (!portrait.matches && !document.hidden) engine().frame(frozen ? 0 : dt, ctx, W, H);
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
    start: (m = 'cave', i = 0) => startGame(m, i),
    squeak,
    // Explore checkpoints and hidden hearts
    get checkpoint() { return checkpoint; },
    get pops() { return pops; },
    hurt: () => hurt(moka.x + 1, moka.y),
    restartFromCheckpoint,
    primary: primaryAction,
  };
})();
