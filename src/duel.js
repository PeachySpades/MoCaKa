// Bat Brawl: 2 to 4 bats in a pitch-dark arena. A squeak lights the walls
// and stuns any rival it hits; fly into a stunned bat to eat it. First to 3
// bites wins. Bats can dash, grab power-ups, and every so often the cave
// shifts into a new arena.
//
// It runs in three modes:
//   local   everyone on one device (split touch zones / shared keyboard) + CPU bats
//   host    this device simulates the match for an online room and streams snapshots
//   client  this device shows snapshots from the host and sends its own input
(() => {
  'use strict';

  const R = 0.3, ACCEL = 30, MAX_SPEED = 4.6, DRAG = 3.4;
  const RING_SPEED = 11, RING_MAX = 7, MEGA_RING = 11, COOLDOWN = 0.45, FRENZY_COOLDOWN = 0.22;
  const STUN_TIME = 1.8, MEGA_STUN = 2.6, SPAWN_SAFE = 1.6, RESPAWN_DELAY = 1.4;
  const START_ECHOES = 4, MAX_ECHOES = 6, CRYSTAL_ECHOES = 2;
  const DASH_SPEED = 12, DASH_TIME = 0.16, DASH_COOLDOWN = 1.6;
  const WIN_SCORE = 3;
  // Sonic beam: hold squeak to charge, let go to fire a narrow beam straight
  // ahead (the way you're flying). It reaches much farther than a ring and
  // stuns longer, but costs 2 echoes and misses anything off to the side.
  // Letting go early just squeaks as usual.
  const BEAM_CHARGE = 0.7, BEAM_LEN = 15, BEAM_WIDTH = 0.3, BEAM_STUN = 2.3, BEAM_COST = 2, BEAM_LIFE = 0.4, BEAM_COOLDOWN = 0.8, CHARGE_SLOW = 0.55;
  const SHIFT_FADE = 0.9, OPEN_SKY_CHANCE = 0.3;
  // Arena modes, picked before a match:
  //   shift  every 25s the cave jumps to the next arena (sometimes Open Sky)
  //   morph  the cave slowly reshapes itself, a few walls at a time, into the next one
  //   chaos  the cave jumps every 9 seconds
  //   sky    Open Sky the whole match: no cave at all
  const ARENA_MODES = {
    shift: { every: 25, warning: 3 },
    morph: { every: 0 },
    chaos: { every: 9, warning: 2 },
    sky: { every: 0 },
  };
  const MORPH_STEP = 0.3, MORPH_PAUSE = 5, NO_SHIFT = 9999;
  let arenaMode = 'shift';
  const shiftEvery = () => ARENA_MODES[arenaMode].every || NO_SHIFT;
  const shiftWarning = () => ARENA_MODES[arenaMode].warning || 0;
  const EAT_PULL = 0.35, EAT_TIME = 1.1;
  const SNAPSHOT_EVERY = 0.05;
  const POWERS = {
    mega: { label: 'MEGA SCREECH', rgb: '255, 226, 120' },
    speed: { label: 'SPEED', rgb: '120, 255, 170' },
    shield: { label: 'SHIELD', rgb: '150, 240, 255' },
    frenzy: { label: 'ECHO FRENZY', rgb: '255, 120, 200' },
  };
  const POWER_TYPES = Object.keys(POWERS);
  const BATS = [
    { name: 'Mo', color: '#8b6cff', rgb: '139, 108, 255' },
    { name: 'Ka', color: '#ff7ad9', rgb: '255, 122, 217' },
    { name: 'Ca', color: '#9dff6a', rgb: '157, 255, 106' },
    { name: 'Bo', color: '#ffb347', rgb: '255, 179, 71' },
  ];
  // keys for each local player slot on a shared keyboard
  const KEYMAP = [
    { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], squeak: ['KeyF', 'Space'], dash: ['KeyG', 'ShiftLeft'] },
    { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], squeak: ['Enter', 'Slash'], dash: ['ShiftRight', 'Period'] },
    { up: ['KeyI'], down: ['KeyK'], left: ['KeyJ'], right: ['KeyL'], squeak: ['KeyH'], dash: ['KeyU'] },
    { up: ['Numpad8'], down: ['Numpad5'], left: ['Numpad4'], right: ['Numpad6'], squeak: ['Numpad0', 'NumpadEnter'], dash: ['NumpadAdd'] },
  ];

  // ---- Arena -------------------------------------------------------------
  // Caves rotate in order; now and then a shift opens onto the wall-less Open Sky instead.
  let arena, arenaIndex = 0, lastCave = 0;
  const arenaKinds = (open) => window.ECHO_ARENAS.map((a, i) => (!!a.open === open ? i : -1)).filter((i) => i >= 0);
  function nextArenaIndex() {
    const caves = arenaKinds(false), skies = arenaKinds(true);
    if (!arena.def.open && skies.length && Math.random() < OPEN_SKY_CHANCE) return skies[Math.floor(Math.random() * skies.length)];
    return caves[(caves.indexOf(lastCave) + 1) % caves.length];
  }
  function loadArena(i) {
    const n = window.ECHO_ARENAS.length;
    arenaIndex = ((i % n) + n) % n;
    const def = window.ECHO_ARENAS[arenaIndex];
    if (!def.open) lastCave = arenaIndex;
    const h = def.map.length, w = def.map[0].length;
    const a = { def, theme: def.theme, w, h, grid: new Uint8Array(w * h), spawns: [], crystalSpots: [], open: [] };
    def.map.forEach((row, y) => [...row].forEach((c, x) => {
      a.grid[y * w + x] = c === '#' ? 1 : 0;
      if (c !== '#') a.open.push({ x: x + 0.5, y: y + 0.5 });
      if ('ABCD'.includes(c)) a.spawns.push({ x: x + 0.5, y: y + 0.5, key: c });
      if (c === 'e') a.crystalSpots.push({ x: x + 0.5, y: y + 0.5 });
    }));
    a.spawns.sort((p, q) => p.key.localeCompare(q.key));
    arena = a;
    lit = new Float32Array(w * h);
    litBy = new Uint8Array(w * h);
    tileGlow = new Float32Array(w * h);
    crystals = a.crystalSpots.map((c) => ({ ...c, on: false, timer: 0.5 + Math.random() * 2.5, phase: Math.random() * 6 }));
    powerups = [];
    ambient = Array.from({ length: 46 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      v: 0.3 + Math.random() * 0.7, phase: Math.random() * 6, size: 0.04 + Math.random() * 0.06,
    }));
  }
  const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= arena.w || ty >= arena.h || arena.grid[ty * arena.w + tx] === 1;
  const litAt = (x, y) => {
    const tx = Math.floor(x), ty = Math.floor(y);
    return tx < 0 || ty < 0 || tx >= arena.w || ty >= arena.h ? 0 : lit[ty * arena.w + tx];
  };
  function hitsWall(px, py, r) {
    for (let ty = Math.floor(py - r); ty <= Math.floor(py + r); ty++) {
      for (let tx = Math.floor(px - r); tx <= Math.floor(px + r); tx++) {
        if (!solid(tx, ty)) continue;
        const nx = Math.max(tx, Math.min(px, tx + 1)), ny = Math.max(ty, Math.min(py, ty + 1));
        if ((px - nx) ** 2 + (py - ny) ** 2 < r * r) return true;
      }
    }
    return false;
  }
  function updateAmbient(dt) {
    const kind = arena.theme.ambient;
    for (const p of ambient) {
      p.phase += dt;
      if (kind === 'ember') { p.y -= p.v * 0.8 * dt; p.x += Math.sin(p.phase * 2) * 0.3 * dt; }
      else if (kind === 'snow') { p.y += p.v * 0.6 * dt; p.x += Math.sin(p.phase) * 0.4 * dt; }
      else if (kind === 'firefly') { p.x += Math.cos(p.phase * 0.9) * 0.5 * dt; p.y += Math.sin(p.phase * 1.3) * 0.35 * dt; }
      else if (kind === 'spore') { p.x += Math.cos(p.phase * 0.7) * 0.25 * dt; p.y += Math.sin(p.phase * 0.5) * 0.2 * dt; }
      if (p.y < 0) p.y += arena.h;
      if (p.y > arena.h) p.y -= arena.h;
      if (p.x < 0) p.x += arena.w;
      if (p.x > arena.w) p.x -= arena.w;
    }
  }

  // ---- State -------------------------------------------------------------
  let paused = false;
  let active = false, mode = 'local', viewer = -1, net = null, onEnd = null;
  let localCount = 1;                    // humans on this device (local mode)
  let beams = [], beamId = 0;
  let bats = [], rings = [], crystals = [], powerups = [], particles = [], popups = [], eats = [], ambient = [];
  let lit, litBy;
  let clock = 0, countdown = 0, over = false, banner = null, shiftTimer = NO_SHIFT, shift = null, morph = null, tileGlow = null;
  let slowmo = 0, shake = 0, powerTimer = 6, snapTimer = 0, outbox = [], ringId = 0, ended = false;
  const remoteInput = new Map();         // slot -> { ix, iy }

  function makeBat(i, ctrl, localSlot) {
    return {
      i, ...BATS[i], ctrl, local: localSlot, x: 0, y: 0, vx: 0, vy: 0, face: 1,
      echoes: START_ECHOES, cooldown: 0, stun: 0, safe: 0, dead: 0, score: 0, seen: 0, mouth: 0, puff: 0,
      dashCd: 0, dashT: 0, power: null, powerT: 0, mega: false, shield: false, charging: false, charge: 0,
      ai: ctrl === 'cpu' ? { path: [], repath: 0, think: Math.random() * 0.3, wander: null } : null,
    };
  }

  // o: { mode, humans, cpus, remotes, mySlot, net, onEnd }
  function start(o = {}) {
    mode = o.mode || 'local';
    net = o.net || null;
    onEnd = o.onEnd || null;
    cpuLevel = CPU_LEVELS[o.level] || CPU_LEVELS.normal;
    arenaMode = ARENA_MODES[o.arenaMode] ? o.arenaMode : 'shift';
    bats = [];
    if (mode === 'local') {
      localCount = Math.max(1, Math.min(4, o.humans || 1));
      let cpus = Math.max(0, Math.min(4 - localCount, o.cpus ?? 1));
      if (localCount + cpus < 2) cpus = 1;
      for (let i = 0; i < localCount; i++) bats.push(makeBat(i, 'local', i));
      for (let k = 0; k < cpus; k++) bats.push(makeBat(bats.length, 'cpu'));
      viewer = -1;
    } else if (mode === 'host') {
      localCount = 1;
      bats.push(makeBat(0, 'local', 0));
      for (let k = 0; k < (o.remotes || 0); k++) bats.push(makeBat(bats.length, 'remote'));
      for (let k = 0; k < (o.cpus || 0) && bats.length < 4; k++) bats.push(makeBat(bats.length, 'cpu'));
      viewer = 0;
    } else {
      localCount = 1;
      viewer = o.mySlot;
      for (let i = 0; i < (o.total || 2); i++) bats.push(makeBat(i, i === o.mySlot ? 'local' : 'remote', 0));
    }
    const caves = arenaKinds(false);
    loadArena(arenaMode === 'sky' ? arenaKinds(true)[0] : mode === 'client' ? caves[0] : caves[Math.floor(Math.random() * caves.length)]);
    morph = arenaMode === 'morph' && mode !== 'client' ? { target: -1, timer: 0, pause: MORPH_PAUSE } : null;
    bats.forEach((b, k) => {
      const s = arena.spawns[k];
      b.x = s.x; b.y = s.y; b.face = s.x < arena.w / 2 ? 1 : -1;
    });
    rings = []; beams = []; particles = []; popups = []; eats = []; outbox = [];
    remoteInput.clear();
    clock = 0; countdown = 3; over = false; ended = false; shift = null; slowmo = 0; shake = 0;
    shiftTimer = shiftEvery(); powerTimer = 6 + Math.random() * 3; snapTimer = 0;
    banner = mode === 'client' ? null : { text: arena.def.name, rgb: arena.theme.wall, t: 3.2 };
    keys.clear();
    sticks.clear();
    chargers.clear();
    active = true;
  }
  function stop() { active = false; }

  // Effects are applied here and, when hosting, also streamed to the room
  function fx(ev) {
    applyFx(ev);
    if (mode === 'host') outbox.push(ev);
  }
  function applyFx(ev) {
    const s = (window.EchoAudio && window.EchoAudio.sfx) || {};
    if (ev.k === 'sfx') s[ev.n]?.();
    else if (ev.k === 'burst') burst(ev.x, ev.y, ev.rgb, ev.n, ev.sp || 3, ev.sz || 4);
    else if (ev.k === 'popup') popups.push({ x: ev.x, y: ev.y, text: ev.text, rgb: ev.rgb, t: 0, life: ev.life || 0.9, big: !!ev.big });
    else if (ev.k === 'shake') shake = Math.max(shake, ev.v);
    else if (ev.k === 'banner') banner = { text: ev.text, rgb: ev.rgb, t: ev.t };
    else if (ev.k === 'feathers') {
      for (let k = 0; k < 4; k++) particles.push({ x: ev.x, y: ev.y, vx: ev.face * (1 + Math.random()), vy: -0.5 - Math.random(), life: 1, rgb: ev.rgb, size: 6, feather: true });
    } else if (ev.k === 'slowmo') slowmo = ev.t;
    else if (ev.k === 'tiles') for (const [k, v] of ev.c) { if (arena.grid[k] !== v) { arena.grid[k] = v; tileGlow[k] = 1; } }
  }
  function burst(x, y, rgb, n, speed = 3, size = 4) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * speed;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.6, rgb, size });
    }
  }

  // ---- Input -------------------------------------------------------------
  const keys = new Set();
  const sticks = new Map();      // pointerId -> stick owned by a local player slot
  const STICK_RANGE = 56;
  const chargers = new Map();    // pointerId -> slot, for a second finger held down to charge a beam
  const canvas = document.getElementById('game');
  let W = 0, H = 0;

  const localBat = (slot) => bats.find((b) => b.ctrl === 'local' && b.local === slot);
  // with one person on this device, either of the first two key sets works
  const keysFor = (slot, what) => (localCount === 1 && slot === 0) ? [...KEYMAP[0][what], ...KEYMAP[1][what]] : KEYMAP[slot][what];

  addEventListener('keydown', (e) => {
    if (!active || paused) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    for (let slot = 0; slot < localCount; slot++) {
      if (keysFor(slot, 'squeak').includes(e.code)) act(slot, 'charge');
      if (keysFor(slot, 'dash').includes(e.code)) act(slot, 'dash');
    }
  });
  addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (!active) return;
    for (let slot = 0; slot < localCount; slot++) {
      const sq = keysFor(slot, 'squeak');
      if (sq.includes(e.code) && !sq.some((k) => keys.has(k))) act(slot, 'release');
    }
  });
  addEventListener('blur', () => { keys.clear(); sticks.clear(); chargers.clear(); });

  // A dash button for the single-player-per-device layouts, on touch screens
  let touchUsed = matchMedia('(pointer: coarse)').matches;
  // kept well above the bottom-right corner, where hosting badges like to sit
  const dashButton = () => ({ x: W - 64, y: H - Math.max(124, H * 0.3), r: 42 });
  const inDashButton = (cx, cy) => {
    if (localCount !== 1) return false;
    const rect = canvas.getBoundingClientRect(), b = dashButton();
    return Math.hypot(cx - rect.left - b.x, cy - rect.top - b.y) < b.r + 8;
  };

  // Touch zones: one player owns the screen, 2–3 split it into columns, 4 into quarters
  function zoneAt(clientX, clientY) {
    const n = localCount;
    if (n === 1) return 0;
    const rect = canvas.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width, fy = (clientY - rect.top) / rect.height;
    if (n === 4) return (fy < 0.5 ? 0 : 2) + (fx < 0.5 ? 0 : 1);
    return Math.min(n - 1, Math.floor(fx * n));
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    e.preventDefault();
    window.EchoAudio?.unlock();
    if (e.pointerType === 'touch') touchUsed = true;
    if (touchUsed && inDashButton(e.clientX, e.clientY)) { act(0, 'dash'); return; }
    const owner = zoneAt(e.clientX, e.clientY);
    if ([...sticks.values()].some((s) => s.owner === owner)) { chargers.set(e.pointerId, owner); act(owner, 'charge'); return; }
    sticks.set(e.pointerId, { owner, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), moved: false });
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const s = sticks.get(e.pointerId);
    if (!s) return;
    s.x = e.clientX; s.y = e.clientY;
    if (Math.hypot(s.x - s.sx, s.y - s.sy) > 14) s.moved = true;
  });
  const endStick = (e) => {
    if (chargers.has(e.pointerId)) { act(chargers.get(e.pointerId), 'release'); chargers.delete(e.pointerId); return; }
    const s = sticks.get(e.pointerId);
    if (!s) return;
    const dt = performance.now() - s.t, dx = s.x - s.sx, dy = s.y - s.sy, d = Math.hypot(dx, dy);
    if (!s.moved && dt < 280) act(s.owner, 'squeak');
    else if (dt < 230 && d > 30) act(s.owner, 'dash', dx / d, dy / d);   // a quick flick dashes
    sticks.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', endStick);
  canvas.addEventListener('pointercancel', endStick);

  function localInput(slot) {
    let ix = 0, iy = 0;
    const down = (w) => keysFor(slot, w).some((k) => keys.has(k));
    if (down('left')) ix -= 1;
    if (down('right')) ix += 1;
    if (down('up')) iy -= 1;
    if (down('down')) iy += 1;
    for (const s of sticks.values()) {
      if (s.owner !== slot) continue;
      const dx = s.x - s.sx, dy = s.y - s.sy, len = Math.hypot(dx, dy);
      if (len > 8) { const m = Math.min(len / STICK_RANGE, 1); ix += (dx / len) * m; iy += (dy / len) * m; }
    }
    const len = Math.hypot(ix, iy);
    return len > 1 ? { ix: ix / len, iy: iy / len } : { ix, iy };
  }

  // A local player pressed squeak or dash
  function act(slot, a, dx, dy) {
    if (paused) return;
    const b = localBat(slot);
    if (!b) return;
    if (mode === 'client') {
      net?.send({ t: 'act', a, dx, dy });
      if (a === 'squeak' && b.echoes <= 0) applyFx({ k: 'sfx', n: 'empty' });
      return;
    }
    doAct(b, a, dx, dy);
  }
  function doAct(b, a, dx, dy) {
    if (a === 'squeak') squeak(b);
    else if (a === 'charge') startCharge(b);
    else if (a === 'release') releaseCharge(b);
    else if (a === 'dash') dash(b, dx, dy);
  }

  // ---- Online hooks (host side) -----------------------------------------
  function remote(slot, msg) {
    const b = bats[slot];
    if (!b || b.ctrl !== 'remote' || mode !== 'host') return;
    if (msg.t === 'in') remoteInput.set(slot, { ix: +msg.ix || 0, iy: +msg.iy || 0 });
    else if (msg.t === 'act' && ['squeak', 'charge', 'release', 'dash'].includes(msg.a)) doAct(b, msg.a, msg.dx, msg.dy);
  }
  function dropRemote(slot) {
    const b = bats[slot];
    if (!b || b.ctrl !== 'remote') return;
    // a player who leaves is replaced by a CPU bat so the match can go on
    b.ctrl = 'cpu';
    b.ai = { path: [], repath: 0, think: 0, wander: null };
    fx({ k: 'banner', text: `${b.name} left, a CPU takes over`, rgb: b.rgb, t: 2 });
  }

  // ---- CPU bats ----------------------------------------------------------
  function bfsPath(fromX, fromY, toX, toY) {
    const { w, h } = arena;
    const sx = Math.floor(fromX), sy = Math.floor(fromY), gx = Math.floor(toX), gy = Math.floor(toY);
    if ((sx === gx && sy === gy) || solid(gx, gy)) return [];
    const prev = new Int32Array(w * h).fill(-1);
    const q = [sy * w + sx];
    prev[q[0]] = q[0];
    for (let k = 0; k < q.length; k++) {
      const c = q[k], cx = c % w, cy = (c / w) | 0;
      if (cx === gx && cy === gy) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, n = ny * w + nx;
        if (!solid(nx, ny) && prev[n] < 0) { prev[n] = c; q.push(n); }
      }
    }
    const goal = gy * w + gx;
    if (prev[goal] < 0) return [];
    const path = [];
    for (let c = goal; c !== prev[c]; c = prev[c]) path.push({ x: (c % w) + 0.5, y: ((c / w) | 0) + 0.5 });
    return path.reverse();
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // CPU levels. CPUs play fair: like you, they only know where a rival is
  // when sound shows it (a lit spot, a squeak or dash they hear, a stunned
  // bat's dizzy stars) or it's right next to them. Otherwise they hunt from
  // the last place they noticed it, or roam and squeak to look around.
  const CPU_LEVELS = {
    easy: { speed: 0.72, think: 0.65, squeak: 0.22, beam: 0, aimErr: 0, dash: 0.25, sense: 1.6, memory: 1.5, search: 0.08, power: 3 },
    normal: { speed: 0.86, think: 0.42, squeak: 0.35, beam: 0.25, aimErr: 0.16, dash: 0.5, sense: 2.2, memory: 3, search: 0.15, power: 5 },
    hard: { speed: 1, think: 0.26, squeak: 0.5, beam: 0.5, aimErr: 0.06, dash: 0.75, sense: 2.8, memory: 4.5, search: 0.25, power: 7 },
  };
  let cpuLevel = CPU_LEVELS.normal;
  function randomOpenSpot() {
    const spots = arena.open.filter((p) => !solid(Math.floor(p.x), Math.floor(p.y)));
    return spots[Math.floor(Math.random() * spots.length)];
  }
  function cpuInput(b, dt) {
    const ai = b.ai, lv = cpuLevel;
    ai.known = ai.known || new Map();
    const foes = bats.filter((o) => o !== b && !o.dead);
    if (!foes.length) return { ix: 0, iy: 0 };
    // what this bat can perceive right now
    for (const o of foes) {
      const noticed = o.stun > 0 || o.seen > 0.25 || litAt(o.x, o.y) > 0.35 || dist(o, b) < lv.sense;
      if (noticed) ai.known.set(o.i, { x: o.x, y: o.y, vx: o.vx, vy: o.vy, age: 0, bat: o });
    }
    for (const [i, k] of ai.known) {
      k.age += dt;
      if (k.age > lv.memory || k.bat.dead) ai.known.delete(i);
    }
    const known = [...ai.known.values()].sort((p, q) => dist(p, b) - dist(q, b));
    const fresh = known.filter((k) => k.age < 0.4);
    const snack = foes.find((o) => o.stun > 0 && dist(o, b) < 9);
    let target = snack;
    if (!target) target = powerups.filter((p) => dist(p, b) < lv.power && litAt(p.x, p.y) + (dist(p, b) < 2.5 ? 1 : 0) > 0.2).sort((p, q) => dist(p, b) - dist(q, b))[0];
    if (!target && b.echoes === 0) target = crystals.filter((c) => c.on).sort((p, q) => dist(p, b) - dist(q, b))[0];
    if (!target && known.length) {
      // head for where a rival was last noticed, circling a little
      if (!ai.wander || Math.random() < dt * 0.4) ai.wander = { dx: (Math.random() - 0.5) * 4, dy: (Math.random() - 0.5) * 3 };
      const k = known[0];
      target = { x: k.x + ai.wander.dx * Math.min(1, k.age), y: k.y + ai.wander.dy * Math.min(1, k.age) };
      if (solid(Math.floor(target.x), Math.floor(target.y))) target = k;
    }
    if (!target) {
      // nobody noticed: roam the cave
      if (!ai.roam || dist(ai.roam, b) < 1 || Math.random() < dt * 0.25) ai.roam = randomOpenSpot() || { x: b.x, y: b.y };
      target = ai.roam;
    }
    ai.repath -= dt;
    if (ai.repath <= 0) { ai.path = bfsPath(b.x, b.y, target.x, target.y); ai.repath = 0.25; }
    while (ai.path.length && Math.hypot(ai.path[0].x - b.x, ai.path[0].y - b.y) < 0.35) ai.path.shift();
    const next = ai.path[0] || target;
    const dx = next.x - b.x, dy = next.y - b.y, len = Math.hypot(dx, dy) || 1;

    // a charged beam fires where the target was last noticed (or fizzles into a squeak if it's gone)
    if (b.charging && ai.beamAt) {
      if (b.charge >= BEAM_CHARGE) {
        const k = ai.known.get(ai.beamAt.i);
        b.charging = false; b.charge = 0; ai.beamAt = null;
        if (k) {
          const lead = lv.aimErr < 0.1 ? 0.25 : 0;   // hard CPUs lead a moving target a little
          const ax = k.x + k.vx * lead - b.x, ay = k.y + k.vy * lead - b.y, d = Math.hypot(ax, ay) || 1;
          const err = (Math.random() - 0.5) * 2 * lv.aimErr, c = Math.cos(err), sn = Math.sin(err);
          const ux = (ax * c - ay * sn) / d, uy = (ax * sn + ay * c) / d;
          if (d < BEAM_LEN && castRay(b.x, b.y, ux, uy, d) >= d - 0.3) fireBeam(b, { ux, uy });
          else squeak(b);
        } else squeak(b);
      }
    }
    ai.think -= dt;
    if (ai.think <= 0) {
      ai.think = lv.think * (0.8 + Math.random() * 0.4);
      const canShoot = b.echoes > 0 || b.power === 'frenzy';
      if (lv.beam && !b.charging && !snack && (b.echoes >= BEAM_COST || b.power === 'frenzy') && b.cooldown <= 0) {
        const far = fresh.find((k) => k.bat.safe <= 0 && k.bat.stun <= 0 && dist(k, b) > RING_MAX * 0.7 && dist(k, b) < BEAM_LEN - 2
          && castRay(b.x, b.y, (k.x - b.x) / dist(k, b), (k.y - b.y) / dist(k, b), dist(k, b)) >= dist(k, b) - 0.3);
        if (far && Math.random() < lv.beam) { ai.beamAt = far.bat; startCharge(b); }
      }
      const shootable = fresh.some((k) => k.bat.safe <= 0 && k.bat.stun <= 0 && dist(k, b) < RING_MAX * 0.7);
      if (shootable && !b.charging && canShoot && Math.random() < lv.squeak) squeak(b);
      // lost everyone: sometimes squeak just to look around
      else if (!known.length && !b.charging && b.echoes > 2 && Math.random() < lv.search) squeak(b);
      if (snack && dist(snack, b) < 4 && b.dashCd <= 0 && Math.random() < lv.dash) dash(b, dx / len, dy / len);
    }
    const speed = (snack ? 1 : 0.85) * lv.speed;
    return { ix: (dx / len) * speed, iy: (dy / len) * speed };
  }

  // ---- Actions -----------------------------------------------------------
  const canAct = (b) => active && b && countdown <= 0 && !over && !shift && !b.dead && b.stun <= 0;

  function squeak(b) {
    if (!canAct(b) || b.cooldown > 0) return;
    const frenzy = b.power === 'frenzy';
    b.cooldown = frenzy ? FRENZY_COOLDOWN : COOLDOWN;
    if (!frenzy && b.echoes <= 0) { if (b.ctrl === 'local') applyFx({ k: 'sfx', n: 'empty' }); return; }
    if (!frenzy) b.echoes--;
    b.seen = 1;
    const mega = b.mega;
    b.mega = false;
    rings.push({ id: ++ringId, x: b.x, y: b.y, r: 0, owner: b.i, hit: new Set(), max: mega ? MEGA_RING : RING_MAX, stun: mega ? MEGA_STUN : STUN_TIME, big: mega });
    fx({ k: 'sfx', n: mega ? 'crash' : 'squeak' });
  }

  function startCharge(b) {
    if (!canAct(b) || b.charging) return;
    b.charging = true; b.charge = 0; b.chargeSfx = false;
  }
  function releaseCharge(b) {
    if (!b || !b.charging) return;
    const full = b.charge >= BEAM_CHARGE;
    b.charging = false; b.charge = 0;
    if (!full) { squeak(b); return; }
    fireBeam(b);
  }
  // which way a bat is pointing: where it's flying, or where it faces when still
  function heading(b) {
    const sp = Math.hypot(b.vx, b.vy);
    return sp > 0.6 ? { ux: b.vx / sp, uy: b.vy / sp } : { ux: b.face, uy: 0 };
  }
  // walk a line until it hits a wall; returns how far it got
  function castRay(x, y, ux, uy, max) {
    let t = 0;
    while (t < max) { t += 0.1; if (solid(Math.floor(x + ux * t), Math.floor(y + uy * t))) return t - 0.1; }
    return max;
  }
  function fireBeam(b, aim) {
    if (!canAct(b) || b.cooldown > 0) return;
    const frenzy = b.power === 'frenzy';
    if (!frenzy && b.echoes < BEAM_COST) { squeak(b); return; }   // can't afford it: a plain squeak instead
    if (!frenzy) b.echoes -= BEAM_COST;
    b.cooldown = BEAM_COOLDOWN;
    b.seen = 1;
    const { ux, uy } = aim || heading(b);
    if (Math.abs(ux) > 0.2) b.face = Math.sign(ux);
    const len = castRay(b.x, b.y, ux, uy, BEAM_LEN);
    const beam = { id: ++beamId, x: b.x, y: b.y, ux, uy, len, owner: b.i, t: 0 };
    beams.push(beam);
    lightBeam(beam);
    b.vx -= ux * 2.5; b.vy -= uy * 2.5;   // a little recoil
    fx({ k: 'sfx', n: 'beam' });
    fx({ k: 'shake', v: 0.12 });
    for (const foe of bats) {
      if (foe === b || foe.dead || foe.safe > 0) continue;
      const rx = foe.x - b.x, ry = foe.y - b.y, along = rx * ux + ry * uy;
      if (along < 0 || along > len + R) continue;
      if (Math.abs(rx * uy - ry * ux) > BEAM_WIDTH + R) continue;
      foe.seen = 1;
      if (foe.stun > 0) continue;
      if (foe.shield) {
        foe.shield = false;
        foe.vx = ux * 3; foe.vy = uy * 3;
        fx({ k: 'popup', x: foe.x, y: foe.y - 1, text: 'BLOCKED', rgb: POWERS.shield.rgb, life: 0.8 });
        fx({ k: 'burst', x: foe.x, y: foe.y, rgb: POWERS.shield.rgb, n: 12 });
        fx({ k: 'sfx', n: 'block' });
        continue;
      }
      foe.stun = BEAM_STUN;
      foe.dashT = 0; foe.charging = false; foe.charge = 0;
      foe.vx = ux * 5; foe.vy = uy * 5;
      fx({ k: 'burst', x: foe.x, y: foe.y, rgb: '255, 226, 120', n: 14 });
      fx({ k: 'popup', x: foe.x, y: foe.y - 1, text: 'ZAP!', rgb: b.rgb, life: 0.8 });
      fx({ k: 'sfx', n: 'stun' });
    }
  }
  function lightBeam(beam) {
    const { w } = arena;
    for (let t = 0; t <= beam.len + 0.6; t += 0.25) {
      for (const [ox2, oy2] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) {
        const tx = Math.floor(beam.x + beam.ux * t + ox2), ty = Math.floor(beam.y + beam.uy * t + oy2);
        if (tx < 0 || ty < 0 || tx >= w || ty >= arena.h) continue;
        lit[ty * w + tx] = 1; litBy[ty * w + tx] = beam.owner;
      }
    }
  }

  function dash(b, dx, dy) {
    if (!canAct(b) || b.dashCd > 0) return;
    let ux = dx, uy = dy;
    if (!(Math.hypot(ux || 0, uy || 0) > 0.1)) {
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0.5) { ux = b.vx / sp; uy = b.vy / sp; } else { ux = b.face; uy = 0; }
    }
    const len = Math.hypot(ux, uy) || 1;
    b.vx = (ux / len) * DASH_SPEED;
    b.vy = (uy / len) * DASH_SPEED;
    b.dashT = DASH_TIME;
    b.dashCd = DASH_COOLDOWN;
    b.seen = Math.max(b.seen, 0.5);
    fx({ k: 'sfx', n: 'dash' });
  }

  // The bite: the stunned bat gets slurped into the eater's open mouth,
  // CHOMP, the eater puffs up, then burps out a few feathers.
  function eat(eater, food) {
    eater.score++;
    eats.push({ eater, food: { ...food }, t: 0, chomped: false, burped: false });
    food.dead = RESPAWN_DELAY + EAT_TIME;
    food.stun = 0;
    food.power = null; food.mega = false; food.shield = false; food.charging = false; food.charge = 0;
    fx({ k: 'slowmo', t: 0.45 });
    fx({ k: 'sfx', n: 'slurp' });
    if (eater.score >= WIN_SCORE) over = true;
  }

  function updateEats(dt) {
    for (const e of eats) {
      e.t += dt;
      const b = e.eater;
      b.mouth = e.t < EAT_PULL ? Math.min(1, e.t / 0.12) : 0;
      if (!e.chomped && e.t >= EAT_PULL) {
        e.chomped = true;
        b.puff = 1;
        const mx = b.x + b.face * R * 0.4, my = b.y + R * 0.3;
        fx({ k: 'sfx', n: 'chomp' });
        fx({ k: 'shake', v: 0.25 });
        fx({ k: 'burst', x: mx, y: my, rgb: e.food.rgb, n: 22, sp: 4, sz: 5 });
        fx({ k: 'burst', x: mx, y: my, rgb: '255, 255, 255', n: 8, sp: 3, sz: 3 });
        fx({ k: 'popup', x: b.x, y: b.y - 1.1, text: 'CHOMP!', rgb: b.rgb, big: true });
      }
      if (!e.burped && e.t >= EAT_TIME - 0.3) {
        e.burped = true;
        fx({ k: 'sfx', n: 'burp' });
        fx({ k: 'popup', x: b.x + b.face * 0.5, y: b.y - 0.4, text: 'burp', rgb: '232, 236, 255', life: 0.8 });
        fx({ k: 'feathers', x: b.x + b.face * 0.4, y: b.y, face: b.face, rgb: e.food.rgb });
      }
    }
    for (const b of bats) if (b.puff > 0) b.puff = Math.max(0, b.puff - dt * 1.6);
    const done = eats.filter((e) => e.t >= EAT_TIME);
    eats = eats.filter((e) => e.t < EAT_TIME);
    if (over && !ended && !eats.length && done.length) {
      ended = true;
      const winner = done[done.length - 1].eater;
      const result = {
        winner: winner.name, winnerCpu: winner.ctrl === 'cpu', color: winner.color, humans: localCount,
        standings: bats.map((o) => ({ name: o.name, score: o.score, cpu: o.ctrl === 'cpu', color: o.color })).sort((p, q) => q.score - p.score),
      };
      setTimeout(() => { if (active && onEnd) onEnd(result); }, 600);
    }
  }

  // Morph mode: every few moments a handful of tiles turn into the next
  // arena's layout, never closing on a bat, until the whole cave has become it.
  function updateMorph(dt) {
    if (!morph) return;
    if (morph.pause > 0) { morph.pause -= dt; if (morph.pause <= 0) morph.target = nextArenaIndex(); return; }
    morph.timer -= dt;
    if (morph.timer > 0) return;
    morph.timer = MORPH_STEP;
    const def = window.ECHO_ARENAS[morph.target], { w, h, grid } = arena, diff = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (grid[y * w + x] !== (def.map[y][x] === '#' ? 1 : 0)) diff.push(y * w + x);
    }
    if (!diff.length) {
      const keepLit = lit, keepBy = litBy, keepPowers = powerups;
      loadArena(morph.target);
      lit = keepLit; litBy = keepBy; powerups = keepPowers;
      fx({ k: 'banner', text: arena.def.name, rgb: arena.theme.wall, t: 2 });
      morph.pause = MORPH_PAUSE;
      return;
    }
    const changes = [];
    for (let n = 0; n < 3 && diff.length; n++) {
      const k = diff.splice(Math.floor(Math.random() * diff.length), 1)[0];
      const v = grid[k] ? 0 : 1, cx = (k % w) + 0.5, cy = Math.floor(k / w) + 0.5;
      if (v && bats.some((b) => !b.dead && Math.abs(b.x - cx) < 1 && Math.abs(b.y - cy) < 1)) continue;
      changes.push([k, v]);
      if (v) {
        powerups = powerups.filter((p) => Math.floor(p.x) !== k % w || Math.floor(p.y) !== Math.floor(k / w));
        for (const c of crystals) if (Math.floor(c.x) === k % w && Math.floor(c.y) === Math.floor(k / w)) { c.on = false; c.timer = 99; }
      }
    }
    if (changes.length) fx({ k: 'tiles', c: changes });
  }

  function respawn(b) {
    const foes = bats.filter((o) => o !== b && !o.dead);
    const score = (s) => foes.length ? Math.min(...foes.map((o) => Math.hypot(o.x - s.x, o.y - s.y))) : 0;
    const free = arena.spawns.filter((p) => !solid(Math.floor(p.x), Math.floor(p.y)));
    const s = (free.length ? free : [randomOpenSpot()]).slice().sort((p, q) => score(q) - score(p))[0];
    Object.assign(b, { x: s.x, y: s.y, vx: 0, vy: 0, echoes: START_ECHOES, stun: 0, safe: SPAWN_SAFE, dead: 0, cooldown: 0, mouth: 0, dashT: 0 });
  }

  function shiftArena() {
    loadArena(nextArenaIndex());
    rings = []; beams = [];
    bats.forEach((b, k) => {
      const s = arena.spawns[k % arena.spawns.length];
      Object.assign(b, { x: s.x, y: s.y, vx: 0, vy: 0, safe: SPAWN_SAFE, stun: 0, dashT: 0 });
      if (b.ai) b.ai.path = [];
    });
    fx({ k: 'banner', text: arena.def.name, rgb: arena.theme.wall, t: 2.2 });
    fx({ k: 'sfx', n: 'crash' });
  }

  function spawnPowerup() {
    const spots = arena.open.filter((p) => !solid(Math.floor(p.x), Math.floor(p.y)) && bats.every((b) => b.dead || dist(p, b) > 5) && powerups.every((q) => dist(p, q) > 4));
    if (!spots.length) return;
    const s = spots[Math.floor(Math.random() * spots.length)];
    powerups.push({ x: s.x, y: s.y, type: POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)], phase: Math.random() * 6 });
  }

  function grabPowerup(b, p) {
    if (p.type === 'mega') b.mega = true;
    else if (p.type === 'shield') b.shield = true;
    else { b.power = p.type; b.powerT = p.type === 'speed' ? 6 : 5; }
    fx({ k: 'burst', x: p.x, y: p.y, rgb: POWERS[p.type].rgb, n: 14 });
    fx({ k: 'popup', x: b.x, y: b.y - 1, text: POWERS[p.type].label, rgb: POWERS[p.type].rgb, life: 1.1 });
    fx({ k: 'sfx', n: 'power' });
  }

  // ---- Update (local and host) -------------------------------------------
  function update(rawDt) {
    clock += rawDt;
    tickCosmetics(rawDt);
    if (countdown > 0) {
      const before = Math.ceil(countdown);
      countdown -= rawDt;
      if (Math.ceil(countdown) !== before) fx({ k: 'sfx', n: countdown <= 0 ? 'go' : 'beep' });
      return;
    }
    slowmo = Math.max(0, slowmo - rawDt);
    const dt = slowmo > 0 ? rawDt * 0.35 : rawDt;
    updateEats(rawDt);

    if (!over) {
      if (shift) {
        shift.t += rawDt;
        if (!shift.swapped && shift.t >= SHIFT_FADE / 2) { shift.swapped = true; shiftArena(); }
        if (shift.t >= SHIFT_FADE) shift = null;
        return;
      }
      shiftTimer -= rawDt;
      if (shiftTimer <= shiftWarning() && shiftTimer + rawDt > shiftWarning()) {
        fx({ k: 'banner', text: 'The cave is shifting!', rgb: arena.theme.wall, t: shiftWarning() });
        fx({ k: 'sfx', n: 'warn' });
      }
      if (shiftTimer <= 0) { shift = { t: 0, swapped: false }; shiftTimer = shiftEvery(); }
      updateMorph(rawDt);
    }

    for (const b of bats) {
      b.cooldown = Math.max(0, b.cooldown - dt);
      b.safe = Math.max(0, b.safe - dt);
      b.seen = Math.max(0, b.seen - dt * 0.8);
      b.dashCd = Math.max(0, b.dashCd - dt);
      if (b.power) { b.powerT -= dt; if (b.powerT <= 0) { b.power = null; b.powerT = 0; } }
      if (b.dead > 0) { b.dead -= dt; if (b.dead <= 0 && !over) respawn(b); continue; }
      let ix = 0, iy = 0;
      if (b.stun > 0) b.stun = Math.max(0, b.stun - dt);
      else if (!over) {
        if (b.ctrl === 'cpu') ({ ix, iy } = cpuInput(b, dt));
        else if (b.ctrl === 'remote') ({ ix, iy } = remoteInput.get(b.i) || { ix: 0, iy: 0 });
        else ({ ix, iy } = localInput(b.local));
      }
      if (b.charging) {
        if (b.stun > 0 || over) { b.charging = false; b.charge = 0; }
        else {
          b.charge += dt;
          if (b.charge >= BEAM_CHARGE && !b.chargeSfx) { b.chargeSfx = true; if (b.ctrl === 'local') applyFx({ k: 'sfx', n: 'charged' }); }
        }
      }
      const fast = b.power === 'speed';
      if (b.dashT > 0) {
        b.dashT -= dt;
        if (Math.random() < 0.6) particles.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.3, rgb: b.rgb, size: 5 });
      } else if (ix || iy) {
        const acc = ACCEL * (fast ? 1.3 : 1);
        b.vx += ix * acc * dt; b.vy += iy * acc * dt;
      } else { b.vx -= b.vx * DRAG * dt; b.vy -= b.vy * DRAG * dt; }
      const max = b.dashT > 0 ? DASH_SPEED : b.stun > 0 ? 7 : MAX_SPEED * (fast ? 1.45 : 1) * (b.charging && b.charge > 0.2 ? CHARGE_SLOW : 1) * (b.ctrl === 'cpu' ? cpuLevel.speed : 1);
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
      if (Math.abs(b.vx) > 0.2) b.face = Math.sign(b.vx);
      const nx = b.x + b.vx * dt;
      if (!hitsWall(nx, b.y, R)) b.x = nx; else b.vx *= -0.4;
      const ny = b.y + b.vy * dt;
      if (!hitsWall(b.x, ny, R)) b.y = ny; else b.vy *= -0.4;
    }

    advanceRings(dt, true);

    // eating: a bat that isn't stunned touches a stunned one
    if (!over) {
      outer: for (const a of bats) {
        if (a.dead || a.stun > 0) continue;
        for (const b of bats) {
          if (b === a || b.dead || b.stun <= 0) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) < R * 2 + 0.15) { eat(a, b); break outer; }
        }
      }
    }

    for (const c of crystals) {
      if (!c.on) {
        c.timer -= dt;
        if (c.timer <= 0 && crystals.filter((k) => k.on).length < 2 + Math.floor(bats.length / 2)) c.on = true;
        continue;
      }
      for (const b of bats) {
        if (b.dead || Math.hypot(c.x - b.x, c.y - b.y) > 0.6) continue;
        b.echoes = Math.min(MAX_ECHOES, b.echoes + CRYSTAL_ECHOES);
        c.on = false;
        c.timer = 4 + Math.random() * 3;
        fx({ k: 'burst', x: c.x, y: c.y, rgb: '150, 240, 255', n: 12 });
        fx({ k: 'sfx', n: 'crystal' });
        break;
      }
    }

    powerTimer -= dt;
    if (powerTimer <= 0) { if (powerups.length < 2) spawnPowerup(); powerTimer = 8 + Math.random() * 5; }
    powerups = powerups.filter((p) => {
      const b = bats.find((o) => !o.dead && dist(o, p) < 0.6);
      if (b) { grabPowerup(b, p); return false; }
      return true;
    });

    if (mode === 'host') {
      snapTimer -= rawDt;
      if (snapTimer <= 0) { snapTimer = SNAPSHOT_EVERY; net?.broadcast(snapshot()); }
    }
  }

  // Rings light walls as they pass and, on the host, stun every other bat they reach
  function advanceRings(dt, simulate) {
    for (let k = 0; k < lit.length; k++) if (lit[k] > 0) lit[k] = Math.max(0, lit[k] - dt * 0.75);
    for (const beam of beams) beam.t += dt;
    beams = beams.filter((beam) => beam.t < BEAM_LIFE);
    for (const ring of rings) {
      const prev = ring.r;
      ring.r += RING_SPEED * dt;
      const r = ring.r, { w, h } = arena;
      for (let ty = Math.max(0, Math.floor(ring.y - r - 1)); ty <= Math.min(h - 1, Math.ceil(ring.y + r + 1)); ty++) {
        for (let tx = Math.max(0, Math.floor(ring.x - r - 1)); tx <= Math.min(w - 1, Math.ceil(ring.x + r + 1)); tx++) {
          const d = Math.hypot(tx + 0.5 - ring.x, ty + 0.5 - ring.y);
          if (d >= prev - 0.6 && d < r + 0.6) { lit[ty * w + tx] = 1; litBy[ty * w + tx] = ring.owner; }
        }
      }
      if (!simulate) continue;
      for (const foe of bats) {
        if (foe.i === ring.owner || foe.dead || foe.safe > 0 || ring.hit.has(foe.i)) continue;
        const d = Math.hypot(foe.x - ring.x, foe.y - ring.y);
        if (d < r + R && d >= prev - R) {
          ring.hit.add(foe.i);
          foe.seen = 1;
          if (foe.stun > 0) continue;
          const k = d || 1;
          if (foe.shield) {
            foe.shield = false;
            foe.vx = ((foe.x - ring.x) / k) * 3; foe.vy = ((foe.y - ring.y) / k) * 3;
            fx({ k: 'popup', x: foe.x, y: foe.y - 1, text: 'BLOCKED', rgb: POWERS.shield.rgb, life: 0.8 });
            fx({ k: 'burst', x: foe.x, y: foe.y, rgb: POWERS.shield.rgb, n: 12 });
            fx({ k: 'sfx', n: 'block' });
            continue;
          }
          foe.stun = ring.stun;
          foe.dashT = 0;
          const push = 2 + 4 * (1 - d / ring.max);
          foe.vx = ((foe.x - ring.x) / k) * push;
          foe.vy = ((foe.y - ring.y) / k) * push;
          fx({ k: 'burst', x: foe.x, y: foe.y, rgb: '255, 226, 120', n: 10 });
          fx({ k: 'sfx', n: 'stun' });
        }
      }
    }
    rings = rings.filter((ring) => ring.r < ring.max);
  }

  function tickCosmetics(dt) {
    shake = Math.max(0, shake - dt);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    updateAmbient(dt);
    if (tileGlow) for (let k = 0; k < tileGlow.length; k++) if (tileGlow[k] > 0) tileGlow[k] = Math.max(0, tileGlow[k] - dt * 0.6);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < p.life);
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.feather) { p.vy += 1.5 * dt; p.vx *= 1 - 1.5 * dt; } else { p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; }
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  // ---- Online snapshots ----------------------------------------------------
  const r2 = (v) => Math.round(v * 100) / 100;
  function snapshot() {
    const s = {
      t: 's', a: arenaIndex, am: arenaMode, st: r2(shiftTimer), sh: shift ? r2(shift.t) : -1, cd: r2(countdown), over,
      b: bats.map((b) => [r2(b.x), r2(b.y), r2(b.vx), r2(b.vy), b.face, r2(b.stun), r2(b.dead), b.score, b.echoes, r2(b.safe), r2(b.seen),
        r2(b.mouth), r2(b.puff), r2(b.dashCd), b.power || 0, r2(b.powerT), b.mega ? 1 : 0, b.shield ? 1 : 0, b.ctrl === 'cpu' ? 1 : 0, r2(b.dashT), b.charging ? r2(b.charge) : -1]),
      bm: beams.map((m) => [m.id, r2(m.x), r2(m.y), r2(m.ux), r2(m.uy), r2(m.len), m.owner, r2(m.t)]),
      r: rings.map((g) => [g.id, r2(g.x), r2(g.y), r2(g.r), g.owner, g.max, g.big ? 1 : 0]),
      c: crystals.map((c) => (c.on ? 1 : 0)).join(''),
      p: powerups.map((p) => [r2(p.x), r2(p.y), p.type]),
      e: eats.map((e) => [e.eater.i, e.food.i, r2(e.food.x), r2(e.food.y), r2(e.t)]),
      fx: outbox,
    };
    outbox = [];
    return s;
  }

  function applySnapshot(s) {
    if (mode !== 'client' || !active) return;
    if (s.a !== arenaIndex) loadArena(s.a);
    if (s.am) arenaMode = s.am;
    shiftTimer = s.st;
    shift = s.sh >= 0 ? { t: s.sh, swapped: true } : null;
    countdown = s.cd;
    over = s.over;
    s.b.forEach((v, i) => {
      const b = bats[i] || (bats[i] = makeBat(i, 'remote', 0));
      const first = b.tx === undefined;
      [b.tx, b.ty, b.vx, b.vy, b.face, b.stun, b.dead, b.score, b.echoes, b.safe, b.seen, b.mouth, b.puff, b.dashCd] = v;
      b.power = v[14] || null; b.powerT = v[15]; b.mega = !!v[16]; b.shield = !!v[17];
      b.cpuFlag = !!v[18]; b.dashT = v[19];
      b.charging = v[20] >= 0; b.charge = Math.max(0, v[20] ?? -1);
      if (first || Math.hypot(b.tx - b.x, b.ty - b.y) > 3) { b.x = b.tx; b.y = b.ty; }
    });
    const knownBeams = new Set(beams.map((m) => m.id));
    beams = (s.bm || []).map(([id, x, y, ux, uy, len, owner, t]) => {
      const m = { id, x, y, ux, uy, len, owner, t };
      if (!knownBeams.has(id)) lightBeam(m);
      return m;
    });
    const known = new Map(rings.map((g) => [g.id, g]));
    rings = s.r.map(([id, x, y, r, owner, max, big]) => {
      const g = known.get(id);
      return { id, x, y, r: g ? Math.max(g.r, r) : r, owner, max, big: !!big, hit: new Set() };
    });
    [...s.c].forEach((ch, k) => { if (crystals[k]) crystals[k].on = ch === '1'; });
    powerups = s.p.map(([x, y, type], k) => ({ x, y, type, phase: powerups[k]?.phase ?? Math.random() * 6 }));
    eats = s.e.map(([ei, fi, fx2, fy2, t]) => {
      const f = bats[fi];
      return { eater: bats[ei], food: { ...f, x: fx2, y: fy2 }, t };
    });
    for (const ev of s.fx || []) applyFx(ev);
  }

  // Client: no simulation, just smooth toward the host's positions and keep the visuals moving
  let inputTimer = 0, lastSent = '';
  function clientUpdate(dt) {
    clock += dt;
    tickCosmetics(dt);
    slowmo = Math.max(0, slowmo - dt);
    const k = 1 - Math.exp(-dt * 14);
    for (const b of bats) {
      if (b.tx === undefined) continue;
      b.tx += b.vx * dt * 0.5; b.ty += b.vy * dt * 0.5;
      b.x += (b.tx - b.x) * k; b.y += (b.ty - b.y) * k;
      if (b.dashT > 0 && Math.random() < 0.6) particles.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.3, rgb: b.rgb, size: 5 });
    }
    for (const e of eats) e.t += dt;
    advanceRings(dt, false);
    inputTimer -= dt;
    if (inputTimer <= 0) {
      inputTimer = 1 / 30;
      const { ix, iy } = localInput(0);
      const msg = { t: 'in', ix: r2(ix), iy: r2(iy) };
      const key = msg.ix + ',' + msg.iy;
      if (key !== lastSent || Math.random() < 0.1) { lastSent = key; net?.send(msg); }
    }
  }

  // ---- Render ------------------------------------------------------------
  let ctx, PX, ox, oy;
  const FONT = '"Fredoka", "Arial Rounded MT Bold", system-ui, sans-serif';
  const HEAD = '"Lilita One", "Arial Rounded MT Bold", system-ui, sans-serif';
  const X = (x) => ox + x * PX, Y = (y) => oy + y * PX;

  function glow(x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${a})`); g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Which bats sense their surroundings on this screen: the viewer online,
  // every local player on a shared screen
  const senses = () => bats.filter((b) => !b.dead && b.ctrl === 'local');

  // Other bats are invisible in the dark unless sound reaches them
  function batVisible(b) {
    if (b.ctrl === 'local' || viewer === b.i) return 1;
    return Math.max(litAt(b.x, b.y) * 0.9, b.seen, b.stun > 0 ? 1 : 0, b.mouth > 0 || b.puff > 0 ? 1 : 0);
  }

  // Open Sky: no cave at all, just a starry night and a moon. The stars never
  // reveal anyone; bats are still found by sound.
  let stars = null;
  function drawSky() {
    if (!stars) {
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      stars = Array.from({ length: 160 }, () => ({ x: rnd(), y: rnd(), s: 1 + rnd() * 1.6, p: rnd() * 6 }));
    }
    const x0 = X(0), y0 = Y(0), w = arena.w * PX, h = arena.h * PX;
    for (const st of stars) {
      ctx.fillStyle = `rgba(232, 236, 255, ${0.3 + 0.5 * Math.sin(clock * 1.5 + st.p) ** 2})`;
      // stars fill the whole screen so the sky doesn't read as a squashed strip
      ctx.fillRect(st.x * W, st.y * H, st.s, st.s);
    }
    const mx = x0 + w * 0.82, my = y0 + h * 0.2, mr = PX * 1.1;
    glow(mx, my, mr * 3, '255, 236, 190', 0.12);
    // a crescent: the moon disc with a shadow bite, clipped so the bite never shows outside it
    ctx.save();
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(255, 244, 214, 0.6)';
    ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    ctx.fillStyle = arena.theme.bg;
    ctx.beginPath(); ctx.arc(mx + mr * 0.55, my - mr * 0.3, mr * 0.85, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // a faint edge so players know where the sky ends
    ctx.strokeStyle = 'rgba(255, 236, 190, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 8]);
    ctx.strokeRect(X(1), Y(1), (arena.w - 2) * PX, (arena.h - 2) * PX);
    ctx.setLineDash([]);
  }

  function render() {
    const th = arena.theme;
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, H);
    const top = Math.max(54, H * 0.15);
    const bottom = Math.max(22, H * 0.06);
    PX = Math.min(W / arena.w, (H - top - bottom) / arena.h);
    const sx = shake > 0 ? (Math.random() - 0.5) * shake * 30 : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake * 30 : 0;
    ox = (W - arena.w * PX) / 2 + sx;
    oy = top + (H - top - bottom - arena.h * PX) / 2 + sy;
    const near = senses();

    if (arena.def.open) drawSky();

    // ambient particles only show where sound has lit the cave
    for (const p of ambient) {
      const l = litAt(p.x, p.y);
      if (l < 0.05) continue;
      ctx.fillStyle = `rgba(${th.ambientRgb}, ${0.55 * l})`;
      const s = Math.max(1.5, p.size * PX);
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), s * 0.6, 0, Math.PI * 2); ctx.fill();
    }

    // Morph mode: tiles that just changed shimmer faintly, so you can feel the cave moving
    for (let k = 0; k < tileGlow.length; k++) {
      const g = tileGlow[k];
      if (g < 0.02) continue;
      const x = X(k % arena.w), y = Y(Math.floor(k / arena.w));
      if (arena.grid[k]) { ctx.fillStyle = `rgba(${th.fill}, ${g * 0.5})`; ctx.fillRect(x, y, PX + 0.5, PX + 0.5); }
      ctx.strokeStyle = `rgba(${th.wall}, ${g * 0.35})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, PX - 2, PX - 2);
    }

    // walls: nothing in the dark, bright where sound or a nearby bat's senses reach
    for (let ty = 0; ty < arena.h; ty++) {
      for (let tx = 0; tx < arena.w; tx++) {
        if (!solid(tx, ty)) continue;
        const open = [!solid(tx, ty - 1), !solid(tx + 1, ty), !solid(tx, ty + 1), !solid(tx - 1, ty)];
        if (!open.some(Boolean)) continue;
        const l = lit[ty * arena.w + tx];
        let a = l;
        for (const b of near) {
          const d = Math.hypot(tx + 0.5 - b.x, ty + 0.5 - b.y);
          a = Math.max(a, Math.max(0, Math.min(1, 1 - (d - 0.7) / 1.4)) * 0.35);
        }
        if (a < 0.02) continue;
        const rgb = l > 0.05 ? BATS[litBy[ty * arena.w + tx]].rgb : th.wall;
        const x = X(tx), y = Y(ty), s = PX;
        ctx.fillStyle = `rgba(${th.fill}, ${a * 0.8})`;
        ctx.fillRect(x, y, s + 0.5, s + 0.5);
        ctx.strokeStyle = `rgba(${rgb}, ${a})`;
        ctx.lineWidth = Math.max(1.5, PX * 0.08);
        ctx.beginPath();
        if (open[0]) { ctx.moveTo(x, y); ctx.lineTo(x + s, y); }
        if (open[1]) { ctx.moveTo(x + s, y); ctx.lineTo(x + s, y + s); }
        if (open[2]) { ctx.moveTo(x, y + s); ctx.lineTo(x + s, y + s); }
        if (open[3]) { ctx.moveTo(x, y); ctx.lineTo(x, y + s); }
        ctx.stroke();
      }
    }

    // crystals and power-ups stay hidden too, until sound or a bat's senses find them
    const seenAt = (x, y) => {
      let a = litAt(x, y);
      for (const b of near) a = Math.max(a, Math.max(0, Math.min(1, 1 - (Math.hypot(x - b.x, y - b.y) - 1) / 1.5)));
      return Math.min(1, a * 1.2);
    };
    for (const c of crystals) {
      if (!c.on) continue;
      const a = seenAt(c.x, c.y);
      if (a < 0.03) continue;
      ctx.globalAlpha = a;
      const cx = X(c.x), cy = Y(c.y + Math.sin(clock * 2 + c.phase) * 0.1);
      glow(cx, cy, PX * 0.9, '150, 240, 255', 0.35);
      ctx.fillStyle = '#96f0ff';
      ctx.beginPath();
      ctx.moveTo(cx, cy - PX * 0.26); ctx.lineTo(cx + PX * 0.15, cy); ctx.lineTo(cx, cy + PX * 0.26); ctx.lineTo(cx - PX * 0.15, cy);
      ctx.closePath(); ctx.fill();
    }
    for (const p of powerups) {
      const a = seenAt(p.x, p.y);
      if (a < 0.03) continue;
      ctx.globalAlpha = a;
      drawPowerup(p);
    }
    ctx.globalAlpha = 1;

    for (const ring of rings) {
      const f = 1 - ring.r / ring.max;
      ctx.strokeStyle = `rgba(${BATS[ring.owner].rgb}, ${f * 0.95})`;
      ctx.lineWidth = Math.max(2, PX * (ring.big ? 0.22 : 0.12));
      ctx.beginPath(); ctx.arc(X(ring.x), Y(ring.y), ring.r * PX, 0, Math.PI * 2); ctx.stroke();
    }

    for (const m of beams) {
      const f = 1 - m.t / BEAM_LIFE, x0 = X(m.x), y0 = Y(m.y), x1 = X(m.x + m.ux * m.len), y1 = Y(m.y + m.uy * m.len);
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(${BATS[m.owner].rgb}, ${0.35 * f})`;
      ctx.lineWidth = PX * 0.9 * f + 2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * f})`;
      ctx.lineWidth = Math.max(2, PX * 0.16 * f);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.lineCap = 'butt';
    }

    for (const e of eats) {
      if (e.t >= EAT_PULL || !e.eater) continue;
      const p = e.t / EAT_PULL, ease = p * p;
      const mx = e.eater.x + e.eater.face * R * 0.4, my = e.eater.y + R * 0.3;
      const fx2 = e.food.x + (mx - e.food.x) * ease, fy2 = e.food.y + (my - e.food.y) * ease;
      drawBat(e.food, X(fx2), Y(fy2), { scale: 1 - 0.85 * ease, rot: p * 9, alpha: 1, stunned: true, tag: false });
    }

    for (const p of particles) {
      ctx.fillStyle = `rgba(${p.rgb}, ${Math.min(1, p.life * 1.6)})`;
      if (p.feather) {
        ctx.save(); ctx.translate(X(p.x), Y(p.y)); ctx.rotate(p.life * 6);
        ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * 0.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else ctx.fillRect(X(p.x) - p.size / 2, Y(p.y) - p.size / 2, p.size, p.size);
    }

    for (const b of bats) {
      if (b.dead) continue;
      const v = batVisible(b);
      if (v > 0.03) drawBat(b, X(b.x), Y(b.y), { alpha: b.ctrl === 'local' || viewer === b.i ? undefined : v });
    }

    for (const p of popups) {
      const k = p.t / p.life;
      const pop = p.big ? 1 + 0.6 * Math.max(0, 1 - p.t * 6) : 1;
      ctx.font = `700 ${Math.max(p.big ? 18 : 11, PX * (p.big ? 0.9 : 0.45)) * pop}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(${p.rgb}, ${1 - k * k})`;
      ctx.fillText(p.text, X(p.x), Y(p.y - k * 0.6));
    }

    // the shift warning pulses the screen edge instead of revealing the map
    if (shiftTimer < shiftWarning() && !over && !shift) {
      const a = 0.25 + 0.25 * Math.sin(clock * 14);
      ctx.strokeStyle = `rgba(${th.wall}, ${a})`;
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, W - 6, H - 6);
    }

    drawHud();
    drawSticks();
    if (localCount === 1 && countdown <= 0 && touchUsed) drawDashButton();

    if (shift) {
      const a = 1 - Math.abs(shift.t / (SHIFT_FADE / 2) - 1);
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, Math.min(1, a))})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawPowerup(p) {
    const x = X(p.x), y = Y(p.y + Math.sin(clock * 2.5 + p.phase) * 0.12), rgb = POWERS[p.type].rgb, s = PX * 0.3;
    glow(x, y, PX * 1.1, rgb, 0.3 + 0.15 * Math.sin(clock * 4 + p.phase));
    ctx.strokeStyle = `rgb(${rgb})`;
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.lineWidth = Math.max(1.5, PX * 0.07);
    ctx.beginPath(); ctx.arc(x, y, s * 1.25, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    if (p.type === 'mega') {
      ctx.arc(x, y, s * 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, s * 0.55, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, s * 0.55, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, s * 0.85, -0.7, 0.7); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, s * 0.85, Math.PI - 0.7, Math.PI + 0.7); ctx.stroke();
    } else if (p.type === 'speed') {
      for (const off of [-0.3, 0.25]) {
        ctx.beginPath();
        ctx.moveTo(x + (off - 0.25) * s, y - 0.5 * s); ctx.lineTo(x + (off + 0.25) * s, y); ctx.lineTo(x + (off - 0.25) * s, y + 0.5 * s);
        ctx.stroke();
      }
    } else if (p.type === 'shield') {
      ctx.moveTo(x, y - 0.65 * s); ctx.lineTo(x + 0.55 * s, y - 0.35 * s); ctx.lineTo(x + 0.45 * s, y + 0.3 * s);
      ctx.lineTo(x, y + 0.7 * s); ctx.lineTo(x - 0.45 * s, y + 0.3 * s); ctx.lineTo(x - 0.55 * s, y - 0.35 * s); ctx.closePath();
      ctx.stroke();
    } else {
      ctx.arc(x - 0.32 * s, y, 0.3 * s, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 0.32 * s, y, 0.3 * s, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawBat(b, x, y, o = {}) {
    const scale = o.scale ?? (1 + (b.puff > 0 ? 0.4 * b.puff * (0.8 + 0.2 * Math.sin(clock * 30)) : 0));
    const stunned = o.stunned ?? b.stun > 0;
    if (!o.rot && b.safe > 0 && Math.floor(b.safe * 10) % 2 === 0) return;
    const r = PX * R * scale, flap = stunned ? 0.2 : Math.sin(clock * (b.dashT > 0 ? 40 : 18) + b.i);
    const alpha = o.alpha ?? 1;
    ctx.save();
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    ctx.globalAlpha = alpha;
    glow(0, 0, r * 3, b.rgb, 0.3);
    if (b.power) glow(0, 0, r * 4, POWERS[b.power].rgb, 0.25 + 0.1 * Math.sin(clock * 10));
    ctx.fillStyle = b.color;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.6, -r * 0.2); ctx.lineTo(s * r * 2.3, -r * (0.2 + flap * 0.9));
      ctx.lineTo(s * r * 1.8, r * 0.25); ctx.lineTo(s * r * 1.3, r * 0.05); ctx.lineTo(s * r * 0.9, r * 0.45);
      ctx.closePath(); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.75, -r * 0.5); ctx.lineTo(-r * 0.45, -r * 1.35); ctx.lineTo(-r * 0.1, -r * 0.8);
    ctx.moveTo(r * 0.75, -r * 0.5); ctx.lineTo(r * 0.45, -r * 1.35); ctx.lineTo(r * 0.1, -r * 0.8);
    ctx.fill();

    const lx = (b.face || 1) * r * 0.18;
    if (stunned) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.2, PX * 0.05);
      for (const s of [-1, 1]) {
        const ex = s * r * 0.32, ey = -r * 0.1, k = r * 0.14;
        ctx.beginPath(); ctx.moveTo(ex - k, ey - k); ctx.lineTo(ex + k, ey + k); ctx.moveTo(ex + k, ey - k); ctx.lineTo(ex - k, ey + k); ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-r * 0.32 + lx, -r * 0.1, r * 0.22, 0, Math.PI * 2); ctx.arc(r * 0.32 + lx, -r * 0.1, r * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1030';
      ctx.beginPath(); ctx.arc(-r * 0.28 + lx * 1.4, -r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.arc(r * 0.36 + lx * 1.4, -r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.fill();
    }
    if (b.mouth > 0) {
      const mw = r * 0.55 * b.mouth, mh = r * 0.5 * b.mouth;
      ctx.fillStyle = '#2a0614';
      ctx.beginPath(); ctx.ellipse(lx * 0.8, r * 0.38, mw, mh, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(lx * 0.8 + s * mw * 0.55 - r * 0.08, r * 0.38 - mh * 0.85);
        ctx.lineTo(lx * 0.8 + s * mw * 0.55 + r * 0.08, r * 0.38 - mh * 0.85);
        ctx.lineTo(lx * 0.8 + s * mw * 0.55, r * 0.38 - mh * 0.85 + r * 0.22);
        ctx.closePath(); ctx.fill();
      }
    } else if (b.puff > 0) {
      ctx.strokeStyle = '#2a0614'; ctx.lineWidth = Math.max(1.5, r * 0.12);
      ctx.beginPath(); ctx.arc(lx * 0.8, r * 0.25, r * 0.35, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    }
    if (b.charging && b.charge > 0.12 && !o.rot) {
      const k = Math.min(1, b.charge / BEAM_CHARGE), full = k >= 1;
      ctx.strokeStyle = full ? `rgba(255, 255, 255, ${0.6 + 0.4 * Math.sin(clock * 20)})` : `rgba(${b.rgb}, 0.9)`;
      ctx.lineWidth = Math.max(2, PX * 0.08);
      ctx.beginPath(); ctx.arc(0, 0, r * 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
    }
    if (b.shield && !o.rot) {
      ctx.strokeStyle = `rgba(${POWERS.shield.rgb}, 0.8)`;
      ctx.lineWidth = Math.max(1.5, PX * 0.06);
      ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2); ctx.stroke();
    }
    if (b.mega && !o.rot) {
      ctx.strokeStyle = `rgba(${POWERS.mega.rgb}, ${0.5 + 0.4 * Math.sin(clock * 8)})`;
      ctx.lineWidth = Math.max(1.5, PX * 0.05);
      ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    if (stunned && !o.rot) {
      ctx.globalAlpha = alpha;
      for (let k = 0; k < 3; k++) {
        const a = clock * 5 + k * 2.1;
        ctx.fillStyle = '#ffe278';
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 1.4, y - r * 1.5 + Math.sin(a) * r * 0.4, Math.max(2, r * 0.18), 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = `700 ${Math.max(10, PX * 0.4)}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffe278';
      ctx.fillText('STUNNED', x, y - r * 2.6);
      ctx.globalAlpha = 1;
    }
    if (o.tag !== false) {
      ctx.globalAlpha = alpha;
      ctx.font = `700 ${Math.max(9, PX * 0.34)}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(${b.rgb}, 0.9)`;
      const you = viewer === b.i ? ' (you)' : '';
      ctx.fillText((b.ctrl === 'cpu' || b.cpuFlag ? `${b.name} · CPU` : b.name) + you, x, y + r * 2.1);
      ctx.globalAlpha = 1;
    }
  }

  function drawDashButton() {
    const b = dashButton(), me = localBat(0);
    if (!me) return;
    const ready = me.dashCd <= 0;
    ctx.fillStyle = `rgba(${me.rgb}, ${ready ? 0.22 : 0.08})`;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(${me.rgb}, 0.9)`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - me.dashCd / DASH_COOLDOWN)); ctx.stroke();
    ctx.font = `700 ${14}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = ready ? '#fff' : 'rgba(255,255,255,0.4)';
    ctx.fillText('DASH', b.x, b.y);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // a chunky pill with a dark fill, light outline and a solid drop shadow
  function pill(x, y, w, h, edge) {
    ctx.fillStyle = 'rgba(5, 6, 15, 0.9)';
    roundRect(x, y + 3, w, h, h / 2); ctx.fill();
    ctx.fillStyle = 'rgba(27, 30, 61, 0.92)';
    roundRect(x, y, w, h, h / 2); ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 2.5; ctx.stroke();
  }

  // Scoreboard: one pill per bat along the top, split around the pause button
  function drawHud() {
    const n = bats.length, pad = 10, centerGap = 34;
    const ph = Math.max(30, Math.min(40, H * 0.085));
    const left = Math.ceil(n / 2);
    // each side's pills must stay clear of the pause button in the middle
    const pw = Math.min(230, (W / 2 - pad - centerGap) / left - 8);
    ctx.textBaseline = 'middle';
    bats.forEach((b, k) => {
      const x = k < left ? pad + k * (pw + 8) : W - pad - (n - k) * (pw + 8) + 8;
      const y = 8;
      pill(x, y, pw, ph, viewer === b.i || (b.ctrl === 'local' && localCount === 1) ? '#f4f1ff' : 'rgba(244, 241, 255, 0.35)');
      // avatar dot with the score inside
      const r = ph * 0.36, cx = x + ph * 0.5, cy = y + ph / 2;
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#12142a';
      ctx.font = `${Math.round(r * 1.35)}px ${HEAD}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(b.score), cx, cy + 1);
      // name, with a tag underneath
      const tags = [];
      if (b.ctrl === 'cpu' || b.cpuFlag) tags.push('CPU');
      if (viewer === b.i || (b.ctrl === 'local' && localCount === 1)) tags.push('YOU');
      if (b.power) tags.push(`${POWERS[b.power].label} ${Math.ceil(b.powerT)}`);
      else if (b.mega) tags.push('MEGA');
      else if (b.shield) tags.push('SHIELD');
      ctx.textAlign = 'left';
      ctx.fillStyle = b.color;
      ctx.font = `${Math.round(ph * 0.42)}px ${HEAD}`;
      const nx = x + ph * 0.95;
      ctx.fillText(b.name, nx, cy - (tags.length ? ph * 0.12 : 0));
      if (tags.length) {
        ctx.font = `600 ${Math.round(ph * 0.24)}px ${FONT}`;
        ctx.fillStyle = 'rgba(244, 241, 255, 0.6)';
        ctx.fillText(tags.join(' · '), nx, cy + ph * 0.24);
      }
      // echoes left as pips on the right
      const pr = Math.max(2.2, ph * 0.075), gap = pr * 2.7;
      const px0 = x + pw - ph * 0.42 - (MAX_ECHOES - 1) * gap;
      for (let e = 0; e < MAX_ECHOES; e++) {
        ctx.beginPath(); ctx.arc(px0 + e * gap, cy, pr, 0, Math.PI * 2);
        if (b.power === 'frenzy' || e < b.echoes) { ctx.fillStyle = b.color; ctx.fill(); }
        else { ctx.fillStyle = 'rgba(244, 241, 255, 0.14)'; ctx.fill(); }
      }
    });

    // arena info pill along the bottom
    const size = Math.max(13, Math.min(20, H / 26));
    const secs = Math.max(0, Math.ceil(shiftTimer));
    const tail = arenaMode === 'morph' ? 'the cave keeps changing' : arenaMode === 'sky' ? 'no cave tonight' : `shifts in ${secs}s`;
    const info = `${arena.def.name.toUpperCase()}  ·  ${tail.toUpperCase()}`;
    ctx.font = `600 ${Math.round(size * 0.68)}px ${FONT}`;
    const iw = ctx.measureText(info).width + 28, ih = size * 1.45;
    const urgent = shiftTimer < shiftWarning() + 2 && arenaMode !== 'morph' && arenaMode !== 'sky';
    pill(W / 2 - iw / 2, H - ih - 10, iw, ih, urgent ? `rgb(${arena.theme.wall})` : 'rgba(244, 241, 255, 0.3)');
    ctx.textAlign = 'center';
    ctx.fillStyle = urgent ? `rgb(${arena.theme.wall})` : 'rgba(244, 241, 255, 0.75)';
    ctx.fillText(info, W / 2, H - ih / 2 - 10 + 1);

    const mid = oy + (arena.h * PX) / 2;
    if (countdown > 0) {
      ctx.font = `${size * 4.5}px ${HEAD}`;
      ctx.fillStyle = 'rgba(5, 6, 15, 0.9)';
      ctx.fillText(String(Math.ceil(countdown)), W / 2, mid - size * 1.5 + 5);
      ctx.fillStyle = '#f4f1ff';
      ctx.fillText(String(Math.ceil(countdown)), W / 2, mid - size * 1.5);
      ctx.font = `600 ${size}px ${FONT}`;
      ctx.fillStyle = 'rgba(232, 236, 255, 0.9)';
      ctx.fillText('Squeak to stun. Fly into a stunned bat to eat it.', W / 2, mid + size * 1.4);
      ctx.fillStyle = 'rgba(232, 236, 255, 0.65)';
      ctx.font = `600 ${size * 0.8}px ${FONT}`;
      const how = localCount === 1
        ? (touchUsed ? 'Drag to fly · tap to squeak · hold a 2nd finger, let go: beam · flick or DASH to dash'
          : 'WASD or arrows to fly · F to squeak, hold F for a beam · G to dash · Esc to pause')
        : `Each player owns ${['', 'the screen', 'half', 'a third', 'a quarter'][localCount]} of the screen · tap to squeak · hold a 2nd finger to charge a beam · flick to dash`;
      ctx.fillText(how, W / 2, mid + size * 2.7);
      ctx.fillText('Grab glowing power-ups: Mega Screech, Speed, Shield, Echo Frenzy', W / 2, mid + size * 3.9);
    } else if (banner) {
      ctx.font = `${size * 2}px ${HEAD}`;
      ctx.fillStyle = `rgba(5, 6, 15, ${Math.min(0.9, banner.t * 2)})`;
      ctx.fillText(banner.text, W / 2, mid + 4);
      ctx.fillStyle = `rgba(${banner.rgb}, ${Math.min(1, banner.t * 2)})`;
      ctx.fillText(banner.text, W / 2, mid);
    }
    if (localCount > 1 && countdown > 0) {
      ctx.strokeStyle = 'rgba(232, 236, 255, 0.18)';
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      if (localCount === 4) { ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); }
      else for (let k = 1; k < localCount; k++) { ctx.moveTo((W * k) / localCount, 0); ctx.lineTo((W * k) / localCount, H); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawSticks() {
    const rect = canvas.getBoundingClientRect();
    for (const s of sticks.values()) {
      if (!s.moved) continue;
      const me = localBat(s.owner);
      if (!me) continue;
      const bx = s.sx - rect.left, by = s.sy - rect.top;
      let dx = s.x - s.sx, dy = s.y - s.sy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RANGE) { dx *= STICK_RANGE / len; dy *= STICK_RANGE / len; }
      ctx.strokeStyle = `rgba(${me.rgb}, 0.3)`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, STICK_RANGE, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(${me.rgb}, 0.3)`;
      ctx.beginPath(); ctx.arc(bx + dx, by + dy, 20, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Called by the main loop each frame while a battle is on
  function frame(dt, context, width, height) {
    ctx = context; W = width; H = height;
    if (active) { if (mode === 'client') clientUpdate(dt); else update(dt); }
    if (arena) render();
  }

  window.EchoDuel = {
    start, stop, frame, applySnapshot, remote, dropRemote,
    get active() { return active; },
    get mode() { return mode; },
    // for automated tests
    get bats() { return bats; },
    get arena() { return arena; },
    get powerups() { return powerups; },
    get beams() { return beams; },
    get countdown() { return countdown; },
    get over() { return over; },
    setPaused: (p) => { paused = p; if (p) { keys.clear(); sticks.clear(); chargers.clear(); } },
    setShiftTimer: (s) => { shiftTimer = s; },
    spawnPowerup: (type) => { spawnPowerup(); if (type && powerups.length) powerups[powerups.length - 1].type = type; },
    squeak: (i) => squeak(bats[i]),
    dash: (i, dx, dy) => dash(bats[i], dx, dy),
  };
})();
