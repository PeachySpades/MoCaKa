// Co-op Run: 1 to 4 bats fly one side-scrolling cave together while monsters
// try to stop them. The screen scrolls right on its own (everyone shares it),
// a little faster in each of the cave's four sections. Squeak to light the cave
// and stun monsters; dash into a stunned monster (or a small one) to destroy it.
// Each bat has 3 hearts. A bat that runs out (or gets pinned against the left
// edge by a wall) is knocked out and drifts along as a ghost until a living
// teammate reaches the next checkpoint lantern, which revives it with 1 heart.
// If every bat is knocked out the team starts again from the last checkpoint;
// after 3 tries it's game over. Any bat reaching the green light wins.
//
// Same shape as duel.js, so the lobby can launch it the same way:
//   local   everyone on one device (split touch zones / shared keyboard), plus CPU bats
//   host    this device simulates the run for an online room and streams snapshots
//   client  this device shows snapshots from the host and sends its own input
(() => {
  'use strict';

  // ---- Tuning ------------------------------------------------------------
  const R = 0.28, ACCEL = 30, MAX_SPEED = 4.6, DRAG = 3.4, GHOST_SPEED = 3.4;
  const RING_SPEED = 11, RING_MAX = 7.5, SQUEAK_COOLDOWN = 0.45, LIGHT_FADE = 0.7, LOUD_TIME = 2.5;
  const MAX_HEARTS = 3, HURT_TIME = 1.4, REVIVE_SAFE = 2.5;
  const START_ECHOES = 8, MAX_ECHOES = 12, CRYSTAL_ECHOES = 3;
  const DASH_SPEED = 12, DASH_TIME = 0.16, DASH_COOLDOWN = 1.6, BITE_GRACE = 0.12;
  const VIEW_W = 24;            // tiles of cave the whole team shares, on every device
  const TRIES = 3;
  const SPEEDS = [2.3, 2.6, 2.9, 3.2];   // scroll speed per section, tiles per second
  const SNAPSHOT_EVERY = 0.05;
  const DIFF = {
    easy: { speed: 0.9, stun: 3.2, owl: 6, leap: 8, ghost: 1.25, sense: 0.85, tell: 1.25 },
    normal: { speed: 1, stun: 2.6, owl: 7.2, leap: 9, ghost: 1.6, sense: 1, tell: 1 },
    hard: { speed: 1.08, stun: 2.1, owl: 8.4, leap: 10, ghost: 1.95, sense: 1.15, tell: 0.85 },
  };
  const BATS = [
    { name: 'Mo', color: '#8b6cff', rgb: '139, 108, 255' },
    { name: 'Ka', color: '#ff7ad9', rgb: '255, 122, 217' },
    { name: 'Ca', color: '#9dff6a', rgb: '157, 255, 106' },
    { name: 'Bo', color: '#ffb347', rgb: '255, 179, 71' },
  ];
  const KEYMAP = [
    { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], squeak: ['KeyF', 'Space'], dash: ['KeyG', 'ShiftLeft'] },
    { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], squeak: ['Enter', 'Slash'], dash: ['ShiftRight', 'Period'] },
    { up: ['KeyI'], down: ['KeyK'], left: ['KeyJ'], right: ['KeyL'], squeak: ['KeyH'], dash: ['KeyU'] },
    { up: ['Numpad8'], down: ['Numpad5'], left: ['Numpad4'], right: ['Numpad6'], squeak: ['Numpad0', 'NumpadEnter'], dash: ['NumpadAdd'] },
  ];
  const COL = {
    wall: '74, 222, 255', moth: '255, 226, 120', crystal: '150, 240, 255', exit: '120, 255, 170',
    danger: '255, 84, 104', owl: '255, 196, 64', stun: '255, 226, 120', ghost: '255, 190, 235', crawl: '160, 255, 120',
  };
  const PHASES = ['count', 'play', 'wipe', 'win', 'lose'];
  const MSTATES = ['hang', 'tell', 'drop', 'hold', 'climb', 'perch', 'swoop', 'recover', 'leave', 'walk', 'leap', 'drift', 'chase'];
  const SMALL = { crawler: true, ghost: true };   // a dash destroys these even when they aren't stunned

  // ---- State -------------------------------------------------------------
  let active = false, mode = 'local', viewer = -1, net = null, onEnd = null, paused = false, localCount = 1;
  let L = null, D = DIFF.normal, difficulty = 'normal', seed = 1;
  let bats = [], rings = [], particles = [], popups = [], outbox = [];
  let scroll = { x: 0, speed: 0 }, cpIndex = -1, tries = TRIES, phase = 'count', phaseT = 0, countdown = 3;
  let clock = 0, playTime = 0, shake = 0, banner = null, over = false, ended = false, result = null;
  let ringId = 0, snapTimer = 0, gotDirty = true, snapCount = 0;
  const remoteInput = new Map();

  // ---- Level -------------------------------------------------------------
  function loadLevel(def) {
    const rows = def.map, h = rows.length, w = Math.max(...rows.map((r) => r.length));
    const lv = {
      def, w, h, grid: new Uint8Array(w * h), lit: new Float32Array(w * h),
      start: { x: 5.5, y: 6.5 }, goal: { x: w - 6.5, y: 6.5 }, moths: [], crystals: [], checkpoints: [], monsters: [],
    };
    const ch = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? '#' : (rows[y][x] || '#');
    const specs = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = ch(x, y), cx = x + 0.5, cy = y + 0.5;
        lv.grid[y * w + x] = c === '#' ? 1 : 0;
        if (c === 'S') lv.start = { x: cx, y: cy };
        else if (c === 'E') lv.goal = { x: cx, y: cy };
        else if (c === 'm') lv.moths.push({ x: cx, y: cy, got: false, phase: (x * 7 + y) % 6 });
        else if (c === 'e') lv.crystals.push({ x: cx, y: cy, got: false, phase: (x * 3 + y) % 6 });
        else if (c === 'K') lv.checkpoints.push({ x: cx, y: cy, floor: floorBelow(ch, x, y) });
        else if (c === 's') specs.push({ kind: 'spider', x: cx, y: y + 0.42, bot: floorBelow(ch, x, y) - 0.45 });
        else if (c === 'c') specs.push({ kind: 'crawler', x: cx, y: y + 1 - 0.3 });
        else if (c === 'o') specs.push({ kind: 'owl', x: cx, y: cy });
        else if (c === 'g') for (let k = 0; k < 3; k++) specs.push({ kind: 'ghost', x: cx + (k - 1) * 0.7, y: cy + (k === 1 ? -0.5 : 0.3) });
      }
    }
    lv.checkpoints.sort((a, b) => a.x - b.x);
    lv.monsters = specs.map((sp, id) => resetMonster({ id, ...sp, hx: sp.x, hy: sp.y }));
    return lv;
  }
  function floorBelow(ch, x, y) { let b = y; while (ch(x, b + 1) !== '#') b++; return b + 1; }
  function resetMonster(m) {
    Object.assign(m, {
      x: m.hx, y: m.hy, vx: 0, vy: 0, t: 0, cd: 0, stun: 0, lit: 0, dead: false, face: -1, ax: 0, ay: 0, swoops: 0, target: -1,
      st: { spider: 'hang', crawler: 'walk', owl: 'perch', ghost: 'drift' }[m.kind],
      r: { spider: 0.3, crawler: 0.3, owl: 0.36, ghost: 0.2 }[m.kind],
    });
    if (m.kind === 'crawler') m.vx = -1.1;
    return m;
  }
  const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= L.w || ty >= L.h || L.grid[ty * L.w + tx] === 1;
  const solidAt = (x, y) => solid(Math.floor(x), Math.floor(y));
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

  function makeBat(i, ctrl, localSlot) {
    return {
      i, ...BATS[i], ctrl, local: localSlot, x: 0, y: 0, vx: 0, vy: 0, face: 1,
      hearts: MAX_HEARTS, echoes: START_ECHOES, cooldown: 0, hurt: 0, safe: 0, ko: false, loud: 0, noEcho: 0,
      dashT: 0, dashCd: 0, biteT: 0,
      st: { moths: 0, stuns: 0, kills: 0, kos: 0, squeaks: 0 },
      ai: ctrl === 'cpu' ? { path: [], think: 0, sq: 0 } : null,
    };
  }

  // ---- Start / stop --------------------------------------------------------
  // o: { mode, humans, cpus, remotes, mySlot, total, level, seed, net, onEnd }
  let view = '3d';
  const in3d = () => view === '3d' && window.EchoCave3D && window.EchoCave3D.supported;

  function start(o = {}) {
    window.EchoCave3D?.reset?.();
    mode = o.mode || 'local';
    net = o.net || null;
    onEnd = o.onEnd || null;
    difficulty = DIFF[o.level] ? o.level : 'normal';
    D = DIFF[difficulty];
    seed = o.seed != null ? (o.seed >>> 0) : Math.floor(Math.random() * 1e9);
    L = loadLevel(window.makeCoopLevel(seed, difficulty));
    bats = [];
    if (mode === 'local') {
      localCount = Math.max(1, Math.min(4, o.humans || 1));
      const cpus = Math.max(0, Math.min(4 - localCount, o.cpus || 0));
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
      viewer = o.mySlot | 0;
      for (let i = 0; i < Math.max(1, o.total || 2); i++) bats.push(makeBat(i, i === viewer ? 'local' : 'remote', 0));
    }
    rings = []; particles = []; popups = []; outbox = [];
    remoteInput.clear();
    cpIndex = -1; tries = TRIES; over = false; ended = false; result = null;
    clock = 0; playTime = 0; shake = 0; snapTimer = 0; gotDirty = true; snapCount = 0;
    placeTeam(L.start.x, L.start.y);
    scroll = { x: 0, speed: SPEEDS[0] * D.speed };
    setPhase('count', 3);
    banner = { text: 'Co-op Run', rgb: COL.exit, t: 0 };
    keys.clear(); sticks.clear();
    active = true;
  }
  function stop() { active = false; }

  function setPhase(p, t = 0) {
    phase = p; phaseT = t;
    if (p === 'count') countdown = t;
  }

  // the team lines up around a point, never inside rock
  function placeTeam(x, y) {
    const offs = [[0, 0], [-1, -1.1], [-1, 1.1], [-2, 0], [0, -2.2], [0, 2.2], [-2, -2.2], [-2, 2.2]];
    let k = 0;
    for (const b of bats) {
      let px = x, py = y;
      for (; k < offs.length; k++) {
        const cx = x + offs[k][0], cy = y + offs[k][1];
        if (!hitsWall(cx, cy, R + 0.05)) { px = cx; py = cy; k++; break; }
      }
      Object.assign(b, { x: px, y: py, vx: 0, vy: 0, face: 1, dashT: 0, biteT: 0, hurt: 0 });
    }
  }

  // ---- Effects (applied here and, when hosting, streamed to the room) --------
  function fx(ev) {
    applyFx(ev);
    if (mode === 'host') outbox.push(ev);
  }
  function applyFx(ev) {
    const s = (window.EchoAudio && window.EchoAudio.sfx) || {};
    if (ev.k === 'sfx') (s[ev.n] || s[ev.alt])?.();
    else if (ev.k === 'burst') burst(ev.x, ev.y, ev.rgb, ev.n, ev.sp || 3);
    else if (ev.k === 'popup') popups.push({ x: ev.x, y: ev.y, text: ev.text, rgb: ev.rgb, t: 0, life: ev.life || 0.9 });
    else if (ev.k === 'shake') { if (ev.s == null || ev.s < 0 || bats[ev.s]?.ctrl === 'local') shake = Math.max(shake, ev.v); }
    else if (ev.k === 'banner') banner = { text: ev.text, sub: ev.sub || '', rgb: ev.rgb, t: ev.t };
  }
  function burst(x, y, rgb, n, speed = 3) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * speed;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.5, rgb });
    }
  }

  // ---- Input -------------------------------------------------------------
  const keys = new Set();
  const sticks = new Map();
  const STICK_RANGE = 56;
  const canvas = document.getElementById('game');
  let W = 0, H = 0;
  const localBat = (slot) => bats.find((b) => b.ctrl === 'local' && b.local === slot);
  const keysFor = (slot, what) => (localCount === 1 && slot === 0) ? [...KEYMAP[0][what], ...KEYMAP[1][what]] : (KEYMAP[slot] || {})[what] || [];

  addEventListener('keydown', (e) => {
    if (!active || paused) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    for (let slot = 0; slot < localCount; slot++) {
      if (keysFor(slot, 'squeak').includes(e.code)) act(slot, 'squeak');
      if (keysFor(slot, 'dash').includes(e.code)) act(slot, 'dash');
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); sticks.clear(); });

  let touchUsed = matchMedia('(pointer: coarse)').matches;
  const dashButton = () => ({ x: W - 64, y: H - Math.max(124, H * 0.3), r: 42 });
  const inDashButton = (cx, cy) => {
    if (localCount !== 1) return false;
    const rect = canvas.getBoundingClientRect(), b = dashButton();
    return Math.hypot(cx - rect.left - b.x, cy - rect.top - b.y) < b.r + 8;
  };
  function zoneAt(clientX, clientY) {
    const n = localCount;
    if (n === 1) return 0;
    const rect = canvas.getBoundingClientRect();
    const fx2 = (clientX - rect.left) / rect.width, fy = (clientY - rect.top) / rect.height;
    if (n === 4) return (fy < 0.5 ? 0 : 2) + (fx2 < 0.5 ? 0 : 1);
    return Math.min(n - 1, Math.floor(fx2 * n));
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!active || paused) return;
    e.preventDefault();
    window.EchoAudio?.unlock?.();
    if (e.pointerType === 'touch') touchUsed = true;
    if (touchUsed && inDashButton(e.clientX, e.clientY)) { act(0, 'dash'); return; }
    const owner = zoneAt(e.clientX, e.clientY);
    // a second finger in your zone squeaks while the first one steers
    if ([...sticks.values()].some((s) => s.owner === owner)) { act(owner, 'squeak'); return; }
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
    const s = sticks.get(e.pointerId);
    if (!s) return;
    sticks.delete(e.pointerId);
    if (!active) return;
    const dt = performance.now() - s.t, dx = s.x - s.sx, dy = s.y - s.sy, d = Math.hypot(dx, dy);
    if (!s.moved && dt < 280) act(s.owner, 'squeak');
    else if (dt < 230 && d > 30) act(s.owner, 'dash', dx / d, dy / d);   // a quick flick dashes
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

  // a local player pressed squeak or dash
  function act(slot, a, dx, dy) {
    if (paused) return;
    const b = localBat(slot);
    if (!b) return;
    if (a === 'dash' && !(Math.hypot(dx || 0, dy || 0) > 0.1)) {
      const { ix, iy } = localInput(slot);
      if (Math.hypot(ix, iy) > 0.2) { dx = ix; dy = iy; }
    }
    if (mode === 'client') {
      net?.send({ t: 'act', a, dx, dy });
      if (a === 'squeak' && b.echoes <= 0 && !b.ko) applyFx({ k: 'sfx', n: 'empty' });
      return;
    }
    doAct(b, a, dx, dy);
  }
  function doAct(b, a, dx, dy) {
    if (a === 'squeak' || a === 'charge') squeak(b);
    else if (a === 'dash') dash(b, dx, dy);
  }

  // ---- Online hooks (host side) -------------------------------------------
  function remote(slot, msg) {
    const b = bats[slot];
    if (!b || b.ctrl !== 'remote' || mode !== 'host' || !msg) return;
    if (msg.t === 'in') remoteInput.set(slot, { ix: Math.max(-1, Math.min(1, +msg.ix || 0)), iy: Math.max(-1, Math.min(1, +msg.iy || 0)) });
    else if (msg.t === 'act' && ['squeak', 'charge', 'dash'].includes(msg.a)) doAct(b, msg.a, +msg.dx || 0, +msg.dy || 0);
  }
  function dropRemote(slot) {
    const b = bats[slot];
    if (!b || b.ctrl !== 'remote') return;
    // a player who leaves is replaced by a CPU bat so the team can go on
    b.ctrl = 'cpu';
    b.ai = { path: [], think: 0, sq: 0 };
    fx({ k: 'banner', text: `${b.name} left, a CPU takes over`, rgb: b.rgb, t: 2 });
  }

  // ---- Actions -------------------------------------------------------------
  const canAct = (b) => active && b && phase === 'play' && !b.ko;
  function squeak(b) {
    if (!canAct(b) || b.cooldown > 0) return;
    b.cooldown = SQUEAK_COOLDOWN;
    if (b.echoes <= 0) {
      b.noEcho = 0.6;
      if (b.ctrl === 'local') applyFx({ k: 'sfx', n: 'empty' });
      return;
    }
    b.echoes--;
    b.loud = LOUD_TIME;
    b.st.squeaks++;
    rings.push({ id: ++ringId, x: b.x, y: b.y, r: 0, owner: b.i, hit: new Set() });
    fx({ k: 'sfx', n: 'squeak' });
  }
  function dash(b, dx, dy) {
    if (!canAct(b) || b.dashCd > 0) return;
    let ux = dx, uy = dy;
    if (!(Math.hypot(ux || 0, uy || 0) > 0.1)) {
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0.5) { ux = b.vx / sp; uy = b.vy / sp; } else { ux = b.face; uy = 0; }
    }
    const len = Math.hypot(ux, uy) || 1;
    b.vx = (ux / len) * DASH_SPEED; b.vy = (uy / len) * DASH_SPEED;
    if (Math.abs(ux) > 0.2) b.face = Math.sign(ux);
    b.dashT = DASH_TIME; b.dashCd = DASH_COOLDOWN; b.biteT = DASH_TIME + BITE_GRACE;
    fx({ k: 'sfx', n: 'dash' });
  }

  function hurtBat(b, fromX, fromY) {
    if (b.ko || b.hurt > 0 || b.safe > 0) return;
    b.hearts--;
    b.hurt = HURT_TIME;
    const dx = b.x - fromX, dy = b.y - fromY, d = Math.hypot(dx, dy) || 1;
    b.vx = (dx / d) * 5; b.vy = (dy / d) * 5; b.dashT = 0;
    fx({ k: 'burst', x: b.x, y: b.y, rgb: COL.danger, n: 14 });
    fx({ k: 'sfx', n: 'hurt' });
    fx({ k: 'shake', v: 0.35, s: b.i });
    if (b.hearts <= 0) knockOut(b);
  }
  function knockOut(b, crushed = false) {
    if (b.ko) return;
    b.ko = true; b.hearts = 0; b.dashT = 0; b.biteT = 0; b.hurt = 0;
    b.st.kos++;
    fx({ k: 'burst', x: b.x, y: b.y, rgb: b.rgb, n: 22, sp: 4 });
    fx({ k: 'sfx', n: 'crash' });
    fx({ k: 'popup', x: b.x, y: b.y - 0.8, text: crushed ? 'CAUGHT!' : 'KO!', rgb: COL.danger, life: 1.4 });
    const team = bats.filter((o) => !o.ko);
    if (team.length) fx({ k: 'banner', text: `${b.name} is down!`, sub: 'Reach the next lantern to revive', rgb: b.rgb, t: 2 });
    else wipe();
  }
  function wipe() {
    tries--;
    rings = [];
    if (tries <= 0) { finish(false); return; }
    setPhase('wipe', 2.2);
    fx({ k: 'banner', text: 'Wiped out!', sub: `Back to the ${cpIndex >= 0 ? 'last lantern' : 'start'} · try ${TRIES - tries + 1} of ${TRIES}`, rgb: COL.danger, t: 2.2 });
    fx({ k: 'sfx', n: 'warn' });
  }
  function restartFromCheckpoint() {
    const cp = cpIndex >= 0 ? L.checkpoints[cpIndex] : null;
    const at = cp ? { x: cp.x - 1, y: cp.y } : L.start;
    scroll.x = Math.max(0, Math.min(L.w - VIEW_W, at.x - 6));
    scroll.speed = sectionSpeed();
    for (const b of bats) {
      Object.assign(b, { ko: false, hearts: MAX_HEARTS, echoes: Math.max(b.echoes, START_ECHOES), safe: 1.5, cooldown: 0, dashCd: 0, loud: 0 });
      if (b.ai) b.ai.path = [];
    }
    placeTeam(at.x, at.y);
    for (const m of L.monsters) if (m.hx >= scroll.x - 2) resetMonster(m);
    for (const c of L.crystals) if (c.x >= scroll.x) c.got = false;
    gotDirty = true;
    rings = [];
    for (let k = 0; k < L.lit.length; k++) L.lit[k] = 0;
    setPhase('count', 2);
  }
  function finish(won) {
    over = true;
    setPhase(won ? 'win' : 'lose', 0);
    const team = { moths: 0, stuns: 0, kills: 0, kos: 0 };
    for (const b of bats) for (const k in team) team[k] += b.st[k];
    result = {
      won, difficulty, seed, time: Math.round(playTime), triesUsed: TRIES - tries + (won ? 1 : 0), triesTotal: TRIES,
      checkpoint: cpIndex + 1, checkpoints: L.checkpoints.length, progress: Math.round(progress() * 100) / 100,
      mothsTotal: L.moths.length, team,
      players: bats.map((b) => ({ slot: b.i, name: b.name, color: b.color, cpu: b.ctrl === 'cpu' || !!b.cpuFlag, alive: !b.ko, ...b.st })),
    };
    if (won) {
      fx({ k: 'banner', text: 'You made it out!', sub: 'The whole team is free', rgb: COL.exit, t: 3 });
      fx({ k: 'sfx', n: 'win' });
    } else {
      fx({ k: 'banner', text: 'Out of tries', sub: 'The monsters win this time', rgb: COL.danger, t: 3 });
      fx({ k: 'sfx', n: 'burp' });
    }
    fireEnd(won ? 1500 : 1800);
  }
  function fireEnd(ms) {
    if (ended) return;
    ended = true;
    const r = result;
    setTimeout(() => { if (active && onEnd && r) onEnd(r, { guest: mode === 'client' }); }, ms);
  }

  // ---- Simulation ------------------------------------------------------------
  const progress = () => {
    let lead = scroll.x + 1;
    for (const b of bats) if (!b.ko) lead = Math.max(lead, b.x);
    return Math.max(0, Math.min(1, (lead - L.start.x) / (L.goal.x - L.start.x)));
  };
  const sectionSpeed = () => SPEEDS[Math.max(0, Math.min(3, Math.floor((scroll.x + VIEW_W / 2) / (L.w / 4))))] * D.speed;

  function update(dt) {
    clock += dt;
    tickCosmetics(dt);
    for (const b of bats) {
      b.cooldown = Math.max(0, b.cooldown - dt);
      b.hurt = Math.max(0, b.hurt - dt);
      b.safe = Math.max(0, b.safe - dt);
      b.loud = Math.max(0, b.loud - dt);
      b.noEcho = Math.max(0, b.noEcho - dt);
      b.dashCd = Math.max(0, b.dashCd - dt);
      b.biteT = Math.max(0, b.biteT - dt);
    }
    if (phase === 'count') {
      const before = Math.ceil(countdown);
      countdown -= dt;
      if (Math.ceil(countdown) !== before) fx({ k: 'sfx', n: countdown <= 0 ? 'go' : 'beep' });
      if (countdown <= 0) setPhase('play');
      fadeLight(dt);
      broadcast(dt);
      return;
    }
    if (phase === 'wipe') {
      phaseT -= dt;
      fadeLight(dt);
      for (const b of bats) moveGhost(b, 0, 0, dt);
      if (phaseT <= 0) restartFromCheckpoint();
      broadcast(dt);
      return;
    }
    if (phase !== 'play') { broadcast(dt); return; }
    playTime += dt;

    // the shared screen creeps right, a little faster in each section
    const want = sectionSpeed();
    scroll.speed += Math.sign(want - scroll.speed) * Math.min(Math.abs(want - scroll.speed), 0.4 * dt);
    scroll.x = Math.min(L.w - VIEW_W, scroll.x + scroll.speed * dt);

    for (const b of bats) {
      let ix = 0, iy = 0;
      if (b.ctrl === 'cpu') ({ ix, iy } = cpuInput(b, dt));
      else if (b.ctrl === 'remote') ({ ix, iy } = remoteInput.get(b.i) || { ix: 0, iy: 0 });
      else ({ ix, iy } = localInput(b.local));
      if (b.ko) { moveGhost(b, ix, iy, dt); continue; }
      moveBat(b, ix, iy, dt);
      if (phase !== 'play') return;
    }

    fadeLight(dt);
    advanceRings(dt, true);
    for (const m of L.monsters) updateMonster(m, dt);
    if (phase !== 'play') { broadcast(dt); return; }
    contacts();
    if (phase !== 'play') { broadcast(dt); return; }

    // pickups
    for (const b of bats) {
      if (b.ko) continue;
      for (const m of L.moths) {
        if (m.got || Math.abs(m.x - b.x) > 0.7 || Math.hypot(m.x - b.x, m.y - b.y) > 0.6) continue;
        m.got = true; gotDirty = true; b.st.moths++;
        fx({ k: 'burst', x: m.x, y: m.y, rgb: COL.moth, n: 14 });
        fx({ k: 'sfx', n: 'moth' });
      }
      for (const c of L.crystals) {
        if (c.got || Math.abs(c.x - b.x) > 0.7 || Math.hypot(c.x - b.x, c.y - b.y) > 0.6) continue;
        c.got = true; gotDirty = true;
        b.echoes = Math.min(MAX_ECHOES, b.echoes + CRYSTAL_ECHOES);
        fx({ k: 'burst', x: c.x, y: c.y, rgb: COL.crystal, n: 12 });
        fx({ k: 'popup', x: c.x, y: c.y - 0.6, text: `+${CRYSTAL_ECHOES} ECHOES`, rgb: COL.crystal, life: 0.8 });
        fx({ k: 'sfx', n: 'crystal' });
      }
    }

    // checkpoint lanterns: a living bat reaching one revives everyone who is down
    const next = L.checkpoints[cpIndex + 1];
    if (next) {
      const reacher = bats.find((b) => !b.ko && b.x >= next.x - 0.2);
      if (reacher) {
        cpIndex++;
        const down = bats.filter((b) => b.ko);
        for (const b of down) {
          Object.assign(b, { ko: false, hearts: 1, safe: REVIVE_SAFE, vx: 0, vy: 0 });
          const spot = [[0, -0.9], [0, 0.9], [-0.9, 0], [0.9, 0]].map(([ox2, oy2]) => ({ x: reacher.x + ox2, y: reacher.y + oy2 })).find((p) => !hitsWall(p.x, p.y, R + 0.05));
          b.x = spot ? spot.x : reacher.x; b.y = spot ? spot.y : reacher.y;
          fx({ k: 'burst', x: b.x, y: b.y, rgb: b.rgb, n: 16 });
        }
        fx({ k: 'burst', x: next.x, y: next.y, rgb: COL.exit, n: 26, sp: 4 });
        fx({ k: 'sfx', n: 'power' });
        fx({ k: 'banner', text: `Checkpoint ${cpIndex + 1} of ${L.checkpoints.length}`, sub: down.length ? `${down.map((b) => b.name).join(' & ')} ${down.length > 1 ? 'are' : 'is'} back!` : 'The team will start here if everyone falls', rgb: COL.exit, t: 2 });
      }
    }

    // the green light at the end
    if (bats.some((b) => !b.ko && Math.hypot(L.goal.x - b.x, L.goal.y - b.y) < 0.95)) finish(true);
    broadcast(dt);
  }

  function moveBat(b, ix, iy, dt) {
    if (b.dashT > 0) {
      b.dashT -= dt;
      if (Math.random() < 0.6) particles.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.3, rgb: b.rgb });
    } else if (ix || iy) { b.vx += ix * ACCEL * dt; b.vy += iy * ACCEL * dt; }
    else { b.vx -= b.vx * DRAG * dt; b.vy -= b.vy * DRAG * dt; }
    const maxSp = b.dashT > 0 ? DASH_SPEED : MAX_SPEED, sp = Math.hypot(b.vx, b.vy);
    if (sp > maxSp) { b.vx *= maxSp / sp; b.vy *= maxSp / sp; }
    if (Math.abs(b.vx) > 0.2) b.face = Math.sign(b.vx);
    const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 0.2)), sdt = dt / steps;
    for (let k = 0; k < steps; k++) {
      const nx = b.x + b.vx * sdt;
      if (!hitsWall(nx, b.y, R)) b.x = nx; else { b.vx *= -0.25; b.dashT = 0; }
      const ny = b.y + b.vy * sdt;
      if (!hitsWall(b.x, ny, R)) b.y = ny; else { b.vy *= -0.25; b.dashT = 0; }
    }
    // the shared screen: the right edge holds you back, the left edge pushes you on
    const left = scroll.x + R + 0.05, right = scroll.x + VIEW_W - R - 0.3;
    if (b.x > right) { b.x = right; b.vx = Math.min(b.vx, 0); }
    if (b.x < left) {
      b.x = left;
      b.vx = Math.max(b.vx, scroll.speed);
      if (hitsWall(b.x, b.y, R)) knockOut(b, true);
    }
  }
  // knocked-out bats drift through rock as ghosts, kept on screen
  function moveGhost(b, ix, iy, dt) {
    if (!b.ko) return;
    const tvx = ix * GHOST_SPEED + (phase === 'play' ? scroll.speed * 0.6 : 0), tvy = iy * GHOST_SPEED;
    const k = 1 - Math.exp(-dt * 5);
    b.vx += (tvx - b.vx) * k; b.vy += (tvy - b.vy) * k;
    b.x = Math.max(scroll.x + 0.6, Math.min(scroll.x + VIEW_W - 0.6, b.x + b.vx * dt));
    b.y = Math.max(0.8, Math.min(L.h - 0.8, b.y + b.vy * dt));
    if (Math.abs(b.vx) > 0.3) b.face = Math.sign(b.vx);
  }

  function fadeLight(dt) {
    const lit = L.lit;
    // during a countdown the team's lanterns light the cave around them
    if (phase === 'count') {
      for (const b of bats) {
        for (let ty = Math.max(0, Math.floor(b.y - 4)); ty <= Math.min(L.h - 1, Math.floor(b.y + 4)); ty++) {
          for (let tx = Math.max(0, Math.floor(b.x - 5)); tx <= Math.min(L.w - 1, Math.floor(b.x + 5)); tx++) {
            const d = Math.hypot(tx + 0.5 - b.x, ty + 0.5 - b.y), k = ty * L.w + tx;
            if (d < 5) lit[k] = Math.max(lit[k], Math.min(1, 1.6 - d * 0.25));
          }
        }
      }
    }
    for (let k = 0; k < lit.length; k++) if (lit[k] > 0) lit[k] = Math.max(0, lit[k] - dt * LIGHT_FADE);
    for (const m of L.monsters) if (m.lit > 0) m.lit = Math.max(0, m.lit - dt * LIGHT_FADE);
  }

  // Rings light the cave as they pass and, on the host, stun every monster they reach
  function advanceRings(dt, simulate) {
    for (const ring of rings) {
      const prev = ring.r;
      ring.r += RING_SPEED * dt;
      const r = ring.r;
      for (let ty = Math.max(0, Math.floor(ring.y - r - 1)); ty <= Math.min(L.h - 1, Math.ceil(ring.y + r + 1)); ty++) {
        for (let tx = Math.max(0, Math.floor(ring.x - r - 1)); tx <= Math.min(L.w - 1, Math.ceil(ring.x + r + 1)); tx++) {
          const d = Math.hypot(tx + 0.5 - ring.x, ty + 0.5 - ring.y);
          if (d >= prev - 0.6 && d < r + 0.6) L.lit[ty * L.w + tx] = 1;
        }
      }
      for (const m of L.monsters) {
        if (m.dead || ring.hit.has(m.id) || Math.abs(m.x - ring.x) > r + 1) continue;
        const d = Math.hypot(m.x - ring.x, m.y - ring.y);
        if (d >= r + m.r || d < prev - m.r) continue;
        ring.hit.add(m.id);
        m.lit = 1;
        if (!simulate) continue;
        if (m.st === 'leave') continue;
        if (m.stun <= 0) {
          bats[ring.owner] && bats[ring.owner].st.stuns++;
          fx({ k: 'burst', x: m.x, y: m.y, rgb: COL.stun, n: 8 });
          if (!ring.stunSfx) { ring.stunSfx = true; fx({ k: 'sfx', n: 'stun' }); }
        }
        m.stun = D.stun;
        if (m.kind === 'owl' && (m.st === 'swoop' || m.st === 'tell')) { m.st = 'recover'; m.t = 0.6; m.vx *= 0.2; m.vy *= 0.2; }
        if (m.kind === 'crawler' && m.st === 'tell') m.st = 'walk';
        if (m.kind === 'spider' && m.st === 'tell') { m.st = 'hang'; m.cd = 1; }
      }
    }
    rings = rings.filter((ring) => ring.r < RING_MAX);
  }

  // ---- Monsters --------------------------------------------------------------
  const livingBats = () => bats.filter((b) => !b.ko);
  function nearestBat(m, maxD, filter) {
    let best = null, bd = maxD;
    for (const b of bats) {
      if (b.ko || (filter && !filter(b))) continue;
      const d = Math.hypot(b.x - m.x, b.y - m.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  function updateMonster(m, dt) {
    if (m.dead) return;
    // far behind the screen, or not reached yet: asleep
    if (m.x < scroll.x - 4 || m.hx > scroll.x + VIEW_W + 2) return;
    m.cd = Math.max(0, m.cd - dt);
    if (m.stun > 0) {
      m.stun = Math.max(0, m.stun - dt);
      // stunned things drop out of the air a little, then hang there dazed
      if (m.kind === 'crawler' && m.st === 'leap') crawlerPhysics(m, dt);
      else { m.vx *= 1 - 3 * dt; m.vy *= 1 - 3 * dt; if (m.kind === 'owl' || m.kind === 'ghost') moveFree(m, dt, true); }
      return;
    }
    const sense = D.sense;
    if (m.kind === 'spider') {
      const top = m.hy, bot = Math.max(top, m.bot ?? top);
      if (m.st === 'hang') {
        m.y += (top - m.y) * Math.min(1, dt * 4);
        const b = m.cd <= 0 && nearestBat(m, 99, (o) => Math.abs(o.x - m.x) < 1.9 * sense && o.y > m.y && o.y - m.y < bot - top + 1);
        if (b) { m.st = 'tell'; m.t = 0.55 * D.tell; fx({ k: 'sfx', n: 'wake' }); }
      } else if (m.st === 'tell') {
        m.t -= dt;
        if (m.t <= 0) { m.st = 'drop'; m.vy = 2; }
      } else if (m.st === 'drop') {
        m.vy = Math.min(10, m.vy + 30 * dt);
        m.y += m.vy * dt;
        if (m.y >= bot) { m.y = bot; m.st = 'hold'; m.t = 0.8; }
      } else if (m.st === 'hold') {
        m.t -= dt;
        if (m.t <= 0) m.st = 'climb';
      } else if (m.st === 'climb') {
        m.y -= 1.7 * dt;
        if (m.y <= top) { m.y = top; m.st = 'hang'; m.cd = 1.4; }
      }
    } else if (m.kind === 'owl') {
      if (m.st === 'perch') {
        // a squeak nearby gives you away; flying right past wakes it too
        const loud = nearestBat(m, 6.5 * sense, (o) => o.loud > 0);
        const close = nearestBat(m, 3.2 * sense);
        const b = loud || close;
        if (b && m.x < scroll.x + VIEW_W - 0.5) startOwlTell(m, b);
      } else if (m.st === 'tell') {
        m.t -= dt;
        const b = bats[m.target];
        // it tracks you for most of the wind-up, then locks its aim (the line on screen)
        if (b && !b.ko && m.t > 0.3 * D.tell) { const d = Math.hypot(b.x - m.x, b.y - m.y) || 1; m.ax = (b.x - m.x) / d; m.ay = (b.y - m.y) / d; }
        m.vx *= 1 - 4 * dt; m.vy *= 1 - 4 * dt;
        moveFree(m, dt, false);
        if (m.t <= 0) { m.st = 'swoop'; m.t = 8 / D.owl; m.vx = m.ax * D.owl; m.vy = m.ay * D.owl; m.swoops++; fx({ k: 'sfx', n: 'dash' }); }
      } else if (m.st === 'swoop') {
        m.t -= dt;
        const hit = moveFree(m, dt, false);
        if (hit || m.t <= 0) { m.st = 'recover'; m.t = 1.1; m.vx *= 0.2; m.vy *= 0.2; }
      } else if (m.st === 'recover') {
        m.t -= dt;
        m.vx *= 1 - 2.5 * dt; m.vy = m.vy * (1 - 2.5 * dt) - 0.6 * dt;
        moveFree(m, dt, false);
        if (m.t <= 0) {
          const b = nearestBat(m, 7 * sense);
          if (b && m.swoops < 3) startOwlTell(m, b);
          else { m.st = 'leave'; m.vx = 2.5; m.vy = -2.5; }
        }
      } else if (m.st === 'leave') {
        m.x += m.vx * dt; m.y += m.vy * dt;
        if (m.y < -1 || m.x > scroll.x + VIEW_W + 3) m.dead = true;
      }
    } else if (m.kind === 'crawler') {
      if (m.st === 'walk') {
        const nx = m.x + m.vx * dt, ahead = nx + Math.sign(m.vx) * m.r, foot = Math.floor(m.y);
        if (solid(Math.floor(ahead), foot) || !solid(Math.floor(ahead), foot + 1)) m.vx = -m.vx; else m.x = nx;
        m.face = Math.sign(m.vx);
        const b = m.cd <= 0 && nearestBat(m, 99, (o) => Math.abs(o.x - m.x) < 1.8 * sense && o.y < m.y && m.y - o.y < 5);
        if (b) { m.st = 'tell'; m.t = 0.45 * D.tell; m.target = b.i; fx({ k: 'sfx', n: 'wake' }); }
      } else if (m.st === 'tell') {
        m.t -= dt;
        if (m.t <= 0) {
          const b = bats[m.target];
          const dx = b ? b.x - m.x : 0;
          m.st = 'leap'; m.vy = -D.leap; m.vx = Math.max(-2.5, Math.min(2.5, dx * 2));
        }
      } else if (m.st === 'leap') {
        if (crawlerPhysics(m, dt)) { m.st = 'walk'; m.vx = (m.face || 1) * 1.1; m.cd = 1.2; }
      }
    } else if (m.kind === 'ghost') {
      if (m.st === 'drift') {
        m.y = m.hy + Math.sin(clock * 1.6 + m.id) * 0.25;
        if (nearestBat(m, 7 * sense) && m.x < scroll.x + VIEW_W) { m.st = 'chase'; fx({ k: 'sfx', n: 'wake' }); }
      } else {
        const b = nearestBat(m, 30);
        if (b) {
          const dx = b.x - m.x, dy = b.y - m.y, d = Math.hypot(dx, dy) || 1;
          const wob = Math.sin(clock * 3 + m.id * 1.7) * 0.6;
          const tvx = (dx / d - (dy / d) * wob) * D.ghost, tvy = (dy / d + (dx / d) * wob) * D.ghost;
          const k = 1 - Math.exp(-dt * 2.5);
          m.vx += (tvx - m.vx) * k; m.vy += (tvy - m.vy) * k;
        }
        m.x += m.vx * dt; m.y += m.vy * dt;   // ghosts drift straight through rock
        m.y = Math.max(0.6, Math.min(L.h - 0.6, m.y));
        if (Math.abs(m.vx) > 0.2) m.face = Math.sign(m.vx);
      }
    }
  }
  function startOwlTell(m, b) {
    m.st = 'tell'; m.t = 0.8 * D.tell; m.target = b.i;
    const d = Math.hypot(b.x - m.x, b.y - m.y) || 1;
    m.ax = (b.x - m.x) / d; m.ay = (b.y - m.y) / d;
    fx({ k: 'sfx', n: 'wake' });
  }
  // flying monsters stop at rock; returns true if they hit some
  function moveFree(m, dt, soft) {
    let hit = false;
    const nx = m.x + m.vx * dt;
    if (!hitsWall(nx, m.y, m.r * 0.8)) m.x = nx; else { m.vx = soft ? 0 : -m.vx * 0.2; hit = true; }
    const ny = m.y + m.vy * dt;
    if (!hitsWall(m.x, ny, m.r * 0.8)) m.y = ny; else { m.vy = soft ? 0 : -m.vy * 0.2; hit = true; }
    if (Math.abs(m.vx) > 0.3) m.face = Math.sign(m.vx);
    return hit;
  }
  // returns true once the crawler lands back on the floor
  function crawlerPhysics(m, dt) {
    m.vy = Math.min(14, m.vy + 22 * dt);
    const nx = m.x + m.vx * dt;
    if (!hitsWall(nx, m.y, m.r)) m.x = nx; else m.vx = 0;
    const ny = m.y + m.vy * dt;
    if (!hitsWall(m.x, ny, m.r)) { m.y = ny; return false; }
    if (m.vy > 0) { m.vy = 0; m.vx = 0; return true; }
    m.vy = 0;
    return false;
  }

  // bats touching monsters: a dash destroys stunned (or small) ones; anything else hurts
  function contacts() {
    for (const b of bats) {
      if (b.ko) continue;
      for (const m of L.monsters) {
        if (m.dead || m.st === 'leave' || Math.abs(m.x - b.x) > 1.5) continue;
        const d = Math.hypot(m.x - b.x, m.y - b.y);
        const biting = b.biteT > 0;
        if (biting && d < m.r + R + 0.15 && (m.stun > 0 || SMALL[m.kind])) { destroy(m, b); continue; }
        if (d >= m.r + R) continue;
        if (m.stun > 0) {
          if (m.kind === 'ghost') destroy(m, b);   // a dazed ghost moth pops at a touch
          continue;
        }
        if (b.hurt > 0 || b.safe > 0) continue;
        hurtBat(b, m.x, m.y);
        if (m.kind === 'ghost') { m.dead = true; fx({ k: 'burst', x: m.x, y: m.y, rgb: COL.ghost, n: 10 }); }
        if (phase !== 'play') return;
      }
    }
  }
  function destroy(m, b) {
    m.dead = true;
    b.st.kills++;
    fx({ k: 'burst', x: m.x, y: m.y, rgb: m.kind === 'ghost' ? COL.ghost : m.kind === 'crawler' ? COL.crawl : m.kind === 'owl' ? COL.owl : COL.danger, n: 18, sp: 4 });
    fx({ k: 'popup', x: m.x, y: m.y - 0.6, text: m.kind === 'ghost' ? 'POP!' : 'CHOMP!', rgb: b.rgb, life: 0.8 });
    fx({ k: 'sfx', n: 'chomp' });
  }

  // ---- CPU teammates (also the test bot) -------------------------------------
  // They follow a breadth-first path toward the right of the screen, squeak when
  // a monster gets close, and dash into anything stunned or small.
  function plan(b) {
    const x0 = Math.max(0, Math.floor(scroll.x)), x1 = Math.min(L.w - 1, Math.ceil(scroll.x + VIEW_W));
    const sx = Math.floor(b.x), sy = Math.floor(b.y);
    if (solid(sx, sy)) return [];
    const wN = x1 - x0 + 1, prev = new Int32Array(wN * L.h).fill(-2), dist = new Int32Array(wN * L.h).fill(-1);
    const idx = (x, y) => (y * wN + (x - x0));
    const q = [idx(sx, sy)];
    prev[q[0]] = -1; dist[q[0]] = 0;
    // each bat keeps its own distance behind the front, so a CPU team spreads out
    const cap = Math.min(L.goal.x, scroll.x + VIEW_W * (0.7 - 0.07 * (b.i % 4)));
    const goalK = idx(Math.floor(L.goal.x), Math.floor(L.goal.y));
    let best = q[0], bestScore = -1e9, crystal = -1, crystalD = 1e9;
    const wantCrystal = b.echoes < 3;
    for (let h = 0; h < q.length; h++) {
      const k = q[h], x = (k % wN) + x0, y = Math.floor(k / wN);
      const clear = !solid(x, y - 1) && !solid(x, y + 1) ? 0.6 : 0;
      const score = (x <= cap ? x : cap - (x - cap) * 2) + clear - Math.abs(y + 0.5 - b.y) * 0.05;
      if (k === goalK) { best = k; bestScore = 1e9; }
      if (score > bestScore) { bestScore = score; best = k; }
      if (wantCrystal && dist[k] < crystalD && x > scroll.x + 3 && L.crystals.some((c) => !c.got && Math.floor(c.x) === x && Math.floor(c.y) === y)) { crystal = k; crystalD = dist[k]; }
      for (const [dx, dy] of [[1, 0], [0, -1], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < x0 || nx > x1 || solid(nx, ny)) continue;
        const nk = idx(nx, ny);
        if (prev[nk] !== -2) continue;
        prev[nk] = k; dist[nk] = dist[k] + 1;
        q.push(nk);
      }
    }
    if (crystal >= 0 && crystalD < 14) best = crystal;
    const path = [];
    for (let k = best; k >= 0 && prev[k] !== -1; k = prev[k]) path.push({ x: (k % wN) + x0 + 0.5, y: Math.floor(k / wN) + 0.5 });
    return path.reverse();
  }
  function cpuInput(b, dt) {
    const ai = b.ai || (b.ai = { path: [], think: 0, sq: 0 });
    ai.think -= dt; ai.sq -= dt;
    if (b.ko) {
      // a ghost tags along with the team
      const team = livingBats();
      const tx = team.length ? team.reduce((s, o) => s + o.x, 0) / team.length - 1 : scroll.x + VIEW_W / 2;
      const ty = team.length ? team.reduce((s, o) => s + o.y, 0) / team.length : L.h / 2;
      const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
      return d > 0.8 ? { ix: dx / d, iy: dy / d } : { ix: 0, iy: 0 };
    }
    if (ai.think <= 0 || !ai.path.length) { ai.think = 0.22; ai.path = plan(b); }
    while (ai.path.length > 1 && Math.hypot(ai.path[0].x - b.x, ai.path[0].y - b.y) < 0.45) ai.path.shift();
    let ix = 0, iy = 0;
    const wp = ai.path[Math.min(1, ai.path.length - 1)];
    if (wp) { const dx = wp.x - b.x, dy = wp.y - b.y, d = Math.hypot(dx, dy) || 1; ix = dx / d; iy = dy / d; }
    if (b.x < scroll.x + 1.2) ix = Math.max(ix, 0.6);
    for (const o of bats) {
      if (o === b || o.ko) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      if (d < 0.9) { ix -= ((o.x - b.x) / (d || 1)) * 0.5; iy -= ((o.y - b.y) / (d || 1)) * 0.5; }
    }
    // threats: squeak to stun; dash into anything dazed or small
    for (const m of L.monsters) {
      if (m.dead || m.st === 'leave' || Math.abs(m.x - b.x) > 6) continue;
      const d = Math.hypot(m.x - b.x, m.y - b.y);
      const angry = m.st === 'tell' || m.st === 'swoop' || m.st === 'drop' || m.st === 'leap' || m.st === 'chase';
      if (m.stun <= 0 && ((d < 2.6) || (angry && d < 5)) && b.echoes > 0 && b.cooldown <= 0 && ai.sq <= 0) {
        squeak(b); ai.sq = 0.5;
      }
      if ((m.stun > 0.25 || (SMALL[m.kind] && d < 1.6)) && d < 2.3 && b.dashCd <= 0) {
        dash(b, m.x - b.x, m.y - b.y);
        break;
      }
      if (m.stun <= 0 && d < 1.5) { ix -= ((m.x - b.x) / (d || 1)) * 0.7; iy -= ((m.y - b.y) / (d || 1)) * 0.7; }
    }
    const len = Math.hypot(ix, iy);
    return len > 1 ? { ix: ix / len, iy: iy / len } : { ix, iy };
  }

  function tickCosmetics(dt) {
    shake = Math.max(0, shake - dt);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < p.life);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
  }

  // ---- Online snapshots ----------------------------------------------------
  const r2 = (v) => Math.round(v * 100) / 100;
  function broadcast(dt) {
    if (mode !== 'host') return;
    snapTimer -= dt;
    if (snapTimer > 0) return;
    snapTimer = SNAPSHOT_EVERY;
    net?.broadcast(snapshot());
  }
  function snapshot() {
    snapCount++;
    const x0 = scroll.x - 4, x1 = scroll.x + VIEW_W + 3;
    const s = {
      t: 's', sd: seed, lv: difficulty, ph: PHASES.indexOf(phase), pt: r2(phaseT), cd: r2(countdown),
      sx: r2(scroll.x), sp: r2(scroll.speed), cp: cpIndex, tr: tries, pl: r2(playTime),
      b: bats.map((b) => [r2(b.x), r2(b.y), r2(b.vx), r2(b.vy), b.face, b.hearts, b.echoes, r2(b.hurt), b.ko ? 1 : 0,
        r2(b.dashT), r2(b.dashCd), r2(b.safe), b.ctrl === 'cpu' ? 1 : 0, r2(b.loud)]),
      m: L.monsters.filter((m) => m.hx > x0 - 6 && m.hx < x1 && (m.x > x0 || m.dead) && m.x < x1 + 6)
        .map((m) => [m.id, r2(m.x), r2(m.y), MSTATES.indexOf(m.st), r2(m.t), r2(m.stun), r2(m.ax), r2(m.ay), m.dead ? 1 : 0, m.face]),
      r: rings.map((g) => [g.id, r2(g.x), r2(g.y), r2(g.r), g.owner]),
      fx: outbox,
    };
    // which moths and crystals are gone: when it changes, and once a second anyway
    if (gotDirty || snapCount % 20 === 0) { s.g = L.moths.map((m) => (m.got ? 1 : 0)).join('') + '|' + L.crystals.map((c) => (c.got ? 1 : 0)).join(''); gotDirty = false; }
    if (result) s.res = result;
    outbox = [];
    return s;
  }

  function applySnapshot(s) {
    if (mode !== 'client' || !active || !s) return;
    // the cave comes from the host's seed; rebuild it if ours doesn't match
    if (s.sd != null && ((s.sd >>> 0) !== seed || (s.lv && s.lv !== difficulty))) {
      seed = s.sd >>> 0;
      if (DIFF[s.lv]) { difficulty = s.lv; D = DIFF[difficulty]; }
      L = loadLevel(window.makeCoopLevel(seed, difficulty));
    }
    phase = PHASES[s.ph] || 'play'; phaseT = s.pt; countdown = s.cd;
    if (s.sx < scroll.x - 2) for (let k = 0; k < L.lit.length; k++) L.lit[k] = 0;   // the team went back to a lantern
    scroll.tx = s.sx; scroll.speed = s.sp;
    if (Math.abs(s.sx - scroll.x) > 3) scroll.x = s.sx;
    cpIndex = s.cp; tries = s.tr; playTime = s.pl;
    s.b.forEach((v, i) => {
      const b = bats[i] || (bats[i] = makeBat(i, 'remote', 0));
      const first = b.tx === undefined;
      [b.tx, b.ty, b.vx, b.vy, b.face, b.hearts, b.echoes, b.hurt] = v;
      b.ko = !!v[8]; b.dashT = v[9]; b.dashCd = v[10]; b.safe = v[11]; b.cpuFlag = !!v[12]; b.loud = v[13];
      if (first || Math.hypot(b.tx - b.x, b.ty - b.y) > 3) { b.x = b.tx; b.y = b.ty; }
    });
    for (const [id, x, y, st, t, stun, ax, ay, dead, face] of s.m || []) {
      const m = L.monsters[id];
      if (!m) continue;
      if (m.tx === undefined || Math.hypot(x - m.x, y - m.y) > 3) { m.x = x; m.y = y; }
      m.tx = x; m.ty = y; m.st = MSTATES[st] || m.st; m.t = t; m.stun = stun; m.ax = ax; m.ay = ay; m.dead = !!dead; m.face = face;
    }
    if (s.g) {
      const [mg, cg] = s.g.split('|');
      L.moths.forEach((m, k) => { m.got = mg[k] === '1'; });
      L.crystals.forEach((c, k) => { c.got = cg[k] === '1'; });
    }
    const known = new Map(rings.map((g) => [g.id, g]));
    rings = s.r.map(([id, x, y, r, owner]) => {
      const g = known.get(id);
      return { id, x, y, r: g ? Math.max(g.r, r) : r, owner, hit: g ? g.hit : new Set() };
    });
    for (const ev of s.fx || []) applyFx(ev);
    over = phase === 'win' || phase === 'lose';
    if (s.res && !ended) { result = s.res; fireEnd(1200); }
  }

  // Client: no simulation, just smooth toward the host's positions and keep the visuals moving
  let inputTimer = 0, lastSent = '';
  function clientUpdate(dt) {
    clock += dt;
    tickCosmetics(dt);
    const k = 1 - Math.exp(-dt * 14);
    if (phase === 'play' && scroll.tx !== undefined) {
      scroll.tx = Math.min(L.w - VIEW_W, scroll.tx + scroll.speed * dt);
      scroll.x += (scroll.tx - scroll.x) * k;
    }
    for (const b of bats) {
      if (b.tx === undefined) continue;
      b.tx += b.vx * dt * 0.5; b.ty += b.vy * dt * 0.5;
      b.x += (b.tx - b.x) * k; b.y += (b.ty - b.y) * k;
      if (b.dashT > 0 && Math.random() < 0.6) particles.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.3, rgb: b.rgb });
    }
    for (const m of L.monsters) if (m.tx !== undefined && !m.dead) { m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k; }
    fadeLight(dt);
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
  let ctx, PX = 32, ox = 0, oy = 0;
  const FONT = '"Fredoka", "Nunito", system-ui, sans-serif';
  const CAVE_BG = '#06071a';
  const X = (x) => ox + x * PX, Y = (y) => oy + y * PX;

  function glow(x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${a})`); g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // a faint "whisker sense" around every bat, so tight spots stay fair
  function nearGlow(x, y) {
    let a = 0;
    for (const b of bats) {
      const d = Math.hypot(x - b.x, y - b.y);
      a = Math.max(a, Math.max(0, Math.min(1, 1 - (d - 0.7) / 1.4)) * (b.ko ? 0.12 : 0.3));
    }
    return a;
  }

  let stoneTile = null, stoneCtx = null;
  function stonePattern() {
    if (stoneTile && stoneCtx === ctx) return stoneTile;
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    let sd = 99;
    const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    g.fillStyle = 'rgb(46, 46, 108)'; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 14; k++) {
      const x = rnd() * S, y = rnd() * S, r = S * (0.1 + rnd() * 0.25), dark = rnd() < 0.6;
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        gr.addColorStop(0, dark ? 'rgba(10, 8, 40, 0.35)' : 'rgba(150, 150, 230, 0.16)');
        gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
    for (let k = 0; k < 260; k++) {
      g.fillStyle = rnd() < 0.55 ? 'rgba(8, 8, 30, 0.25)' : 'rgba(190, 190, 255, 0.12)';
      g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
    }
    stoneCtx = ctx;
    return (stoneTile = ctx.createPattern(c, 'repeat'));
  }

  function render() {
    const sx = shake > 0 ? (Math.random() - 0.5) * shake * 18 : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake * 18 : 0;
    PX = Math.min(H / L.h, W / VIEW_W);
    const cam = { x: scroll.x + VIEW_W / 2, y: L.h / 2 };
    ox = W / 2 - cam.x * PX + sx; oy = H / 2 - cam.y * PX + sy;
    let threeD = false;
    if (in3d()) {
      threeD = window.EchoCave3D.render({
        W, H, PX, cam, shake: { x: sx, y: sy }, level: L, near: nearGlow, clock, wall: COL.wall, mokaColor: BATS[0].color, mokaR: R,
        bats: bats.map((b) => ({
          x: b.x, y: b.y + (b.ko ? Math.sin(clock * 2.4 + b.i) * 0.12 : 0), vx: b.vx, face: b.face, color: b.color,
          alpha: b.ko ? 0.38 : 1, flap: b.ko ? 6 : b.dashT > 0 ? 40 : 18,
          hidden: !b.ko && ((b.hurt > 0 && Math.floor(b.hurt * 12) % 2 === 0) || (b.safe > 0 && Math.floor(b.safe * 10) % 2 === 0)),
        })),
      });
    }
    if (threeD) ctx.clearRect(0, 0, W, H);
    else {
      window.EchoDuel3D?.hide?.();
      ctx.fillStyle = CAVE_BG;
      ctx.fillRect(0, 0, W, H);
    }

    const tx0 = Math.max(0, Math.floor(cam.x - W / PX / 2) - 1), tx1 = Math.min(L.w - 1, Math.ceil(cam.x + W / PX / 2) + 1);
    const ty0 = 0, ty1 = L.h - 1;
    if (!threeD) {
      const pat = stonePattern();
      pat.setTransform?.(new DOMMatrix([PX / 64, 0, 0, PX / 64, ox, oy]));
      ctx.fillStyle = pat;
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const a = Math.max(L.lit[ty * L.w + tx], nearGlow(tx + 0.5, ty + 0.5));
          if (a < 0.02) continue;
          ctx.globalAlpha = solid(tx, ty) ? Math.min(1, a * 1.15) : a * 0.32;
          ctx.fillRect(X(tx), Y(ty), PX + 0.5, PX + 0.5);
        }
      }
      ctx.globalAlpha = 1;
    }
    // walls: the faces that touch open air get glowing neon edges, in both views
    ctx.lineCap = 'round';
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!solid(tx, ty)) continue;
        const open = [!solid(tx, ty - 1), !solid(tx + 1, ty), !solid(tx, ty + 1), !solid(tx - 1, ty)];
        if (!open.some(Boolean)) continue;
        const a = Math.max(L.lit[ty * L.w + tx], nearGlow(tx + 0.5, ty + 0.5));
        if (a < 0.02) continue;
        const x = X(tx), y = Y(ty), s = PX;
        const edges = [[x, y, x + s, y], [x + s, y, x + s, y + s], [x, y + s, x + s, y + s], [x, y, x, y + s]];
        ctx.beginPath();
        for (let i = 0; i < 4; i++) if (open[i]) { ctx.moveTo(edges[i][0], edges[i][1]); ctx.lineTo(edges[i][2], edges[i][3]); }
        ctx.strokeStyle = `rgba(${COL.wall}, ${a * 0.22})`; ctx.lineWidth = 7; ctx.stroke();
        ctx.strokeStyle = `rgba(${COL.wall}, ${a * 0.95})`; ctx.lineWidth = 2; ctx.stroke();
      }
    }

    const visX = (x) => x > tx0 - 1 && x < tx1 + 2;
    // checkpoint lanterns: always faintly visible, bright green once reached
    L.checkpoints.forEach((cp, k) => {
      if (!visX(cp.x)) return;
      const on = k <= cpIndex, pulse = 0.6 + 0.3 * Math.sin(clock * 3 + k);
      const x = X(cp.x), top = Y(cp.y - 0.2), bot = Y(cp.floor);
      const rgb = on ? COL.exit : COL.crystal;
      ctx.strokeStyle = `rgba(${rgb}, ${on ? 0.7 : 0.35})`; ctx.lineWidth = Math.max(2, PX * 0.08);
      ctx.beginPath(); ctx.moveTo(x, bot); ctx.lineTo(x, top); ctx.stroke();
      glow(x, top, PX * (on ? 1.8 : 1.1), rgb, (on ? 0.55 : 0.3) * pulse);
      ctx.fillStyle = `rgba(${rgb}, ${on ? 0.95 : 0.6})`;
      ctx.beginPath(); ctx.moveTo(x, top - PX * 0.3); ctx.lineTo(x + PX * 0.18, top); ctx.lineTo(x, top + PX * 0.3); ctx.lineTo(x - PX * 0.18, top); ctx.closePath(); ctx.fill();
      ctx.font = `700 ${Math.max(9, PX * 0.3)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(${rgb}, ${on ? 0.9 : 0.55})`;
      ctx.fillText(on ? '✓' : `${k + 1}`, x, top - PX * 0.6);
    });
    // the green light at the end
    if (visX(L.goal.x)) {
      const pulse = 0.55 + 0.25 * Math.sin(clock * 2.4);
      glow(X(L.goal.x), Y(L.goal.y), PX * 2.2, COL.exit, pulse * 0.8);
      ctx.strokeStyle = `rgba(${COL.exit}, ${pulse})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(X(L.goal.x), Y(L.goal.y), PX * 0.45, 0, Math.PI * 2); ctx.stroke();
    }
    for (const m of L.moths) {
      if (m.got || !visX(m.x)) continue;
      const mx = X(m.x + Math.cos(clock * 1.3 + m.phase) * 0.12), my = Y(m.y + Math.sin(clock * 2.1 + m.phase) * 0.15);
      glow(mx, my, PX * 0.9, COL.moth, 0.5);
      const flap = Math.abs(Math.sin(clock * 14 + m.phase));
      ctx.fillStyle = `rgba(${COL.moth}, 0.95)`;
      ctx.beginPath();
      ctx.ellipse(mx - PX * 0.09, my, PX * 0.1, PX * 0.04 + PX * 0.07 * flap, -0.5, 0, Math.PI * 2);
      ctx.ellipse(mx + PX * 0.09, my, PX * 0.1, PX * 0.04 + PX * 0.07 * flap, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const c of L.crystals) {
      if (c.got || !visX(c.x)) continue;
      const cx = X(c.x), cy = Y(c.y + Math.sin(clock * 2 + c.phase) * 0.1);
      glow(cx, cy, PX * 0.8, COL.crystal, 0.45);
      ctx.fillStyle = `rgba(${COL.crystal}, 0.95)`;
      ctx.beginPath(); ctx.moveTo(cx, cy - PX * 0.24); ctx.lineTo(cx + PX * 0.14, cy); ctx.lineTo(cx, cy + PX * 0.24); ctx.lineTo(cx - PX * 0.14, cy); ctx.closePath(); ctx.fill();
    }

    for (const m of L.monsters) if (!m.dead && visX(m.x)) drawMonster(m);

    for (const ring of rings) {
      const f = 1 - ring.r / RING_MAX, rgb = BATS[ring.owner]?.rgb || COL.wall;
      ctx.strokeStyle = `rgba(${rgb}, ${f * 0.9})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(X(ring.x), Y(ring.y), ring.r * PX, 0, Math.PI * 2); ctx.stroke();
      if (ring.r > 0.8) {
        ctx.strokeStyle = `rgba(${COL.wall}, ${f * 0.35})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(X(ring.x), Y(ring.y), (ring.r - 0.6) * PX, 0, Math.PI * 2); ctx.stroke();
      }
    }
    for (const p of particles) {
      ctx.fillStyle = `rgba(${p.rgb}, ${Math.min(1, p.life * 1.6)})`;
      ctx.fillRect(X(p.x) - 2, Y(p.y) - 2, 4, 4);
    }
    for (const b of bats) drawBat(b, threeD);
    for (const p of popups) {
      const k = p.t / p.life;
      ctx.font = `700 ${Math.max(11, PX * 0.42)}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(${p.rgb}, ${1 - k * k})`;
      ctx.fillText(p.text, X(p.x), Y(p.y - k * 0.6));
    }

    // the creeping dark at the left edge, and the dark beyond the shared screen
    const lx = X(scroll.x);
    const g = ctx.createLinearGradient(lx, 0, lx + PX * 1.6, 0);
    g.addColorStop(0, 'rgba(255, 84, 104, 0.3)'); g.addColorStop(1, 'rgba(255, 84, 104, 0)');
    ctx.fillStyle = g; ctx.fillRect(lx, 0, PX * 1.6, H);
    if (lx > 0) { ctx.fillStyle = 'rgba(4, 3, 16, 0.75)'; ctx.fillRect(0, 0, lx, H); }
    const rx = X(scroll.x + VIEW_W);
    if (rx < W) { ctx.fillStyle = 'rgba(4, 3, 16, 0.6)'; ctx.fillRect(rx, 0, W - rx, H); }
    drawVignette();
    drawHud();
    if (touchUsed && localCount === 1 && phase === 'play') drawDashButton();
    drawSticks();
  }

  // eyes that glow in the dark: they show even when the body doesn't
  function eyes(x, y, rgb, gap, size, a = 1) {
    glow(x, y, PX * 0.45, rgb, 0.35 * a);
    ctx.fillStyle = `rgba(${rgb}, ${a})`;
    ctx.beginPath(); ctx.arc(x - gap, y, size, 0, Math.PI * 2); ctx.arc(x + gap, y, size, 0, Math.PI * 2); ctx.fill();
  }
  function stunStars(x, y) {
    for (let k = 0; k < 3; k++) {
      const a = clock * 5 + k * 2.1;
      ctx.fillStyle = '#ffe278';
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * PX * 0.35, y - PX * 0.45 + Math.sin(a) * PX * 0.1, Math.max(2, PX * 0.06), 0, Math.PI * 2); ctx.fill();
    }
  }
  // the warning mark over a monster about to attack
  function alarm(x, y) {
    const s = Math.max(12, PX * 0.5) * (1 + 0.15 * Math.sin(clock * 20));
    ctx.font = `700 ${s}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(5, 6, 15, 0.8)'; ctx.fillText('!', x + 1, y + 2);
    ctx.fillStyle = `rgb(${COL.danger})`; ctx.fillText('!', x, y);
  }

  function drawMonster(m) {
    const x = X(m.x), y = Y(m.y), stunned = m.stun > 0;
    const angry = ['tell', 'drop', 'swoop', 'leap', 'chase'].includes(m.st);
    let a = Math.max(m.lit, nearGlow(m.x, m.y) * 2.5, stunned ? 0.75 : 0, angry ? 0.55 : 0);
    if (m.kind === 'ghost') a = Math.max(a, 0.5);
    a = Math.min(1, a);
    if (m.kind === 'spider') {
      if (a > 0.02) {
        ctx.strokeStyle = `rgba(220, 230, 255, ${a * 0.5})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, Y(m.hy - 0.45)); ctx.lineTo(x, y); ctx.stroke();
        const wig = m.st === 'tell' ? (Math.random() - 0.5) * PX * 0.12 : 0;
        ctx.strokeStyle = `rgba(${stunned ? COL.stun : COL.danger}, ${a})`; ctx.lineWidth = 2;
        const legs = m.st !== 'hang' ? Math.sin(clock * 16) * 0.1 : 0;
        for (const side of [-1, 1]) {
          for (let i = 0; i < 4; i++) {
            const ang = (-0.6 + i * 0.4 + legs) * side;
            ctx.beginPath(); ctx.moveTo(x + wig, y);
            ctx.quadraticCurveTo(x + wig + side * PX * 0.25, y + (ang - 0.3) * PX * 0.25, x + wig + side * PX * 0.34, y + ang * PX * 0.3 + PX * 0.1);
            ctx.stroke();
          }
        }
        ctx.fillStyle = `rgba(70, 16, 32, ${a})`;
        ctx.beginPath(); ctx.arc(x + wig, y, PX * 0.18, 0, Math.PI * 2); ctx.fill();
      }
      if (stunned) stunStars(x, y);
      else if (m.st !== 'hang' || m.lit > 0.1) eyes(x, y - PX * 0.03, COL.danger, PX * 0.06, PX * 0.04, m.st === 'hang' ? m.lit : 1);
      if (m.st === 'tell') alarm(x, y + PX * 0.6);
    } else if (m.kind === 'owl') {
      const awake = m.st !== 'perch';
      if (m.st === 'tell' && !stunned) {
        // the aim line: where it's about to swoop
        const k = 1 - Math.max(0, m.t) / (0.8 * D.tell);
        ctx.strokeStyle = `rgba(${COL.owl}, ${0.25 + 0.5 * k})`; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + m.ax * PX * 7, y + m.ay * PX * 7); ctx.stroke(); ctx.setLineDash([]);
      }
      if (m.st === 'swoop') for (let k = 1; k <= 3; k++) glow(x - m.vx * PX * 0.04 * k, y - m.vy * PX * 0.04 * k, PX * 0.4, COL.owl, 0.18 / k);
      if (a > 0.02) {
        const flap = awake ? Math.sin(clock * (m.st === 'swoop' ? 20 : 12)) * PX * 0.15 : 0;
        const puff = m.st === 'tell' ? 1.15 : 1;
        ctx.fillStyle = `rgba(110, 82, 60, ${a})`;
        ctx.beginPath();
        ctx.ellipse(x - PX * 0.32 * puff, y + PX * 0.05 - flap, PX * 0.22, PX * 0.1, -0.4, 0, Math.PI * 2);
        ctx.ellipse(x + PX * 0.32 * puff, y + PX * 0.05 - flap, PX * 0.22, PX * 0.1, 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(150, 112, 80, ${a})`;
        ctx.beginPath(); ctx.ellipse(x, y, PX * 0.26 * puff, PX * 0.32 * puff, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - PX * 0.2, y - PX * 0.22); ctx.lineTo(x - PX * 0.14, y - PX * 0.42); ctx.lineTo(x - PX * 0.04, y - PX * 0.26);
        ctx.moveTo(x + PX * 0.2, y - PX * 0.22); ctx.lineTo(x + PX * 0.14, y - PX * 0.42); ctx.lineTo(x + PX * 0.04, y - PX * 0.26); ctx.fill();
      }
      if (stunned) stunStars(x, y);
      else if (awake) eyes(x, y - PX * 0.08, COL.owl, PX * 0.1, PX * 0.065);
      else if (a > 0.05) {
        ctx.strokeStyle = `rgba(40, 24, 16, ${a})`; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - PX * 0.15, y - PX * 0.08); ctx.lineTo(x - PX * 0.04, y - PX * 0.08);
        ctx.moveTo(x + PX * 0.04, y - PX * 0.08); ctx.lineTo(x + PX * 0.15, y - PX * 0.08);
        ctx.stroke();
      }
      if (m.st === 'tell' && !stunned) alarm(x, y - PX * 0.75);
    } else if (m.kind === 'crawler') {
      const squash = m.st === 'tell' ? 0.7 : m.st === 'leap' ? 1.2 : 1;
      if (a > 0.02) {
        ctx.strokeStyle = `rgba(${stunned ? COL.stun : COL.crawl}, ${a * 0.8})`; ctx.lineWidth = 2;
        const step = m.st === 'walk' ? Math.sin(clock * 14) * 0.08 : 0;
        for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
          const lx = x + (i - 1) * PX * 0.16;
          ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx + side * PX * (0.06 + step), y + PX * 0.28 * (side > 0 ? 1 : 0.8)); ctx.stroke();
        }
        ctx.fillStyle = `rgba(40, 70, 40, ${a})`;
        ctx.beginPath(); ctx.ellipse(x, y + PX * (1 - squash) * 0.15, PX * 0.34 / Math.sqrt(squash), PX * 0.22 * squash, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = `rgba(${COL.crawl}, ${a * 0.35})`;
        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(x + i * PX * 0.14, y - PX * 0.1 * squash, PX * 0.05, 0, Math.PI * 2); ctx.fill(); }
      }
      if (stunned) stunStars(x, y);
      else eyes(x + (m.face || 1) * PX * 0.16, y - PX * 0.06, COL.crawl, PX * 0.05, PX * 0.035, m.st === 'walk' ? Math.max(0.35, a) : 1);
      if (m.st === 'tell' && !stunned) alarm(x, y - PX * 0.65);
    } else if (m.kind === 'ghost') {
      // ghost moths: pale, see-through, with a wispy tail and red eyes
      const flap = Math.abs(Math.sin(clock * 10 + m.id));
      glow(x, y, PX * 0.8, COL.ghost, 0.35 * a);
      ctx.fillStyle = `rgba(${COL.ghost}, ${0.25 * a})`;
      ctx.beginPath(); ctx.ellipse(x - (m.face || 1) * PX * 0.25, y + PX * 0.06, PX * 0.22, PX * 0.07, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(${stunned ? COL.stun : COL.ghost}, ${0.75 * a})`;
      ctx.beginPath();
      ctx.ellipse(x - PX * 0.11, y, PX * 0.13, PX * 0.05 + PX * 0.09 * flap, -0.5, 0, Math.PI * 2);
      ctx.ellipse(x + PX * 0.11, y, PX * 0.13, PX * 0.05 + PX * 0.09 * flap, 0.5, 0, Math.PI * 2);
      ctx.fill();
      if (stunned) stunStars(x, y);
      else eyes(x, y - PX * 0.02, COL.danger, PX * 0.04, PX * 0.028, a);
    }
  }

  function drawBat(b, threeD) {
    const x = X(b.x), y = Y(b.y + (b.ko ? Math.sin(clock * 2.4 + b.i) * 0.12 : 0)), r = PX * R;
    const mine = b.ctrl === 'local' || viewer === b.i;
    if (!threeD) {
      const blink = !b.ko && ((b.hurt > 0 && Math.floor(b.hurt * 12) % 2 === 0) || (b.safe > 0 && Math.floor(b.safe * 10) % 2 === 0));
      if (!blink) {
        ctx.save();
        ctx.translate(x, y);
        ctx.globalAlpha = b.ko ? 0.4 : 1;
        glow(0, 0, r * 3, b.rgb, b.dashT > 0 ? 0.5 : 0.28);
        const flap = Math.sin(clock * (b.ko ? 6 : b.dashT > 0 ? 40 : 18) + b.i);
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
        if (b.ko) {
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
        ctx.restore();
      }
    } else if (!b.ko) glow(x, y, r * 3, b.rgb, b.dashT > 0 ? 0.4 : 0.18);
    if (b.ko) {
      ctx.strokeStyle = `rgba(${b.rgb}, ${0.35 + 0.2 * Math.sin(clock * 4)})`; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    // name tag (and "you" on your own bat)
    ctx.font = `700 ${Math.max(9, PX * 0.32)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${b.rgb}, ${b.ko ? 0.55 : 0.9})`;
    const tag = b.ko ? `${b.name} · KO` : (b.ctrl === 'cpu' || b.cpuFlag ? `${b.name} · CPU` : b.name) + (mine && bats.length > 1 && localCount === 1 ? ' (you)' : '');
    ctx.fillText(tag, x, y + r * 2.4);
  }

  let vignette = null, vigW = 0, vigH = 0;
  function drawVignette() {
    if (!vignette || vigW !== W || vigH !== H) {
      vigW = W; vigH = H;
      vignette = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.hypot(W, H) * 0.6);
      vignette.addColorStop(0, 'rgba(4, 3, 16, 0)'); vignette.addColorStop(1, 'rgba(4, 3, 16, 0.55)');
    }
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
  }

  // ---- HUD (glass pills like the other modes) ---------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function glowStroke(color, width, halo = color, k = 1) {
    if (halo && k > 0) {
      ctx.strokeStyle = halo;
      ctx.globalAlpha = 0.1 * k; ctx.lineWidth = width + 9; ctx.stroke();
      ctx.globalAlpha = 0.22 * k; ctx.lineWidth = width + 4; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  function pill(x, y, w, h, edge, glowAmt = 10) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(26, 22, 64, 0.78)'); g.addColorStop(1, 'rgba(8, 8, 26, 0.82)');
    ctx.fillStyle = g;
    roundRect(x, y, w, h, h / 2); ctx.fill();
    glowStroke(edge, 2, edge, glowAmt / 10);
  }
  function heart(x, y, s, full) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.8);
    ctx.bezierCurveTo(x - s * 1.2, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.2, y - s * 0.1, x, y + s * 0.8);
    if (full) { ctx.fillStyle = '#ff6b8a'; ctx.fill(); }
    else { ctx.strokeStyle = 'rgba(255, 120, 150, 0.45)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  let hudLayer = null;
  function drawHud() {
    const dpr = ctx.getTransform().a || 1, ph = Math.max(30, Math.min(40, H * 0.085)), topH = Math.ceil(8 + ph + 12);
    let key = `${W},${H},${dpr},${viewer},${localCount}`;
    for (const b of bats) key += `|${b.ctrl},${b.cpuFlag},${b.hearts},${b.echoes},${b.ko},${b.hurt > 0},${b.noEcho > 0 && Math.floor(b.noEcho * 10) % 2}`;
    if (!hudLayer) { const c = document.createElement('canvas'); hudLayer = { c, g: c.getContext('2d'), key: '' }; }
    const c = hudLayer.c;
    if (hudLayer.key !== key) {
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(topH * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(topH * dpr); }
      const main = ctx;
      ctx = hudLayer.g;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawTeamPills(ph);
      ctx = main;
      hudLayer.key = key;
    }
    ctx.drawImage(c, 0, 0, W, topH);
    drawProgress();
    drawMiddle();
  }

  // one pill per bat along the top, split around the pause button: name, hearts, echoes
  function drawTeamPills(ph) {
    const n = bats.length, pad = 10, centerGap = 34, left = Math.ceil(n / 2);
    const pw = Math.min(240, (W / 2 - pad - centerGap) / Math.max(left, n - left) - 8);
    ctx.textBaseline = 'middle';
    bats.forEach((b, k) => {
      const x = k < left ? pad + k * (pw + 8) : W - pad - (n - k) * (pw + 8) + 8;
      const y = 8, cy = y + ph / 2;
      const mine = viewer === b.i || (b.ctrl === 'local' && localCount === 1);
      pill(x, y, pw, ph, b.ko ? 'rgba(160, 160, 190, 0.5)' : b.hurt > 0 ? `rgb(${COL.danger})` : mine ? b.color : `rgba(${b.rgb}, 0.6)`, mine ? 12 : 6);
      // name in a coloured lozenge
      const sh = ph * 0.66, sw = sh * 1.7, sx = x + ph * 0.18;
      roundRect(sx, cy - sh / 2, sw, sh, sh / 2);
      ctx.globalAlpha = b.ko ? 0.45 : 1;
      ctx.fillStyle = b.color; ctx.fill();
      ctx.fillStyle = '#16123a';
      ctx.font = `700 ${Math.round(sh * 0.58)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(b.name, sx + sw / 2, cy + 1);
      ctx.globalAlpha = 1;
      // hearts, or KO while a ghost
      const hx = sx + sw + ph * 0.2, hs = ph * 0.17, hg = ph * 0.5;
      if (b.ko) {
        ctx.font = `700 ${Math.round(ph * 0.36)}px ${FONT}`; ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(214, 208, 255, 0.6)';
        ctx.fillText('KO', hx, cy + 1);
      } else for (let i = 0; i < MAX_HEARTS; i++) heart(hx + hg * (i + 0.5) - hg * 0.2, cy, hs * 1.15, i < b.hearts);
      // echoes: a little ring and the count
      const ecol = b.echoes <= 2 || b.noEcho > 0 ? COL.danger : COL.wall;
      const ex = x + pw - ph * 0.42;
      ctx.font = `700 ${Math.round(ph * 0.4)}px ${FONT}`; ctx.textAlign = 'right';
      ctx.fillStyle = `rgba(${ecol}, ${b.ko ? 0.4 : 1})`;
      ctx.fillText(String(b.echoes), ex, cy + 1);
      const tw = ctx.measureText(String(b.echoes)).width, rx2 = ex - tw - ph * 0.22;
      ctx.strokeStyle = `rgba(${ecol}, ${b.ko ? 0.4 : 0.9})`; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(rx2, cy, ph * 0.1, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(rx2, cy, ph * 0.18, -0.9, 0.9); ctx.stroke();
      if (mine && n > 1) {
        ctx.font = `600 ${Math.round(ph * 0.22)}px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(214, 208, 255, 0.7)';
        ctx.fillText('YOU', sx + sw / 2, y + ph + 6);
      }
    });
  }

  // the level so far: a bar with lantern ticks, each bat's dot, and tries left
  function drawProgress() {
    const size = Math.max(13, Math.min(20, H / 26)), bh = size * 1.4, by = H - bh - 10;
    const bw = Math.min(440, W * 0.5), bx = W / 2 - bw / 2;
    pill(bx, by, bw, bh, 'rgba(150, 130, 255, 0.75)', 8);
    const cy = by + bh / 2;
    ctx.font = `700 ${Math.round(size * 0.62)}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(234, 230, 255, 0.85)';
    const label = 'TRIES', lw = ctx.measureText(label).width;
    ctx.fillText(label, bx + bh * 0.5, cy + 1);
    for (let k = 0; k < TRIES; k++) {
      ctx.beginPath(); ctx.arc(bx + bh * 0.5 + lw + 8 + k * size * 0.62, cy, size * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = k < tries ? `rgb(${COL.exit})` : 'rgba(214, 208, 255, 0.18)'; ctx.fill();
    }
    const t0 = bx + bh * 0.5 + lw + 8 + TRIES * size * 0.62 + 6, t1 = bx + bw - bh * 0.7, tw = t1 - t0;
    const at = (x) => t0 + tw * Math.max(0, Math.min(1, (x - L.start.x) / (L.goal.x - L.start.x)));
    ctx.fillStyle = 'rgba(214, 208, 255, 0.16)'; roundRect(t0, cy - 2, tw, 4, 2); ctx.fill();
    ctx.fillStyle = `rgba(${COL.exit}, 0.7)`; roundRect(t0, cy - 2, Math.max(4, at(scroll.x + VIEW_W / 2) - t0), 4, 2); ctx.fill();
    L.checkpoints.forEach((cp, k) => {
      const x = at(cp.x);
      ctx.fillStyle = k <= cpIndex ? `rgb(${COL.exit})` : 'rgba(150, 240, 255, 0.6)';
      ctx.beginPath(); ctx.moveTo(x, cy - size * 0.38); ctx.lineTo(x + size * 0.2, cy); ctx.lineTo(x, cy + size * 0.38); ctx.lineTo(x - size * 0.2, cy); ctx.closePath(); ctx.fill();
    });
    glow(t1, cy, size * 0.7, COL.exit, 0.6);
    ctx.fillStyle = `rgb(${COL.exit})`; ctx.beginPath(); ctx.arc(t1, cy, size * 0.18, 0, Math.PI * 2); ctx.fill();
    for (const b of bats) {
      ctx.fillStyle = b.ko ? `rgba(${b.rgb}, 0.35)` : b.color;
      ctx.beginPath(); ctx.arc(at(b.x), cy - size * 0.02 - (b.i % 2 ? 1 : -1) * size * 0.05, size * 0.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  // countdown, banners and the first-time hint
  function drawMiddle() {
    const size = Math.max(13, Math.min(20, H / 26)), mid = H * 0.45;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (phase === 'count' && countdown > 0) {
      // to the right of centre: the team lines up on the left
      const cx = W * 0.6;
      ctx.font = `700 ${size * 4}px ${FONT}`;
      ctx.fillStyle = 'rgba(5, 6, 15, 0.9)'; ctx.fillText(String(Math.ceil(countdown)), cx, mid - size * 1.6 + 5);
      ctx.fillStyle = '#f4f1ff'; ctx.fillText(String(Math.ceil(countdown)), cx, mid - size * 1.6);
      const lines = tries < TRIES
        ? [`Try ${TRIES - tries + 1} of ${TRIES}`, 'Stick together. Lanterns bring fallen bats back.']
        : ['Fly together to the green light!',
          'Squeak to see and stun monsters, then dash into them.',
          'Reach a lantern to revive fallen teammates.',
          localCount > 1 ? `Each player owns ${['', 'the screen', 'half', 'a third', 'a quarter'][localCount]} of the screen · tap: squeak · flick: dash`
            : touchUsed ? 'Drag to fly · tap to squeak · flick or DASH to dash' : 'WASD/arrows fly · F/Space squeak · G dash · Esc pause'];
      lines.forEach((t, k) => {
        ctx.font = `${k ? 600 : 700} ${size * (k ? 0.8 : 1)}px ${FONT}`;
        ctx.fillStyle = 'rgba(5, 6, 15, 0.75)'; ctx.fillText(t, cx + 1, mid + size * (1.1 + k * 1.25) + 2);
        ctx.fillStyle = k ? 'rgba(232, 236, 255, 0.78)' : 'rgba(232, 236, 255, 0.95)';
        ctx.fillText(t, cx, mid + size * (1.1 + k * 1.25));
      });
    } else if (banner && banner.t > 0) {
      const a = Math.min(1, banner.t * 2);
      ctx.font = `700 ${size * 1.9}px ${FONT}`;
      ctx.fillStyle = `rgba(5, 6, 15, ${0.9 * a})`; ctx.fillText(banner.text, W / 2, mid + 4);
      ctx.fillStyle = `rgba(${banner.rgb}, ${a})`; ctx.fillText(banner.text, W / 2, mid);
      if (banner.sub) {
        ctx.font = `600 ${size * 0.85}px ${FONT}`;
        ctx.fillStyle = `rgba(5, 6, 15, ${0.8 * a})`; ctx.fillText(banner.sub, W / 2 + 1, mid + size * 1.6 + 2);
        ctx.fillStyle = `rgba(232, 236, 255, ${0.9 * a})`; ctx.fillText(banner.sub, W / 2, mid + size * 1.6);
      }
    }
    const me = viewer >= 0 ? bats[viewer] : localCount === 1 ? localBat(0) : null;
    if (me && me.ko && phase === 'play' && !(banner && banner.t > 0)) {
      ctx.font = `600 ${size * 0.8}px ${FONT}`;
      ctx.fillStyle = 'rgba(232, 236, 255, 0.75)';
      ctx.fillText(bats.some((b) => !b.ko) ? 'You\'re a ghost. Your team revives you at the next lantern.' : '', W / 2, H - size * 3.6);
    }
  }

  function drawDashButton() {
    const b = dashButton(), me = localBat(0);
    if (!me || me.ko) return;
    const ready = me.dashCd <= 0, k = ready ? 1 : 0.55;
    const g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, `rgba(120, 90, 235, ${0.55 * k})`); g.addColorStop(1, `rgba(36, 22, 92, ${0.72 * k})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    glowStroke('rgba(80, 60, 160, 0.7)', 3.5, ready ? 'rgba(160, 120, 255, 1)' : null);
    ctx.strokeStyle = '#a68bff'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, 1 - me.dashCd / DASH_COOLDOWN)); ctx.stroke();
    ctx.font = `700 ${Math.round(b.r * 0.4)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = ready ? '#f4f1ff' : 'rgba(244, 241, 255, 0.45)';
    ctx.fillText('DASH', b.x, b.y - b.r * 0.12);
    // a little bat under the word
    const x = b.x, y = b.y + b.r * 0.38, s = b.r * 0.31;
    ctx.fillStyle = ready ? '#8f6dff' : 'rgba(143, 109, 255, 0.45)';
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.22); ctx.lineTo(x - s * 0.14, y - s * 0.42); ctx.lineTo(x - s * 0.2, y - s * 0.2);
    ctx.quadraticCurveTo(x - s * 0.6, y - s * 0.5, x - s, y - s * 0.38); ctx.quadraticCurveTo(x - s * 0.8, y - s * 0.1, x - s * 0.82, y + s * 0.12);
    ctx.quadraticCurveTo(x - s * 0.5, y, x, y + s * 0.42);
    ctx.quadraticCurveTo(x + s * 0.5, y, x + s * 0.82, y + s * 0.12);
    ctx.quadraticCurveTo(x + s * 0.8, y - s * 0.1, x + s, y - s * 0.38); ctx.quadraticCurveTo(x + s * 0.6, y - s * 0.5, x + s * 0.2, y - s * 0.2);
    ctx.lineTo(x + s * 0.14, y - s * 0.42);
    ctx.closePath(); ctx.fill();
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

  // ---- Main hooks ---------------------------------------------------------
  // Called by the main loop each frame while a co-op run is on (dt is 0 while paused)
  function frame(dt, context, width, height) {
    ctx = context; W = width; H = height;
    if (active && !paused) { if (mode === 'client') clientUpdate(dt); else update(dt); }
    if (L) render();
  }

  // Text for an end screen: { title, big, lines: [{ text, got, color }] } (game.js can use it)
  function describe(r, mySlot = 0) {
    if (!r) return null;
    const lines = r.players.map((p) => ({
      text: `${p.name}${p.cpu ? ' (CPU)' : ''}${p.slot === mySlot && r.players.length > 1 ? ' (you)' : ''}: ${p.moths} moth${p.moths === 1 ? '' : 's'} · ${p.stuns} stunned · ${p.kills} destroyed${p.kos ? ` · down ${p.kos}×` : ''}`,
      got: p.alive && r.won, color: p.color,
    }));
    lines.push({ text: `Team: ${r.team.moths} of ${r.mothsTotal} moths · ${r.team.stuns} stunned · ${r.team.kills} destroyed · ${r.time}s`, got: r.won });
    return {
      title: r.won ? 'Out of the dark together!' : 'The monsters won',
      big: r.won ? `Try ${r.triesUsed} of ${r.triesTotal}` : `${Math.round(r.progress * 100)}% of the way · ${r.checkpoint}/${r.checkpoints} lanterns`,
      lines,
    };
  }

  window.EchoCoop = {
    start, stop, frame, applySnapshot, remote, dropRemote, describe,
    get active() { return active; },
    get over() { return over; },
    get mode() { return mode; },
    get seed() { return seed; },
    get level() { return difficulty; },
    get view() { return view; },
    setView: (v) => { view = v === '2d' ? '2d' : '3d'; if (view === '2d') window.EchoDuel3D?.hide?.(); },
    setPaused: (p) => { paused = !!p; if (paused) { keys.clear(); sticks.clear(); } },
    // for automated tests
    get bats() { return bats; },
    get cave() { return L; },
    get monsters() { return L ? L.monsters : []; },
    get scroll() { return scroll; },
    get phase() { return phase; },
    get tries() { return tries; },
    get checkpoint() { return cpIndex; },
    get rings() { return rings; },
    get result() { return result; },
    VIEW_W,
    autopilot(i, on = true) {
      const b = bats[i];
      if (!b) return;
      if (on) { if (b.ctrl !== 'cpu') b.was = b.ctrl; b.ctrl = 'cpu'; b.ai = { path: [], think: 0, sq: 0 }; } else if (b.was) b.ctrl = b.was;
    },
    squeak: (i) => squeak(bats[i]),
    dash: (i, dx, dy) => dash(bats[i], dx, dy),
    hurt: (i, n = 1) => { const b = bats[i]; for (let k = 0; k < n && b && !b.ko; k++) { b.hurt = 0; b.safe = 0; hurtBat(b, b.x - 1, b.y); } },
    knockOut: (i) => knockOut(bats[i]),
    teleport: (i, x, y) => { const b = bats[i]; if (b) { b.x = x; b.y = y; b.vx = b.vy = 0; } },
    setScroll: (x) => { scroll.x = x; },
    skipCountdown: () => { if (phase === 'count') { countdown = 0.001; } },
  };
})();
