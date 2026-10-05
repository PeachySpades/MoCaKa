// Bat Brawl: 2 to 4 bats in a pitch-dark arena. A squeak lights the walls
// and stuns any rival it hits; dash into a rival to chomp it (stunned ones
// can't dash away or parry). Bats can dash and grab power-ups.
// Two match rules:
//   bites     first to 3 (or 5, 7) bites wins; an eaten bat comes back
//   survivor  Last Bat Standing: an eaten bat is out until the round ends;
//             the last bat flying wins the round, first to N round wins takes the match
//
// It runs in three modes:
//   local   everyone on one device (split touch zones / shared keyboard) + CPU bats
//   host    this device simulates the match for an online room and streams snapshots
//   client  this device shows snapshots from the host and sends its own input
(() => {
  'use strict';

  const R = 0.3, ACCEL = 30, MAX_SPEED = 4.6, DRAG = 3.4, STUN_DRAG = 7;
  const RING_SPEED = 11, RING_MAX = 4.5, MEGA_RING = 7, COOLDOWN = 0.45, FRENZY_COOLDOWN = 0.22;
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
  const OPEN_SKY_CHANCE = 0.3;
  // Arena modes, picked before a match:
  //   morph  the cave slowly reshapes itself, a few walls at a time, into the next one
  //   still  one cave, picked in the lobby, that never changes
  //   sky    Open Sky the whole match: no cave at all
  // (older lobbies may still send 'shift' or 'chaos'; those play as morph)
  const ARENA_MODES = ['morph', 'still', 'sky'];
  const MORPH_STEP = 0.3, MORPH_PAUSE = 5;
  // A bat the morphing walls have shut into a small pocket (less than
  // TRAP_SHARE of the open cave reachable) for TRAP_TIME seconds sets off an
  // early morph into Open Sky, which melts the walls nearest it first and fast.
  const TRAP_SHARE = 0.35, TRAP_TIME = 1.5, TRAP_CHECK = 0.25, RESCUE_STEP = 0.1, RESCUE_TILES = 8;
  let arenaMode = 'morph';
  // Last Bat Standing: the round banner shows for ROUND_BANNER seconds after
  // the last chomp, then everyone respawns. A round that drags past
  // ROUND_LIMIT seconds brings an echo storm: every bat glows, nobody can hide.
  const ROUND_BANNER = 2.5, ROUND_LIMIT = 90, STORM_WARN = 10;
  let rule = 'bites', round = 1, roundClock = 0, roundEnd = null, storm = false, stormWarned = false, matchWinner = null;
  const EAT_PULL = 0.35, EAT_TIME = 1.1;
  const SNAPSHOT_EVERY = 0.05;
  // Power-ups. The first four work the moment you grab them. The "special"
  // ones are held (one at a time; grabbing another swaps it) and used with
  // the POWER button above BITE·DASH (E or Q on a keyboard).
  const POWERS = {
    mega: { label: 'MEGA SCREECH', rgb: '255, 226, 120', name: 'Mega Screech', desc: 'Your next squeak is huge and stuns longer' },
    speed: { label: 'SPEED', rgb: '120, 255, 170', name: 'Speed', desc: '6 seconds of faster flying' },
    shield: { label: 'SHIELD', rgb: '150, 240, 255', name: 'Shield', desc: 'Blocks one stun or bite' },
    frenzy: { label: 'ECHO FRENZY', rgb: '255, 120, 200', name: 'Echo Frenzy', desc: '5 seconds of free, rapid squeaks' },
    fire: { label: 'FIREBALL', rgb: '255, 112, 40', name: 'Fireball', desc: 'Shoot fireballs where you fly for 8 seconds: they light the cave and stun', special: true },
    thunder: { label: 'THUNDER', rgb: '255, 245, 90', name: 'Thunder', desc: 'For 8 seconds, call lightning on every rival near you (no parrying it)', special: true },
    wall: { label: 'STONE WALL', rgb: '214, 160, 110', name: 'Stone Wall', desc: 'Raise a wall behind you for 6 seconds', special: true },
    freeze: { label: 'FREEZE', rgb: '110, 210, 255', name: 'Freeze', desc: 'For 8 seconds, ice blasts freeze rivals close to you', special: true },
    tornado: { label: 'TORNADO', rgb: '190, 255, 235', name: 'Tornado', desc: 'For 8 seconds, send out twisters that pull rivals in and spin them', special: true },
    ghost: { label: 'GHOST', rgb: '214, 196, 255', name: 'Ghost', desc: 'Fly through cave walls for 5 seconds, half see-through', special: true },
  };
  const POWER_TYPES = Object.keys(POWERS);
  const POWER_ICONS = { mega: '📣', speed: '⚡', shield: '🛡️', frenzy: '🎶', fire: '🔥', thunder: '🌩️', wall: '🧱', freeze: '❄️', tornado: '🌪️', ghost: '👻' };
  const toHex = (rgb) => '#' + rgb.split(',').map((v) => (+v).toString(16).padStart(2, '0')).join('');
  const POWER_LIST = POWER_TYPES.map((id) => ({ id, name: POWERS[id].name, desc: POWERS[id].desc, color: toHex(POWERS[id].rgb), icon: POWER_ICONS[id], special: !!POWERS[id].special }));
  // how often power-ups appear: [first one after, then every, seconds] and how many can wait on the map
  const POWER_FREQ = {
    off: null,
    low: { first: [10, 14], every: [14, 20], max: 1 },
    normal: { first: [6, 9], every: [8, 13], max: 2 },
    high: { first: [0, 0], every: [2, 3.5], max: 5, start: 2 },   // two show up the moment play starts
  };
  let powerOn = POWER_TYPES.slice(), powerFreq = POWER_FREQ.normal;
  const powerWait = (k) => (powerFreq ? powerFreq[k][0] + Math.random() * (powerFreq[k][1] - powerFreq[k][0]) : 1e9);
  // special power numbers
  const SPECIAL_CD = 0.35;
  // Timed specials: the first use starts a TIMED_LIFE-second clock, and until
  // it runs out you can use the power again and again. Shots (fireball,
  // tornado) fire as fast as you tap; the area blasts (freeze, thunder) keep a
  // short gap. CPUs use slower gaps so they don't spray. Stone Wall and Ghost
  // stay one use each.
  const TIMED_LIFE = 8;
  const TIMED_CD = { fire: 0.08, tornado: 0.12, thunder: 0.6, freeze: 0.6 };
  const CPU_TIMED_CD = { fire: 0.3, tornado: 0.8, thunder: 1.6, freeze: 1.6 };
  const MAX_SHOTS_EACH = 10, MAX_TWISTERS_EACH = 4;   // oldest goes when a bat has more out
  const FIRE_SPEED = 10, FIRE_LIFE = 1.6, FIRE_R = 0.28, FIRE_STUN = 2, FIRE_KNOCK = 6, FIRE_SPLASH = 1.15, SPLASH_STUN = 1.3;
  const THUNDER_RANGE = 7, THUNDER_FAR = 11, THUNDER_DELAY = 0.45, THUNDER_STUN = 2.2, THUNDER_REVEAL = 3, BOLT_FX = 0.9;
  const WALL_LEN = 4, WALL_LIFE = 6, WALL_RISE = 0.3, WALL_CRUMBLE = 0.7, WALL_BACK = 1.6;
  const FREEZE_R = 3.2, FREEZE_STUN = 2.6, NOVA_FX = 0.55;
  const TORNADO_LIFE = 4.5, TORNADO_SPEED = 2.4, TORNADO_PULL = 3.6, TORNADO_CORE = 0.65, TORNADO_STUN = 1.6;
  const GHOST_TIME = 5;
  const BATS = [
    { name: 'Mo', color: '#8b6cff', rgb: '139, 108, 255' },
    { name: 'Ka', color: '#ff7ad9', rgb: '255, 122, 217' },
    { name: 'Ca', color: '#9dff6a', rgb: '157, 255, 106' },
    { name: 'Bo', color: '#ffb347', rgb: '255, 179, 71' },
  ];
  // what lit a tile (litBy): a bat's slot 0-3, or one of these lights
  const LIGHT_FIRE = 4, LIGHT_ICE = 5, LIGHT_BOLT = 6;
  const LIGHT_RGB = [...BATS.map((b) => b.rgb), '255, 140, 50', '140, 220, 255', '255, 250, 190'];
  // keys for each local player slot on a shared keyboard
  const KEYMAP = [
    { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], squeak: ['KeyF', 'Space'], dash: ['KeyG', 'ShiftLeft'], special: ['KeyE', 'KeyQ'] },
    { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], squeak: ['Enter', 'Slash'], dash: ['ShiftRight', 'Period'], special: ['Quote', 'Comma'] },
    { up: ['KeyI'], down: ['KeyK'], left: ['KeyJ'], right: ['KeyL'], squeak: ['KeyH'], dash: ['KeyU'], special: ['KeyY'] },
    { up: ['Numpad8'], down: ['Numpad5'], left: ['Numpad4'], right: ['Numpad6'], squeak: ['Numpad0', 'NumpadEnter'], dash: ['NumpadAdd'], special: ['NumpadSubtract'] },
  ];

  // ---- Arena -------------------------------------------------------------
  // Morph mode: caves morph in order; now and then the walls melt away into the wall-less Open Sky instead.
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
  // grid: 0 open, 1 cave wall, 2 a Stone Wall power's temporary block
  const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= arena.w || ty >= arena.h || arena.grid[ty * arena.w + tx] !== 0;
  const blockerAt = (tx, ty) => tx >= 0 && ty >= 0 && tx < arena.w && ty < arena.h && arena.grid[ty * arena.w + tx] === 2;
  // is there a Stone Wall block on the straight line between two points?
  function blockerBetween(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 0.2);
    for (let k = 1; k < n; k++) if (blockerAt(Math.floor(x0 + (x1 - x0) * k / n), Math.floor(y0 + (y1 - y0) * k / n))) return true;
    return false;
  }
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
  // Which open patch each tile belongs to (cave walls split them; Stone Wall
  // blocks count as open since they crumble): label per tile (-1 for rock) and patch sizes
  function openRegions() {
    const { w, h, grid } = arena, label = new Int16Array(w * h).fill(-1), sizes = [], stack = [];
    for (let k0 = 0; k0 < w * h; k0++) {
      if (grid[k0] === 1 || label[k0] >= 0) continue;
      const id = sizes.length;
      let n = 0;
      label[k0] = id; stack.push(k0);
      while (stack.length) {
        const k = stack.pop(), x = k % w, y = (k - x) / w;
        n++;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (grid[j] !== 1 && label[j] < 0) { label[j] = id; stack.push(j); }
        }
      }
      sizes.push(n);
    }
    return { label, sizes };
  }
  // Starting spots: one safe open tile near each corner (top-left, top-right,
  // bottom-left, bottom-right), all in the cave's biggest open patch
  function cornerSpots() {
    const { w, h } = arena, { label, sizes } = openRegions();
    const big = sizes.indexOf(Math.max(...sizes));
    const ok = arena.open.filter((p) => label[Math.floor(p.y) * w + Math.floor(p.x)] === big && !hitsWall(p.x, p.y, R));
    const pool = ok.length ? ok : arena.open;
    return [[2.5, 2.5], [w - 2.5, 2.5], [2.5, h - 2.5], [w - 2.5, h - 2.5]].map(([cx, cy]) =>
      pool.reduce((best, p) => (Math.hypot(p.x - cx, p.y - cy) < Math.hypot(best.x - cx, best.y - cy) ? p : best), pool[0]));
  }
  // Each bat gets its own corner, picked at random; two bats get opposite
  // corners (a random diagonal), so they start as far apart as they can
  function cornerStarts() {
    const spots = cornerSpots(), n = bats.length;
    let order = [0, 1, 2, 3];
    for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; }
    if (n === 2) order = [order[0], 3 - order[0]];
    return bats.map((b, k) => spots[order[k % 4]]);
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
  // special powers in play: fireballs, twisters, Stone Wall segments, thunder strikes (rules, host)
  // and the purely visual lightning bolts and ice blasts (everyone)
  let shots = [], twisters = [], blocks = [], thunders = [], bolts = [], novas = [], fxId = 0, specialCount = 0;
  let lit, litBy;
  let clock = 0, countdown = 0, over = false, banner = null, morph = null, tileGlow = null;
  let slowmo = 0, shake = 0, powerTimer = 6, firstPower = true, snapTimer = 0, outbox = [], ringId = 0, ended = false;
  const remoteInput = new Map();         // slot -> { ix, iy }

  function makeBat(i, ctrl, localSlot) {
    return {
      i, ...BATS[i], ctrl, local: localSlot, x: 0, y: 0, vx: 0, vy: 0, face: 1,
      echoes: START_ECHOES, cooldown: 0, stun: 0, safe: 0, dead: 0, score: 0, seen: 0, mouth: 0, puff: 0,
      dashCd: 0, dashT: 0, power: null, powerT: 0, mega: false, shield: false, charging: false, charge: 0,
      parryT: 0, parryCd: 0, parryRing: null, hitBy: null, biteT: 0, dashSeq: 0, out: false,
      held: null, heldLeft: 0, specialCd: 0, ghostT: 0, ice: 0, burn: 0, revealT: 0, look: null,
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
    cpuLevel = baseLevel = CPU_LEVELS[o.level] || CPU_LEVELS.normal;
    arenaMode = ARENA_MODES.includes(o.arenaMode) ? o.arenaMode : 'morph';
    rule = o.rule === 'survivor' ? 'survivor' : 'bites';
    winScore = Math.max(1, Math.min(15, Math.round(+o.firstTo) || WIN_SCORE));
    // o.powerups: { on: { fire: false, ... }, freq: 'off' | 'low' | 'normal' | 'high' }
    const pu = o.powerups || {};
    powerOn = POWER_TYPES.filter((t) => !pu.on || pu.on[t] !== false);
    powerFreq = Object.prototype.hasOwnProperty.call(POWER_FREQ, pu.freq) ? POWER_FREQ[pu.freq] : POWER_FREQ.normal;
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
    // o.arena picks the cave (0-3: Crystal Grotto, Lava Hollow, Mossy Den, Frozen Cavern)
    // for 'still', and the first cave for 'morph'; otherwise a random one. Guests
    // load whatever the host's snapshots say.
    const caves = arenaKinds(false), want = o.arena == null || o.arena === '' ? NaN : Math.floor(+o.arena);
    const cave = want >= 0 ? caves[want % caves.length] : mode === 'client' ? caves[0] : caves[Math.floor(Math.random() * caves.length)];
    loadArena(arenaMode === 'sky' ? arenaKinds(true)[0] : cave);
    morph = arenaMode === 'morph' && mode !== 'client' ? { target: -1, timer: 0, pause: MORPH_PAUSE } : null;
    // everyone starts in a different corner (guests take theirs from the host's snapshots)
    const starts = mode === 'client' ? arena.spawns : cornerStarts();
    bats.forEach((b, k) => {
      const s = starts[k] || arena.spawns[k % arena.spawns.length];
      b.x = s.x; b.y = s.y; b.face = s.x < arena.w / 2 ? 1 : -1;
    });
    // bat looks (see looks.js): the lobby's pick for each slot, else a preset for
    // people and a random one for CPUs. Guests get the host's from snapshots.
    const seed = Number.isFinite(+(o.seed ?? o.cpuSeed)) ? +(o.seed ?? o.cpuSeed) : Math.floor(Math.random() * 1e6);
    bats.forEach((b) => { b.look = lookFor(b, o.looks?.[b.i], seed); b.lv = CPU_LEVELS[o.levels?.[b.i]] || null; });
    looksSent = 0;
    rings = []; beams = []; particles = []; popups = []; eats = []; outbox = []; parries = [];
    shots = []; twisters = []; blocks = []; thunders = []; bolts = []; novas = [];
    remoteInput.clear();
    clock = 0; countdown = 3; over = false; ended = false; slowmo = 0; shake = 0;
    round = 1; roundClock = 0; roundEnd = null; storm = false; stormWarned = false; matchWinner = null; watchI = -1;
    powerTimer = powerWait('first'); firstPower = true; snapTimer = 0;
    banner = mode === 'client' ? null : { text: arena.def.name, rgb: arena.theme.wall, t: 3.2 };
    keys.clear();
    sticks.clear();
    chargers.clear();
    active = true;
  }
  function stop() { active = false; }
  let looksSent = 0;
  function lookFor(b, want, seed) {
    const L = window.EchoLooks;
    if (!L) return null;
    try {
      if (want) return L.clean(want);
      return b.ctrl === 'cpu' ? L.random(seed + b.i) : L.preset(b.i);
    } catch (e) { return null; }
  }

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
    else if (ev.k === 'bolt') bolts.push({ id: ev.id, tgt: ev.tgt, x: ev.x, y: ev.y, t: 0, delay: ev.d, seed: ev.id * 97 });
    else if (ev.k === 'nova') novas.push({ x: ev.x, y: ev.y, o: ev.o, t: 0 });
    else if (ev.k === 'boom') {
      burst(ev.x, ev.y, '255, 140, 50', 18, 4, 5); burst(ev.x, ev.y, '255, 230, 140', 8, 2.5, 3);
      lightAround(ev.x, ev.y, 2.2, LIGHT_FIRE);
      novas.push({ x: ev.x, y: ev.y, o: -1, t: 0, fire: true });
    } else if (ev.k === 'parry') {
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
      if (keysFor(slot, 'special').includes(e.code)) act(slot, 'special');
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

  // While you hold a special power a smaller POWER button pops up above
  // BITE·DASH, so you can still bite (on computers BITE·DASH stays hidden,
  // since G bites; the power button shows up there too, with E)
  const powerButton = () => { const b = dashButton(), r = 36; return { x: b.x, y: b.y - b.r - 14 - r, r }; };
  const inPowerButton = (cx, cy) => {
    if (localCount !== 1) return false;
    const rect = canvas.getBoundingClientRect(), b = powerButton();
    return Math.hypot(cx - rect.left - b.x, cy - rect.top - b.y) < b.r + 6;
  };
  const buttonsShown = () => localCount === 1 && countdown <= 0 && !spectating();
  const specialShown = () => buttonsShown() && !!localBat(0)?.held;
  const biteShown = () => buttonsShown() && touchUsed;
  const actionShown = () => specialShown() || biteShown();

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
    if (specialShown() && inPowerButton(e.clientX, e.clientY)) { act(0, 'special'); return; }
    if (biteShown() && inDashButton(e.clientX, e.clientY)) { act(0, 'dash'); return; }
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
    // a dash (or a power) goes the way you're steering right now (guests' copies of velocity lag behind)
    if ((a === 'dash' || a === 'special') && !(Math.hypot(dx || 0, dy || 0) > 0.1)) {
      const { ix, iy } = localInput(slot);
      if (Math.hypot(ix, iy) > 0.2) { dx = ix; dy = iy; }
    }
    if (mode === 'client') {
      net?.send({ t: 'act', a, dx, dy });
      if (a === 'squeak' && b.echoes <= 0) applyFx({ k: 'sfx', n: 'empty' });
      if (a === 'special' && !b.held) applyFx({ k: 'sfx', n: 'empty' });
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
    else if (a === 'special') useSpecial(b, dx, dy);
  }

  // ---- Online hooks (host side) -----------------------------------------
  function remote(slot, msg) {
    const b = bats[slot];
    if (!b || b.ctrl !== 'remote' || mode !== 'host') return;
    if (msg.t === 'in') remoteInput.set(slot, { ix: +msg.ix || 0, iy: +msg.iy || 0 });
    else if (msg.t === 'act' && ['squeak', 'charge', 'release', 'dash', 'special'].includes(msg.a)) doAct(b, msg.a, +msg.dx || 0, +msg.dy || 0);
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
    easy: { speed: 0.72, think: 0.65, squeak: 0.22, beam: 0, aimErr: 0, dash: 0.25, sense: 1.6, memory: 1.5, search: 0.08, power: 3, parry: 0, special: 0.3, waste: 0.05 },
    normal: { speed: 0.86, think: 0.42, squeak: 0.35, beam: 0.25, aimErr: 0.16, dash: 0.5, sense: 2.2, memory: 3, search: 0.15, power: 5, parry: 0.3, special: 0.55, waste: 0 },
    hard: { speed: 1, think: 0.26, squeak: 0.5, beam: 0.5, aimErr: 0.06, dash: 0.75, sense: 2.8, memory: 4.5, search: 0.25, power: 7, parry: 0.55, special: 0.85, waste: 0 },
  };
  // cpuLevel is the level of the CPU being thought for (o.levels can set one per seat)
  let cpuLevel = CPU_LEVELS.normal, baseLevel = CPU_LEVELS.normal;
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
    // a ghost flies straight at its target, through the rock
    const next = (b.ghostT > 0.4 ? null : ai.path[0]) || target;
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
      if (b.held && b.specialCd <= 0 && !b.charging) cpuSpecial(b, fresh, known, target);
    }
    const speed = (snack ? 1 : 0.85) * lv.speed;
    return { ix: (dx / len) * speed, iy: (dy / len) * speed };
  }

  // CPUs use a held power when it would pay off (better CPUs more readily and
  // more accurately; easy ones sometimes just waste it)
  function cpuSpecial(b, fresh, known, target) {
    const lv = cpuLevel;
    // a timed power already running gets used whenever there's a shot (it's ticking away anyway)
    const running = b.heldLeft > 0;
    if (!running && lv.waste && Math.random() < lv.waste) { useSpecial(b); return; }
    if (!running && Math.random() > lv.special) return;
    const live = fresh.filter((k) => k.bat.safe <= 0 && !k.bat.dead && !k.bat.out).sort((p, q) => dist(p, b) - dist(q, b));
    const near = live[0], d = near ? dist(near, b) : 99;
    const clear = (k) => castRay(b.x, b.y, (k.x - b.x) / dist(k, b), (k.y - b.y) / dist(k, b), dist(k, b)) >= dist(k, b) - 0.3;
    const aim = (k, lead) => {
      const ax = k.x + (k.vx || 0) * lead - b.x, ay = k.y + (k.vy || 0) * lead - b.y, l = Math.hypot(ax, ay) || 1;
      const err = (Math.random() - 0.5) * 2 * lv.aimErr, c = Math.cos(err), sn = Math.sin(err);
      return [(ax * c - ay * sn) / l, (ax * sn + ay * c) / l];
    };
    switch (b.held) {
      case 'fire': if (near && d < 10 && near.bat.stun <= 0 && clear(near)) useSpecial(b, ...aim(near, lv.aimErr < 0.1 ? d / FIRE_SPEED : 0)); break;
      case 'tornado': if (near && d < 6.5 && clear(near)) useSpecial(b, ...aim(near, 0)); break;
      case 'thunder': if (live.some((k) => dist(k, b) < THUNDER_RANGE - 0.5 && k.bat.stun <= 0)) useSpecial(b); break;
      case 'freeze': if (live.some((k) => dist(k, b) < FREEZE_R - 0.2 && k.bat.stun <= 0)) useSpecial(b); break;
      case 'wall': {
        // a rival close by and able to bite: wall it off (the wall goes behind, so fly away from it)
        const t = live.find((k) => dist(k, b) < 3.4 && k.bat.stun <= 0 && (k.bat.biteT > 0 || k.bat.dashCd < 0.5));
        if (t) useSpecial(b, (b.x - t.x) / dist(t, b), (b.y - t.y) / dist(t, b));
        break;
      }
      case 'ghost': {
        // the way to its target winds around rock: go straight through instead
        const goal = target && dist(target, b);
        if ((goal > 2.5 && b.ai.path.length > goal * 1.6 + 2) || (b.heldT > 10 && known.length)) useSpecial(b);
        break;
      }
    }
  }

  // ---- Echo parry ----------------------------------------------------------
  // A squeak press opens a short parry window (unless the last one was too
  // recent). Returns true if a window opened, 'late' if the press parried a
  // hit that had just landed, false otherwise.
  function parryPress(b) {
    if (!active || countdown > 0 || over || roundEnd || !b || b.dead || b.parryCd > 0) return false;
    const late = b.ctrl === 'remote' ? PARRY_LATE_REMOTE : PARRY_LATE;
    if (b.stun > 0 && b.hitBy && clock - b.hitBy.t <= late) {
      const h = b.hitBy;
      b.hitBy = null;
      b.stun = 0; b.ice = 0; b.vx = h.vx; b.vy = h.vy;
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
  const canAct = (b) => active && b && countdown <= 0 && !over && !roundEnd && !b.dead && b.stun <= 0;

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

  // ---- Special powers (held, used with the POWER button) --------------------
  // Fire, thunder, ice and wind light up the cave around them like sound does
  // (litBy says what lit a tile, so walls glow orange near a fireball).
  function lightAround(x, y, rad, by) {
    if (!arena || !lit) return;
    const { w, h } = arena;
    for (let ty = Math.max(0, Math.floor(y - rad)); ty <= Math.min(h - 1, Math.floor(y + rad)); ty++) {
      for (let tx = Math.max(0, Math.floor(x - rad)); tx <= Math.min(w - 1, Math.floor(x + rad)); tx++) {
        const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
        if (d > rad) continue;
        const k = ty * w + tx, v = Math.min(1, 1.3 - d / rad);
        if (v > lit[k]) { lit[k] = v; litBy[k] = by; }
      }
    }
  }
  // a stun from a power; false if a shield blocked it
  function powerStun(foe, by, t, kx, ky, text, rgb, parryFrom) {
    foe.seen = 1;
    if (foe.shield) {
      foe.shield = false;
      fx({ k: 'popup', x: foe.x, y: foe.y - 1, text: 'BLOCKED', rgb: POWERS.shield.rgb, life: 0.8 });
      fx({ k: 'burst', x: foe.x, y: foe.y, rgb: POWERS.shield.rgb, n: 12 });
      fx({ k: 'sfx', n: 'block' });
      return false;
    }
    if (parryFrom) noteHit(foe, by, parryFrom.x, parryFrom.y, foe.vx, foe.vy);
    foe.stun = Math.max(foe.stun, t);
    foe.dashT = 0; foe.biteT = 0; foe.charging = false; foe.charge = 0;
    foe.vx = kx; foe.vy = ky;
    fx({ k: 'burst', x: foe.x, y: foe.y, rgb, n: 14, sp: 3.5 });
    fx({ k: 'popup', x: foe.x, y: foe.y - 1.5, text, rgb, life: 0.9, big: true });
    fx({ k: 'sfx', n: 'stun' });
    return true;
  }

  function useSpecial(b, dx, dy) {
    if (!canAct(b) || !b.held || b.specialCd > 0) return false;
    let ux = dx, uy = dy;
    if (!(Math.hypot(ux || 0, uy || 0) > 0.1)) ({ ux, uy } = heading(b));
    const l = Math.hypot(ux, uy) || 1;
    ux /= l; uy /= l;
    const type = b.held;
    if (type === 'wall' && !placeWall(b, ux, uy)) {
      // nowhere to put it without boxing someone in: keep it for later
      b.specialCd = SPECIAL_CD;
      if (b.ctrl !== 'cpu') { fx({ k: 'popup', x: b.x, y: b.y - 1, text: 'NO ROOM', rgb: POWERS.wall.rgb, life: 0.7 }); fx({ k: 'sfx', n: 'empty' }); }
      return false;
    }
    if (TIMED_CD[type]) {
      // a timed power: the first use starts its clock, then it keeps working until that runs out
      if (!(b.heldLeft > 0)) b.heldLeft = TIMED_LIFE;
      b.specialCd = (b.ctrl === 'cpu' ? CPU_TIMED_CD : TIMED_CD)[type];
    } else { b.held = null; b.heldLeft = 0; b.specialCd = SPECIAL_CD; }
    b.charging = false; b.charge = 0;
    specialCount++;
    if (Math.abs(ux) > 0.2) b.face = Math.sign(ux);
    if (type === 'fire') shootFire(b, ux, uy);
    else if (type === 'thunder') callThunder(b, ux, uy);
    else if (type === 'freeze') freezeBlast(b);
    else if (type === 'tornado') spawnTwister(b, ux, uy);
    else if (type === 'ghost') {
      b.ghostT = GHOST_TIME;
      fx({ k: 'burst', x: b.x, y: b.y, rgb: POWERS.ghost.rgb, n: 16, sp: 2.5 });
      fx({ k: 'popup', x: b.x, y: b.y - 1, text: 'GHOST!', rgb: POWERS.ghost.rgb, life: 0.9 });
      fx({ k: 'sfx', n: 'ghost', alt: 'slurp' });
    }
    return true;
  }

  // Fire: a fireball flies straight on, lighting the cave, and bursts on the
  // first wall or bat it meets. A hit stuns and knocks back (bite them next!);
  // the burst singes anyone close. A parry knocks it back at whoever threw it.
  function shootFire(b, ux, uy) {
    const mine = shots.filter((m) => m.owner === b.i);
    if (mine.length >= MAX_SHOTS_EACH) shots.splice(shots.indexOf(mine[0]), 1);
    shots.push({ id: ++fxId, x: b.x + ux * 0.35, y: b.y + uy * 0.35, vx: ux * FIRE_SPEED, vy: uy * FIRE_SPEED, owner: b.i, t: 0 });
    b.vx -= ux * 0.8; b.vy -= uy * 0.8;
    b.seen = 1;
    fx({ k: 'sfx', n: 'fire', alt: 'beam' });
    fx({ k: 'shake', v: 0.08 });
  }
  function updateShots(dt) {
    for (const s of shots) {
      s.t += dt;
      const steps = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy) * dt) / 0.1));
      for (let k = 0; k < steps && !s.gone; k++) {
        const nx = s.x + (s.vx * dt) / steps, ny = s.y + (s.vy * dt) / steps;
        if (solid(Math.floor(nx), Math.floor(ny))) { explode(s, null); break; }
        s.x = nx; s.y = ny;
        for (const foe of bats) {
          if (foe.i === s.owner || foe.dead || foe.safe > 0 || Math.hypot(foe.x - s.x, foe.y - s.y) > R + FIRE_R) continue;
          if (foe.parryT > 0 && foe.stun <= 0) { deflect(s, foe); break; }
          const sp = Math.hypot(s.vx, s.vy) || 1;
          if (powerStun(foe, s.owner, FIRE_STUN, (s.vx / sp) * FIRE_KNOCK, (s.vy / sp) * FIRE_KNOCK, 'BURNED!', POWERS.fire.rgb, s)) foe.burn = 1.4;
          explode(s, foe);
          break;
        }
      }
      if (!s.gone && s.t > FIRE_LIFE) explode(s, null);
    }
    shots = shots.filter((s) => !s.gone);
  }
  function explode(s, hit) {
    s.gone = true;
    fx({ k: 'boom', x: r2(s.x), y: r2(s.y) });
    fx({ k: 'sfx', n: 'boom', alt: 'crash' });
    fx({ k: 'shake', v: 0.16 });
    for (const foe of bats) {
      if (foe === hit || foe.i === s.owner || foe.dead || foe.safe > 0 || foe.stun > 0) continue;
      const d = Math.hypot(foe.x - s.x, foe.y - s.y);
      if (d > FIRE_SPLASH + R || castRay(s.x, s.y, (foe.x - s.x) / (d || 1), (foe.y - s.y) / (d || 1), d) < d - 0.3) continue;
      if (powerStun(foe, s.owner, SPLASH_STUN, ((foe.x - s.x) / (d || 1)) * 4, ((foe.y - s.y) / (d || 1)) * 4, 'SCORCHED!', POWERS.fire.rgb, s)) foe.burn = 1;
    }
  }
  function deflect(s, foe) {
    const atk = bats[s.owner];
    let ux = -s.vx, uy = -s.vy;
    if (atk && !atk.dead) { ux = atk.x - s.x; uy = atk.y - s.y; }
    const l = Math.hypot(ux, uy) || 1;
    s.vx = (ux / l) * FIRE_SPEED * 1.15; s.vy = (uy / l) * FIRE_SPEED * 1.15;
    s.owner = foe.i; s.t = 0;
    parrySucceed(foe, null, s.x, s.y);
  }

  // Thunder: the screen darkens, then lightning strikes every rival within
  // THUNDER_RANGE (or the nearest one a bit farther out). It comes from above,
  // not from an echo, so it can't be parried; a shield still blocks it.
  // Struck bats are stunned and glow for a few seconds.
  function callThunder(b, ux, uy) {
    const foes = bats.filter((o) => o !== b && !o.dead && !o.out);
    let hit = foes.filter((o) => dist(o, b) <= THUNDER_RANGE);
    if (!hit.length) hit = foes.filter((o) => dist(o, b) <= THUNDER_FAR).sort((p, q) => dist(p, b) - dist(q, b)).slice(0, 1);
    b.seen = Math.max(b.seen, 0.5);
    fx({ k: 'sfx', n: 'charged' });
    if (!hit.length) {
      // nobody about: it strikes the ground ahead and lights it up
      const x = Math.max(1.5, Math.min(arena.w - 1.5, b.x + ux * 3)), y = Math.max(1.5, Math.min(arena.h - 1.5, b.y + uy * 3));
      fx({ k: 'bolt', id: ++fxId, tgt: -1, x: r2(x), y: r2(y), d: THUNDER_DELAY });
      return;
    }
    for (const o of hit) {
      const id = ++fxId;
      thunders.push({ id, tgt: o.i, t: 0, owner: b.i });
      fx({ k: 'bolt', id, tgt: o.i, x: r2(o.x), y: r2(o.y), d: THUNDER_DELAY });
    }
  }
  function updateThunder(dt) {
    for (const th of thunders) {
      th.t += dt;
      if (th.t < THUNDER_DELAY) continue;
      th.done = true;
      const o = bats[th.tgt];
      if (!o || o.dead || o.safe > 0) continue;
      o.revealT = THUNDER_REVEAL;
      powerStun(o, th.owner, THUNDER_STUN, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 'ZAPPED!', POWERS.thunder.rgb);
    }
    thunders = thunders.filter((t) => !t.done);
  }

  // Freeze: a blast of ice around you. Rivals in reach are frozen solid in a
  // block of ice (stunned, can't drift). Like a squeak, it can be parried, and
  // it doesn't pass a Stone Wall.
  function freezeBlast(b) {
    b.seen = 1;
    fx({ k: 'nova', x: r2(b.x), y: r2(b.y), o: b.i });
    fx({ k: 'sfx', n: 'freeze', alt: 'crystal' });
    fx({ k: 'shake', v: 0.12 });
    for (const foe of bats) {
      if (foe === b || foe.dead || foe.safe > 0) continue;
      const d = dist(foe, b);
      if (d > FREEZE_R + R || blockerBetween(b.x, b.y, foe.x, foe.y)) continue;
      if (foe.parryT > 0 && foe.stun <= 0) { parrySucceed(foe, b, b.x, b.y); continue; }
      if (powerStun(foe, b.i, FREEZE_STUN, 0, 0, 'FROZEN!', POWERS.freeze.rgb, b)) foe.ice = FREEZE_STUN;
    }
  }

  // Tornado: a twister spins off the way you're flying, wanders and bounces
  // off walls, pulling rivals toward its eye. One that reaches the eye is
  // spun out, stunned. Wind can't be parried; a shield blocks the spin.
  function spawnTwister(b, ux, uy) {
    let x = b.x + ux * 1.2, y = b.y + uy * 1.2;
    if (hitsWall(x, y, 0.35)) { x = b.x; y = b.y; }
    const mine = twisters.filter((m) => m.owner === b.i);
    if (mine.length >= MAX_TWISTERS_EACH) twisters.splice(twisters.indexOf(mine[0]), 1);
    twisters.push({ id: ++fxId, x, y, ux, uy, t: 0, owner: b.i, hit: new Set() });
    b.seen = Math.max(b.seen, 0.6);
    fx({ k: 'sfx', n: 'vortex', alt: 'warn' });
  }
  function updateTwisters(dt) {
    for (const tw of twisters) {
      tw.t += dt;
      const sp = TORNADO_SPEED * Math.min(1, tw.t * 2), wob = Math.sin(tw.t * 2.3 + tw.id) * 0.9 * dt;
      const c = Math.cos(wob), sn = Math.sin(wob), ux = tw.ux * c - tw.uy * sn, uy = tw.ux * sn + tw.uy * c;
      tw.ux = ux; tw.uy = uy;
      const nx = tw.x + ux * sp * dt;
      if (hitsWall(nx, tw.y, 0.35)) tw.ux = -tw.ux; else tw.x = nx;
      const ny = tw.y + tw.uy * sp * dt;
      if (hitsWall(tw.x, ny, 0.35)) tw.uy = -tw.uy; else tw.y = ny;
      if (tw.t > TORNADO_LIFE) { tw.gone = true; continue; }
      for (const foe of bats) {
        if (foe.i === tw.owner || foe.dead || foe.safe > 0 || tw.hit.has(foe.i)) continue;
        const d = Math.hypot(foe.x - tw.x, foe.y - tw.y);
        if (d > TORNADO_PULL) continue;
        foe.seen = Math.max(foe.seen, 0.6);
        if (d < TORNADO_CORE) {
          tw.hit.add(foe.i);
          const k = d || 1, tx = -(foe.y - tw.y) / k, ty = (foe.x - tw.x) / k;
          powerStun(foe, tw.owner, TORNADO_STUN, tx * 7, ty * 7, 'WHIRLED!', POWERS.tornado.rgb);
          continue;
        }
        // pulled in and swirled around the eye (moved directly, so top speed can't cap it)
        const k = 1 - d / TORNADO_PULL, pull = 1.2 + 4.4 * k, swirl = 2.4 * k;
        const ax = (tw.x - foe.x) / d, ay = (tw.y - foe.y) / d;
        const mx = (ax * pull - ay * swirl) * dt, my = (ay * pull + ax * swirl) * dt;
        if (!batBlocked(foe, foe.x + mx, foe.y)) foe.x += mx;
        if (!batBlocked(foe, foe.x, foe.y + my)) foe.y += my;
      }
    }
    twisters = twisters.filter((tw) => !tw.gone);
  }

  // Ghost: fly through cave walls (not the outer wall) for GHOST_TIME seconds,
  // half see-through. If it wears off inside rock, you pop out at the nearest gap.
  const inBorder = (x, y) => x < 1 + R || y < 1 + R || x > arena.w - 1 - R || y > arena.h - 1 - R;
  const batBlocked = (b, x, y) => (b.ghostT > 0 ? inBorder(x, y) : hitsWall(x, y, R));
  function unGhost(b) {
    b.ghostT = 0;
    if (!hitsWall(b.x, b.y, R)) return;
    const spot = arena.open.filter((p) => !hitsWall(p.x, p.y, R)).sort((p, q) => dist(p, b) - dist(q, b))[0];
    if (spot) { b.x = spot.x; b.y = spot.y; b.vx = 0; b.vy = 0; }
    fx({ k: 'burst', x: b.x, y: b.y, rgb: POWERS.ghost.rgb, n: 12 });
  }

  // Stone Wall: a row of WALL_LEN blocks rises across your path, just behind
  // you (it blocks bats, squeaks, beams, fireballs and dashes), then crumbles
  // after WALL_LIFE seconds. Blocks never land on a bat, a crystal or a
  // power-up, and a placement that would box any bat into a tiny pocket is
  // skipped (it tries a few spots; if none work you keep the power).
  function canBlock(tx, ty) {
    if (tx < 1 || ty < 1 || tx >= arena.w - 1 || ty >= arena.h - 1 || arena.grid[ty * arena.w + tx] !== 0) return false;
    for (const o of bats) {
      if (o.dead && !o.out) continue;
      if (o.out) continue;
      const nx = Math.max(tx, Math.min(o.x, tx + 1)), ny = Math.max(ty, Math.min(o.y, ty + 1));
      if (Math.hypot(o.x - nx, o.y - ny) < R + 0.12) return false;
    }
    const here = (p) => Math.floor(p.x) === tx && Math.floor(p.y) === ty;
    return !crystals.some((c) => c.on && here(c)) && !powerups.some(here) && !twisters.some(here);
  }
  function reach(tx, ty, limit) {
    const { w } = arena, seen = new Set([ty * w + tx]), q = [ty * w + tx];
    for (let k = 0; k < q.length && seen.size < limit; k++) {
      const c = q[k], cx = c % w, cy = (c / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = (cy + dy) * w + cx + dx;
        if (!seen.has(n) && !solid(cx + dx, cy + dy)) { seen.add(n); q.push(n); }
      }
    }
    return seen.size;
  }
  const TRAP_SPACE = 30;
  function trapsSomeone(tiles) {
    const live = bats.filter((o) => !o.dead && !o.out && o.ghostT <= 0);
    const before = live.map((o) => reach(Math.floor(o.x), Math.floor(o.y), TRAP_SPACE));
    for (const k of tiles) arena.grid[k] = 2;
    const after = live.map((o) => reach(Math.floor(o.x), Math.floor(o.y), TRAP_SPACE));
    for (const k of tiles) arena.grid[k] = 0;
    return after.some((n, j) => n < Math.min(before[j], TRAP_SPACE));
  }
  function placeWall(b, ux, uy) {
    const across = Math.abs(ux) >= Math.abs(uy);   // flying sideways: the wall stands as a column
    for (const back of [WALL_BACK, WALL_BACK + 0.9, WALL_BACK - 0.6, -WALL_BACK]) {
      for (const side of [0, 1, -1]) {
        const cx = b.x - ux * back, cy = b.y - uy * back, tiles = [];
        for (let j = 0; j < WALL_LEN; j++) {
          const off = j - (WALL_LEN - 1) / 2 + side;
          const tx = Math.floor(across ? cx : cx + off), ty = Math.floor(across ? cy + off : cy);
          if (canBlock(tx, ty)) tiles.push(ty * arena.w + tx);
        }
        if (tiles.length < 3 || trapsSomeone(tiles)) continue;
        for (const k of tiles) { arena.grid[k] = 2; tileGlow[k] = 1; }
        blocks.push({ id: ++fxId, tiles, t: 0, owner: b.i });
        fx({ k: 'sfx', n: 'wallUp', alt: 'crash' });
        fx({ k: 'shake', v: 0.14 });
        return true;
      }
    }
    return false;
  }
  function updateBlocks(dt) {
    for (const bk of blocks) {
      bk.t += dt;
      if (bk.t >= WALL_LIFE) bk.gone = true;
    }
    if (blocks.some((bk) => bk.gone)) {
      for (const bk of blocks) if (bk.gone) clearBlock(bk);
      blocks = blocks.filter((bk) => !bk.gone);
    }
  }
  function clearBlock(bk) {
    for (const k of bk.tiles) if (arena.grid[k] === 2) arena.grid[k] = 0;
  }
  // the morphing cave swapped its whole grid: the Stone Walls stay put
  function reapplyBlocks() {
    for (const bk of blocks) for (const k of bk.tiles) if (arena.grid[k] === 0) arena.grid[k] = 2;
  }

  // The bite: the stunned bat gets slurped into the eater's open mouth,
  // CHOMP, the eater puffs up, then burps out a few feathers.
  function eat(eater, food) {
    if (rule === 'survivor') food.out = true;   // out until the round ends: no respawn
    else eater.score++;
    eater.biteT = 0; eater.dashT = 0;
    eater.vx *= 0.3; eater.vy *= 0.3;
    eats.push({ eater, food: { ...food }, t: 0, chomped: false, burped: false, ang: Math.atan2(food.y - eater.y, food.x - eater.x) });
    food.dead = RESPAWN_DELAY + EAT_TIME;
    food.stun = 0;
    food.power = null; food.mega = false; food.shield = false; food.charging = false; food.charge = 0;
    food.held = null; food.heldLeft = 0; food.ghostT = 0; food.ice = 0; food.burn = 0; food.revealT = 0;
    fx({ k: 'slowmo', t: 0.45 });
    fx({ k: 'sfx', n: 'slurp' });
    if (rule === 'bites' && eater.score >= winScore) { over = true; matchWinner = eater; }
    if (rule === 'survivor') checkRoundOver();
  }

  // Last Bat Standing: one bat left (or none, if that ever happens) ends the round
  function checkRoundOver() {
    if (roundEnd || over) return;
    const alive = bats.filter((b) => !b.out);
    if (alive.length > 1) return;
    const w = alive[0] || null;
    if (w) w.score++;
    roundEnd = { t: 0, w: w ? w.i : -1, shown: false };
    if (w && w.score >= winScore) {
      over = true; matchWinner = w;
      fx({ k: 'banner', text: `${w.name} wins the match!`, rgb: w.rgb, t: 2 });
    }
  }
  function updateRound(dt) {
    if (rule !== 'survivor' || over) return;
    if (roundEnd) {
      roundEnd.t += dt;
      // the banner comes up as the jaws snap shut, then a fresh round starts
      if (!roundEnd.shown && roundEnd.t >= EAT_PULL) {
        roundEnd.shown = true;
        const w = bats[roundEnd.w];
        fx({ k: 'banner', text: w ? `${w.name} wins round ${round}!` : `Nobody wins round ${round}`, rgb: w ? w.rgb : '232, 236, 255', t: ROUND_BANNER });
        fx({ k: 'sfx', n: 'power' });
      }
      if (roundEnd.t >= EAT_PULL + ROUND_BANNER) newRound();
      return;
    }
    roundClock += dt;
    if (!stormWarned && roundClock >= ROUND_LIMIT - STORM_WARN) {
      stormWarned = true;
      fx({ k: 'banner', text: `Echo storm in ${STORM_WARN}s!`, rgb: '255, 226, 120', t: 2 });
      fx({ k: 'sfx', n: 'warn' });
    }
    if (!storm && roundClock >= ROUND_LIMIT) {
      storm = true;
      fx({ k: 'banner', text: 'Echo storm! Nobody can hide', rgb: '255, 226, 120', t: 2.4 });
      fx({ k: 'sfx', n: 'crash' });
      fx({ k: 'shake', v: 0.25 });
    }
    // the storm makes every bat glow, for everyone (and every CPU) to see
    if (storm) for (const b of bats) if (!b.dead) b.seen = 1;
  }
  // everyone back to a spawn point, fresh: no stuns, power-ups or bites in progress
  function newRound() {
    round++;
    roundEnd = null; roundClock = 0; storm = false; stormWarned = false;
    rings = []; beams = []; eats = []; powerups = []; parries = [];
    for (const bk of blocks) clearBlock(bk);
    shots = []; twisters = []; blocks = []; thunders = []; bolts = []; novas = [];
    powerTimer = powerWait('first'); firstPower = true;
    for (const c of crystals) { c.on = false; c.timer = 0.5 + Math.random() * 2.5; }
    // a fresh corner each for everyone (the corner spots dodge any walls the morphing cave grew)
    const starts = cornerStarts();
    bats.forEach((b, k) => {
      const s = starts[k] || randomOpenSpot();
      if (b.trapT) b.trapT = 0;
      Object.assign(b, {
        x: s.x, y: s.y, vx: 0, vy: 0, face: s.x < arena.w / 2 ? 1 : -1, out: false, dead: 0,
        echoes: START_ECHOES, stun: 0, safe: SPAWN_SAFE, cooldown: 0, dashCd: 0, dashT: 0, biteT: 0,
        parryT: 0, parryCd: 0, parryRing: null, hitBy: null, power: null, powerT: 0, mega: false, shield: false,
        charging: false, charge: 0, mouth: 0, puff: 0, seen: 0,
        held: null, heldLeft: 0, specialCd: 0, ghostT: 0, ice: 0, burn: 0, revealT: 0,
      });
      if (b.ai) { b.ai.path = []; b.ai.roam = null; b.ai.known = null; b.ai.beamAt = null; }
    });
    fx({ k: 'banner', text: `Round ${round}`, rgb: '232, 236, 255', t: 1.4 });
    fx({ k: 'sfx', n: 'go' });
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
    if (over && !ended && !eats.length && (matchWinner || done.length)) {
      ended = true;
      const winner = matchWinner || done[done.length - 1].eater;
      // score is bites (rule 'bites') or round wins (rule 'survivor')
      const result = {
        winner: winner.name, winnerCpu: winner.ctrl === 'cpu', color: winner.color, humans: localCount, firstTo: winScore, rule,
        standings: bats.map((o) => ({ name: o.name, score: o.score, cpu: o.ctrl === 'cpu', color: o.color })).sort((p, q) => q.score - p.score),
      };
      setTimeout(() => { if (active && onEnd) onEnd(result); }, 600);
    }
  }

  // Morph mode: every few moments a handful of tiles turn into the next
  // arena's layout, never closing on a bat, until the whole cave has become it.
  function updateMorph(dt) {
    if (!morph) return;
    checkTrapped(dt);
    if (morph.pause > 0) { morph.pause -= dt; if (morph.pause <= 0) morph.target = nextArenaIndex(); return; }
    morph.timer -= dt;
    if (morph.timer > 0) return;
    morph.timer = morph.rescue ? RESCUE_STEP : MORPH_STEP;
    const def = window.ECHO_ARENAS[morph.target], { w, h, grid } = arena, diff = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      // (Stone Wall blocks are left alone; they crumble on their own)
      if (grid[y * w + x] !== 2 && grid[y * w + x] !== (def.map[y][x] === '#' ? 1 : 0)) diff.push(y * w + x);
    }
    if (!diff.length) {
      const keepLit = lit, keepBy = litBy, keepPowers = powerups;
      loadArena(morph.target);
      lit = keepLit; litBy = keepBy; powerups = keepPowers;
      reapplyBlocks();
      fx({ k: 'banner', text: arena.def.name, rgb: arena.theme.wall, t: 2 });
      morph.pause = MORPH_PAUSE;
      morph.rescue = null;
      for (const b of bats) b.trapT = 0;
      return;
    }
    const changes = [];
    // freeing a trapped bat: melt the rock nearest it first, many tiles at a time
    let pick = () => diff.splice(Math.floor(Math.random() * diff.length), 1)[0], count = 3;
    if (morph.rescue) {
      const near = (k) => Math.min(...morph.rescue.map((p) => Math.hypot((k % w) + 0.5 - p.x, Math.floor(k / w) + 0.5 - p.y)));
      diff.sort((p, q) => (grid[q] - grid[p]) || near(p) - near(q));   // walls to clear first, nearest first
      pick = () => diff.shift();
      count = RESCUE_TILES;
    }
    for (let n = 0; n < count && diff.length; n++) {
      const k = pick();
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

  // Morph mode: is any bat shut in a small pocket? (checked a few times a second)
  function checkTrapped(dt) {
    morph.check = (morph.check || 0) - dt;
    if (morph.check > 0) return;
    morph.check = TRAP_CHECK;
    if (over || roundEnd) return;
    const { label, sizes } = openRegions(), total = sizes.reduce((a, n) => a + n, 0) || 1;
    const stuck = [];
    for (const b of bats) {
      if (b.dead || b.out || b.ghostT > 0) { b.trapT = 0; continue; }
      const tx = Math.floor(b.x), ty = Math.floor(b.y), id = tx >= 0 && ty >= 0 && tx < arena.w && ty < arena.h ? label[ty * arena.w + tx] : -1;
      const room = id >= 0 && !hitsWall(b.x, b.y, R) ? sizes[id] : 0;   // wedged into rock counts as trapped too
      b.trapT = room < total * TRAP_SHARE ? (b.trapT || 0) + TRAP_CHECK : 0;
      if (b.trapT >= TRAP_TIME) stuck.push({ x: b.x, y: b.y });
    }
    if (!stuck.length) return;
    if (morph.rescue) { morph.rescue = stuck; return; }   // already opening up: just aim at whoever's stuck now
    // morph early, straight into Open Sky (or, with no sky about, the next cave)
    const skies = arenaKinds(true);
    morph.target = skies.length ? skies[Math.floor(Math.random() * skies.length)] : morph.target >= 0 ? morph.target : nextArenaIndex();
    morph.pause = 0; morph.timer = 0; morph.rescue = stuck;
    fx({ k: 'banner', text: 'Opening up!', rgb: '190, 255, 235', t: 1.6 });
    fx({ k: 'shake', v: 0.3 });
    fx({ k: 'sfx', n: 'crash', alt: 'warn' });
  }

  function respawn(b) {
    const foes = bats.filter((o) => o !== b && !o.dead);
    const score = (s) => foes.length ? Math.min(...foes.map((o) => Math.hypot(o.x - s.x, o.y - s.y))) : 0;
    const free = arena.spawns.filter((p) => !solid(Math.floor(p.x), Math.floor(p.y)));
    const s = (free.length ? free : [randomOpenSpot()]).slice().sort((p, q) => score(q) - score(p))[0];
    Object.assign(b, { x: s.x, y: s.y, vx: 0, vy: 0, echoes: START_ECHOES, stun: 0, safe: SPAWN_SAFE, dead: 0, cooldown: 0, mouth: 0, dashT: 0, parryT: 0, parryRing: null, hitBy: null, ghostT: 0, ice: 0, burn: 0 });
  }

  function spawnPowerup(force) {
    const types = force ? [force] : powerOn;
    if (!types.length) return;
    const spots = arena.open.filter((p) => !solid(Math.floor(p.x), Math.floor(p.y)) && bats.every((b) => b.dead || dist(p, b) > 5) && powerups.every((q) => dist(p, q) > 4));
    if (!spots.length) return;
    const s = spots[Math.floor(Math.random() * spots.length)];
    powerups.push({ x: s.x, y: s.y, type: types[Math.floor(Math.random() * types.length)], phase: Math.random() * 6 });
  }

  function grabPowerup(b, p) {
    if (POWERS[p.type].special) { b.held = p.type; b.heldLeft = 0; }   // held for the POWER button (replaces one already held)
    else if (p.type === 'mega') b.mega = true;
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

    if (!over) updateMorph(rawDt);
    updateRound(rawDt);

    for (const b of bats) {
      b.cooldown = Math.max(0, b.cooldown - dt);
      b.safe = Math.max(0, b.safe - dt);
      b.seen = Math.max(0, b.seen - dt * 0.8);
      b.dashCd = Math.max(0, b.dashCd - dt);
      b.parryCd = Math.max(0, b.parryCd - dt);
      b.biteT = Math.max(0, b.biteT - dt);
      if (b.parryT > 0) { b.parryT = Math.max(0, b.parryT - dt); if (b.parryT <= 0) b.parryRing = null; }
      if (b.power) { b.powerT -= dt; if (b.powerT <= 0) { b.power = null; b.powerT = 0; } }
      b.specialCd = Math.max(0, b.specialCd - dt);
      b.heldT = b.held ? (b.heldT || 0) + dt : 0;
      if (b.held && b.heldLeft > 0) {
        b.heldLeft -= dt;
        if (b.heldLeft <= 0) {
          fx({ k: 'popup', x: b.x, y: b.y - 1, text: `${POWERS[b.held].label} OVER`, rgb: POWERS[b.held].rgb, life: 0.8 });
          b.held = null; b.heldLeft = 0;
        }
      }
      b.burn = Math.max(0, b.burn - dt);
      if (b.revealT > 0) { b.revealT = Math.max(0, b.revealT - dt); b.seen = 1; }
      if (b.ghostT > 0) { b.ghostT -= dt; if (b.ghostT <= 0) unGhost(b); }
      if (b.dead > 0) { if (b.out) continue; b.dead -= dt; if (b.dead <= 0 && !over) respawn(b); continue; }
      let ix = 0, iy = 0;
      if (b.stun > 0) b.stun = Math.max(0, b.stun - dt);
      b.ice = b.stun > 0 ? Math.max(0, b.ice - dt) : 0;
      if (b.ice > 0) { b.vx = 0; b.vy = 0; }   // frozen solid
      else if (b.stun > 0) {
        // stunned bats can't steer: the hit's knockback dies off fast and they hang still
        const k = Math.exp(-STUN_DRAG * dt);
        b.dashT = 0;
        b.vx *= k; b.vy *= k;
      } else if (!over) {
        if (b.ctrl === 'cpu') { cpuLevel = b.lv || baseLevel; ({ ix, iy } = cpuInput(b, dt)); }
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
      } else if (b.stun <= 0) { b.vx -= b.vx * DRAG * dt; b.vy -= b.vy * DRAG * dt; }
      if (b.ctrl === 'cpu') cpuLevel = b.lv || baseLevel;
      const max = b.dashT > 0 ? DASH_SPEED : b.stun > 0 ? 7 : MAX_SPEED * (fast ? 1.45 : 1) * (b.charging && b.charge > 0.2 ? CHARGE_SLOW : 1) * (b.ctrl === 'cpu' ? cpuLevel.speed : 1);
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
      if (Math.abs(b.vx) > 0.2) b.face = Math.sign(b.vx);
      const nx = b.x + b.vx * dt;
      if (!batBlocked(b, nx, b.y)) b.x = nx; else b.vx *= -0.4;
      const ny = b.y + b.vy * dt;
      if (!batBlocked(b, b.x, ny)) b.y = ny; else b.vy *= -0.4;
    }

    advanceRings(dt, true);
    updateShots(dt);
    updateThunder(dt);
    updateTwisters(dt);
    updateBlocks(dt);

    // biting: a bat mid-dash (or just after) that touches any rival chomps it,
    // unless the rival parries, blocks with a shield, or is dashing too (a clash)
    if (!over && !roundEnd) {
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
    if (powerTimer <= 0) {
      const n = firstPower && powerFreq ? powerFreq.start || 1 : 1;
      for (let k = 0; k < n; k++) if (powerFreq && powerups.length < powerFreq.max) spawnPowerup();
      firstPower = false; powerTimer = powerWait('every');
    }
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
          if (blocks.length && blockerBetween(ring.x, ring.y, foe.x, foe.y)) continue;   // a Stone Wall soaks it up
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
    powerCosmetics(dt);
  }

  // the look and sound of special powers, the same on every screen
  function powerCosmetics(dt) {
    if (!arena) return;
    const s = (window.EchoAudio && window.EchoAudio.sfx) || {};
    for (const sh of shots) {
      // a fireball lights the cave as it flies and sheds embers
      lightAround(sh.x, sh.y, 1.9, LIGHT_FIRE);
      for (let k = 0; k < 2; k++) {
        if (Math.random() > 0.8) continue;
        particles.push({ x: sh.x + (Math.random() - 0.5) * 0.2, y: sh.y + (Math.random() - 0.5) * 0.2, vx: -sh.vx * 0.08 + (Math.random() - 0.5) * 1.2, vy: -sh.vy * 0.08 + (Math.random() - 0.5) * 1.2 - 0.4,
          life: 0.35 + Math.random() * 0.35, rgb: Math.random() < 0.5 ? '255, 200, 90' : '255, 110, 40', size: 3 + Math.random() * 3 });
      }
    }
    for (const b of bats) {
      if (b.dead) continue;
      if (b.burn > 0 && Math.random() < 0.5) particles.push({ x: b.x + (Math.random() - 0.5) * 0.4, y: b.y + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.8, vy: -1 - Math.random(), life: 0.3 + Math.random() * 0.3, rgb: Math.random() < 0.5 ? '255, 200, 90' : '255, 110, 40', size: 3 });
    }
    for (const tw of twisters) {
      lightAround(tw.x, tw.y, 1.5, tw.owner);
      if (Math.random() < 0.7) {
        const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 1.4;
        particles.push({ x: tw.x + Math.cos(a) * r, y: tw.y + Math.sin(a) * r, vx: -Math.sin(a) * 4 - Math.cos(a) * 1.5, vy: Math.cos(a) * 4 - Math.sin(a) * 1.5,
          life: 0.4 + Math.random() * 0.3, rgb: Math.random() < 0.5 ? POWERS.tornado.rgb : arena.theme.wall, size: 2.5 + Math.random() * 2 });
      }
    }
    for (const bt of bolts) {
      const before = bt.t;
      bt.t += dt;
      const o = bt.tgt >= 0 ? bats[bt.tgt] : null;
      if (bt.t < bt.delay && o && !o.dead) { bt.x = o.x; bt.y = o.y; }
      if (before < bt.delay && bt.t >= bt.delay) {
        lightAround(bt.x, bt.y, 2.8, LIGHT_BOLT);
        burst(bt.x, bt.y, '255, 250, 190', 16, 5, 4);
        burst(bt.x, bt.y, POWERS.thunder.rgb, 10, 3, 3);
        shake = Math.max(shake, 0.4);
        if (!bolts.some((q) => q !== bt && q.boomed && Math.abs(q.t - bt.t) < 0.1)) (s.thunder || s.crash)?.();
        bt.boomed = true;
      }
    }
    bolts = bolts.filter((bt) => bt.t < bt.delay + BOLT_FX);
    for (const n of novas) {
      if (n.t === 0 && !n.fire) lightAround(n.x, n.y, FREEZE_R + 0.6, LIGHT_ICE);
      if (n.t === 0 && !n.fire) for (let k = 0; k < 22; k++) {
        const a = (k / 22) * Math.PI * 2, v = 4 + Math.random() * 4;
        particles.push({ x: n.x, y: n.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + Math.random() * 0.3, rgb: k % 2 ? '200, 245, 255' : POWERS.freeze.rgb, size: 3 + Math.random() * 2 });
      }
      n.t += dt;
    }
    novas = novas.filter((n) => n.t < NOVA_FX);
    for (const bk of blocks) {
      if (!bk.cr && bk.t >= WALL_LIFE - WALL_CRUMBLE) { bk.cr = true; (s.crumble || s.crash)?.(); }
      if (bk.t < WALL_RISE || bk.cr) {
        // dust while it rises, falling chunks while it crumbles
        const k = bk.tiles[Math.floor(Math.random() * bk.tiles.length)], x = (k % arena.w) + Math.random(), y = Math.floor(k / arena.w) + Math.random();
        if (Math.random() < 0.6) particles.push({ x, y, vx: (Math.random() - 0.5) * 2, vy: bk.cr ? 1.5 + Math.random() : -0.5 - Math.random(), life: 0.4 + Math.random() * 0.3, rgb: bk.cr ? POWERS.wall.rgb : '200, 190, 170', size: 3 + Math.random() * 3 });
      }
    }
  }

  // ---- Online snapshots ----------------------------------------------------
  const r2 = (v) => Math.round(v * 100) / 100;
  function snapshot() {
    const s = {
      t: 's', a: arenaIndex, am: arenaMode, cd: r2(countdown), over,
      b: bats.map((b) => [r2(b.x), r2(b.y), r2(b.vx), r2(b.vy), b.face, r2(b.stun), r2(b.dead), b.score, b.echoes, r2(b.safe), r2(b.seen),
        r2(b.mouth), r2(b.puff), r2(b.dashCd), b.power || 0, r2(b.powerT), b.mega ? 1 : 0, b.shield ? 1 : 0, b.ctrl === 'cpu' ? 1 : 0, r2(b.dashT), b.charging ? r2(b.charge) : -1, r2(b.parryT), b.out ? 1 : 0,
        b.held || 0, r2(b.ghostT), r2(b.ice), r2(b.burn), r2(b.heldLeft), r2(b.specialCd)]),
      bm: beams.map((m) => [m.id, r2(m.x), r2(m.y), r2(m.ux), r2(m.uy), r2(m.len), m.owner, r2(m.t)]),
      r: rings.map((g) => [g.id, r2(g.x), r2(g.y), r2(g.r), g.owner, g.max, g.big ? 1 : 0]),
      c: crystals.map((c) => (c.on ? 1 : 0)).join(''),
      p: powerups.map((p) => [r2(p.x), r2(p.y), p.type]),
      e: eats.map((e) => [e.eater.i, e.food.i, r2(e.food.x), r2(e.food.y), r2(e.t), r2(e.ang)]),
      fx: outbox,
      ft: winScore,
    };
    // special powers in play (only sent while there are some)
    if (shots.length) s.sh = shots.map((m) => [m.id, r2(m.x), r2(m.y), r2(m.vx), r2(m.vy), m.owner]);
    if (twisters.length) s.tw = twisters.map((m) => [m.id, r2(m.x), r2(m.y), r2(m.ux), r2(m.uy), r2(m.t), m.owner]);
    if (blocks.length) s.bk = blocks.map((m) => [m.id, m.tiles, r2(m.t), m.owner]);
    // bat looks: with the first snapshots, then now and then for anyone who missed them
    if (looksSent < 10 || looksSent % 60 === 0) s.lk = bats.map((b) => b.look);
    looksSent++;
    // Last Bat Standing: [round, whole seconds into it, storm, round over]
    if (rule === 'survivor') s.ru = [round, Math.floor(roundClock), storm ? 1 : 0, roundEnd ? 1 : 0];
    outbox = [];
    return s;
  }

  function applySnapshot(s) {
    if (mode !== 'client' || !active) return;
    if (s.a !== arenaIndex) loadArena(s.a);
    if (s.am) arenaMode = s.am;
    if (s.ft) winScore = s.ft;
    rule = s.ru ? 'survivor' : 'bites';
    if (s.ru) { round = s.ru[0]; roundClock = s.ru[1]; storm = !!s.ru[2]; roundEnd = s.ru[3] ? roundEnd || { t: 0, w: -1 } : null; }
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
      b.out = !!v[22];
      b.held = v[23] || null; b.heldLeft = v[27] || 0; b.specialCd = v[28] || 0; b.ghostT = v[24] || 0; b.ice = v[25] || 0; b.burn = v[26] || 0;
      if (s.lk && s.lk[i] && window.EchoLooks) { try { b.look = window.EchoLooks.clean(s.lk[i]); } catch (e) { /* keep the old look */ } }
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
    const oldShots = new Map(shots.map((m) => [m.id, m]));
    shots = (s.sh || []).map(([id, x, y, vx, vy, owner]) => {
      const m = oldShots.get(id);
      // keep the smoothly predicted position unless it drifted off
      if (m && Math.hypot(m.x - x, m.y - y) < 0.6) { m.vx = vx; m.vy = vy; m.owner = owner; return m; }
      return { id, x, y, vx, vy, owner, t: 0 };
    });
    const oldTw = new Map(twisters.map((m) => [m.id, m]));
    twisters = (s.tw || []).map(([id, x, y, ux, uy, t, owner]) => {
      const m = oldTw.get(id) || { id, x, y, hit: new Set() };
      if (Math.hypot(m.x - x, m.y - y) > 0.8) { m.x = x; m.y = y; }
      m.tx = x; m.ty = y; m.ux = ux; m.uy = uy; m.t = Math.max(m.t || 0, t); m.owner = owner;
      return m;
    });
    // Stone Wall blocks: the host's list says which tiles are walled right now
    const oldBk = new Map(blocks.map((m) => [m.id, m]));
    blocks = (s.bk || []).map(([id, tiles, t, owner]) => {
      const m = oldBk.get(id) || { id, tiles, t, owner };
      m.t = Math.max(m.t, t);
      return m;
    });
    const walled = new Set(blocks.flatMap((m) => m.tiles));
    for (let k = 0; k < arena.grid.length; k++) {
      if (arena.grid[k] === 2 && !walled.has(k)) arena.grid[k] = 0;
    }
    for (const k of walled) if (arena.grid[k] === 0) { arena.grid[k] = 2; tileGlow[k] = 1; }
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
      // timed powers drain smoothly between snapshots (the host clears them when they run out)
      if (b.heldLeft > 0) b.heldLeft = Math.max(0.01, b.heldLeft - dt);
      if (b.specialCd > 0) b.specialCd = Math.max(0, b.specialCd - dt);
      if (b.dashT > 0 && Math.random() < 0.6) particles.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.3, rgb: b.rgb, size: 5 });
    }
    for (const e of eats) e.t += dt;
    // fireballs and twisters keep moving between snapshots
    for (const m of shots) { m.x += m.vx * dt; m.y += m.vy * dt; m.t += dt; }
    for (const m of twisters) {
      m.t += dt;
      if (m.tx !== undefined) { m.tx += m.ux * TORNADO_SPEED * dt; m.ty += m.uy * TORNADO_SPEED * dt; m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k; }
    }
    for (const m of blocks) m.t += dt;
    for (const b of bats) if (b.ghostT > 0) b.ghostT = Math.max(0, b.ghostT - dt);
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

  // Last Bat Standing: once every player on this screen is out, the view
  // follows the action instead: the leading bat still flying (and sticks
  // with it until it's out too).
  let watchI = -1;
  const ownBats = () => bats.filter((b) => b.ctrl === 'local');
  const spectating = () => rule === 'survivor' && !over && ownBats().length > 0 && ownBats().every((b) => b.out);
  function watched() {
    if (!spectating()) return null;
    const cur = bats[watchI];
    if (cur && !cur.out) return cur;
    const alive = bats.filter((b) => !b.out).sort((p, q) => q.score - p.score || p.i - q.i);
    watchI = alive.length ? alive[0].i : -1;
    return alive[0] || null;
  }
  // Which bats sense their surroundings on this screen: the viewer online,
  // every local player on a shared screen (or the bat being watched)
  function senses() {
    const own = bats.filter((b) => !b.dead && b.ctrl === 'local');
    if (own.length) return own;
    const w = watched();
    return w && !w.dead ? [w] : own;
  }

  // Other bats are invisible in the dark unless sound reaches them
  const ghostAlpha = (b) => (b.ghostT < 0.8 && Math.floor(b.ghostT * 10) % 2 ? 0.75 : 0.42);
  function batVisible(b) {
    const v = batVisible0(b);
    return b.ghostT > 0 ? v * ghostAlpha(b) : v;
  }
  function batVisible0(b) {
    if (b.ctrl === 'local' || viewer === b.i || (watchI === b.i && spectating())) return 1;
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

  // (indexed by litBy: the bats' slot colours, then fire, ice and lightning)
  const BAT_RGB = LIGHT_RGB.map((rgb) => rgb.split(',').map((v) => +v / 255));
  function render() {
    if (in3d()) {
      let follow = viewer >= 0 ? bats[viewer] : localBat(0);
      // out of the round: follow a teammate on this screen still flying, else the action
      if (follow && follow.out) follow = bats.find((b) => b.ctrl === 'local' && !b.out) || watched() || follow;
      const ok = window.EchoDuel3D.render({
        W, H, arena, bats, lit, litBy, tileGlow, near: senses(), clock, rings, beams, crystals, powerups, eats, shake, follow,
        batVisible, seenAt, batRgb: BAT_RGB, POWERS, BEAM_LIFE, EAT_PULL, extra: extras3d,
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
        if (!solid(tx, ty) || arena.grid[ty * arena.w + tx] === 2) continue;   // (Stone Walls are drawn below)
        const open = [!solid(tx, ty - 1), !solid(tx + 1, ty), !solid(tx, ty + 1), !solid(tx - 1, ty)];
        if (!open.some(Boolean)) continue;
        const l = lit[ty * arena.w + tx];
        let a = l;
        for (const b of near) {
          const d = Math.hypot(tx + 0.5 - b.x, ty + 0.5 - b.y);
          a = Math.max(a, Math.max(0, Math.min(1, 1 - (d - 0.7) / 1.4)) * 0.35);
        }
        if (a < 0.02) continue;
        const rgb = l > 0.05 ? LIGHT_RGB[litBy[ty * arena.w + tx]] : th.wall;
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

    drawBlocks2D();

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

    const P2 = (x, y) => ({ x: X(x), y: Y(y), s: PX });
    drawTwisters2D(P2);
    drawNovas(P2);
    drawShots(P2);

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

    drawBolts(P2);
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
    drawShots(P, true);
    // power-ups get their picture floating over them, so you can tell them apart
    for (const p of powerups) {
      const a = seenAt(p.x, p.y);
      if (a < 0.03) continue;
      const q = P(p.x, p.y, 1.05 + Math.sin(clock * 2.5 + p.phase) * 0.1);
      if (q.off) continue;
      ctx.globalAlpha = a;
      drawIcon(p.type, q.x, q.y, Math.max(7, q.s * 0.2), `rgb(${POWERS[p.type].rgb})`);
      ctx.globalAlpha = 1;
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
      if (b.held && b.heldLeft > 0) {
        // a timed power running: a draining arc in its colour
        const rgb = POWERS[b.held].rgb;
        glow(q.x, q.y, s * 0.9, rgb, 0.18);
        ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
        ctx.lineWidth = Math.max(2, s * 0.06);
        ctx.beginPath(); ctx.arc(q.x, q.y, s * 0.68, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, b.heldLeft / TIMED_LIFE)); ctx.stroke();
      }
      if (b.mega) {
        ctx.strokeStyle = `rgba(${POWERS.mega.rgb}, ${0.5 + 0.4 * Math.sin(clock * 8)})`;
        ctx.lineWidth = Math.max(1.5, s * 0.05);
        ctx.beginPath(); ctx.arc(q.x, q.y, s * 0.6, 0, Math.PI * 2); ctx.stroke();
      }
      if (b.stun > 0 && !(b.ice > 0)) {
        ctx.font = `700 ${Math.max(10, s * 0.32)}px ${FONT}`;
        ctx.fillStyle = '#ffe278';
        ctx.fillText('STUNNED', q.x, q.y - s * 0.95);
      }
      // no name tags: just a small arrow under your own bat
      if (isMine(b)) youMarker(q.x, q.y + s * 0.62, Math.max(5, s * 0.13), b.rgb);
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
    drawBolts(P);
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
      EchoChomp.draw(ctx, q, P(b.x + ca * 0.6, b.y + sa * 0.6), ang, t, b.color, b.rgb, EAT_PULL);
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

  // ---- Special power effects ------------------------------------------------
  const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const easeBack = (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
  // how tall a Stone Wall block stands (0..1, overshooting as it slams up) and how far it has crumbled
  const blockRise = (bk) => (bk.t < WALL_RISE ? Math.max(0, easeBack(bk.t / WALL_RISE)) : 1);
  const blockCrumble = (bk) => Math.max(0, Math.min(1, (bk.t - (WALL_LIFE - WALL_CRUMBLE)) / WALL_CRUMBLE));

  // Stone Wall, top-down: blocks pop up from the floor, glow faintly in the
  // owner's colour, crack and break apart at the end. Everyone can see them.
  function drawBlocks2D() {
    for (const bk of blocks) {
      const rise = blockRise(bk), cr = blockCrumble(bk), rgb = BATS[bk.owner]?.rgb || POWERS.wall.rgb;
      for (const k of bk.tiles) {
        const tx = k % arena.w, ty = Math.floor(k / arena.w);
        const j = cr > 0 ? (hash(k + Math.floor(clock * 30)) - 0.5) * PX * 0.08 : 0;
        const sz = PX * (0.25 + 0.75 * rise) * (1 - cr * 0.45), cx = X(tx + 0.5) + j, cy = Y(ty + 0.5);
        ctx.globalAlpha = 1 - cr * 0.6;
        glow(cx, cy, PX * 1.1, rgb, 0.18);
        const g = ctx.createLinearGradient(0, cy - sz / 2, 0, cy + sz / 2);
        g.addColorStop(0, 'rgb(226, 186, 140)'); g.addColorStop(1, 'rgb(128, 88, 62)');
        ctx.fillStyle = g;
        roundRect(cx - sz / 2, cy - sz / 2, sz, sz, sz * 0.12); ctx.fill();
        ctx.strokeStyle = `rgba(${rgb}, 0.9)`; ctx.lineWidth = Math.max(1.5, PX * 0.07); ctx.stroke();
        // bricks
        ctx.strokeStyle = 'rgba(70, 44, 30, 0.6)'; ctx.lineWidth = Math.max(1, PX * 0.04);
        ctx.beginPath();
        ctx.moveTo(cx - sz / 2, cy - sz / 6); ctx.lineTo(cx + sz / 2, cy - sz / 6);
        ctx.moveTo(cx - sz / 2, cy + sz / 6); ctx.lineTo(cx + sz / 2, cy + sz / 6);
        ctx.moveTo(cx, cy - sz / 2); ctx.lineTo(cx, cy - sz / 6);
        ctx.moveTo(cx - sz / 4, cy - sz / 6); ctx.lineTo(cx - sz / 4, cy + sz / 6);
        ctx.moveTo(cx + sz / 4, cy - sz / 6); ctx.lineTo(cx + sz / 4, cy + sz / 6);
        ctx.moveTo(cx, cy + sz / 6); ctx.lineTo(cx, cy + sz / 2);
        ctx.stroke();
        if (cr > 0) {
          // glowing cracks spread across it
          ctx.strokeStyle = `rgba(255, 220, 160, ${0.9 * (1 - cr * 0.5)})`; ctx.lineWidth = Math.max(1.2, PX * 0.05);
          ctx.beginPath();
          for (let c = 0; c < 3; c++) {
            let px = cx + (hash(k * 3 + c) - 0.5) * sz * 0.3, py = cy + (hash(k * 5 + c) - 0.5) * sz * 0.3;
            ctx.moveTo(px, py);
            for (let s2 = 0; s2 < 3; s2++) {
              const a = hash(k * 7 + c * 11 + s2) * Math.PI * 2, l = sz * 0.22 * Math.min(1, cr * 3);
              px += Math.cos(a) * l; py += Math.sin(a) * l; ctx.lineTo(px, py);
            }
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // Fireball: a flickering comet of flame. P maps arena to screen ({ x, y, s, off }).
  function drawShots(P, in3d) {
    if (!shots.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of shots) {
      const q = P(m.x, m.y);
      if (q.off) continue;
      const S = q.s, sp = Math.hypot(m.vx, m.vy) || 1, ux = m.vx / sp, uy = m.vy / sp;
      glow(q.x, q.y, S * (in3d ? 1.3 : 1.9) * (1 + 0.12 * Math.sin(clock * 37 + m.id)), '255, 110, 30', 0.4);
      // tail: blobs shrinking and reddening behind the head
      for (let k = 6; k >= 0; k--) {
        const f = k / 6, t = P(m.x - ux * f * 0.9 + (hash(k + Math.floor(clock * 24)) - 0.5) * 0.12 * f, m.y - uy * f * 0.9 + (hash(k * 3 + Math.floor(clock * 24)) - 0.5) * 0.12 * f);
        if (t.off) continue;
        const rad = S * (0.3 - 0.03 * k) * (in3d ? 0.8 : 1);
        ctx.fillStyle = `rgba(255, ${Math.round(200 - 140 * f)}, ${Math.round(80 - 60 * f)}, ${0.55 * (1 - f * 0.7)})`;
        ctx.beginPath(); ctx.arc(t.x, t.y, rad, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255, 245, 210, 0.95)';
      ctx.beginPath(); ctx.arc(q.x, q.y, S * 0.13 * (in3d ? 0.8 : 1), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Tornado, top-down: three spiral arms spinning around the eye, and a faint
  // circle showing how far its pull reaches
  function drawTwisters2D(P) {
    for (const tw of twisters) {
      const q = P(tw.x, tw.y);
      if (q.off) continue;
      const fade = Math.min(1, tw.t * 3, (TORNADO_LIFE - tw.t) * 2), rgb = POWERS.tornado.rgb, S = q.s;
      if (fade <= 0) continue;
      ctx.save();
      ctx.globalAlpha = fade;
      glow(q.x, q.y, S * 2.2, rgb, 0.18);
      ctx.strokeStyle = `rgba(${rgb}, 0.18)`; ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 7]); ctx.lineDashOffset = clock * 30;
      ctx.beginPath(); ctx.arc(q.x, q.y, TORNADO_PULL * S, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      for (let arm = 0; arm < 3; arm++) {
        ctx.beginPath();
        for (let k = 0; k <= 14; k++) {
          const r = 0.12 + k * 0.1, a = -clock * 9 + arm * 2.094 + r * 2.4;
          const x = q.x + Math.cos(a) * r * S, y = q.y + Math.sin(a) * r * S;
          if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.strokeStyle = `rgba(${rgb}, 0.85)`; ctx.lineWidth = Math.max(2, S * 0.12); ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'; ctx.lineWidth = Math.max(1, S * 0.04); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath(); ctx.arc(q.x, q.y, S * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // Freeze blast (and a fireball's burst): a ring racing out with ice shards
  function drawNovas(P) {
    for (const n of novas) {
      const q = P(n.x, n.y);
      if (q.off) continue;
      const k = n.t / NOVA_FX, e = 1 - (1 - Math.min(1, n.t / 0.3)) ** 3, f = 1 - k;
      const R0 = (n.fire ? FIRE_SPLASH + 0.3 : FREEZE_R) * e * q.s, rgb = n.fire ? '255, 150, 60' : POWERS.freeze.rgb;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glow(q.x, q.y, Math.max(4, R0 * 1.1), rgb, 0.35 * f);
      ctx.strokeStyle = `rgba(${rgb}, ${0.9 * f})`; ctx.lineWidth = Math.max(2, q.s * 0.2 * f);
      ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1, R0), 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * f})`; ctx.lineWidth = Math.max(1, q.s * 0.05);
      ctx.stroke();
      if (!n.fire) {
        // shards pointing out around the ring
        ctx.fillStyle = `rgba(220, 248, 255, ${0.9 * f})`;
        for (let j = 0; j < 12; j++) {
          const a = (j / 12) * Math.PI * 2 + 0.2, r0 = R0 * 0.82, r1 = R0 * 1.12, w = 0.09;
          ctx.beginPath();
          ctx.moveTo(q.x + Math.cos(a - w) * r0, q.y + Math.sin(a - w) * r0);
          ctx.lineTo(q.x + Math.cos(a) * r1, q.y + Math.sin(a) * r1);
          ctx.lineTo(q.x + Math.cos(a + w) * r0, q.y + Math.sin(a + w) * r0);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // Thunder: the screen dims while a crackling target locks on, then a
  // jagged bolt slams down from the top of the screen with a white flash.
  function drawBolts(P) {
    if (!bolts.length) return;
    let dark = 0, flash = 0;
    for (const bt of bolts) {
      if (bt.t < bt.delay) dark = Math.max(dark, bt.t / bt.delay);
      else { const a = bt.t - bt.delay; dark = Math.max(dark, 1 - a / 0.6); flash = Math.max(flash, 1 - a / 0.18); }
    }
    ctx.save();
    if (dark > 0) { ctx.fillStyle = `rgba(3, 2, 14, ${0.5 * dark})`; ctx.fillRect(0, 0, W, H); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const rgb = POWERS.thunder.rgb;
    for (const bt of bolts) {
      const q = P(bt.x, bt.y);
      if (q.off) continue;
      const S = q.s;
      if (bt.t < bt.delay) {
        const k = bt.t / bt.delay;
        ctx.strokeStyle = `rgba(${rgb}, ${0.4 + 0.6 * k})`; ctx.lineWidth = Math.max(2, S * 0.08);
        ctx.setLineDash([S * 0.3, S * 0.2]); ctx.lineDashOffset = -clock * 60;
        ctx.beginPath(); ctx.arc(q.x, q.y, S * (1.7 - 1.0 * k), 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        // little sparks crawling around the target
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * k})`; ctx.lineWidth = Math.max(1, S * 0.04);
        ctx.beginPath();
        for (let j = 0; j < 3; j++) {
          const a = hash(bt.seed + j + Math.floor(clock * 20)) * Math.PI * 2, r = S * 0.7;
          let x = q.x + Math.cos(a) * r, y = q.y + Math.sin(a) * r;
          ctx.moveTo(x, y);
          for (let s2 = 0; s2 < 3; s2++) { x += (hash(bt.seed + j * 5 + s2 + clock) - 0.5) * S * 0.5; y += (hash(bt.seed + j * 9 + s2 + clock * 2) - 0.5) * S * 0.5; ctx.lineTo(x, y); }
        }
        ctx.stroke();
        continue;
      }
      const a = bt.t - bt.delay, f = Math.max(0, 1 - a / BOLT_FX), seed = bt.seed + Math.floor(clock * 18);
      // the main bolt, from above the top of the screen down to the target, plus two branches
      const pts = [];
      const x0 = q.x + (hash(bt.seed) - 0.5) * S * 3, y0 = -20, n = 12;
      for (let j = 0; j <= n; j++) {
        const t = j / n, jig = j === 0 || j === n ? 0 : (hash(seed * 13 + j) - 0.5) * S * 1.1;
        pts.push([x0 + (q.x - x0) * t + jig, y0 + (q.y - y0) * t]);
      }
      const stroke = (path, w) => {
        ctx.beginPath(); path.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.strokeStyle = `rgba(${rgb}, ${0.35 * f})`; ctx.lineWidth = Math.max(6, S * 0.55 * w); ctx.stroke();
        ctx.strokeStyle = `rgba(190, 215, 255, ${0.85 * f})`; ctx.lineWidth = Math.max(3, S * 0.18 * w); ctx.stroke();
        ctx.strokeStyle = `rgba(255, 255, 255, ${f})`; ctx.lineWidth = Math.max(1.5, S * 0.07 * w); ctx.stroke();
      };
      stroke(pts, 1);
      for (let br = 0; br < 2; br++) {
        const from = pts[3 + br * 4], side = br ? 1 : -1, path = [from];
        let [x, y] = from;
        for (let j = 0; j < 4; j++) { x += side * S * (0.4 + hash(seed + br * 7 + j) * 0.5); y += S * (0.5 + hash(seed * 3 + j) * 0.6); path.push([x, y]); }
        stroke(path, 0.5);
      }
      ctx.globalCompositeOperation = 'lighter';
      glow(q.x, q.y, S * 2.6, '255, 250, 200', 0.7 * f);
      ctx.strokeStyle = `rgba(${rgb}, ${f})`; ctx.lineWidth = Math.max(2, S * 0.12 * f);
      ctx.beginPath(); ctx.arc(q.x, q.y, S * (0.4 + 2.2 * (1 - f)), 0, Math.PI * 2); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (flash > 0) { ctx.fillStyle = `rgba(235, 240, 255, ${0.55 * flash})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  // The big BITE·DASH button, and above it the special power you hold
  // (glowing when it's ready). The power button pops in with a little bounce.
  let specialSeen = null, specialPopAt = -1;
  function drawActionButton() {
    const me = localBat(0);
    if (!me) return;
    if (biteShown()) drawBiteButton(dashButton(), me);
    if (me.held !== specialSeen) { specialSeen = me.held; specialPopAt = clock; }
    if (!specialShown()) return;
    const bt = powerButton();
    const u = Math.min(1, (clock - specialPopAt) / 0.35), pop = u < 1 ? 1 + Math.sin(u * Math.PI) * 0.35 - (1 - u) * 0.6 : 1;
    ctx.save();
    ctx.translate(bt.x, bt.y); ctx.scale(pop, pop); ctx.translate(-bt.x, -bt.y);
    drawSpecialFace(bt, me);
    ctx.restore();
  }
  function drawSpecialFace(bt, me) {
    const type = me.held, pw = type ? POWERS[type] : null, ready = !!pw && me.specialCd <= 0 && me.stun <= 0 && !me.dead;
    const rgb = pw ? pw.rgb : '150, 130, 255', pulse = ready ? 0.5 + 0.5 * Math.sin(clock * 6) : 0;
    if (ready) glow(bt.x, bt.y, bt.r * 2, rgb, 0.22 + 0.18 * pulse);
    const g = ctx.createRadialGradient(bt.x - bt.r * 0.3, bt.y - bt.r * 0.4, bt.r * 0.1, bt.x, bt.y, bt.r);
    g.addColorStop(0, pw ? `rgba(${rgb}, 0.5)` : 'rgba(120, 90, 235, 0.25)');
    g.addColorStop(1, pw ? 'rgba(20, 14, 52, 0.8)' : 'rgba(36, 22, 92, 0.45)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bt.x, bt.y, bt.r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(bt.x, bt.y, bt.r, 0, Math.PI * 2);
    glowStroke(pw ? `rgba(${rgb}, 0.95)` : 'rgba(150, 130, 255, 0.35)', 3, ready ? `rgba(${rgb}, 1)` : null, 1 + pulse);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (pw) {
      drawIcon(type, bt.x, bt.y - bt.r * 0.14, bt.r * 0.42 * (1 + 0.06 * pulse), ready ? `rgb(${rgb})` : `rgba(${rgb}, 0.5)`);
      const name = pw.name.toUpperCase();
      ctx.font = `700 ${Math.round(bt.r * (name.length > 7 ? 0.22 : 0.27))}px ${FONT}`;
      ctx.fillStyle = ready ? '#f4f1ff' : 'rgba(244, 241, 255, 0.5)';
      ctx.fillText(name, bt.x, bt.y + bt.r * 0.52);
    } else {
      ctx.font = `700 ${Math.round(bt.r * 0.3)}px ${FONT}`;
      ctx.fillStyle = 'rgba(244, 241, 255, 0.35)';
      ctx.fillText('POWER', bt.x, bt.y);
    }
    // a timed power: the rim drains as its clock runs down, with the seconds left above
    if (pw && TIMED_CD[type]) {
      const left = me.heldLeft > 0 ? Math.min(1, me.heldLeft / TIMED_LIFE) : 1, going = me.heldLeft > 0;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(10, 8, 30, 0.75)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(bt.x, bt.y, bt.r + 5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = going && me.heldLeft < 2.5 && Math.sin(clock * 16) > 0 ? '#ffffff' : `rgb(${rgb})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(bt.x, bt.y, bt.r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
      ctx.lineCap = 'butt';
      const txt = going ? `${Math.ceil(me.heldLeft)}s` : `${TIMED_LIFE}s`, fs = Math.round(bt.r * 0.3);
      ctx.font = `700 ${fs}px ${FONT}`;
      // the seconds sit to the left of the button, clear of the score pills up top
      const tw = ctx.measureText(txt).width + fs * 0.9, ty = bt.y - bt.r * 0.55, tx = bt.x - bt.r - 9 - tw / 2;
      ctx.fillStyle = 'rgba(10, 8, 30, 0.8)';
      roundRect(tx - tw / 2, ty - fs * 0.65, tw, fs * 1.3, fs * 0.65); ctx.fill();
      ctx.strokeStyle = `rgba(${rgb}, 0.9)`; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#f4f1ff';
      ctx.fillText(txt, tx, ty + 1);
    }
    if (!touchUsed && pw) {
      ctx.font = `700 ${Math.round(bt.r * 0.28)}px ${FONT}`;
      ctx.fillStyle = 'rgba(244, 241, 255, 0.8)';
      ctx.fillText('E', bt.x + bt.r * 0.78, bt.y - bt.r * 0.78);
    }
  }

  // ---- Special power effects in 3D -------------------------------------------
  // view3d.js calls this (as v.extra) just before it draws each frame. Arena
  // (x, y) is the 3D point (x, height, y); bats fly at height 0.55.
  const FLY_Y = 0.55;
  let x3 = null;
  function build3d(T, scene) {
    const add = (o) => { scene.add(o); return o; };
    const glowMat = (color, opacity = 1) => new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
    const MAXB = 48;
    const bgeo = new T.BoxGeometry(1, 1, 1); bgeo.translate(0, 0.5, 0);
    const blockMesh = add(new T.InstancedMesh(bgeo, new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0x3a2412 }), MAXB));
    blockMesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
    const rimMesh = add(new T.InstancedMesh(bgeo, new T.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.55 }), MAXB));
    rimMesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
    for (const m of [blockMesh, rimMesh]) { m.frustumCulled = false; m.count = 0; }
    const ball = new T.SphereGeometry(1, 16, 12);
    const fires = Array.from({ length: 12 }, () => {
      const g = new T.Group();
      const core = new T.Mesh(ball, new T.MeshBasicMaterial({ color: 0xfff0c0 }));
      const mid = new T.Mesh(ball, glowMat(0xff9a30, 0.8));
      const outer = new T.Mesh(ball, glowMat(0xff5a10, 0.35));
      core.scale.setScalar(0.14); mid.scale.setScalar(0.24); outer.scale.setScalar(0.4);
      g.add(core, mid, outer); g.visible = false; add(g);
      return { g, mid, outer };
    });
    // lights stay in the scene (intensity 0 when idle) so materials never recompile mid-match
    const fireLights = [0, 1].map(() => { const l = add(new T.PointLight(0xff7a30, 0, 7, 1.6)); return l; });
    const flashLight = add(new T.PointLight(0xdde8ff, 0, 10, 1.2));
    const ringGeo = new T.TorusGeometry(1, 0.035, 6, 40); ringGeo.rotateX(Math.PI / 2);
    const twists = Array.from({ length: 8 }, () => {
      const g = new T.Group();
      const rings = Array.from({ length: 8 }, (_, k) => { const m = new T.Mesh(ringGeo, glowMat(0xbefff0, 0.55)); g.add(m); return m; });
      const bits = Array.from({ length: 8 }, () => { const m = new T.Mesh(new T.TetrahedronGeometry(0.06), new T.MeshBasicMaterial({ color: 0x8a7fb0 })); g.add(m); return m; });
      g.visible = false; add(g);
      return { g, rings, bits };
    });
    const flat = new T.RingGeometry(0.86, 1, 64); flat.rotateX(-Math.PI / 2);
    const spikeGeo = new T.ConeGeometry(0.12, 0.7, 5); spikeGeo.translate(0, 0.35, 0);
    const novas3 = [0, 1, 2, 3].map(() => {
      const g = new T.Group();
      const ring = new T.Mesh(flat, glowMat(0x6ed2ff, 0.9));
      const spikes = Array.from({ length: 12 }, () => { const m = new T.Mesh(spikeGeo, new T.MeshLambertMaterial({ color: 0xc8f0ff, emissive: 0x3a7aa0, transparent: true, opacity: 0.85 })); g.add(m); return m; });
      g.add(ring); g.visible = false; add(g);
      return { g, ring, spikes };
    });
    const iceGeo = new T.BoxGeometry(0.95, 0.95, 0.95);
    const ices = [0, 1, 2, 3].map(() => {
      const g = new T.Group();
      const box = new T.Mesh(iceGeo, new T.MeshLambertMaterial({ color: 0xaee6ff, emissive: 0x2a6a90, transparent: true, opacity: 0.45, depthWrite: false }));
      const edges = new T.LineSegments(new T.EdgesGeometry(iceGeo), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
      g.add(box, edges); g.visible = false; add(g);
      return { g, box, edges };
    });
    const ghosts = [0, 1, 2, 3].map(() => { const m = add(new T.Mesh(ball, glowMat(0xd6c4ff, 0.18))); m.visible = false; return m; });
    return { scene, blockMesh, rimMesh, MAXB, fires, fireLights, flashLight, twists, novas3, ices, ghosts, M: new T.Matrix4(), Q: new T.Quaternion(), E: new T.Euler(), V: new T.Vector3(), S: new T.Vector3(), C: new T.Color() };
  }
  function extras3d(T, scene) {
    if (!x3 || x3.scene !== scene) x3 = build3d(T, scene);
    const { blockMesh, rimMesh, M, Q, E, V, S, C } = x3;
    // Stone Wall: blocks slam up out of the floor, then shake, sink and tilt as they crumble
    let n = 0;
    for (const bk of blocks) {
      const rise = blockRise(bk), cr = blockCrumble(bk), own = BAT_RGB[bk.owner] || [0.84, 0.63, 0.43];
      for (const k of bk.tiles) {
        if (n >= x3.MAXB) break;
        const tx = k % arena.w, ty = Math.floor(k / arena.w), j = cr > 0 ? (hash(k + Math.floor(clock * 30)) - 0.5) * 0.08 : 0;
        V.set(tx + 0.5 + j, -0.02 - cr * 0.5, ty + 0.5);
        Q.setFromEuler(E.set(cr * (hash(k) - 0.5) * 0.8, 0, cr * (hash(k * 3) - 0.5) * 0.8));
        S.set(0.98 * (1 - cr * 0.25), Math.max(0.01, 1.2 * rise * (1 - cr * 0.4)), 0.98 * (1 - cr * 0.25));
        M.compose(V, Q, S);
        blockMesh.setMatrixAt(n, M);
        const lum = 0.62 + 0.4 * Math.max(0, 1 - bk.t * 2) + 0.08 * hash(k);
        blockMesh.setColorAt(n, C.setRGB(0.86 * lum, 0.62 * lum, 0.44 * lum));
        S.multiplyScalar(1.03); M.compose(V, Q, S);
        rimMesh.setMatrixAt(n, M);
        rimMesh.setColorAt(n, C.setRGB(own[0], own[1], own[2]).multiplyScalar(1 - cr));
        n++;
      }
    }
    blockMesh.count = rimMesh.count = n;
    for (const m of [blockMesh, rimMesh]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

    // fireballs: a glowing ball of flame that lights the walls orange as it passes
    x3.fires.forEach((f, k) => {
      const m = shots[k];
      f.g.visible = !!m;
      if (!m) return;
      f.g.position.set(m.x, FLY_Y, m.y);
      const fl = 1 + 0.15 * Math.sin(clock * 40 + m.id);
      f.mid.scale.setScalar(0.24 * fl); f.outer.scale.setScalar(0.4 * (2 - fl));
    });
    x3.fireLights.forEach((l, k) => {
      const m = shots[k];
      l.intensity = m ? 9 * (1 + 0.15 * Math.sin(clock * 33 + k)) : 0;
      if (m) l.position.set(m.x, FLY_Y + 0.35, m.y);
    });
    // the flash light: lightning strikes and fireball bursts
    let fl = 0, fx3 = 0, fy3 = 0;
    for (const bt of bolts) {
      const a = bt.t - bt.delay;
      if (a >= 0 && 1 - a / 0.35 > fl) { fl = 1 - a / 0.35; fx3 = bt.x; fy3 = bt.y; }
    }
    for (const nv of novas) if (1 - nv.t / 0.3 > fl) { fl = 1 - nv.t / 0.3; fx3 = nv.x; fy3 = nv.y; }
    x3.flashLight.intensity = fl > 0 ? 22 * fl : 0;
    x3.flashLight.position.set(fx3, 1.6, fy3);
    // twisters: a stack of spinning rings, wider at the top, wobbling as they go
    x3.twists.forEach((tw3, k) => {
      const tw = twisters[k];
      tw3.g.visible = !!tw;
      if (!tw) return;
      const fade = Math.max(0, Math.min(1, tw.t * 3, (TORNADO_LIFE - tw.t) * 2));
      tw3.g.position.set(tw.x, 0, tw.y);
      tw3.rings.forEach((m, j) => {
        const h = j / 7, r = (0.15 + h * h * 0.95) * (0.6 + 0.4 * fade);
        m.position.set(Math.sin(clock * 4 + j * 0.6) * 0.12 * h, 0.08 + h * 1.9, Math.cos(clock * 3.3 + j * 0.6) * 0.12 * h);
        m.scale.set(r, 1, r);
        m.rotation.y = clock * 9 + j;
        m.material.opacity = (0.18 + 0.3 * h) * fade;
      });
      tw3.bits.forEach((m, j) => {
        const a = clock * 7 + j * 0.785, h = 0.2 + ((j * 0.37 + clock * 0.4) % 1) * 1.6, r = 0.2 + h * 0.5;
        m.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
        m.rotation.set(clock * 5 + j, clock * 3, 0);
      });
    });
    // freeze blasts (and fire bursts): a ring racing out, ice spikes bursting up and sinking
    x3.novas3.forEach((n3, k) => {
      const nv = novas[k];
      n3.g.visible = !!nv;
      if (!nv) return;
      const t = nv.t / NOVA_FX, e = 1 - (1 - Math.min(1, nv.t / 0.3)) ** 3, R0 = (nv.fire ? FIRE_SPLASH + 0.3 : FREEZE_R) * e;
      n3.g.position.set(nv.x, 0.06, nv.y);
      n3.ring.scale.setScalar(Math.max(0.05, R0));
      n3.ring.material.color.setHex(nv.fire ? 0xff8a30 : 0x6ed2ff);
      n3.ring.material.opacity = 0.9 * (1 - t);
      n3.spikes.forEach((m, j) => {
        m.visible = !nv.fire;
        const a = (j / 12) * Math.PI * 2, r = R0 * (0.75 + 0.2 * hash(j));
        m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        m.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        m.scale.set(1, Math.max(0.01, Math.sin(Math.min(1, t * 1.1) * Math.PI)) * (0.8 + 0.6 * hash(j * 7)), 1);
      });
    });
    // frozen bats sit in a block of ice; ghosts get a pale aura
    x3.ices.forEach((ic, k) => {
      const b = bats[k], vis = b && !b.dead && b.ice > 0 ? batVisible(b) : 0;
      ic.g.visible = vis > 0.03;
      if (!ic.g.visible) return;
      const pop = Math.min(1, b.ice / 0.3);
      ic.g.position.set(b.x, FLY_Y, b.y);
      ic.g.rotation.set(0.15, 0.4 + k, 0.1);
      ic.g.scale.setScalar(0.9 + 0.1 * pop);
      ic.box.material.opacity = 0.45 * vis * pop; ic.edges.material.opacity = 0.9 * vis * pop;
    });
    x3.ghosts.forEach((m, k) => {
      const b = bats[k], vis = b && !b.dead && b.ghostT > 0 ? batVisible(b) : 0;
      m.visible = vis > 0.03;
      if (!m.visible) return;
      m.position.set(b.x, FLY_Y, b.y);
      m.scale.setScalar(0.55 + 0.05 * Math.sin(clock * 6));
      m.material.opacity = 0.35 * Math.min(1, vis * 2);
    });
  }

  // Screen-space layer shared by both views: warnings, HUD, touch controls, fades
  function drawScreen() {
    const th = arena.theme;
    // the echo storm pulses the screen edge
    if (storm && !over && !roundEnd) {
      const a = 0.22 + 0.22 * Math.sin(clock * 10);
      ctx.strokeStyle = `rgba(255, 226, 120, ${a})`;
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, W - 6, H - 6);
    }

    drawHud();
    drawSticks();
    if (actionShown()) drawActionButton();
  }

  function drawPowerup(p) {
    const x = X(p.x), y = Y(p.y + Math.sin(clock * 2.5 + p.phase) * 0.12), rgb = POWERS[p.type].rgb, s = PX * 0.3;
    glow(x, y, PX * 1.1, rgb, 0.3 + 0.15 * Math.sin(clock * 4 + p.phase));
    ctx.strokeStyle = `rgb(${rgb})`;
    ctx.lineWidth = Math.max(1.5, PX * 0.07);
    ctx.beginPath(); ctx.arc(x, y, s * 1.25, 0, Math.PI * 2); ctx.stroke();
    // special powers spin a dashed outer ring, so they read as "for the POWER button"
    if (POWERS[p.type].special) {
      ctx.setLineDash([s * 0.35, s * 0.3]); ctx.lineDashOffset = -clock * 20;
      ctx.beginPath(); ctx.arc(x, y, s * 1.6, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    drawIcon(p.type, x, y, s, `rgb(${rgb})`);
  }
  // each power's little picture, centred on x, y, about 2s across
  function drawIcon(type, x, y, s, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, s * 0.2); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (type === 'mega') {
      ctx.arc(x, y, s * 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(1.5, s * 0.16);
      ctx.beginPath(); ctx.arc(x, y, s * 0.55, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, s * 0.55, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, s * 0.85, -0.7, 0.7); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, s * 0.85, Math.PI - 0.7, Math.PI + 0.7); ctx.stroke();
    } else if (type === 'speed') {
      for (const off of [-0.3, 0.25]) {
        ctx.beginPath();
        ctx.moveTo(x + (off - 0.25) * s, y - 0.5 * s); ctx.lineTo(x + (off + 0.25) * s, y); ctx.lineTo(x + (off - 0.25) * s, y + 0.5 * s);
        ctx.stroke();
      }
    } else if (type === 'shield') {
      ctx.moveTo(x, y - 0.65 * s); ctx.lineTo(x + 0.55 * s, y - 0.35 * s); ctx.lineTo(x + 0.45 * s, y + 0.3 * s);
      ctx.lineTo(x, y + 0.7 * s); ctx.lineTo(x - 0.45 * s, y + 0.3 * s); ctx.lineTo(x - 0.55 * s, y - 0.35 * s); ctx.closePath();
      ctx.stroke();
    } else if (type === 'frenzy') {
      ctx.arc(x - 0.32 * s, y, 0.3 * s, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 0.32 * s, y, 0.3 * s, 0, Math.PI * 2); ctx.stroke();
    } else if (type === 'fire') {
      const flame = (k, dy) => {
        ctx.beginPath();
        ctx.moveTo(x, y + dy - s * 0.95 * k);
        ctx.bezierCurveTo(x + s * 0.75 * k, y + dy - s * 0.2 * k, x + s * 0.7 * k, y + dy + s * 0.75 * k, x, y + dy + s * 0.8 * k);
        ctx.bezierCurveTo(x - s * 0.7 * k, y + dy + s * 0.75 * k, x - s * 0.75 * k, y + dy - s * 0.2 * k, x, y + dy - s * 0.95 * k);
        ctx.fill();
      };
      flame(1, 0);
      ctx.fillStyle = 'rgba(255, 240, 190, 0.95)'; flame(0.5, s * 0.35);
    } else if (type === 'thunder') {
      ctx.moveTo(x + 0.2 * s, y - 0.95 * s); ctx.lineTo(x - 0.5 * s, y + 0.12 * s); ctx.lineTo(x - 0.02 * s, y + 0.12 * s);
      ctx.lineTo(x - 0.22 * s, y + 0.95 * s); ctx.lineTo(x + 0.52 * s, y - 0.16 * s); ctx.lineTo(x + 0.06 * s, y - 0.16 * s); ctx.closePath();
      ctx.fill();
    } else if (type === 'wall') {
      ctx.lineWidth = Math.max(1.2, s * 0.13);
      const w = s * 1.5, h = s * 1.15, x0 = x - w / 2, y0 = y - h / 2;
      ctx.globalAlpha *= 0.35; ctx.fillRect(x0, y0, w, h); ctx.globalAlpha /= 0.35;
      ctx.strokeRect(x0, y0, w, h);
      for (let r = 1; r < 3; r++) { ctx.moveTo(x0, y0 + (h * r) / 3); ctx.lineTo(x0 + w, y0 + (h * r) / 3); }
      for (let r = 0; r < 3; r++) {
        const xs = r % 2 ? [0.5] : [0.25, 0.75];
        for (const f of xs) { ctx.moveTo(x0 + w * f, y0 + (h * r) / 3); ctx.lineTo(x0 + w * f, y0 + (h * (r + 1)) / 3); }
      }
      ctx.stroke();
    } else if (type === 'freeze') {
      ctx.lineWidth = Math.max(1.3, s * 0.15);
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3 + Math.PI / 2, c = Math.cos(a), n = Math.sin(a);
        ctx.moveTo(x - c * s * 0.9, y - n * s * 0.9); ctx.lineTo(x + c * s * 0.9, y + n * s * 0.9);
        for (const sd of [-1, 1]) {
          const mx = x + sd * c * s * 0.55, my = y + sd * n * s * 0.55;
          for (const t of [-0.6, 0.6]) {
            const b = a + (sd > 0 ? 0 : Math.PI) + t * 1.2;
            ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(b) * s * 0.28, my + Math.sin(b) * s * 0.28);
          }
        }
      }
      ctx.stroke();
    } else if (type === 'tornado') {
      ctx.lineWidth = Math.max(1.3, s * 0.17);
      for (let k = 0; k < 5; k++) {
        const yy = y - s * 0.75 + k * s * 0.37, half = s * (0.85 - k * 0.15), dx = Math.sin(k * 1.3) * s * 0.12;
        ctx.moveTo(x - half + dx, yy); ctx.quadraticCurveTo(x + dx, yy + s * 0.12, x + half + dx, yy);
      }
      ctx.stroke();
    } else if (type === 'ghost') {
      ctx.moveTo(x - s * 0.62, y + s * 0.75);
      ctx.lineTo(x - s * 0.62, y - s * 0.15);
      ctx.arc(x, y - s * 0.15, s * 0.62, Math.PI, 0);
      ctx.lineTo(x + s * 0.62, y + s * 0.75);
      for (let k = 0; k < 3; k++) {
        const x1 = x + s * 0.62 - (k + 0.5) * (s * 1.24 / 3), x2 = x + s * 0.62 - (k + 1) * (s * 1.24 / 3);
        ctx.quadraticCurveTo(x1, y + s * (k % 2 ? 0.95 : 0.45), x2, y + s * 0.75);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1a1030';
      ctx.beginPath(); ctx.ellipse(x - s * 0.22, y - s * 0.15, s * 0.1, s * 0.16, 0, 0, Math.PI * 2); ctx.ellipse(x + s * 0.22, y - s * 0.15, s * 0.1, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawBat(b, x, y, o = {}) {
    const scale = o.scale ?? (1 + (b.puff > 0 ? 0.4 * b.puff * (0.8 + 0.2 * Math.sin(clock * 30)) : 0));
    const stunned = o.stunned ?? b.stun > 0;
    if (!o.rot && b.safe > 0 && Math.floor(b.safe * 10) % 2 === 0) return;
    const r = PX * R * scale, flap = stunned ? 0.2 : Math.sin(clock * (b.dashT > 0 ? 40 : 18) + b.i);
    // a ghost is half see-through (rivals' alpha already has it, via batVisible)
    const alpha = o.alpha ?? (b.ghostT > 0 && !o.rot ? ghostAlpha(b) : 1);
    ctx.save();
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    ctx.globalAlpha = alpha;
    glow(0, 0, r * 3, b.rgb, 0.3);
    if (b.power) glow(0, 0, r * 4, POWERS[b.power].rgb, 0.25 + 0.1 * Math.sin(clock * 10));
    if (b.burn > 0) glow(0, 0, r * 3.4, '255, 120, 40', 0.45 * Math.min(1, b.burn) * (0.8 + 0.2 * Math.sin(clock * 30)));
    if (b.ghostT > 0 && !o.rot) glow(0, 0, r * 3.6, POWERS.ghost.rgb, 0.35);
    // a soft ring in the slot colour under the bat, so you can tell bats apart whatever they look like
    if (!o.rot) {
      ctx.strokeStyle = `rgba(${b.rgb}, 0.55)`; ctx.lineWidth = Math.max(1.5, r * 0.14);
      ctx.beginPath(); ctx.ellipse(0, r * 1.05, r * 1.55, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const L = window.EchoLooks;
    let drewLook = false;
    if (L && b.look && L.draw2D) {
      try {
        L.draw2D(ctx, b.look, 0, 0, r, { face: b.face || 1, flap: (flap + 1) / 2, alpha, stunned, eyesClosed: stunned, angle: 0 });
        drewLook = true;
      } catch (e) { drewLook = false; }
      ctx.globalAlpha = alpha;
    }
    if (!drewLook) {
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
    }

    const lx = (b.face || 1) * r * 0.18;
    if (drewLook) { /* the look draws its own eyes */ } else if (stunned) {
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
    if (b.held && b.heldLeft > 0 && !o.rot) {
      // a timed power running: a draining arc in its colour
      ctx.strokeStyle = `rgba(${POWERS[b.held].rgb}, 0.9)`;
      ctx.lineWidth = Math.max(2, PX * 0.07);
      ctx.beginPath(); ctx.arc(0, 0, r * 1.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, b.heldLeft / TIMED_LIFE)); ctx.stroke();
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
    // frozen: a block of ice around the bat
    if (b.ice > 0 && !o.rot) drawIceBlock(r, Math.min(1, b.ice / 0.4));
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
      if (!(b.ice > 0)) ctx.fillText('STUNNED', x, y - r * 2.6);
      ctx.globalAlpha = 1;
    }
    // no name tags: just a small arrow under your own bat
    if (o.tag !== false && isMine(b)) {
      ctx.globalAlpha = alpha;
      youMarker(x, y + r * 1.7, Math.max(5, r * 0.42), b.rgb);
      ctx.globalAlpha = 1;
    }
  }
  // your bat: the one you watch online, or the only human's bat on this device
  const isMine = (b) => viewer === b.i || (viewer < 0 && localCount === 1 && b === localBat(0));
  // a little upward arrow in the bat's colour, marking which bat is yours
  function youMarker(x, y, s, rgb) {
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + s, y + s * 0.9); ctx.lineTo(x - s, y + s * 0.9); ctx.closePath();
    ctx.fillStyle = `rgba(${rgb}, 0.85)`; ctx.fill();
    ctx.strokeStyle = 'rgba(10, 8, 30, 0.6)'; ctx.lineWidth = 1; ctx.stroke();
  }

  function drawBiteButton(b, me) {
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
    // the same toothy Pac-Man as the BITE buttons in Explore and Co-op, lunging
    // forward (speed lines behind it), since a bite is a dash: BITE·DASH under it
    const ix = b.x + b.r * 0.12, iy = b.y - b.r * 0.16, ir = b.r * 0.36;
    ctx.strokeStyle = ready ? 'rgba(244, 241, 255, 0.85)' : 'rgba(244, 241, 255, 0.35)';
    ctx.lineWidth = Math.max(1.5, b.r * 0.06); ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [dy, len] of [[-0.42, 0.34], [0, 0.48], [0.42, 0.34]]) {
      const x1 = ix - ir * 1.25, y1 = iy + ir * dy;
      ctx.moveTo(x1, y1); ctx.lineTo(x1 - b.r * len, y1);
    }
    ctx.stroke(); ctx.lineCap = 'butt';
    window.EchoChomp?.icon(ctx, ix, iy, ir, ready);
    ctx.font = `800 ${Math.round(b.r * 0.235)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = ready ? '#f4f1ff' : 'rgba(244, 241, 255, 0.45)';
    ctx.fillText('BITE·DASH', b.x, b.y + b.r * 0.5);
  }
  function drawIceBlock(r, k) {
    const s = r * 2.5 * (0.9 + 0.1 * k);
    ctx.save();
    ctx.rotate(0.12);
    roundRect(-s / 2, -s / 2, s, s, s * 0.14);
    ctx.fillStyle = `rgba(170, 230, 255, ${0.38 * k})`; ctx.fill();
    ctx.strokeStyle = `rgba(235, 250, 255, ${0.9 * k})`; ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.stroke();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * k})`; ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.moveTo(-s * 0.36, -s * 0.12); ctx.lineTo(-s * 0.12, -s * 0.36);
    ctx.moveTo(-s * 0.36, s * 0.08); ctx.lineTo(s * 0.08, -s * 0.36);
    ctx.moveTo(s * 0.2, s * 0.36); ctx.lineTo(s * 0.36, s * 0.2);
    ctx.stroke();
    ctx.restore();
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
  const stormIn = () => Math.max(0, Math.ceil(ROUND_LIMIT - roundClock));
  const infoText = () => {
    const parts = [arena.def.name];
    // (shorter in Last Bat Standing, which has more to say)
    if (arenaMode === 'morph') parts.push(rule === 'survivor' ? 'morphing' : 'the cave keeps changing');
    else if (arenaMode === 'sky' && rule !== 'survivor') parts.push('no cave tonight');
    if (rule === 'survivor') {
      parts.push(`round ${round}`);
      if (storm) parts.push('echo storm');
      else if (stormIn() <= STORM_WARN && !roundEnd) parts.push(`storm in ${stormIn()}s`);
      parts.push(`first to ${winScore} round${winScore === 1 ? '' : 's'}`);
    } else parts.push(`first to ${winScore}`);
    return parts.join('  ·  ').toUpperCase();
  };
  const infoUrgent = () => rule === 'survivor' && !roundEnd && (storm || stormIn() <= STORM_WARN);
  function drawHud() {
    const dpr = ctx.getTransform().a || 1, ph = Math.max(30, Math.min(40, H * 0.085)), topH = Math.ceil(8 + ph + 12);
    const size = Math.max(13, Math.min(20, H / 26)), botH = Math.ceil(size * 1.55 + 22);
    let key = `${W},${H},${dpr},${viewer},${localCount},${infoText()},${infoUrgent()}`;
    for (const b of bats) key += `|${b.name},${b.ctrl},${b.cpuFlag},${b.out},${b.score},${b.echoes},${b.power},${b.power ? Math.ceil(b.powerT) : 0},${b.mega},${b.shield},${b.held},${b.heldLeft > 0 ? Math.ceil(b.heldLeft) : 0},${b.ghostT > 0}`;
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
      if (b.out) tags.push('OUT');
      if (b.ctrl === 'cpu' || b.cpuFlag) tags.push('CPU');
      if (mine) tags.push('YOU');
      if (b.held) tags.push(b.heldLeft > 0 ? `${POWERS[b.held].label} ${Math.ceil(b.heldLeft)}` : POWERS[b.held].label);
      if (b.ghostT > 0) tags.push('GHOST');
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
      // out this round: the pill dims and the name gets struck through
      if (b.out) {
        ctx.font = `700 ${Math.round(ph * 0.42)}px ${HEAD}`;
        const nw = ctx.measureText(b.name).width, ny = cy - (tags.length ? ph * 0.13 : 0);
        ctx.strokeStyle = '#f4f1ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(nx - 2, ny); ctx.lineTo(nx + nw + 2, ny); ctx.stroke();
        roundRect(x, y, pw, ph, ph / 2);
        ctx.fillStyle = 'rgba(6, 5, 20, 0.55)'; ctx.fill();
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
      ctx.fillText(rule === 'survivor'
        ? `Last Bat Standing: get chomped and you're out for the round. First to ${winScore} round win${winScore === 1 ? '' : 's'}.`
        : `Bite a rival to chomp it (stun it with a squeak first). First to ${winScore} bites wins.`, W / 2, mid + size * 1.4);
      ctx.fillStyle = 'rgba(232, 236, 255, 0.65)';
      ctx.font = `600 ${size * 0.8}px ${FONT}`;
      const how = localCount === 1
        ? (touchUsed ? 'Drag to fly · tap to squeak · hold a 2nd finger, let go: beam · flick or BITE·DASH to bite'
          : 'WASD or arrows to fly · F to squeak, hold F for a beam · G to bite·dash · E to use a power · Esc to pause')
        : `Each player owns ${['', 'the screen', 'half', 'a third', 'a quarter'][localCount]} of the screen · tap to squeak · hold a 2nd finger to charge a beam · flick to dash`;
      ctx.fillText(how, W / 2, mid + size * 2.7);
      ctx.fillText(powerFreq && powerOn.some((t) => POWERS[t].special)
        ? 'Squeak just before a rival\'s echo hits you to PARRY it · grab power-ups, special ones turn BITE·DASH into the power'
        : 'Squeak just before a rival\'s echo hits you to PARRY it · grab glowing power-ups', W / 2, mid + size * 3.9);
    } else if (banner) {
      ctx.font = `700 ${size * 2}px ${HEAD}`;
      ctx.fillStyle = `rgba(5, 6, 15, ${Math.min(0.9, banner.t * 2)})`;
      ctx.fillText(banner.text, W / 2, mid + 4);
      ctx.fillStyle = `rgba(${banner.rgb}, ${Math.min(1, banner.t * 2)})`;
      ctx.fillText(banner.text, W / 2, mid);
    }
    // out of this round: say so, and whose flight we're following
    if (countdown <= 0 && spectating() && !roundEnd) {
      const w = watched();
      ctx.font = `700 ${size * 0.95}px ${HEAD}`;
      const text = w ? `You're out · watching ${w.name}` : "You're out · watching";
      const tw = ctx.measureText(text).width + 36, th = size * 1.8, ty = Math.max(H * 0.2, 8 + Math.max(30, Math.min(40, H * 0.085)) + 14);
      pill(W / 2 - tw / 2, ty, tw, th, w ? `rgba(${w.rgb}, 0.8)` : 'rgba(150, 130, 255, 0.75)', 6);
      ctx.fillStyle = '#f4f1ff';
      ctx.fillText(text, W / 2, ty + th / 2 + 1);
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
    POWER_LIST,
    get powerOptions() { return { on: Object.fromEntries(POWER_TYPES.map((t) => [t, powerOn.includes(t)])), freq: Object.keys(POWER_FREQ).find((k) => POWER_FREQ[k] === powerFreq) }; },
    get shots() { return shots; },
    get twisters() { return twisters; },
    get blocks() { return blocks; },
    get bolts() { return bolts; },
    get novas() { return novas; },
    get specialCount() { return specialCount; },
    special: (i, dx, dy) => useSpecial(bats[i], dx, dy),
    // run the simulation ahead n steps of dt seconds (tests)
    step: (dt, n = 1) => { for (let k = 0; k < n && active && mode !== 'client'; k++) update(dt); },
    give: (i, type) => { const b = bats[i]; if (b && POWERS[type]) grabPowerup(b, { x: b.x, y: b.y, type }); },
    get beams() { return beams; },
    get countdown() { return countdown; },
    get over() { return over; },
    get view() { return view; },
    setView: (v) => { view = v === '2d' ? '2d' : '3d'; if (view === '2d') window.EchoDuel3D?.hide(); },
    setPaused: (p) => { paused = p; if (p) { keys.clear(); sticks.clear(); chargers.clear(); } },
    setRoundClock: (s) => { roundClock = s; stormWarned = s >= ROUND_LIMIT - STORM_WARN; },
    spawnPowerup: (type) => spawnPowerup(type),
    squeak: (i) => squeak(bats[i]),
    act: (i, a) => doAct(bats[i], a),
    beam: (i, ux, uy) => fireBeam(bats[i], ux === undefined ? undefined : { ux, uy }),
    get rings() { return rings; },
    get parries() { return parries; },
    get parryCount() { return parryCount; },
    get eats() { return eats; },
    get winScore() { return winScore; },
    get arenaIndex() { return arenaIndex; },
    get arenaMode() { return arenaMode; },
    get rule() { return rule; },
    get round() { return round; },
    get roundEnd() { return roundEnd; },
    get storm() { return storm; },
    get spectating() { return spectating(); },
    get watching() { return watched()?.i ?? -1; },
    get banner() { return banner; },
    get morph() { return morph; },
    get ringMax() { return RING_MAX; },
    cornerSpots: () => cornerSpots(),
    dash: (i, dx, dy) => dash(bats[i], dx, dy),
  };
})();
