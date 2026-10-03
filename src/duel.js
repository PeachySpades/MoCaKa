// Bat Brawl: 2 to 4 bats in a pitch-dark arena. A squeak lights the walls
// and stuns any rival it hits; dash into a rival to chomp it (stunned ones
// can't dash away or parry). First to 3 (or 5, 7) bites wins. Bats can dash, grab power-ups, and every so often the cave
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
  // Dash is the attack: dashing into any rival chomps it (stunned or not).
  // BITE_GRACE lets a bite land just after the burst ends. Plain flying
  // contact does nothing. The cooldown keeps it from being spammy.
  const DASH_SPEED = 12, DASH_TIME = 0.16, DASH_COOLDOWN = 2.2, BITE_GRACE = 0.15, BITE_REACH = R * 2 + 0.15;
  // Match length: first to this many bites wins (the lobby offers 3, 5 or 7)
  const WIN_SCORE = 3;
  let winScore = WIN_SCORE;
  // Echo parry: press squeak just before a rival's ring or beam reaches you
  // and it bounces off. You aren't stunned, the attacker is, and the squeak
  // you made is refunded. Each press opens a short parry window; a press that
  // parries nothing just squeaks as usual, and you can't open another window
  // until PARRY_COOLDOWN has passed, so mashing squeak isn't a free shield.
  // A hit that lands a hair before the press still counts (PARRY_LATE, a bit
  // more for online guests, whose presses reach the host late).
  const PARRY_WINDOW = 0.25, PARRY_LATE = 0.06, PARRY_LATE_REMOTE = 0.14, PARRY_COOLDOWN = 1, PARRY_STUN = 1.8, PARRY_FX = 0.7;
  const PARRY_RGB = '255, 246, 200';
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
  let parries = [], parryCount = 0;                      // parry flashes being drawn: { x, y, ax, ay, rgb, t }
  let carved = [];                       // tiles opened up by the last shift so no bat ends up inside a wall
  let lit, litBy;
  let clock = 0, countdown = 0, over = false, banner = null, shiftTimer = NO_SHIFT, shift = null, morph = null, tileGlow = null;
  let slowmo = 0, shake = 0, powerTimer = 6, snapTimer = 0, outbox = [], ringId = 0, ended = false;
  const remoteInput = new Map();         // slot -> { ix, iy }

  function makeBat(i, ctrl, localSlot) {
    return {
      i, ...BATS[i], ctrl, local: localSlot, x: 0, y: 0, vx: 0, vy: 0, face: 1,
      echoes: START_ECHOES, cooldown: 0, stun: 0, safe: 0, dead: 0, score: 0, seen: 0, mouth: 0, puff: 0,
      dashCd: 0, dashT: 0, power: null, powerT: 0, mega: false, shield: false, charging: false, charge: 0,
      parryT: 0, parryCd: 0, parryRing: null, hitBy: null, biteT: 0, dashSeq: 0,
      ai: ctrl === 'cpu' ? { path: [], repath: 0, think: Math.random() * 0.3, wander: null } : null,
    };
  }

  // o: { mode, humans, cpus, remotes, mySlot, net, onEnd }
  // '3d' draws the battle with three.js (duel3d.js); '2d' is the flat top-down view
  let view = '3d';
  const in3d = () => view === '3d' && window.EchoDuel3D && window.EchoDuel3D.supported;

  function start(o = {}) {
    window.EchoDuel3D?.reset?.();
    mode = o.mode || 'local';
    net = o.net || null;
    onEnd = o.onEnd || null;
    cpuLevel = CPU_LEVELS[o.level] || CPU_LEVELS.normal;
    arenaMode = ARENA_MODES[o.arenaMode] ? o.arenaMode : 'shift';
    winScore = Math.max(1, Math.min(15, Math.round(+o.firstTo) || WIN_SCORE));
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
    rings = []; beams = []; particles = []; popups = []; eats = []; outbox = []; parries = []; carved = [];
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
    if (ev.k === 'sfx') (s[ev.n] || s[ev.alt])?.();
    else if (ev.k === 'burst') burst(ev.x, ev.y, ev.rgb, ev.n, ev.sp || 3, ev.sz || 4);
    else if (ev.k === 'popup') popups.push({ x: ev.x, y: ev.y, text: ev.text, rgb: ev.rgb, t: 0, life: ev.life || 0.9, big: !!ev.big });
    else if (ev.k === 'shake') shake = Math.max(shake, ev.v);
    else if (ev.k === 'banner') banner = { text: ev.text, rgb: ev.rgb, t: ev.t };
    else if (ev.k === 'feathers') {
      for (let k = 0; k < 4; k++) particles.push({ x: ev.x, y: ev.y, vx: ev.face * (1 + Math.random()), vy: -0.5 - Math.random(), life: 1, rgb: ev.rgb, size: 6, feather: true });
    } else if (ev.k === 'slowmo') slowmo = ev.t;
    else if (ev.k === 'tiles') for (const [k, v] of ev.c) { if (arena.grid[k] !== v) { arena.grid[k] = v; tileGlow[k] = 1; } }
    else if (ev.k === 'parry') {
      parries.push({ x: ev.x, y: ev.y, ax: ev.ax, ay: ev.ay, rgb: ev.rgb, t: 0 });
      // a bright two-tone ping; game.js may provide its own 'parry' sound
      if (s.parry) s.parry(); else { s.block?.(); s.crystal?.(); s.charged?.(); }
    }
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
    // a dash goes the way you're steering right now (guests' copies of velocity lag behind)
    if (a === 'dash' && !(Math.hypot(dx || 0, dy || 0) > 0.1)) {
      const { ix, iy } = localInput(slot);
      if (Math.hypot(ix, iy) > 0.2) { dx = ix; dy = iy; }
    }
    if (mode === 'client') {
      net?.send({ t: 'act', a, dx, dy });
      if (a === 'squeak' && b.echoes <= 0) applyFx({ k: 'sfx', n: 'empty' });
      return;
    }
    doAct(b, a, dx, dy);
  }
  function doAct(b, a, dx, dy) {
    // a squeak press (a tap, or squeak key / second finger going down) is also a parry attempt
    if ((a === 'squeak' || a === 'charge') && parryPress(b) === 'late') return;
    if (a === 'squeak') tracked(b, () => squeak(b));
    else if (a === 'charge') startCharge(b);
    else if (a === 'release') tracked(b, () => releaseCharge(b));
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
    easy: { speed: 0.72, think: 0.65, squeak: 0.22, beam: 0, aimErr: 0, dash: 0.25, sense: 1.6, memory: 1.5, search: 0.08, power: 3, parry: 0 },
    normal: { speed: 0.86, think: 0.42, squeak: 0.35, beam: 0.25, aimErr: 0.16, dash: 0.5, sense: 2.2, memory: 3, search: 0.15, power: 5, parry: 0.3 },
    hard: { speed: 1, think: 0.26, squeak: 0.5, beam: 0.5, aimErr: 0.06, dash: 0.75, sense: 2.8, memory: 4.5, search: 0.25, power: 7, parry: 0.55 },
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
    cpuParry(b, foes);
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
      // the bite is a dash: lunge at a stunned rival in reach, or (less often) at one it can perceive close by
      if (b.dashCd <= 0 && !b.charging) {
        const prey = snack && dist(snack, b) < 2.6 ? snack
          : fresh.map((k) => k.bat).find((o) => o.safe <= 0 && dist(o, b) < 2.2);
        if (prey && Math.random() < (prey.stun > 0 ? lv.dash : lv.dash * 0.6)) {
          const k = prey.stun > 0 ? prey : ai.known.get(prey.i) || prey;
          const ax = k.x + (k.vx || 0) * 0.1 - b.x, ay = k.y + (k.vy || 0) * 0.1 - b.y, d = Math.hypot(ax, ay) || 1;
          const err = (Math.random() - 0.5) * 2 * lv.aimErr, c = Math.cos(err), sn = Math.sin(err);
          if (castRay(b.x, b.y, ax / d, ay / d, d) >= d - 0.4) dash(b, (ax * c - ay * sn) / d, (ax * sn + ay * c) / d);
        }
      }
    }
    const speed = (snack ? 1 : 0.85) * lv.speed;
    return { ix: (dx / len) * speed, iy: (dy / len) * speed };
  }

  // ---- Echo parry ----------------------------------------------------------
  // A squeak press opens a short parry window (unless the last one was too
  // recent). Returns true if a window opened, 'late' if the press parried a
  // hit that had just landed, false otherwise.
  function parryPress(b) {
    if (!active || countdown > 0 || over || shift || !b || b.dead || b.parryCd > 0) return false;
    const late = b.ctrl === 'remote' ? PARRY_LATE_REMOTE : PARRY_LATE;
    if (b.stun > 0 && b.hitBy && clock - b.hitBy.t <= late) {
      const h = b.hitBy;
      b.hitBy = null;
      b.stun = 0; b.vx = h.vx; b.vy = h.vy;
      b.parryCd = PARRY_COOLDOWN;
      parrySucceed(b, bats[h.by], h.x, h.y);
      return 'late';
    }
    if (b.stun > 0) return false;
    b.parryT = PARRY_WINDOW; b.parryCd = PARRY_COOLDOWN; b.parryRing = null;
    return true;
  }
  // remember the squeak made during a parry window, so a parry can refund it
  function tracked(b, act2) {
    const e0 = b.echoes, m0 = b.mega, id0 = ringId;
    act2();
    if (b.parryT > 0 && ringId !== id0 && !b.parryRing) b.parryRing = { id: ringId, cost: Math.max(0, e0 - b.echoes), mega: m0 && !b.mega };
  }
  // b parried an attack from attacker (sx, sy: where it came from)
  function parrySucceed(b, attacker, sx, sy, dashed) {
    b.parryT = 0;
    if (b.parryRing) {
      const pr = b.parryRing;
      b.parryRing = null;
      for (const g of rings) if (g.id === pr.id) g.gone = true;
      rings = rings.filter((g) => !g.gone);
      b.echoes = Math.min(MAX_ECHOES, b.echoes + pr.cost);
      if (pr.mega) b.mega = true;
      b.cooldown = 0;
    }
    b.charging = false; b.charge = 0;
    b.seen = 1;
    let ax = sx, ay = sy;
    if (attacker && attacker !== b && !attacker.dead) {
      ax = attacker.x; ay = attacker.y;
      attacker.seen = 1;
      attacker.biteT = 0;
      if (dashed) {
        // a parried dash bounces straight back
        const dx = attacker.x - b.x, dy = attacker.y - b.y, d = Math.hypot(dx, dy) || 1;
        attacker.dashT = 0; attacker.vx = (dx / d) * 6; attacker.vy = (dy / d) * 6;
      }
      if (attacker.safe <= 0 && attacker.stun <= 0) {
        const dx = attacker.x - b.x, dy = attacker.y - b.y, d = Math.hypot(dx, dy) || 1;
        if (attacker.shield) {
          attacker.shield = false;
          fx({ k: 'popup', x: attacker.x, y: attacker.y - 1, text: 'BLOCKED', rgb: POWERS.shield.rgb, life: 0.8 });
          fx({ k: 'sfx', n: 'block' });
        } else {
          attacker.stun = PARRY_STUN;
          attacker.dashT = 0; attacker.charging = false; attacker.charge = 0;
          const kick = dashed ? 6 : 3;
          attacker.vx = (dx / d) * kick; attacker.vy = (dy / d) * kick;
          fx({ k: 'burst', x: attacker.x, y: attacker.y, rgb: '255, 226, 120', n: 12 });
          fx({ k: 'sfx', n: 'stun' });
        }
      }
    }
    parryCount++;
    fx({ k: 'parry', x: r2(b.x), y: r2(b.y), ax: r2(ax), ay: r2(ay), rgb: b.rgb });
    fx({ k: 'popup', x: b.x, y: b.y - 1.1, text: 'PARRY!', rgb: PARRY_RGB, big: true, life: 1 });
    fx({ k: 'burst', x: b.x, y: b.y, rgb: PARRY_RGB, n: 18, sp: 4, sz: 4 });
    fx({ k: 'shake', v: 0.15 });
  }
  // the attack was not parried: note it, so a press a moment late still counts
  function noteHit(foe, by, x, y, vx, vy) {
    foe.hitBy = { by, t: clock, x, y, vx, vy };
  }
  // CPU bats parry now and then (never on Easy), and only attacks they can
  // perceive: a squeak ring they hear coming, or a beam charging at them from
  // a rival they know is there.
  function cpuParry(b, foes) {
    const lv = cpuLevel, ai = b.ai;
    if (!lv.parry || b.parryCd > 0 || b.parryT > 0) return;
    ai.parried = ai.parried || new Set();
    if (ai.parried.size > 60) ai.parried.clear();
    let go = false;
    for (const g of rings) {
      if (g.owner === b.i || g.hit.has(b.i) || ai.parried.has('r' + g.id)) continue;
      const d = dist(g, b), tti = (d - R - g.r) / RING_SPEED;
      if (d > g.max + R || tti > 0.2 || tti < 0.02) continue;
      ai.parried.add('r' + g.id);
      if (Math.random() < lv.parry) { go = true; break; }
    }
    // a rival dashing at it, heard (a dash is loud) and about to arrive
    for (const o of foes) {
      if (go) break;
      if (o.biteT <= 0 || o.stun > 0 || ai.parried.has('d' + o.i + ':' + o.dashSeq)) continue;
      const k = ai.known.get(o.i);
      if (!k || k.age > 0.3) continue;
      const d = dist(o, b), closing = ((o.vx - b.vx) * (b.x - o.x) + (o.vy - b.vy) * (b.y - o.y)) / (d || 1);
      if (closing <= 1 || (d - BITE_REACH) / closing > 0.2) continue;
      ai.parried.add('d' + o.i + ':' + o.dashSeq);
      if (Math.random() < lv.parry) go = true;
    }
    for (const o of foes) {
      if (go) break;
      if (!o.charging) { ai.parried.delete('b' + o.i); continue; }
      const k = ai.known.get(o.i);
      if (!k || k.age > 0.4 || o.charge < BEAM_CHARGE - 0.2 || ai.parried.has('b' + o.i)) continue;
      const d = dist(o, b);
      if (d > BEAM_LEN) continue;
      ai.parried.add('b' + o.i);
      if (Math.random() < lv.parry * 0.6) go = true;
    }
    if (go && parryPress(b) === true) tracked(b, () => squeak(b));
  }

  // two bats dashing into each other bounce apart, and nobody gets a bite
  function clash(a, b, ux, uy) {
    for (const [o, s] of [[a, -1], [b, 1]]) { o.biteT = 0; o.dashT = 0; o.vx = ux * s * 6; o.vy = uy * s * 6; o.seen = 1; }
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    fx({ k: 'burst', x: mx, y: my, rgb: '255, 255, 255', n: 16, sp: 4 });
    fx({ k: 'popup', x: mx, y: my - 1, text: 'CLASH!', rgb: '232, 236, 255', big: true, life: 0.8 });
    fx({ k: 'sfx', n: 'block' });
    fx({ k: 'shake', v: 0.18 });
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
      if (foe.parryT > 0) { parrySucceed(foe, b, b.x, b.y); continue; }
      if (foe.shield) {
        foe.shield = false;
        foe.vx = ux * 3; foe.vy = uy * 3;
        fx({ k: 'popup', x: foe.x, y: foe.y - 1, text: 'BLOCKED', rgb: POWERS.shield.rgb, life: 0.8 });
        fx({ k: 'burst', x: foe.x, y: foe.y, rgb: POWERS.shield.rgb, n: 12 });
        fx({ k: 'sfx', n: 'block' });
        continue;
      }
      noteHit(foe, b.i, b.x, b.y, foe.vx, foe.vy);
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
    b.biteT = DASH_TIME + BITE_GRACE;
    b.dashSeq++;
    b.dashCd = DASH_COOLDOWN;
    b.seen = Math.max(b.seen, 0.5);
    fx({ k: 'sfx', n: 'dash' });
  }

  // The bite: the stunned bat gets slurped into the eater's open mouth,
  // CHOMP, the eater puffs up, then burps out a few feathers.
  function eat(eater, food) {
    eater.score++;
    eater.biteT = 0; eater.dashT = 0;
    eater.vx *= 0.3; eater.vy *= 0.3;
    eats.push({ eater, food: { ...food }, t: 0, chomped: false, burped: false, ang: Math.atan2(food.y - eater.y, food.x - eater.x) });
    food.dead = RESPAWN_DELAY + EAT_TIME;
    food.stun = 0;
    food.power = null; food.mega = false; food.shield = false; food.charging = false; food.charge = 0;
    fx({ k: 'slowmo', t: 0.45 });
    fx({ k: 'sfx', n: 'slurp' });
    if (eater.score >= winScore) over = true;
  }

  function updateEats(dt) {
    for (const e of eats) {
      e.t += dt;
      const b = e.eater;
      b.mouth = e.t < EAT_PULL ? Math.min(1, e.t / 0.12) : 0;
      // the chomp sound starts with a short whoosh, so it begins just before the jaws snap
      if (!e.snd && e.t >= EAT_PULL - 0.11) { e.snd = true; fx({ k: 'sfx', n: 'bigChomp', alt: 'chomp' }); }
      if (!e.chomped && e.t >= EAT_PULL) {
        e.chomped = true;
        b.puff = 1;
        const mx = b.x + b.face * R * 0.4, my = b.y + R * 0.3;
        fx({ k: 'shake', v: 0.3 });
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
        winner: winner.name, winnerCpu: winner.ctrl === 'cpu', color: winner.color, humans: localCount, firstTo: winScore,
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
    Object.assign(b, { x: s.x, y: s.y, vx: 0, vy: 0, echoes: START_ECHOES, stun: 0, safe: SPAWN_SAFE, dead: 0, cooldown: 0, mouth: 0, dashT: 0, parryT: 0, parryRing: null, hitBy: null });
  }

  // Shifting and Chaos: the cave changes around the bats, but nobody moves.
  // Bats, power-ups, sound rings and bites in progress all keep their places.
  // A bat that would be inside a wall of the new cave gets a small pocket
  // carved around it, joined to the rest of the cave so it is never sealed in.
  let forceNext = -1;   // tests: which arena the next shift lands on
  function shiftArena() {
    const oldW = arena.w, oldH = arena.h, keepPowers = powerups;
    loadArena(forceNext >= 0 ? forceNext : nextArenaIndex());
    forceNext = -1;
    const { w, h } = arena;
    // a different-sized cave: scale positions across, then keep them inside the border
    const sx = (w - 2) / (oldW - 2), sy = (h - 2) / (oldH - 2);
    const fit = (p) => {
      if (oldW !== w || oldH !== h) { p.x = 1 + (p.x - 1) * sx; p.y = 1 + (p.y - 1) * sy; }
      p.x = Math.max(1 + R, Math.min(w - 1 - R, p.x));
      p.y = Math.max(1 + R, Math.min(h - 1 - R, p.y));
    };
    const live = bats.filter((b) => !b.dead);
    for (const b of live) fit(b);
    for (const ring of rings) fit(ring);
    beams = [];
    const opened = [];
    const open = (tx, ty) => {
      if (tx < 1 || ty < 1 || tx > w - 2 || ty > h - 2) return;   // never the outer border
      const k = ty * w + tx;
      if (arena.grid[k]) { arena.grid[k] = 0; opened.push(k); }
    };
    for (const b of live) {
      if (!hitsWall(b.x, b.y, R)) continue;
      const cx = Math.floor(b.x), cy = Math.floor(b.y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) open(cx + dx, cy + dy);
    }
    // nobody may end up shut away from the rest of the cave: tunnel out of any closed pocket
    for (const b of live) {
      const path = tunnelOut(Math.floor(b.x), Math.floor(b.y));
      for (const k of path) open(k % w, Math.floor(k / w));
    }
    carved = opened;
    for (const k of opened) tileGlow[k] = 1;
    if (opened.length) fx({ k: 'tiles', c: opened.map((k) => [k, 0]) });
    // power-ups stay put; one swallowed by rock pops out into the nearest open spot
    powerups = keepPowers.filter((p) => {
      fit(p);
      if (!solid(Math.floor(p.x), Math.floor(p.y))) return true;
      const spot = arena.open.filter((q) => !solid(Math.floor(q.x), Math.floor(q.y))).sort((q, r) => dist(q, p) - dist(r, p))[0];
      if (!spot || dist(spot, p) > 3) return false;
      p.x = spot.x; p.y = spot.y;
      return true;
    });
    for (const b of bats) if (b.ai) { b.ai.path = []; b.ai.roam = null; }
    fx({ k: 'banner', text: arena.def.name, rgb: arena.theme.wall, t: 2.2 });
    fx({ k: 'sfx', n: 'crash' });
  }
  // The cave's main open area is its biggest connected stretch of open tiles.
  // If tile (sx, sy) isn't part of it, return the wall tiles to dig through to
  // reach it by the shortest way (empty when it's already connected).
  function tunnelOut(sx, sy) {
    const { w, h, grid } = arena, n = w * h;
    const comp = new Int32Array(n).fill(-1), sizes = [];
    for (let k = 0; k < n; k++) {
      if (grid[k] || comp[k] >= 0) continue;
      const id = sizes.length, q = [k];
      comp[k] = id;
      for (let j = 0; j < q.length; j++) {
        const c = q[j], cx = c % w, cy = (c / w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy, m = ny * w + nx;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || grid[m] || comp[m] >= 0) continue;
          comp[m] = id; q.push(m);
        }
      }
      sizes.push(q.length);
    }
    const main = sizes.indexOf(Math.max(...sizes)), start = sy * w + sx;
    if (comp[start] === main) return [];
    // breadth-first through rock (inside the border) until the main area
    const prev = new Int32Array(n).fill(-1), q = [start];
    prev[start] = start;
    let goal = -1;
    for (let j = 0; j < q.length && goal < 0; j++) {
      const c = q[j], cx = c % w, cy = (c / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, m = ny * w + nx;
        if (nx < 1 || ny < 1 || nx > w - 2 || ny > h - 2 || prev[m] >= 0) continue;
        prev[m] = c;
        if (comp[m] === main) { goal = m; break; }
        q.push(m);
      }
    }
    const path = [];
    for (let c = goal >= 0 ? prev[goal] : start; c !== start; c = prev[c]) if (grid[c]) path.push(c);
    return path;
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
      b.parryCd = Math.max(0, b.parryCd - dt);
      b.biteT = Math.max(0, b.biteT - dt);
      if (b.parryT > 0) { b.parryT = Math.max(0, b.parryT - dt); if (b.parryT <= 0) b.parryRing = null; }
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

    // biting: a bat mid-dash (or just after) that touches any rival chomps it,
    // unless the rival parries, blocks with a shield, or is dashing too (a clash)
    if (!over) {
      outer: for (const a of bats) {
        if (a.dead || a.stun > 0 || a.biteT <= 0) continue;
        for (const b of bats) {
          if (b === a || b.dead || b.safe > 0 || Math.hypot(a.x - b.x, a.y - b.y) >= BITE_REACH) continue;
          const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
          if (b.biteT > 0 && b.stun <= 0) { clash(a, b, ux, uy); continue outer; }
          if (b.parryT > 0 && b.stun <= 0) { parrySucceed(b, a, a.x, a.y, true); continue outer; }
          if (b.shield) {
            b.shield = false;
            a.biteT = 0; a.dashT = 0; a.vx = -ux * 5; a.vy = -uy * 5;
            b.vx = ux * 3; b.vy = uy * 3;
            fx({ k: 'popup', x: b.x, y: b.y - 1, text: 'BLOCKED', rgb: POWERS.shield.rgb, life: 0.8 });
            fx({ k: 'burst', x: b.x, y: b.y, rgb: POWERS.shield.rgb, n: 12 });
            fx({ k: 'sfx', n: 'block' });
            continue outer;
          }
          eat(a, b);
          break outer;
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
      if (ring.gone) continue;
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
          if (foe.parryT > 0) { parrySucceed(foe, bats[ring.owner], ring.x, ring.y); continue; }
          if (foe.shield) {
            foe.shield = false;
            foe.vx = ((foe.x - ring.x) / k) * 3; foe.vy = ((foe.y - ring.y) / k) * 3;
            fx({ k: 'popup', x: foe.x, y: foe.y - 1, text: 'BLOCKED', rgb: POWERS.shield.rgb, life: 0.8 });
            fx({ k: 'burst', x: foe.x, y: foe.y, rgb: POWERS.shield.rgb, n: 12 });
            fx({ k: 'sfx', n: 'block' });
            continue;
          }
          noteHit(foe, ring.owner, ring.x, ring.y, foe.vx, foe.vy);
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
    rings = rings.filter((ring) => ring.r < ring.max && !ring.gone);
  }

  function tickCosmetics(dt) {
    shake = Math.max(0, shake - dt);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    updateAmbient(dt);
    if (tileGlow) for (let k = 0; k < tileGlow.length; k++) if (tileGlow[k] > 0) tileGlow[k] = Math.max(0, tileGlow[k] - dt * 0.6);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < p.life);
    for (const p of parries) p.t += dt;
    parries = parries.filter((p) => p.t < PARRY_FX);
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
        r2(b.mouth), r2(b.puff), r2(b.dashCd), b.power || 0, r2(b.powerT), b.mega ? 1 : 0, b.shield ? 1 : 0, b.ctrl === 'cpu' ? 1 : 0, r2(b.dashT), b.charging ? r2(b.charge) : -1, r2(b.parryT)]),
      bm: beams.map((m) => [m.id, r2(m.x), r2(m.y), r2(m.ux), r2(m.uy), r2(m.len), m.owner, r2(m.t)]),
      r: rings.map((g) => [g.id, r2(g.x), r2(g.y), r2(g.r), g.owner, g.max, g.big ? 1 : 0]),
      c: crystals.map((c) => (c.on ? 1 : 0)).join(''),
      p: powerups.map((p) => [r2(p.x), r2(p.y), p.type]),
      e: eats.map((e) => [e.eater.i, e.food.i, r2(e.food.x), r2(e.food.y), r2(e.t), r2(e.ang)]),
      fx: outbox,
      ft: winScore,
    };
    if (carved.length) s.cv = carved;
    outbox = [];
    return s;
  }

  function applySnapshot(s) {
    if (mode !== 'client' || !active) return;
    if (s.a !== arenaIndex) loadArena(s.a);
    if (s.am) arenaMode = s.am;
    if (s.ft) winScore = s.ft;
    // pockets the host carved so nobody ended up inside a wall after a shift
    if (s.cv) for (const k of s.cv) if (arena.grid[k]) { arena.grid[k] = 0; tileGlow[k] = 1; }
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
      b.parryT = v[21] || 0;
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
    eats = s.e.map(([ei, fi, fx2, fy2, t, ang]) => {
      const f = bats[fi];
      return { eater: bats[ei], food: { ...f, x: fx2, y: fy2 }, t, ang };
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
  // rounded, chunky type everywhere, like the menus
  const FONT = '"Fredoka", "Nunito", system-ui, sans-serif';
  const HEAD = FONT;
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
    // a bat mid-chomp is never hidden, however dark it is
    if (eats.some((e) => e.eater && e.eater.i === b.i)) return 1;
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

  // crystals and power-ups stay hidden too, until sound or a bat's senses find them
  function seenAt(x, y) {
    let a = litAt(x, y);
    for (const b of senses()) a = Math.max(a, Math.max(0, Math.min(1, 1 - (Math.hypot(x - b.x, y - b.y) - 1) / 1.5)));
    return Math.min(1, a * 1.2);
  }

  const BAT_RGB = BATS.map((b) => b.rgb.split(',').map((v) => +v / 255));
  function render() {
    if (in3d()) {
      const follow = viewer >= 0 ? bats[viewer] : localBat(0);
      const ok = window.EchoDuel3D.render({
        W, H, arena, bats, lit, litBy, tileGlow, near: senses(), clock, rings, beams, crystals, powerups, eats, shake, follow,
        batVisible, seenAt, batRgb: BAT_RGB, POWERS, BEAM_LIFE, EAT_PULL,
      });
      if (ok) { render3dOverlay(follow); return; }
    }
    window.EchoDuel3D?.hide();
    const th = arena.theme;
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, H);
    // the map fills the screen; the scoreboard and arena info float over its border walls
    const top = 4, bottom = 4;
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
    drawChomps((x, y) => ({ x: X(x), y: Y(y), s: PX }), true);
    drawParries((x, y) => ({ x: X(x), y: Y(y), s: PX }));

    for (const p of popups) {
      const k = p.t / p.life;
      const pop = p.big ? 1 + 0.6 * Math.max(0, 1 - p.t * 6) : 1;
      ctx.font = `700 ${Math.max(p.big ? 18 : 11, PX * (p.big ? 0.9 : 0.45)) * pop}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(${p.rgb}, ${1 - k * k})`;
      ctx.fillText(p.text, X(p.x), Y(p.y - k * 0.6));
    }

    drawScreen();
  }

  // The 3D view draws the world; labels, sparks and the HUD go on the flat canvas on top
  function render3dOverlay(follow) {
    const P = window.EchoDuel3D.project;
    ctx.clearRect(0, 0, W, H);
    drawVignette();
    const c = P(follow ? follow.x : arena.w / 2, follow ? follow.y : arena.h / 2);
    PX = c.s;
    ox = 0; oy = H / 2 - (arena.h * PX) / 2;
    const th = arena.theme;
    for (const p of ambient) {
      const l = litAt(p.x, p.y);
      if (l < 0.05) continue;
      const q = P(p.x, p.y, 0.3 + (p.phase % 1) * 0.6);
      if (q.off) continue;
      ctx.fillStyle = `rgba(${th.ambientRgb}, ${0.55 * l})`;
      ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.2, p.size * q.s * 0.6), 0, Math.PI * 2); ctx.fill();
    }
    for (const p of particles) {
      const q = P(p.x, p.y);
      if (q.off) continue;
      const size = p.size * q.s / 34;
      ctx.fillStyle = `rgba(${p.rgb}, ${Math.min(1, p.life * 1.6)})`;
      if (p.feather) {
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(p.life * 6);
        ctx.beginPath(); ctx.ellipse(0, 0, size, size * 0.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else ctx.fillRect(q.x - size / 2, q.y - size / 2, size, size);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const b of bats) {
      if (b.dead) continue;
      const v = batVisible(b);
      if (v < 0.03 || (b.safe > 0 && Math.floor(b.safe * 10) % 2 === 0)) continue;
      const q = P(b.x, b.y), s = q.s;
      if (q.off) continue;
      ctx.globalAlpha = b.ctrl === 'local' || viewer === b.i ? 1 : v;
      if (b.charging && b.charge > 0.12) {
        const k = Math.min(1, b.charge / BEAM_CHARGE), full = k >= 1;
        ctx.strokeStyle = full ? `rgba(255, 255, 255, ${0.6 + 0.4 * Math.sin(clock * 20)})` : `rgba(${b.rgb}, 0.9)`;
        ctx.lineWidth = Math.max(2.5, s * 0.08);
        ctx.beginPath(); ctx.arc(q.x, q.y, s * 0.75, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
      }
      if (b.mega) {
        ctx.strokeStyle = `rgba(${POWERS.mega.rgb}, ${0.5 + 0.4 * Math.sin(clock * 8)})`;
        ctx.lineWidth = Math.max(1.5, s * 0.05);
        ctx.beginPath(); ctx.arc(q.x, q.y, s * 0.6, 0, Math.PI * 2); ctx.stroke();
      }
      if (b.stun > 0) {
        ctx.font = `700 ${Math.max(10, s * 0.32)}px ${FONT}`;
        ctx.fillStyle = '#ffe278';
        ctx.fillText('STUNNED', q.x, q.y - s * 0.95);
      }
      // name tag under the bat, in a light tint of its colour
      ctx.font = `600 ${Math.max(11, s * 0.32)}px ${FONT}`;
      ctx.fillStyle = `rgba(${b.rgb.split(',').map((x) => Math.round(+x + (255 - x) * 0.45)).join(',')}, 0.95)`;
      const you = viewer === b.i ? ' (you)' : '';
      ctx.fillText((b.ctrl === 'cpu' || b.cpuFlag ? `${b.name} · CPU` : b.name) + you, q.x, q.y + s * 0.78);
      ctx.globalAlpha = 1;
    }
    drawChomps(P);
    drawParries(P);
    for (const p of popups) {
      const k = p.t / p.life;
      const pop = p.big ? 1 + 0.6 * Math.max(0, 1 - p.t * 6) : 1;
      const q = P(p.x, p.y - k * 0.6, 1);
      if (q.off) continue;
      ctx.font = `700 ${Math.max(p.big ? 18 : 11, q.s * (p.big ? 0.9 : 0.45)) * pop}px ${FONT}`;
      ctx.fillStyle = `rgba(${p.rgb}, ${1 - k * k})`;
      ctx.fillText(p.text, q.x, q.y);
    }
    drawScreen();
  }

  // The chomp: a big Pac-Man mouth with jagged teeth opens wide toward the
  // victim, snaps shut on it, then three bold slashes rip across the bite.
  // P(x, y) maps arena to screen: { x, y, s } (s = pixels per tile).
  function drawChomps(P, flat) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const e of eats) {
      const b = e.eater;
      if (!b) continue;
      const t = e.t, ang = e.ang ?? (e.ang = Math.atan2(e.food.y - b.y, e.food.x - b.x));
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const q = P(b.x + ca * 0.25, b.y + sa * 0.25);
      if (q.off) continue;
      const S = q.s;
      // the mouth: pops up, gapes, snaps shut at EAT_PULL, then shrinks away
      if (t < EAT_PULL + 0.3) {
        const grow = Math.min(1, t / 0.08), after = Math.max(0, t - EAT_PULL) / 0.3;
        const rad = S * (0.85 + 0.35 * grow) * (1 - after * 0.6) * (1 + 0.12 * Math.max(0, 1 - Math.abs(t - EAT_PULL) / 0.06));
        const gape = t < EAT_PULL * 0.6 ? 0.95 * Math.min(1, t / (EAT_PULL * 0.45)) : t < EAT_PULL ? 0.95 * (1 - ((t - EAT_PULL * 0.6) / (EAT_PULL * 0.4)) ** 2) : 0;
        const op = gape + 0.02, alpha = 1 - after;
        ctx.globalAlpha = alpha;
        glow(q.x, q.y, rad * 1.7, b.rgb, 0.35);
        // dark throat behind the jaws
        ctx.fillStyle = '#1a0610';
        ctx.beginPath(); ctx.arc(q.x, q.y, rad * 0.94, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.arc(q.x, q.y, rad, ang + op, ang - op + Math.PI * 2);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'; ctx.lineWidth = Math.max(1.5, S * 0.05); ctx.stroke();
        // jagged teeth along both jaws, pointing into the gap
        if (gape > 0.08) {
          ctx.fillStyle = '#fff';
          for (const side of [1, -1]) {
            const ja = ang + side * op, jx = Math.cos(ja), jy = Math.sin(ja);
            const nx = -jy * side, ny = jx * side;   // into the gap
            for (let k = 0; k < 4; k++) {
              const f0 = 0.3 + k * 0.17, f1 = f0 + 0.15, tip = rad * (0.13 + 0.04 * (k % 2));
              const x0 = q.x + jx * rad * f0, y0 = q.y + jy * rad * f0, x1 = q.x + jx * rad * f1, y1 = q.y + jy * rad * f1;
              ctx.beginPath();
              ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
              ctx.lineTo((x0 + x1) / 2 - nx * tip, (y0 + y1) / 2 - ny * tip);
              ctx.closePath(); ctx.fill();
            }
          }
        }
        // a fierce eye above the jaw
        const up = ca >= 0 ? [sa, -ca] : [-sa, ca];   // the side of the jaw facing up the screen
        const ex = q.x + up[0] * rad * 0.5 - ca * rad * 0.12, ey = q.y + up[1] * rad * 0.5 - sa * rad * 0.12;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, rad * 0.13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1030'; ctx.beginPath(); ctx.arc(ex + ca * rad * 0.04, ey + sa * rad * 0.04, rad * 0.07, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      // the victim, spinning and shrinking as it's sucked into the jaws
      if (t < EAT_PULL) {
        const k = t / EAT_PULL, ease = k * k;
        const mx = b.x + ca * 0.3, my = b.y + sa * 0.3;
        const v = P(e.food.x + (mx - e.food.x) * ease, e.food.y + (my - e.food.y) * ease);
        if (flat) drawBat(e.food, v.x, v.y, { scale: 1 - 0.8 * ease, rot: k * 9, alpha: 1, stunned: true, tag: false });
        else if (!v.off) {
          const r = v.s * R * 1.15 * (1 - 0.8 * ease);
          ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(k * 9);
          ctx.fillStyle = e.food.color;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.2); ctx.lineTo(-r * 2.1, -r * 0.7); ctx.lineTo(-r * 1.5, r * 0.4); ctx.closePath();
          ctx.moveTo(r * 0.6, -r * 0.2); ctx.lineTo(r * 2.1, -r * 0.7); ctx.lineTo(r * 1.5, r * 0.4); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, r * 0.14);
          for (const sd of [-1, 1]) {
            const ex = sd * r * 0.35, ey = -r * 0.1, q2 = r * 0.16;
            ctx.beginPath(); ctx.moveTo(ex - q2, ey - q2); ctx.lineTo(ex + q2, ey + q2); ctx.moveTo(ex + q2, ey - q2); ctx.lineTo(ex - q2, ey + q2); ctx.stroke();
          }
          ctx.restore();
        }
      }
      // three big slashes across the bite, drawn in fast and fading out
      const st = t - EAT_PULL + 0.04;
      if (st > 0 && st < 0.75) {
        const c = P(b.x + ca * 0.6, b.y + sa * 0.6), L = c.s * 1.5, fade = st < 0.45 ? 1 : 1 - (st - 0.45) / 0.3;
        const sl = ang + Math.PI / 2 + 0.6, ux = Math.cos(sl), uy = Math.sin(sl), px = -uy, py = ux;
        for (let k = 0; k < 3; k++) {
          const draw = Math.min(1, Math.max(0, (st - k * 0.035) / 0.09));
          if (draw <= 0) continue;
          const off = (k - 1) * c.s * 0.42, x0 = c.x + px * off - ux * L, y0 = c.y + py * off - uy * L;
          const x1 = x0 + ux * L * 2 * draw, y1 = y0 + uy * L * 2 * draw;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
          ctx.strokeStyle = `rgba(${b.rgb}, ${0.5 * fade})`; ctx.lineWidth = Math.max(6, c.s * 0.34); ctx.stroke();
          ctx.strokeStyle = `rgba(255, 70, 90, ${0.75 * fade})`; ctx.lineWidth = Math.max(3.5, c.s * 0.17); ctx.stroke();
          ctx.strokeStyle = `rgba(255, 255, 255, ${fade})`; ctx.lineWidth = Math.max(1.5, c.s * 0.065); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // Parry: a bat's open parry window shows as a thin bright guard ring; a
  // successful parry flashes white-gold rings with a spark burst and a crackle
  // of light back to the attacker. P(x, y) maps arena to screen: { x, y, s }.
  function drawParries(P) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const b of bats) {
      if (b.dead || b.parryT <= 0 || batVisible(b) < 0.3) continue;
      const q = P(b.x, b.y);
      if (q.off) continue;
      const k = b.parryT / PARRY_WINDOW;
      ctx.strokeStyle = `rgba(${PARRY_RGB}, ${0.35 + 0.55 * k})`;
      ctx.lineWidth = Math.max(1.5, q.s * 0.06);
      ctx.beginPath(); ctx.arc(q.x, q.y, q.s * (0.62 + 0.15 * (1 - k)), 0, Math.PI * 2); ctx.stroke();
    }
    let flash = 0;
    for (const p of parries) {
      const q = P(p.x, p.y);
      if (q.off) continue;
      const k = p.t / PARRY_FX, f = 1 - k;
      flash = Math.max(flash, 1 - p.t / 0.18);
      // crackle of light back to the attacker
      if (p.t < 0.45 && Math.hypot(p.ax - p.x, p.ay - p.y) > 0.6) {
        const a = P(p.ax, p.ay);
        if (!a.off) {
          const fl = 1 - p.t / 0.45, dx = a.x - q.x, dy = a.y - q.y, len = Math.hypot(dx, dy) || 1;
          ctx.beginPath(); ctx.moveTo(q.x, q.y);
          for (let j = 1; j < 8; j++) {
            const t = j / 8, jig = (((j * 7919 + Math.floor(p.t * 30) * 31) % 13) / 13 - 0.5) * q.s * 0.5;
            ctx.lineTo(q.x + dx * t - (dy / len) * jig, q.y + dy * t + (dx / len) * jig);
          }
          ctx.lineTo(a.x, a.y);
          ctx.strokeStyle = `rgba(${p.rgb}, ${0.45 * fl})`; ctx.lineWidth = Math.max(4, q.s * 0.22); ctx.stroke();
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.95 * fl})`; ctx.lineWidth = Math.max(1.5, q.s * 0.06); ctx.stroke();
        }
      }
      // two rings bursting outwards, white then gold
      for (const [d, rgb] of [[0, '255, 255, 255'], [0.08, PARRY_RGB]]) {
        const t = Math.max(0, k - d);
        if (t <= 0) continue;
        ctx.strokeStyle = `rgba(${rgb}, ${0.95 * (1 - t)})`;
        ctx.lineWidth = Math.max(2, q.s * 0.14 * (1 - t));
        ctx.beginPath(); ctx.arc(q.x, q.y, q.s * (0.4 + 1.6 * Math.sqrt(t)), 0, Math.PI * 2); ctx.stroke();
      }
      // a star of short spikes
      if (k < 0.4) {
        ctx.strokeStyle = `rgba(255, 255, 255, ${1 - k / 0.4})`;
        ctx.lineWidth = Math.max(1.5, q.s * 0.07);
        ctx.beginPath();
        for (let j = 0; j < 8; j++) {
          const ang = (j / 8) * Math.PI * 2 + 0.2, r0 = q.s * (0.5 + k), r1 = q.s * (0.9 + 1.6 * k);
          ctx.moveTo(q.x + Math.cos(ang) * r0, q.y + Math.sin(ang) * r0); ctx.lineTo(q.x + Math.cos(ang) * r1, q.y + Math.sin(ang) * r1);
        }
        ctx.stroke();
      }
      glow(q.x, q.y, q.s * 1.6, PARRY_RGB, 0.5 * f);
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255, 250, 225, ${0.16 * flash})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  // Screen-space layer shared by both views: warnings, HUD, touch controls, fades
  function drawScreen() {
    const th = arena.theme;
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
    const ready = me.dashCd <= 0, k = ready ? 1 : 0.55;
    // glassy purple disc
    const g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, `rgba(120, 90, 235, ${0.55 * k})`);
    g.addColorStop(1, `rgba(36, 22, 92, ${0.72 * k})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    // glowing violet ring, filling up again while the dash recharges
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    glowStroke('rgba(80, 60, 160, 0.7)', 3.5, ready ? 'rgba(160, 120, 255, 1)' : null);
    ctx.strokeStyle = '#a68bff'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, 1 - me.dashCd / DASH_COOLDOWN)); ctx.stroke();
    ctx.font = `700 ${Math.round(b.r * 0.4)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = ready ? '#f4f1ff' : 'rgba(244, 241, 255, 0.45)';
    ctx.fillText('DASH', b.x, b.y - b.r * 0.12);
    batGlyph(b.x, b.y + b.r * 0.38, b.r * 0.62, ready ? '#8f6dff' : 'rgba(143, 109, 255, 0.45)');
  }
  // a little flying-bat silhouette, w wide, centred on x, y
  function batGlyph(x, y, w, color) {
    const s = w / 2;
    ctx.fillStyle = color;
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

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // a glassy pill with a thin glowing outline, like the menus
  function pill(x, y, w, h, edge, glowAmt = 10) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(26, 22, 64, 0.78)');
    g.addColorStop(1, 'rgba(8, 8, 26, 0.82)');
    ctx.fillStyle = g;
    roundRect(x, y, w, h, h / 2); ctx.fill();
    glowStroke(edge, 2, edge, glowAmt / 10);
  }
  // a line with a soft halo: wide faint strokes under a thin bright one (much
  // cheaper on phones than canvas shadows). Strokes the current path.
  function glowStroke(color, width, halo = color, k = 1) {
    if (halo && k > 0) {
      ctx.strokeStyle = halo;
      ctx.globalAlpha = 0.1 * k; ctx.lineWidth = width + 9; ctx.stroke();
      ctx.globalAlpha = 0.22 * k; ctx.lineWidth = width + 4; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  // darkened screen corners, the cave closing in around the light
  let vignette = null, vigW = 0, vigH = 0;
  function drawVignette() {
    if (!vignette || vigW !== W || vigH !== H) {
      vigW = W; vigH = H;
      vignette = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.hypot(W, H) * 0.6);
      vignette.addColorStop(0, 'rgba(4, 3, 16, 0)');
      vignette.addColorStop(1, 'rgba(4, 3, 16, 0.6)');
    }
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  // The scoreboard and arena info only change when a number does, so they are
  // drawn into a cached layer and stamped each frame (much cheaper on phones)
  let hudLayer = null;
  const infoText = () => {
    const tail = arenaMode === 'morph' ? 'the cave keeps changing' : arenaMode === 'sky' ? 'no cave tonight' : `shifts in ${Math.max(0, Math.ceil(shiftTimer))}s`;
    return `${arena.def.name.toUpperCase()}  ·  ${tail.toUpperCase()}  ·  FIRST TO ${winScore}`;
  };
  const infoUrgent = () => shiftTimer < shiftWarning() + 2 && arenaMode !== 'morph' && arenaMode !== 'sky';
  function drawHud() {
    const dpr = ctx.getTransform().a || 1, ph = Math.max(30, Math.min(40, H * 0.085)), topH = Math.ceil(8 + ph + 12);
    const size = Math.max(13, Math.min(20, H / 26)), botH = Math.ceil(size * 1.55 + 22);
    let key = `${W},${H},${dpr},${viewer},${localCount},${infoText()},${infoUrgent()}`;
    for (const b of bats) key += `|${b.name},${b.ctrl},${b.cpuFlag},${b.score},${b.echoes},${b.power},${b.power ? Math.ceil(b.powerT) : 0},${b.mega},${b.shield}`;
    if (!hudLayer) { const c = document.createElement('canvas'); hudLayer = { c, g: c.getContext('2d'), key: '' }; }
    const c = hudLayer.c;
    if (hudLayer.key !== key) {
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      const main = ctx;
      ctx = hudLayer.g;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawHudPills(ph, size);
      ctx = main;
      hudLayer.key = key;
    }
    ctx.drawImage(c, 0, 0, c.width, topH * dpr, 0, 0, W, topH);
    ctx.drawImage(c, 0, c.height - botH * dpr, c.width, botH * dpr, 0, H - botH, W, botH);
    drawHudMiddle(size);
  }

  // Scoreboard: one pill per bat along the top, split around the pause button
  function drawHudPills(ph, size) {
    const n = bats.length, pad = 10, centerGap = 34;
    const left = Math.ceil(n / 2);
    // each side's pills must stay clear of the pause button in the middle
    const pw = Math.min(250, (W / 2 - pad - centerGap) / left - 8);
    ctx.textBaseline = 'middle';
    bats.forEach((b, k) => {
      const x = k < left ? pad + k * (pw + 8) : W - pad - (n - k) * (pw + 8) + 8;
      const y = 8;
      const mine = viewer === b.i || (b.ctrl === 'local' && localCount === 1);
      pill(x, y, pw, ph, mine ? b.color : `rgba(${b.rgb}, 0.6)`, mine ? 12 : 6);
      // the score in a coloured lozenge at the left
      // the score out of the match length, e.g. 2/5
      const sh = ph * 0.66, sw = sh * 2.05, sx = x + ph * 0.2, cy = y + ph / 2;
      roundRect(sx, cy - sh / 2, sw, sh, sh / 2);
      ctx.fillStyle = b.color; ctx.fill();
      ctx.globalAlpha = 0.25; ctx.strokeStyle = b.color; ctx.lineWidth = 5; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#16123a';
      ctx.font = `700 ${Math.round(sh * 0.72)}px ${HEAD}`;
      ctx.textAlign = 'center';
      const sc = String(b.score), tot = `/${winScore}`;
      const w1 = ctx.measureText(sc).width;
      ctx.font = `600 ${Math.round(sh * 0.45)}px ${HEAD}`;
      const w2 = ctx.measureText(tot).width, x1 = sx + sw / 2 - (w1 + w2) / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(22, 18, 58, 0.62)';
      ctx.fillText(tot, x1 + w1, cy + 2);
      ctx.fillStyle = '#16123a';
      ctx.font = `700 ${Math.round(sh * 0.72)}px ${HEAD}`;
      ctx.fillText(sc, x1, cy + 1);
      // name, with a tag underneath
      const tags = [];
      if (b.ctrl === 'cpu' || b.cpuFlag) tags.push('CPU');
      if (mine) tags.push('YOU');
      if (b.power) tags.push(`${POWERS[b.power].label} ${Math.ceil(b.powerT)}`);
      else if (b.mega) tags.push('MEGA');
      else if (b.shield) tags.push('SHIELD');
      ctx.textAlign = 'left';
      ctx.fillStyle = b.color;
      ctx.font = `700 ${Math.round(ph * 0.42)}px ${HEAD}`;
      const nx = sx + sw + ph * 0.22;
      ctx.fillText(b.name, nx, cy - (tags.length ? ph * 0.13 : 0));
      if (tags.length) {
        ctx.font = `600 ${Math.round(ph * 0.25)}px ${FONT}`;
        ctx.fillStyle = 'rgba(214, 208, 255, 0.7)';
        ctx.fillText(tags.join(' · '), nx, cy + ph * 0.24);
      }
      // echoes left as pips on the right
      const pr = Math.max(2.4, ph * 0.08), gap = pr * 2.8;
      const px0 = x + pw - ph * 0.45 - (MAX_ECHOES - 1) * gap;
      for (let e = 0; e < MAX_ECHOES; e++) {
        ctx.beginPath(); ctx.arc(px0 + e * gap, cy, pr, 0, Math.PI * 2);
        if (b.power === 'frenzy' || e < b.echoes) { ctx.fillStyle = b.color; ctx.fill(); }
        else { ctx.fillStyle = 'rgba(214, 208, 255, 0.16)'; ctx.fill(); }
      }
    });

    // arena info pill along the bottom, with thin lines reaching out from both sides
    const info = infoText();
    ctx.font = `600 ${Math.round(size * 0.7)}px ${FONT}`;
    const iw = ctx.measureText(info).width + 40, ih = size * 1.55, iy = H - ih - 10;
    const urgent = infoUrgent();
    const edge = urgent ? `rgb(${arena.theme.wall})` : 'rgba(150, 130, 255, 0.75)';
    ctx.strokeStyle = urgent ? `rgba(${arena.theme.wall}, 0.6)` : 'rgba(150, 130, 255, 0.45)';
    ctx.lineWidth = 1.5;
    const ly = iy + ih / 2, ll = Math.min(48, W * 0.05);
    ctx.beginPath();
    ctx.moveTo(W / 2 - iw / 2 - 12, ly); ctx.lineTo(W / 2 - iw / 2 - 12 - ll, ly);
    ctx.moveTo(W / 2 + iw / 2 + 12, ly); ctx.lineTo(W / 2 + iw / 2 + 12 + ll, ly);
    ctx.stroke();
    pill(W / 2 - iw / 2, iy, iw, ih, edge, 8);
    ctx.textAlign = 'center';
    ctx.fillStyle = urgent ? `rgb(${arena.theme.wall})` : 'rgba(234, 230, 255, 0.88)';
    ctx.fillText(info, W / 2, ly + 1);
  }

  // countdown, banners and split-screen lines over the middle of the screen
  function drawHudMiddle(size) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const mid = oy + (arena.h * PX) / 2;
    if (countdown > 0) {
      ctx.font = `700 ${size * 4.5}px ${HEAD}`;
      ctx.fillStyle = 'rgba(5, 6, 15, 0.9)';
      ctx.fillText(String(Math.ceil(countdown)), W / 2, mid - size * 1.5 + 5);
      ctx.fillStyle = '#f4f1ff';
      ctx.fillText(String(Math.ceil(countdown)), W / 2, mid - size * 1.5);
      ctx.font = `600 ${size}px ${FONT}`;
      ctx.fillStyle = 'rgba(232, 236, 255, 0.9)';
      ctx.fillText(`Dash into a rival to chomp it (stun it with a squeak first). First to ${winScore} bites wins.`, W / 2, mid + size * 1.4);
      ctx.fillStyle = 'rgba(232, 236, 255, 0.65)';
      ctx.font = `600 ${size * 0.8}px ${FONT}`;
      const how = localCount === 1
        ? (touchUsed ? 'Drag to fly · tap to squeak · hold a 2nd finger, let go: beam · flick or DASH to dash'
          : 'WASD or arrows to fly · F to squeak, hold F for a beam · G to dash · Esc to pause')
        : `Each player owns ${['', 'the screen', 'half', 'a third', 'a quarter'][localCount]} of the screen · tap to squeak · hold a 2nd finger to charge a beam · flick to dash`;
      ctx.fillText(how, W / 2, mid + size * 2.7);
      ctx.fillText('Squeak just before a rival\'s echo hits you to PARRY it · grab glowing power-ups', W / 2, mid + size * 3.9);
    } else if (banner) {
      ctx.font = `700 ${size * 2}px ${HEAD}`;
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
    get view() { return view; },
    setView: (v) => { view = v === '2d' ? '2d' : '3d'; if (view === '2d') window.EchoDuel3D?.hide(); },
    setPaused: (p) => { paused = p; if (p) { keys.clear(); sticks.clear(); chargers.clear(); } },
    setShiftTimer: (s) => { shiftTimer = s; },
    spawnPowerup: (type) => { spawnPowerup(); if (type && powerups.length) powerups[powerups.length - 1].type = type; },
    squeak: (i) => squeak(bats[i]),
    act: (i, a) => doAct(bats[i], a),
    beam: (i, ux, uy) => fireBeam(bats[i], ux === undefined ? undefined : { ux, uy }),
    shiftTo: (i) => { forceNext = i; shiftTimer = 0.01; },
    get rings() { return rings; },
    get parries() { return parries; },
    get parryCount() { return parryCount; },
    get eats() { return eats; },
    get carved() { return carved; },
    get winScore() { return winScore; },
    get arenaIndex() { return arenaIndex; },
    get shifting() { return !!shift; },
    dash: (i, dx, dy) => dash(bats[i], dx, dy),
  };
})();
