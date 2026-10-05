// Bat Brawl: 2 to 8 bats in a pitch-dark arena. A squeak lights the walls
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
  // Echo parry: press squeak just before a rival's ring (or dash) reaches you
  // and it bounces off. You aren't stunned, the attacker is, and the squeak
  // you made is refunded. Each press opens a short parry window; a press that
  // parries nothing just squeaks as usual, and you can't open another window
  // until PARRY_COOLDOWN has passed, so mashing squeak isn't a free shield.
  // A hit that lands a hair before the press still counts (PARRY_LATE, a bit
  // more for online guests, whose presses reach the host late).
  const PARRY_WINDOW = 0.25, PARRY_LATE = 0.06, PARRY_LATE_REMOTE = 0.14, PARRY_COOLDOWN = 1, PARRY_STUN = 1.8, PARRY_FX = 0.7;
  const PARRY_RGB = '255, 246, 200';
  const OPEN_SKY_CHANCE = 0.3;
  // Arena modes, picked before a match:
  //   morph   classic Morphing: one stone cave slowly reshapes itself, a few walls
  //           at a time, into the next (same look throughout, no lava or ice)
  //   xtreme  Morphing Xtreme: the themed maps take turns (crystal, lava, ice, moss),
  //           each with its own rules, XTREME_HOLD seconds each
  //   still   one themed cave, picked in the lobby, that never changes
  //   sky     Open Sky the whole match: no cave at all
  // (older lobbies may still send 'shift' or 'chaos'; those play as morph)
  const ARENA_MODES = ['morph', 'xtreme', 'still', 'sky'];
  const MORPH_STEP = 0.3, MORPH_PAUSE = 5;
  // Xtreme: each map stays XTREME_HOLD seconds, then reshapes fast (XTREME_TILES
  // tiles every XTREME_STEP seconds). Turning into Lava Hollow, the blocks change
  // first, then LAVA_WARN seconds of 3-2-1 before the floor turns to lava.
  const XTREME_HOLD = 28, XTREME_STEP = 0.1, XTREME_TILES = 9, LAVA_WARN = 3;
  const XTREME_ORDER = ['Crystal Grotto', 'Lava Hollow', 'Frozen Cavern', 'Mossy Den'];
  // Lava: a bat on the lava floor (not on a block top, not mid-jump, not a ghost)
  // for LAVA_GRACE seconds sizzles: knocked out. The last rival that hit it in
  // the KO_CREDIT seconds before gets the point (Free-for-all).
  const LAVA_GRACE = 0.12, KO_CREDIT = 4, SINK_TIME = 0.7;
  // Mossy Den: a dash into a bush chomps through it; it grows back after
  // REGROW seconds (waiting while a bat is in the way)
  const REGROW = 12;
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
    freeze: { label: 'FREEZE', rgb: '110, 210, 255', name: 'Freeze', desc: 'For 8 seconds, ice blasts freeze rivals close to you', special: true },
    tornado: { label: 'TORNADO', rgb: '190, 255, 235', name: 'Tornado', desc: 'For 8 seconds, send out twisters that pull rivals in and spin them', special: true },
    ghost: { label: 'GHOST', rgb: '214, 196, 255', name: 'Ghost', desc: 'Fly through cave walls for 5 seconds, half see-through', special: true },
  };
  const POWER_TYPES = Object.keys(POWERS);
  const POWER_ICONS = { mega: '📣', speed: '⚡', shield: '🛡️', frenzy: '🎶', fire: '🔥', thunder: '🌩️', freeze: '❄️', tornado: '🌪️', ghost: '👻' };
  const toHex = (rgb) => '#' + rgb.split(',').map((v) => (+v).toString(16).padStart(2, '0')).join('');
  const POWER_LIST = POWER_TYPES.map((id) => ({ id, name: POWERS[id].name, desc: POWERS[id].desc, color: toHex(POWERS[id].rgb), icon: POWER_ICONS[id], special: !!POWERS[id].special }));
  // how often power-ups appear: [first one after, then every, seconds] and how many can wait on the map
  const POWER_FREQ = {
    off: null,
    low: { first: [10, 14], every: [14, 20], max: 1 },
    normal: { first: [6, 9], every: [8, 13], max: 2 },
    high: { first: [0, 0], every: [2, 3.5], max: 5, start: 2 },   // two show up the moment play starts
    max: { first: [0, 0], every: [1, 1.5], max: 8, start: 3, near: 2.5 },   // Extreme: three at once, then a flood
  };
  const POWER_FREQS = [['off', 'Off'], ['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['max', 'Extreme']].map(([id, name]) => ({ id, name }));
  let powerOn = POWER_TYPES.slice(), powerFreq = POWER_FREQ.normal;
  const powerWait = (k) => (powerFreq ? powerFreq[k][0] + Math.random() * (powerFreq[k][1] - powerFreq[k][0]) : 1e9);
  // special power numbers
  const SPECIAL_CD = 0.35;
  // Timed specials: the first use starts a TIMED_LIFE-second clock, and until
  // it runs out you can use the power again and again. Shots (fireball,
  // tornado) fire as fast as you tap; the area blasts (freeze, thunder) keep a
  // short gap. CPUs use slower gaps so they don't spray. Ghost stays one use.
  const TIMED_LIFE = 8;
  const TIMED_CD = { fire: 0.08, tornado: 0.12, thunder: 0.6, freeze: 0.6 };
  const CPU_TIMED_CD = { fire: 0.3, tornado: 0.8, thunder: 1.6, freeze: 1.6 };
  const MAX_SHOTS_EACH = 10, MAX_TWISTERS_EACH = 4;   // oldest goes when a bat has more out
  const FIRE_SPEED = 10, FIRE_LIFE = 1.6, FIRE_R = 0.28, FIRE_STUN = 2, FIRE_KNOCK = 6, FIRE_SPLASH = 1.15, SPLASH_STUN = 1.3;
  const THUNDER_RANGE = 7, THUNDER_FAR = 11, THUNDER_DELAY = 0.45, THUNDER_STUN = 2.2, THUNDER_REVEAL = 3, BOLT_FX = 0.9;
  const FREEZE_R = 3.2, FREEZE_STUN = 2.6, NOVA_FX = 0.55;
  const TORNADO_LIFE = 4.5, TORNADO_SPEED = 2.4, TORNADO_PULL = 3.6, TORNADO_CORE = 0.65, TORNADO_STUN = 1.6;
  const GHOST_TIME = 5;
  const BATS = [
    { name: 'Mo', color: '#8b6cff', rgb: '139, 108, 255' },
    { name: 'Ka', color: '#ff7ad9', rgb: '255, 122, 217' },
    { name: 'Ca', color: '#9dff6a', rgb: '157, 255, 106' },
    { name: 'Bo', color: '#ffb347', rgb: '255, 179, 71' },
    // seats 5-8 (big battles: CPUs or friends online)
    { name: 'Zu', color: '#3fe0ff', rgb: '63, 224, 255' },
    { name: 'Ri', color: '#ff5257', rgb: '255, 82, 87' },
    { name: 'Pi', color: '#fff04d', rgb: '255, 240, 77' },
    { name: 'Lu', color: '#f4f1ff', rgb: '244, 241, 255' },
  ];
  const MAX_BATS = BATS.length, MAX_LOCAL = 4;
  // Big battles (more than 4 bats) stretch the arena by BIG_COLS columns and
  // BIG_ROWS rows of copies (about a third more room)
  const BIG_COLS = 5, BIG_ROWS = 2;
  // Jump: a hop up over walls and other bats. Squeak rings and
  // fireballs pass underneath, and a bite on a jumping bat snaps on empty air
  // (MISS!); nobody bites from up there either. Land on a block and you stay
  // up on top (see Levels below); land half on rock and you're eased off it. The jump meter holds JUMP_CHARGES jumps
  // and refills one every JUMP_RECHARGE seconds on the ground; after landing there's a
  // JUMP_GAP pause before the next hop (a press in the last JUMP_BUFFER
  // seconds of a jump is kept and hops again as soon as it can). Stunned bats
  // can still jump (they just can't steer).
  const JUMP_TIME = 0.72, JUMP_CHARGES = 3, JUMP_RECHARGE = 1.8, JUMP_GAP = 0.1, JUMP_BUFFER = 0.2;
  // a bite that whiffs under a jumping bat: the chomp plays out on empty air
  const MISS_TIME = 1;
  // what lit a tile (litBy): a bat's slot 0-7, or one of these lights
  const LIGHT_FIRE = MAX_BATS, LIGHT_ICE = MAX_BATS + 1, LIGHT_BOLT = MAX_BATS + 2;
  const LIGHT_RGB = [...BATS.map((b) => b.rgb), '255, 140, 50', '140, 220, 255', '255, 250, 190'];
  // keys for each local player slot on a shared keyboard
  const KEYMAP = [
    { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], squeak: ['KeyF', 'Space'], dash: ['KeyG', 'ShiftLeft'], special: ['KeyE', 'KeyQ'], jump: ['KeyR', 'KeyC'] },
    { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], squeak: ['Enter', 'Slash'], dash: ['ShiftRight', 'Period'], special: ['Quote', 'Comma'], jump: ['KeyM', 'ControlRight'] },
    { up: ['KeyI'], down: ['KeyK'], left: ['KeyJ'], right: ['KeyL'], squeak: ['KeyH'], dash: ['KeyU'], special: ['KeyY'], jump: ['KeyO'] },
    { up: ['Numpad8'], down: ['Numpad5'], left: ['Numpad4'], right: ['Numpad6'], squeak: ['Numpad0', 'NumpadEnter'], dash: ['NumpadAdd'], special: ['NumpadSubtract'], jump: ['NumpadDecimal', 'Numpad9'] },
  ];

  // ---- Arena -------------------------------------------------------------
  // Classic Morph: the classic caves morph in order; now and then the walls melt away into the wall-less Open Sky instead.
  // Xtreme: the four themed maps in XTREME_ORDER.
  let arena, arenaIndex = 0, lastCave = 0;
  // the themed caves (the lobby's 0-3), Open Sky, and the classic stone caves
  const arenaKinds = (open) => window.ECHO_ARENAS.map((a, i) => (!!a.open === open && !a.classic ? i : -1)).filter((i) => i >= 0);
  const classicKinds = () => window.ECHO_ARENAS.map((a, i) => (a.classic ? i : -1)).filter((i) => i >= 0);
  const arenaByName = (n) => window.ECHO_ARENAS.findIndex((a) => a.name === n);
  function nextArenaIndex() {
    if (arenaMode === 'xtreme') {
      const order = XTREME_ORDER.map(arenaByName).filter((i) => i >= 0);
      return order[(order.indexOf(arenaIndex) + 1) % order.length];
    }
    const caves = classicKinds(), skies = arenaKinds(true);
    if (!arena.def.open && skies.length && Math.random() < OPEN_SKY_CHANCE) return skies[Math.floor(Math.random() * skies.length)];
    return caves[(caves.indexOf(lastCave) + 1) % caves.length];
  }
  // Big battles (more than 4 bats) play on a bigger copy of each map: its own
  // 'big' layout when it has one, else a stretched copy where a few columns and
  // rows inside it are doubled (the copies get no spawn or crystal spots). The
  // same columns and rows for every map, so morphing still lines up.
  let bigArena = false;
  const bigMaps = new Map();
  function stretchMap(map) {
    const h = map.length, w = map[0].length;
    const pick = (n, add) => new Set(Array.from({ length: add }, (_, k) => Math.round(2 + ((k + 0.5) * (n - 4)) / add)));
    const cols = pick(w, BIG_COLS), rows = pick(h, BIG_ROWS), plain = (c) => (c === '#' || c === 'E' ? '#' : '.');
    const out = [];
    map.forEach((row, y) => {
      let r = '';
      [...row].forEach((c, x) => { r += c; if (cols.has(x)) r += plain(c); });
      out.push(r);
      if (rows.has(y)) out.push([...r].map(plain).join(''));
    });
    return out;
  }
  function mapRows(i) {
    const def = window.ECHO_ARENAS[i];
    if (!bigArena) return def.map;
    if (def.big) return def.big;
    if (!bigMaps.has(i)) bigMaps.set(i, stretchMap(def.map));
    return bigMaps.get(i);
  }

  // ---- Cave themes ---------------------------------------------------------
  // The look follows the cave: crystal, lava, ice, moss (or open sky, or the
  // classic stone). While Xtreme morphs, its colours blend from the old theme
  // into the new one as the walls change (themeK: 0 old .. 1 new); an icy cave
  // is slippery.
  let themeFrom = 0, themeTo = 0, themeK = 0, themeShow = 0, themeCache = null, themeKey = '';
  function setTheme(from, to, k) {
    if (from !== themeFrom || to !== themeTo) themeShow = k;
    themeFrom = from; themeTo = to; themeK = Math.max(0, Math.min(1, k));
  }
  const mixN = (a, b, k) => a + (b - a) * k;
  const mixA = (a, b, k) => a.map((v, j) => mixN(v, b[j], k));
  const rgbNums = (c) => (c[0] === '#' ? [1, 3, 5].map((j) => parseInt(c.slice(j, j + 2), 16)) : c.split(',').map(Number));
  const mixRgb = (a, b, k) => mixA(rgbNums(a), rgbNums(b), k).map(Math.round).join(', ');
  // the theme being shown right now (cached while it doesn't change)
  function TH() {
    const k = Math.round(themeShow * 40) / 40, key = themeFrom + ',' + themeTo + ',' + k;
    if (key === themeKey && themeCache) return themeCache;
    const A = window.ECHO_ARENAS[themeFrom].theme, B = window.ECHO_ARENAS[themeTo].theme, la = A.look, lb = B.look;
    themeKey = key;
    themeCache = {
      key, k, from: themeFrom, to: themeTo, title: (k < 0.5 ? A : B).title, style: (k < 0.5 ? A : B).style || 'stone',
      wall: mixRgb(A.wall, B.wall, k), fill: mixRgb(A.fill, B.fill, k), bg: `rgb(${mixRgb(A.bg, B.bg, k)})`,
      ambient: (k < 0.5 ? A : B).ambient, ambientRgb: mixRgb(A.ambientRgb, B.ambientRgb, k),
      look: la && lb ? {
        key, style: (k < 0.5 ? A : B).style || 'stone', stone: mixA(la.stone, lb.stone, k), floor: mixA(la.floor, lb.floor, k), bg: mixA(la.bg, lb.bg, k),
        accA: mixA(la.accA, lb.accA, k), accB: mixA(la.accB, lb.accB, k), mote: mixA(la.mote, lb.mote, k),
        hemi: [mixA(la.hemi[0], lb.hemi[0], k), mixA(la.hemi[1], lb.hemi[1], k)], lava: mixN(la.lava, lb.lava, k), ice: mixN(la.ice, lb.ice, k),
        vein: mixN(la.vein || 0, lb.vein || 0, k),
      } : null,
    };
    return themeCache;
  }
  // how icy the cave is right now (0..1): icy caves are slippery
  function iceNow() {
    const la = window.ECHO_ARENAS[themeFrom].theme.look, lb = window.ECHO_ARENAS[themeTo].theme.look;
    return la && lb ? mixN(la.ice, lb.ice, themeK) : 0;
  }
  // the map style in play now (by rules): the one being morphed into counts once it's half there
  const styleNow = () => (window.ECHO_ARENAS[themeK >= 0.5 ? themeTo : themeFrom].theme.style || 'stone');
  const mossy = () => styleNow() === 'moss';

  function loadArena(i) {
    const n = window.ECHO_ARENAS.length;
    arenaIndex = ((i % n) + n) % n;
    const def = window.ECHO_ARENAS[arenaIndex], rows = mapRows(arenaIndex);
    if (!def.open) lastCave = arenaIndex;
    setTheme(arenaIndex, arenaIndex, 0);
    const h = rows.length, w = rows[0].length;
    const a = { def, rows, theme: def.theme, w, h, grid: new Uint8Array(w * h), spawns: [], crystalSpots: [], open: [] };
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      a.grid[y * w + x] = c === '#' || c === 'E' ? 1 : 0;
      if (c !== '#' && c !== 'E') a.open.push({ x: x + 0.5, y: y + 0.5 });
      if ('ABCD'.includes(c)) a.spawns.push({ x: x + 0.5, y: y + 0.5, key: c });
      if (c === 'e') a.crystalSpots.push({ x: x + 0.5, y: y + 0.5 });
      if (c === 'E') a.crystalSpots.push({ x: x + 0.5, y: y + 0.5, top: 1 });
    }));
    a.spawns.sort((p, q) => p.key.localeCompare(q.key));
    arena = a;
    lit = new Float32Array(w * h);
    litBy = new Uint8Array(w * h);
    tileGlow = new Float32Array(w * h);
    crystals = a.crystalSpots.map((c) => ({ ...c, on: false, timer: 0.5 + Math.random() * 2.5, phase: Math.random() * 6 }));
    powerups = [];
    regrow = [];
    ambient = Array.from({ length: Math.round((46 * w * h) / 510) }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      v: 0.3 + Math.random() * 0.7, phase: Math.random() * 6, size: 0.04 + Math.random() * 0.06,
    }));
  }
  // grid: 0 open, 1 rock (a block, bush or crystal; bats can stand on top of it)
  const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= arena.w || ty >= arena.h || arena.grid[ty * arena.w + tx] !== 0;
  // a block a bat can stand on: rock that isn't the outer wall
  const blockAt = (x, y) => {
    const tx = Math.floor(x), ty = Math.floor(y);
    return tx > 0 && ty > 0 && tx < arena.w - 1 && ty < arena.h - 1 && arena.grid[ty * arena.w + tx] !== 0;
  };
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
  // Which open patch each tile belongs to (cave walls split them): label per tile (-1 for rock) and patch sizes
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
  // block tops to stand on (lava): tile centres of rock inside the border, the
  // roomiest first (more rock around them)
  function blockSpots() {
    const out = [];
    for (let ty = 1; ty < arena.h - 1; ty++) for (let tx = 1; tx < arena.w - 1; tx++) {
      if (!blockAt(tx + 0.5, ty + 0.5)) continue;
      let room = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (blockAt(tx + dx + 0.5, ty + dy + 0.5)) room++;
      out.push({ x: tx + 0.5, y: ty + 0.5, room, top: 1 });
    }
    return out;
  }
  // Starting spots: one safe open tile near each corner (top-left, top-right,
  // bottom-left, bottom-right), all in the cave's biggest open patch; with
  // more than 4 bats also one near the middle of each edge (top, bottom, left, right).
  // When the floor is lava they're block tops instead.
  function cornerSpots(n = 4) {
    const { w, h } = arena;
    let pool;
    if (lavaSafeOnly()) pool = blockSpots().filter((p) => p.room >= 4);
    else {
      const { label, sizes } = openRegions(), big = sizes.indexOf(Math.max(...sizes));
      pool = arena.open.filter((p) => label[Math.floor(p.y) * w + Math.floor(p.x)] === big && !hitsWall(p.x, p.y, R));
    }
    if (!pool.length) pool = arena.open;
    const used = new Set();
    const want = [[2.5, 2.5], [w - 2.5, 2.5], [2.5, h - 2.5], [w - 2.5, h - 2.5]];
    if (n > 4) want.push([w / 2, 3.5], [w / 2, h - 3.5], [2.5, h / 2], [w - 2.5, h / 2]);   // (top and bottom a row in, clear of the HUD)
    return want.map(([cx, cy]) => {
      let best = null, bd = Infinity;
      for (const p of pool) {
        const d = Math.hypot(p.x - cx, p.y - cy) - (p.room || 0) * 0.15;
        if (d < bd && !used.has(p)) { bd = d; best = p; }
      }
      best = best || pool[0];
      used.add(best);
      return best;
    });
  }
  const shuffle = (a) => { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; };
  // Each bat gets its own corner, picked at random; two bats get opposite
  // corners (a random diagonal), so they start as far apart as they can.
  // Big battles fill the four corners first, then the middles of the edges.
  function cornerStarts() {
    const n = bats.length, spots = cornerSpots(n);
    let order = shuffle([0, 1, 2, 3]);
    if (n === 2) order = [order[0], 3 - order[0]];
    if (n > 4) order = shuffle([...order, ...shuffle([4, 5, 6, 7]).slice(0, n - 4)]);
    return bats.map((b, k) => spots[order[k % order.length]]);
  }
  function updateAmbient(dt) {
    const kind = TH().ambient;
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
  let bats = [], rings = [], crystals = [], powerups = [], particles = [], popups = [], eats = [], ambient = [];
  let parries = [], parryCount = 0;                      // parry flashes being drawn: { x, y, ax, ay, rgb, t }
  // special powers in play: fireballs, twisters, thunder strikes (rules, host)
  // and the purely visual lightning bolts, ice blasts and shatters (everyone)
  let shots = [], twisters = [], thunders = [], bolts = [], novas = [], fxId = 0, specialCount = 0, jumpCount = 0;
  let shatters = [], shieldPops = [], sinks = [];
  // Lava: lavaOn while the floor burns; lavaWarn counts down the 3-2-1 before it
  // does (Xtreme); lavaVis is how much lava is drawn (eases in and out)
  let lavaOn = false, lavaWarn = 0, lavaVis = 0, koCount = 0;
  const lavaSafeOnly = () => lavaOn || lavaWarn > 0;
  // Mossy Den: chomped bushes waiting to grow back: { k (tile), t (seconds left) }
  let regrow = [], bushCount = 0;
  let misses = [], missCount = 0;                       // bites that snapped on empty air under a jumping bat
  // The controls guide before a match (kind 'match') and, in Rounds, before
  // each next round (kind 'round'): play waits until this device's player (or
  // the host online) taps Start. Tests can turn it off (skipGuide).
  let guide = null, noGuide = false;
  let lit, litBy, gridSent = 0;
  let clock = 0, countdown = 0, over = false, banner = null, morph = null, tileGlow = null;
  let slowmo = 0, shake = 0, powerTimer = 6, firstPower = true, snapTimer = 0, outbox = [], ringId = 0, ended = false;
  const remoteInput = new Map();         // slot -> { ix, iy }

  function makeBat(i, ctrl, localSlot) {
    return {
      i, ...BATS[i], ctrl, local: localSlot, x: 0, y: 0, vx: 0, vy: 0, face: 1,
      echoes: START_ECHOES, cooldown: 0, stun: 0, safe: 0, dead: 0, score: 0, seen: 0, mouth: 0, puff: 0,
      dashCd: 0, dashT: 0, power: null, powerT: 0, mega: false, shield: false,
      parryT: 0, parryCd: 0, parryRing: null, hitBy: null, biteT: 0, dashSeq: 0, out: false,
      held: null, heldLeft: 0, specialCd: 0, ghostT: 0, ice: 0, burn: 0, revealT: 0, look: null, jumpT: 0, jumpCd: 0, jumps: JUMP_CHARGES, jumpQ: false,
      top: 0, hv: 0, lavaT: 0, lastHit: null,
      ai: ctrl === 'cpu' ? { path: [], repath: 0, think: Math.random() * 0.3, wander: null } : null,
    };
  }

  // o: { mode, humans, cpus, remotes, mySlot, total, net, onEnd, ... }
  // Up to MAX_BATS (8) bats in all; at most MAX_LOCAL (4) people on one device.
  // A host's bats are: itself (slot 0), then o.remotes guests, then o.cpus CPUs.
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
    // o.powerups: { on: { fire: false, ... }, freq: 'off' | 'low' | 'normal' | 'high' | 'max' }
    // (power ids no longer in the game, like the old 'wall', are just ignored)
    const pu = o.powerups || {};
    powerOn = POWER_TYPES.filter((t) => !pu.on || pu.on[t] !== false);
    powerFreq = Object.prototype.hasOwnProperty.call(POWER_FREQ, pu.freq) ? POWER_FREQ[pu.freq] : POWER_FREQ.normal;
    bats = [];
    if (mode === 'local') {
      localCount = Math.max(1, Math.min(MAX_LOCAL, o.humans || 1));
      let cpus = Math.max(0, Math.min(MAX_BATS - localCount, o.cpus ?? 1));
      if (localCount + cpus < 2) cpus = 1;
      for (let i = 0; i < localCount; i++) bats.push(makeBat(i, 'local', i));
      for (let k = 0; k < cpus; k++) bats.push(makeBat(bats.length, 'cpu'));
      viewer = -1;
    } else if (mode === 'host') {
      localCount = 1;
      bats.push(makeBat(0, 'local', 0));
      for (let k = 0; k < (o.remotes || 0) && bats.length < MAX_BATS; k++) bats.push(makeBat(bats.length, 'remote'));
      for (let k = 0; k < (o.cpus || 0) && bats.length < MAX_BATS; k++) bats.push(makeBat(bats.length, 'cpu'));
      viewer = 0;
    } else {
      localCount = 1;
      viewer = o.mySlot;
      for (let i = 0; i < Math.min(MAX_BATS, o.total || 2); i++) bats.push(makeBat(i, i === o.mySlot ? 'local' : 'remote', 0));
    }
    // more than 4 bats: a bigger arena (guests know from o.total)
    bigArena = bats.length > 4;
    // o.arena picks the cave for 'still' (0-3: Crystal Grotto, Lava Hollow, Mossy Den,
    // Frozen Cavern; else a random one). Classic 'morph' starts in a classic stone
    // cave (o.arena picks which), Xtreme always in Crystal Grotto. Guests load
    // whatever the host's snapshots say.
    const caves = arenaKinds(false), classic = classicKinds(), want = o.arena == null || o.arena === '' ? NaN : Math.floor(+o.arena);
    const cave = want >= 0 ? caves[want % caves.length] : mode === 'client' ? caves[0] : caves[Math.floor(Math.random() * caves.length)];
    lavaOn = false; lavaWarn = 0; lavaVis = 0; regrow = [];
    loadArena(arenaMode === 'sky' ? arenaKinds(true)[0]
      : arenaMode === 'morph' ? classic[want >= 0 ? want % classic.length : mode === 'client' ? 0 : Math.floor(Math.random() * classic.length)]
        : arenaMode === 'xtreme' ? arenaByName(XTREME_ORDER[0]) : cave);
    // a still Lava Hollow burns from the start (everyone starts on a block)
    if (styleNow() === 'lava' && arenaMode === 'still') { lavaOn = true; lavaVis = 1; }
    morph = (arenaMode === 'morph' || arenaMode === 'xtreme') && mode !== 'client'
      ? { target: -1, timer: 0, pause: arenaMode === 'xtreme' ? XTREME_HOLD : MORPH_PAUSE, x: arenaMode === 'xtreme' } : null;
    // everyone starts in a different corner (guests take theirs from the host's snapshots)
    const starts = cornerStarts();
    bats.forEach((b, k) => {
      const s = starts[k] || arena.open[k % arena.open.length];
      b.x = s.x; b.y = s.y; b.face = s.x < arena.w / 2 ? 1 : -1; b.top = s.top ? 1 : 0; b.hv = b.top;
    });
    gridSent = 0;
    // bat looks (see looks.js): the lobby's pick for each slot, else a preset for
    // people and a random one for CPUs. Guests get the host's from snapshots.
    const seed = Number.isFinite(+(o.seed ?? o.cpuSeed)) ? +(o.seed ?? o.cpuSeed) : Math.floor(Math.random() * 1e6);
    bats.forEach((b) => { b.look = lookFor(b, o.looks?.[b.i], seed); b.lv = CPU_LEVELS[o.levels?.[b.i]] || null; });
    looksSent = 0;
    rings = []; particles = []; popups = []; eats = []; outbox = []; parries = []; misses = [];
    shots = []; twisters = []; thunders = []; bolts = []; novas = []; shatters = []; shieldPops = []; sinks = [];
    remoteInput.clear();
    guide = noGuide || window.__echoNoGuide ? null : { kind: 'match', t: 0 };
    clock = 0; countdown = 3; over = false; ended = false; slowmo = 0; shake = 0;
    round = 1; roundClock = 0; roundEnd = null; storm = false; stormWarned = false; matchWinner = null; watchI = -1;
    powerTimer = powerWait('first'); firstPower = true; snapTimer = 0;
    banner = mode === 'client' ? null : { text: arenaMode === 'xtreme' ? 'Morphing Xtreme' : arena.def.name, rgb: arena.theme.wall, t: 3.2 };
    // a big battle gets its own banner as the countdown ends (guests too)
    if (bigArena) banner = { text: `${bats.length}-BAT BRAWL!`, rgb: '255, 226, 120', t: 5.2, big: true };
    keys.clear();
    sticks.clear();
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
    } else if (ev.k === 'miss') {
      // a bite on a jumping bat: the jaws snap on empty air under it
      const a = bats[ev.a];
      if (a) misses.push({ eater: a, food: ev.f, x: ev.x, y: ev.y, ang: ev.ang, t: 0 });
      for (const k of [-1, 1]) particles.push({ x: ev.x, y: ev.y, vx: k * 2.4, vy: -1.2, life: 0.45, rgb: '232, 236, 255', size: 4 });
    } else if (ev.k === 'spop') shieldPops.push({ i: ev.i, x: ev.x, y: ev.y, t: 0 });
    else if (ev.k === 'shatter') {
      // a frozen bat breaks free: shards of ice fly off
      shatters.push({ x: ev.x, y: ev.y, t: 0, top: ev.top || 0 });
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2 + Math.random() * 0.3, v = 2.5 + Math.random() * 3.5;
        particles.push({ x: ev.x, y: ev.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, life: 0.45 + Math.random() * 0.35, rgb: k % 3 ? '200, 240, 255' : '255, 255, 255', size: 3 + Math.random() * 3, shard: true });
      }
      (s.shatter || s.crystal)?.();
    } else if (ev.k === 'sink') {
      // into the lava: the bat sinks with a splash of embers
      const b = bats[ev.i];
      sinks.push({ i: ev.i, x: ev.x, y: ev.y, t: 0, look: b ? { ...b } : null });
      burst(ev.x, ev.y, '255, 140, 50', 20, 4, 5); burst(ev.x, ev.y, '255, 230, 140', 10, 2.5, 3);
    } else if (ev.k === 'leaves') {
      // a bush chomped through (or growing back): a puff of leaves
      for (let k = 0; k < (ev.grow ? 6 : 14); k++) {
        const a = Math.random() * Math.PI * 2, v = (ev.grow ? 0.8 : 2) + Math.random() * 2.5;
        particles.push({ x: ev.x + (Math.random() - 0.5) * 0.6, y: ev.y + (Math.random() - 0.5) * 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.5,
          rgb: ['120, 230, 100', '170, 255, 120', '80, 190, 90'][k % 3], size: 5 + Math.random() * 3, leaf: true, spin: Math.random() * 6 });
      }
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
    // the controls guide: Enter (or any squeak key) starts
    if (guide) {
      if (canStartGuide() && (e.code === 'Enter' || e.code === 'NumpadEnter' || [...Array(localCount).keys()].some((s) => keysFor(s, 'squeak').includes(e.code)))) startFromGuide();
      return;
    }
    if (spectating() && (e.code === 'Enter' || e.code === 'Tab' || [...Array(localCount).keys()].some((s) => keysFor(s, 'squeak').includes(e.code)))) {
      if (e.code === 'Tab') e.preventDefault();
      watchNext();
      return;
    }
    for (let slot = 0; slot < localCount; slot++) {
      if (keysFor(slot, 'squeak').includes(e.code)) act(slot, 'squeak');
      if (keysFor(slot, 'dash').includes(e.code)) act(slot, 'dash');
      if (keysFor(slot, 'special').includes(e.code)) act(slot, 'special');
      if (keysFor(slot, 'jump').includes(e.code)) act(slot, 'jump');
    }
  });
  addEventListener('keyup', (e) => { keys.delete(e.code); });
  addEventListener('blur', () => { keys.clear(); sticks.clear(); });

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
  // JUMP: a smaller button to the left of BITE·DASH, a little lower (thumb arc)
  const jumpButton = () => { const b = dashButton(), r = 29; return { x: b.x - b.r - 16 - r, y: b.y + 22, r }; };
  const inJumpButton = (cx, cy) => {
    if (localCount !== 1) return false;
    const rect = canvas.getBoundingClientRect(), b = jumpButton();
    return Math.hypot(cx - rect.left - b.x, cy - rect.top - b.y) < b.r + 7;
  };
  const buttonsShown = () => localCount === 1 && countdown <= 0 && !guide && !spectating();
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
    // the controls guide swallows taps; only its Start button does anything
    if (guide) {
      guideTap(e.clientX, e.clientY);
      return;
    }
    // out of the round: a tap watches someone else
    if (spectating() && localCount === 1) { watchNext(); return; }
    if (specialShown() && inPowerButton(e.clientX, e.clientY)) { act(0, 'special'); return; }
    if (biteShown() && inDashButton(e.clientX, e.clientY)) { act(0, 'dash'); return; }
    if (biteShown() && inJumpButton(e.clientX, e.clientY)) { act(0, 'jump'); return; }
    const owner = zoneAt(e.clientX, e.clientY);
    // a second finger while you're already steering: squeak
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
    // (older guests still send 'charge' when the squeak key goes down and 'release' when it comes up:
    // the sonic beam is gone, so 'charge' is just a squeak and 'release' does nothing)
    if (a === 'charge') a = 'squeak';
    // a squeak press (a tap, or squeak key / second finger going down) is also a parry attempt
    if (a === 'squeak' && parryPress(b) === 'late') return;
    if (a === 'squeak') tracked(b, () => squeak(b));
    else if (a === 'dash') dash(b, dx, dy);
    else if (a === 'special') useSpecial(b, dx, dy);
    else if (a === 'jump') jump(b);
  }

  // ---- Online hooks (host side) -----------------------------------------
  function remote(slot, msg) {
    const b = bats[slot];
    if (!b || b.ctrl !== 'remote' || mode !== 'host') return;
    if (msg.t === 'in') remoteInput.set(slot, { ix: +msg.ix || 0, iy: +msg.iy || 0 });
    else if (msg.t === 'act' && ['squeak', 'charge', 'release', 'dash', 'special', 'jump'].includes(msg.a)) doAct(b, msg.a, +msg.dx || 0, +msg.dy || 0);
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
    easy: { speed: 0.72, think: 0.65, squeak: 0.22, aimErr: 0, dash: 0.25, sense: 1.6, memory: 1.5, search: 0.08, power: 3, parry: 0, special: 0.3, waste: 0.05, jump: 0.12 },
    normal: { speed: 0.86, think: 0.42, squeak: 0.35, aimErr: 0.16, dash: 0.5, sense: 2.2, memory: 3, search: 0.15, power: 5, parry: 0.3, special: 0.55, waste: 0, jump: 0.3 },
    hard: { speed: 1, think: 0.26, squeak: 0.5, aimErr: 0.06, dash: 0.75, sense: 2.8, memory: 4.5, search: 0.25, power: 7, parry: 0.55, special: 0.85, waste: 0, jump: 0.5 },
  };
  // cpuLevel is the level of the CPU being thought for (o.levels can set one per seat)
  let cpuLevel = CPU_LEVELS.normal, baseLevel = CPU_LEVELS.normal;
  function randomOpenSpot() {
    const spots = lavaSafeOnly() ? blockSpots() : arena.open.filter((p) => !solid(Math.floor(p.x), Math.floor(p.y)));
    return spots[Math.floor(Math.random() * spots.length)];
  }
  // Lava: a path over the block tops, walking from block to block or hopping a
  // gap (up to 2 tiles); steps that need a jump are marked hop
  function topPath(fromX, fromY, toX, toY) {
    const { w, h } = arena, sx = Math.floor(fromX), sy = Math.floor(fromY);
    let gx = Math.floor(toX), gy = Math.floor(toY);
    if (!blockAt(sx + 0.5, sy + 0.5)) return [];
    if (!blockAt(gx + 0.5, gy + 0.5)) {
      // aim for the block top nearest the goal
      let bd = Infinity;
      for (const p of blockSpots()) { const d = Math.hypot(p.x - toX, p.y - toY); if (d < bd) { bd = d; gx = Math.floor(p.x); gy = Math.floor(p.y); } }
    }
    const prev = new Int32Array(w * h).fill(-1), hop = new Uint8Array(w * h), q = [sy * w + sx];
    prev[q[0]] = q[0];
    const steps = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const d of [2, 3]) steps.push([dx * d, dy * d, 1]);
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) steps.push([dx * 2, dy * 2, 1]);
    for (let k = 0; k < q.length; k++) {
      const c = q[k], cx = c % w, cy = (c / w) | 0;
      if (cx === gx && cy === gy) break;
      for (const [dx, dy, jump] of steps) {
        const nx = cx + dx, ny = cy + dy, n = ny * w + nx;
        if (!blockAt(nx + 0.5, ny + 0.5) || prev[n] >= 0) continue;
        prev[n] = c; hop[n] = jump; q.push(n);
      }
    }
    const goal = gy * w + gx;
    if (prev[goal] < 0) return [];
    const path = [];
    for (let c = goal; c !== prev[c]; c = prev[c]) path.push({ x: (c % w) + 0.5, y: ((c / w) | 0) + 0.5, hop: !!hop[c] });
    return path.reverse();
  }
  // the nearest block top (to climb onto when the floor is about to burn)
  function nearestBlock(b) {
    let best = null, bd = Infinity;
    for (const p of blockSpots()) { const d = Math.hypot(p.x - b.x, p.y - b.y) - p.room * 0.08; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function cpuInput(b, dt) {
    const ai = b.ai, lv = cpuLevel;
    ai.known = ai.known || new Map();
    const foes = bats.filter((o) => o !== b && !o.dead);
    if (!foes.length) return { ix: 0, iy: 0 };
    // what this bat can perceive right now
    for (const o of foes) {
      const noticed = o.stun > 0 || o.seen > 0.25 || litAt(o.x, o.y) > 0.35 || dist(o, b) < lv.sense;
      if (noticed) ai.known.set(o.i, { x: o.x, y: o.y, vx: o.vx, vy: o.vy, age: 0, bat: o, top: o.top });
    }
    cpuParry(b, foes);
    cpuDodge(b);
    for (const [i, k] of ai.known) {
      k.age += dt;
      if (k.age > lv.memory || k.bat.dead) ai.known.delete(i);
    }
    const known = [...ai.known.values()].sort((p, q) => dist(p, b) - dist(q, b));
    const fresh = known.filter((k) => k.age < 0.4);
    const snack = foes.find((o) => o.stun > 0 && dist(o, b) < 9);
    let target = snack && (snack.top === b.top || !lavaSafeOnly()) ? snack : null;
    if (!target) target = powerups.filter((p) => (!lavaSafeOnly() || p.top) && dist(p, b) < lv.power && litAt(p.x, p.y) + (dist(p, b) < 2.5 ? 1 : 0) > 0.2).sort((p, q) => dist(p, b) - dist(q, b))[0];
    if (!target && b.echoes === 0) target = crystals.filter((c) => c.on).sort((p, q) => dist(p, b) - dist(q, b))[0];
    if (!target && known.length) {
      // head for where a rival was last noticed, circling a little
      if (!ai.wander || Math.random() < dt * 0.4) ai.wander = { dx: (Math.random() - 0.5) * 4, dy: (Math.random() - 0.5) * 3 };
      const k = known[0];
      target = { x: k.x + ai.wander.dx * Math.min(1, k.age), y: k.y + ai.wander.dy * Math.min(1, k.age) };
      if (solid(Math.floor(target.x), Math.floor(target.y)) !== !!k.top) target = k;
    }
    if (!target) {
      // nobody noticed: roam the cave
      if (!ai.roam || dist(ai.roam, b) < 1 || Math.random() < dt * 0.25) ai.roam = randomOpenSpot() || { x: b.x, y: b.y };
      target = ai.roam;
    }
    // the floor is lava (or about to be): a bat down there makes for the nearest block and hops up
    const lava = lavaSafeOnly();
    if (lava && !b.top && b.jumpT <= 0 && b.ghostT <= 0) {
      const blk = nearestBlock(b);
      if (blk) {
        target = blk;
        if (dist(blk, b) < 1.6 && jump(b)) ai.hopTo = { x: blk.x, y: blk.y };
      }
    }
    ai.repath -= dt;
    // (mid-hop over lava: keep flying at the block it aimed for)
    if (lava && b.jumpT > 0 && ai.hopTo) { target = ai.hopTo; ai.repath = Math.max(ai.repath, 0.01); }
    else if (b.jumpT <= 0) ai.hopTo = null;
    if (ai.repath <= 0) {
      // up on the blocks: over the lava by block-top paths; elsewhere straight at it (walk off the edge to get down)
      ai.path = b.top ? (lava ? topPath(b.x, b.y, target.x, target.y) : []) : bfsPath(b.x, b.y, target.x, target.y);
      ai.repath = 0.25;
    }
    while (ai.path.length && Math.hypot(ai.path[0].x - b.x, ai.path[0].y - b.y) < 0.35) ai.path.shift();
    // a hop to the next block: jump once lined up at the edge
    if (b.top && lava && ai.path[0]?.hop && b.jumpT <= 0) {
      const h = ai.path[0], d = Math.hypot(h.x - b.x, h.y - b.y);
      if (d < 3.2 && !blockAt(b.x + (h.x - b.x) / d * 0.55, b.y + (h.y - b.y) / d * 0.55) && jump(b)) ai.hopTo = { x: h.x, y: h.y };
    }
    // a ground bat that wants a rival up on a block: hop up next to it
    if (!b.top && !lava && target.top && b.jumpT <= 0 && dist(target, b) < 2.6 && Math.random() < dt * 3) jump(b);
    // a ghost flies straight at its target, through the rock (and so does a bat hopping a wall)
    const next = lava && b.jumpT > 0 && ai.hopTo ? ai.hopTo : (b.ghostT > 0.4 || (b.jumpT > 0 && !lava) ? null : ai.path[0]) || target;
    const dx = next.x - b.x, dy = next.y - b.y, len = Math.hypot(dx, dy) || 1;

    ai.think -= dt;
    if (ai.think <= 0) {
      ai.think = lv.think * (0.8 + Math.random() * 0.4);
      const canShoot = b.echoes > 0 || b.power === 'frenzy';
      const shootable = fresh.some((k) => k.bat.safe <= 0 && k.bat.stun <= 0 && dist(k, b) < RING_MAX * 0.7);
      if (shootable && canShoot && Math.random() < lv.squeak) squeak(b);
      // lost everyone: sometimes squeak just to look around
      else if (!known.length && b.echoes > 2 && Math.random() < lv.search) squeak(b);
      // the bite is a dash: lunge at a stunned rival in reach, or (less often) at one it can perceive close by
      if (b.dashCd <= 0) {
        // (only a rival on its own level: a bite can't reach up onto a block or down off one)
        const prey = snack && snack.top === b.top && dist(snack, b) < 2.6 ? snack
          : fresh.map((k) => k.bat).find((o) => o.safe <= 0 && o.top === b.top && dist(o, b) < 2.2);
        if (prey && Math.random() < (prey.stun > 0 ? lv.dash : lv.dash * 0.6)) {
          const k = prey.stun > 0 ? prey : ai.known.get(prey.i) || prey;
          const ax = k.x + (k.vx || 0) * 0.1 - b.x, ay = k.y + (k.vy || 0) * 0.1 - b.y, d = Math.hypot(ax, ay) || 1;
          const err = (Math.random() - 0.5) * 2 * lv.aimErr, c = Math.cos(err), sn = Math.sin(err);
          if (b.top || castRay(b.x, b.y, ax / d, ay / d, d) >= d - 0.4) dash(b, (ax * c - ay * sn) / d, (ax * sn + ay * c) / d);
        }
      }
      if (b.held && b.specialCd <= 0) cpuSpecial(b, fresh, known, target);
      cpuHop(b, target);
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
      case 'ghost': {
        // the way to its target winds around rock: go straight through instead
        const goal = target && dist(target, b);
        if ((goal > 2.5 && b.ai.path.length > goal * 1.6 + 2) || (b.heldT > 10 && known.length)) useSpecial(b);
        break;
      }
    }
  }

  // CPUs jump now and then to let an echo ring or a fireball pass underneath,
  // or to hop over a rival dashing in for a bite (even when stunned: a dash
  // is loud). Each one gets one chance per ring, fireball or dash, better
  // CPUs more often. A stunned CPU only watches for bites (rings and
  // fireballs don't stun it again anyway).
  function cpuDodge(b) {
    const lv = cpuLevel, ai = b.ai;
    if (!lv.jump || b.jumpT > 0 || b.jumpCd > 0 || b.jumps < 1 || b.parryT > 0 || b.dashT > 0) return;
    // over lava, only a hop that comes down on a block
    if (lavaSafeOnly() && !blockAt(b.x + b.vx * JUMP_TIME * 0.8, b.y + b.vy * JUMP_TIME * 0.8)) return;
    ai.dodged = ai.dodged || new Set();
    if (ai.dodged.size > 60) ai.dodged.clear();
    for (const o of bats) {
      if (o === b || o.dead || o.biteT <= 0 || o.stun > 0 || airborne(o) || ai.dodged.has('d' + o.i + ':' + o.dashSeq)) continue;
      const d = dist(o, b), closing = ((o.vx - b.vx) * (b.x - o.x) + (o.vy - b.vy) * (b.y - o.y)) / (d || 1);
      if (closing <= 1 || (d - BITE_REACH) / closing > 0.18) continue;
      ai.dodged.add('d' + o.i + ':' + o.dashSeq);
      if (Math.random() < lv.jump * 0.6) { jump(b); return; }
    }
    if (b.stun > 0) return;
    for (const g of rings) {
      if (g.owner === b.i || g.hit.has(b.i) || ai.dodged.has('r' + g.id)) continue;
      const d = dist(g, b), tti = (d - R - g.r) / RING_SPEED;
      if (d > g.max + R || tti > 0.16 || tti < 0) continue;
      ai.dodged.add('r' + g.id);
      if (Math.random() < lv.jump) { jump(b); return; }
    }
    for (const m of shots) {
      if (m.owner === b.i || ai.dodged.has('f' + m.id)) continue;
      const rx = b.x - m.x, ry = b.y - m.y, sp = Math.hypot(m.vx, m.vy) || 1, along = (rx * m.vx + ry * m.vy) / sp;
      if (along < 0 || along / sp > 0.25 || Math.abs(rx * m.vy - ry * m.vx) / sp > R + FIRE_R + 0.15) continue;
      ai.dodged.add('f' + m.id);
      if (Math.random() < lv.jump * 1.3) { jump(b); return; }
    }
  }
  // ...and to hop a thin wall when the way round it is long: the wall must be
  // right ahead, with open cave again within a jump's reach
  function cpuHop(b, target) {
    const lv = cpuLevel, ai = b.ai;
    if (!lv.jump || !target || b.jumpT > 0 || b.jumpCd > 0 || b.jumps < 1 || b.ghostT > 0 || b.top || lavaSafeOnly()) return;
    const dx = target.x - b.x, dy = target.y - b.y, d = Math.hypot(dx, dy);
    if (d < 2.2 || d > 8 || ai.path.length < d * 1.6 + 2) return;
    const ux = dx / d, uy = dy / d, free = castRay(b.x, b.y, ux, uy, d);
    if (free > 0.9) return;
    for (let t = free + 0.4; t < Math.min(d, 2.6); t += 0.2) {
      if (hitsWall(b.x + ux * t, b.y + uy * t, R)) continue;
      if (Math.random() < lv.jump) jump(b);
      return;
    }
  }

  // ---- Echo parry ----------------------------------------------------------
  // A squeak press opens a short parry window (unless the last one was too
  // recent). Returns true if a window opened, 'late' if the press parried a
  // hit that had just landed, false otherwise.
  function parryPress(b) {
    if (!inPlay() || !b || b.dead || b.parryCd > 0) return false;
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
        hitFrom(attacker, b.i);
        if (attacker.shield) shieldBlock(attacker);
        else {
          attacker.stun = PARRY_STUN;
          attacker.dashT = 0;
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
  // perceive: a squeak ring they hear coming, or a rival they know is there
  // dashing at them.
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
    if (go && parryPress(b) === true) tracked(b, () => squeak(b));
  }

  // two bats dashing into each other bounce apart, and nobody gets a bite
  function clash(a, b, ux, uy) {
    for (const [o, s] of [[a, -1], [b, 1]]) { o.biteT = 0; o.dashT = 0; o.vx = ux * s * 6; o.vy = uy * s * 6; o.seen = 1; }
    hitFrom(a, b.i); hitFrom(b, a.i);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    fx({ k: 'burst', x: mx, y: my, rgb: '255, 255, 255', n: 16, sp: 4 });
    fx({ k: 'popup', x: mx, y: my - 1, text: 'CLASH!', rgb: '232, 236, 255', big: true, life: 0.8 });
    fx({ k: 'sfx', n: 'block' });
    fx({ k: 'shake', v: 0.18 });
  }

  // ---- Actions -----------------------------------------------------------
  const inPlay = () => active && countdown <= 0 && !guide && !over && !roundEnd;
  const canAct = (b) => inPlay() && b && !b.dead && b.stun <= 0;

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
  function dash(b, dx, dy) {
    if (!canAct(b) || b.dashCd > 0 || airborne(b)) return;
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

  // Jump: up over walls and echoes for JUMP_TIME seconds (see JUMP_TIME)
  const airborne = (b) => b.jumpT > 0;
  // 0 on the ground, up to 1 at the top of a jump
  const jumpH = (b) => (b && b.jumpT > 0 ? Math.sin(Math.PI * Math.min(1, 1 - b.jumpT / JUMP_TIME)) : 0);
  // (stunned bats can jump too; they just hang still while they do)
  function jump(b) {
    if (!inPlay() || !b || b.dead) return false;
    if (b.jumpT > 0 || b.jumpCd > 0 || b.jumps < 1) {
      // pressed just before landing: hop again as soon as it can
      if (b.jumps >= 1 && b.jumpCd > 0 && b.jumpCd <= JUMP_GAP + JUMP_BUFFER) b.jumpQ = true;
      return false;
    }
    b.jumpQ = false;
    b.jumps = Math.max(0, b.jumps - 1);
    b.jumpT = JUMP_TIME; b.jumpCd = JUMP_TIME + JUMP_GAP;
    jumpCount++;
    b.seen = Math.max(b.seen, 0.35);
    fx({ k: 'burst', x: r2(b.x), y: r2(b.y + 0.2), rgb: TH().wall, n: 8, sp: 2, sz: 3 });
    fx({ k: 'sfx', n: 'jump', alt: 'charged' });
    return true;
  }
  // ---- Levels: the floor and the block tops ---------------------------------
  // A bat that lands on a block (rock inside the outer wall) stays up there
  // (b.top): it flies around over the connected block tops, ignoring the walls
  // below, until it flies off the edge and drops to the floor (or jumps).
  // Ground bats are blocked by walls as ever. Bites only reach a rival on the
  // same level (a bat dashing off a block drops mid-dash, so it can pounce on
  // one below); squeaks, thunder, ice and wind reach both levels. Over lava,
  // a block's edge holds you back unless you're knocked off it (stunned).
  const lvl = (b) => (b.top ? 1 : 0);
  // eases a bat out of rock it half-overlaps (a short way, never across the cave)
  function easeOut(b) {
    if (!hitsWall(b.x, b.y, R)) return;
    for (let r = 0.05; r <= 1.2; r += 0.05) {
      let best = null;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, x = b.x + Math.cos(a) * r, y = b.y + Math.sin(a) * r;
        if (!hitsWall(x, y, R)) { best = { x, y }; break; }
      }
      if (best) { b.x = best.x; b.y = best.y; return; }
    }
    // (deep in rock: the nearest gap, as a last resort)
    const spot = arena.open.filter((p) => !hitsWall(p.x, p.y, R)).sort((p, q) => dist(p, b) - dist(q, b))[0];
    if (spot) { b.x = spot.x; b.y = spot.y; b.vx *= 0.3; b.vy *= 0.3; }
  }
  // where a bat ends up when it comes down (a landing, or a ghost turning solid again)
  function settle(b) {
    // over lava, coming down with any part of you on a block is enough: you're nudged onto it
    if (lavaSafeOnly() && !blockAt(b.x, b.y) && b.ghostT <= 0) {
      let best = null, bd = R + 0.2;
      for (let ty = Math.floor(b.y - 1); ty <= Math.floor(b.y + 1); ty++) for (let tx = Math.floor(b.x - 1); tx <= Math.floor(b.x + 1); tx++) {
        if (!blockAt(tx + 0.5, ty + 0.5)) continue;
        const nx = Math.max(tx + 0.08, Math.min(b.x, tx + 0.92)), ny = Math.max(ty + 0.08, Math.min(b.y, ty + 0.92)), d = Math.hypot(nx - b.x, ny - b.y);
        if (d < bd) { bd = d; best = { x: nx, y: ny }; }
      }
      if (best) { b.x = best.x; b.y = best.y; }
    }
    if (blockAt(b.x, b.y)) b.top = 1;
    else { b.top = 0; easeOut(b); }
  }
  // flew off the edge of the block tops: down to the floor
  function drop(b) {
    b.top = 0;
    easeOut(b);
    if (!lavaSafeOnly()) fx({ k: 'burst', x: r2(b.x), y: r2(b.y + 0.25), rgb: TH().wall, n: 4, sp: 1.2, sz: 3 });
  }
  // touching down: on a block it stays up top; half on rock it's eased off it
  function land(b) {
    b.jumpT = 0;
    settle(b);
    fx({ k: 'burst', x: r2(b.x), y: r2(b.y + 0.25), rgb: TH().wall, n: 6, sp: 1.6, sz: 3 });
    fx({ k: 'sfx', n: 'land', alt: 'thud' });
  }
  // remember who last knocked a bat about (a lava knockout's point goes to them)
  const hitFrom = (foe, by) => { if (by >= 0 && by !== foe.i) foe.lastHit = { by, t: clock }; };

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
    hitFrom(foe, by);
    if (foe.shield) { shieldBlock(foe); return false; }
    if (parryFrom) noteHit(foe, by, parryFrom.x, parryFrom.y, foe.vx, foe.vy);
    foe.stun = Math.max(foe.stun, t);
    foe.dashT = 0; foe.biteT = 0;
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
    if (TIMED_CD[type]) {
      // a timed power: the first use starts its clock, then it keeps working until that runs out
      if (!(b.heldLeft > 0)) b.heldLeft = TIMED_LIFE;
      b.specialCd = (b.ctrl === 'cpu' ? CPU_TIMED_CD : TIMED_CD)[type];
    } else { b.held = null; b.heldLeft = 0; b.specialCd = SPECIAL_CD; }
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

  // A shield soaks up a hit: the bubble flashes and pops (everyone sees it)
  function shieldBlock(b) {
    b.shield = false;
    fx({ k: 'spop', i: b.i, x: r2(b.x), y: r2(b.y) });
    fx({ k: 'popup', x: b.x, y: b.y - 1, text: 'BLOCKED', rgb: POWERS.shield.rgb, life: 0.8 });
    fx({ k: 'sfx', n: 'block' });
  }

  // Fire: a fireball flies straight on, lighting the cave, and bursts on the
  // first wall or bat it meets. A hit stuns and knocks back (bite them next!);
  // the burst singes anyone close. A parry knocks it back at whoever threw it.
  function shootFire(b, ux, uy) {
    const mine = shots.filter((m) => m.owner === b.i);
    if (mine.length >= MAX_SHOTS_EACH) shots.splice(shots.indexOf(mine[0]), 1);
    // (thrown from up on a block it flies over the rock, and can hit anyone below too)
    shots.push({ id: ++fxId, x: b.x + ux * 0.35, y: b.y + uy * 0.35, vx: ux * FIRE_SPEED, vy: uy * FIRE_SPEED, owner: b.i, t: 0, top: b.top ? 1 : 0 });
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
        if (s.top ? inBorder(nx, ny) : solid(Math.floor(nx), Math.floor(ny))) { explode(s, null); break; }
        s.x = nx; s.y = ny;
        for (const foe of bats) {
          if (foe.i === s.owner || foe.dead || foe.safe > 0 || airborne(foe) || (foe.top && !s.top) || Math.hypot(foe.x - s.x, foe.y - s.y) > R + FIRE_R) continue;
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
      if (foe === hit || foe.i === s.owner || foe.dead || foe.safe > 0 || foe.stun > 0 || airborne(foe) || (foe.top && !s.top)) continue;
      const d = Math.hypot(foe.x - s.x, foe.y - s.y);
      if (d > FIRE_SPLASH + R || (!s.top && castRay(s.x, s.y, (foe.x - s.x) / (d || 1), (foe.y - s.y) / (d || 1), d) < d - 0.3)) continue;
      if (powerStun(foe, s.owner, SPLASH_STUN, ((foe.x - s.x) / (d || 1)) * 4, ((foe.y - s.y) / (d || 1)) * 4, 'SCORCHED!', POWERS.fire.rgb, s)) foe.burn = 1;
    }
  }
  function deflect(s, foe) {
    const atk = bats[s.owner];
    let ux = -s.vx, uy = -s.vy;
    if (atk && !atk.dead) { ux = atk.x - s.x; uy = atk.y - s.y; }
    const l = Math.hypot(ux, uy) || 1;
    s.vx = (ux / l) * FIRE_SPEED * 1.15; s.vy = (uy / l) * FIRE_SPEED * 1.15;
    s.owner = foe.i; s.t = 0; s.top = foe.top ? 1 : 0;
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
  // block of ice (stunned, can't drift). Like a squeak, it can be parried.
  function freezeBlast(b) {
    b.seen = 1;
    fx({ k: 'nova', x: r2(b.x), y: r2(b.y), o: b.i });
    fx({ k: 'sfx', n: 'freeze', alt: 'crystal' });
    fx({ k: 'shake', v: 0.12 });
    for (const foe of bats) {
      if (foe === b || foe.dead || foe.safe > 0 || airborne(foe)) continue;
      const d = dist(foe, b);
      if (d > FREEZE_R + R) continue;
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
        hitFrom(foe, tw.owner);
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
  // ghosts and jumping bats only stop at the outer wall; bats up on the blocks
  // too, except that over lava a block's edge holds them (unless a big hit, like a
  // fireball or a clash, knocks them flying off it)
  const edgeHolds = (b) => lavaSafeOnly() && (b.stun <= 0 || Math.hypot(b.vx, b.vy) < 5.5);
  const batBlocked = (b, x, y) => (b.ghostT > 0 || b.jumpT > 0 ? inBorder(x, y)
    : b.top ? inBorder(x, y) || (edgeHolds(b) && !blockAt(x, y)) : hitsWall(x, y, R));
  // turning solid again inside rock: up on top if it's a block, else eased out
  function unGhost(b) {
    b.ghostT = 0;
    if (b.jumpT > 0 || (!b.top && !hitsWall(b.x, b.y, R))) return;   // (a jump lands on its own)
    settle(b);
    fx({ k: 'burst', x: b.x, y: b.y, rgb: POWERS.ghost.rgb, n: 12 });
  }

  // The bite: the stunned bat gets slurped into the eater's open mouth,
  // CHOMP, the eater puffs up, then burps out a few feathers.
  function eat(eater, food) {
    if (rule === 'survivor') food.out = true;   // out until the round ends: no respawn
    else eater.score++;
    eater.biteT = 0; eater.dashT = 0;
    eater.vx *= 0.3; eater.vy *= 0.3;
    eats.push({ eater, food: { ...food }, t: 0, chomped: false, burped: false, ang: Math.atan2(food.y - eater.y, food.x - eater.x) });
    knockedOut(food, RESPAWN_DELAY + EAT_TIME);
    fx({ k: 'slowmo', t: 0.45 });
    fx({ k: 'sfx', n: 'slurp' });
    if (rule === 'bites' && eater.score >= winScore) { over = true; matchWinner = eater; }
    if (rule === 'survivor') checkRoundOver();
  }
  // a bat that's been eaten or fell in the lava loses everything it had
  function knockedOut(b, wait) {
    b.dead = wait;
    b.stun = 0;
    b.power = null; b.mega = false; b.shield = false;
    b.held = null; b.heldLeft = 0; b.ghostT = 0; b.ice = 0; b.burn = 0; b.revealT = 0; b.jumpT = 0; b.jumpQ = false; b.lavaT = 0;
    if (b.ice > 0) b.ice = 0;
  }
  // Lava: a bat fell in. It sinks with a sizzle and is out like a bitten bat.
  // Free-for-all: whoever last hit it (squeak, power, parry, clash, wind) in the
  // KO_CREDIT seconds before scores the point; nobody does if it just fell.
  function sizzle(b) {
    const h = b.lastHit, by = h && clock - h.t <= KO_CREDIT ? bats[h.by] : null;
    koCount++;
    fx({ k: 'sink', i: b.i, x: r2(b.x), y: r2(b.y) });
    fx({ k: 'popup', x: b.x, y: b.y - 1.1, text: 'SIZZLE!', rgb: '255, 150, 60', big: true, life: 1 });
    fx({ k: 'sfx', n: 'boom', alt: 'crash' });
    fx({ k: 'shake', v: 0.2 });
    knockedOut(b, RESPAWN_DELAY + SINK_TIME);
    b.lastHit = null;
    if (rule === 'survivor') { b.out = true; checkRoundOver(); return; }
    if (by && !by.dead) {
      by.score++;
      fx({ k: 'popup', x: by.x, y: by.y - 1, text: '+1 KNOCKOUT', rgb: by.rgb, life: 1.1 });
      if (by.score >= winScore) { over = true; matchWinner = by; }
    }
  }

  // A bite on a bat up in a jump: the whole chomp plays, but on empty air
  // under it (MISS!). The jumper is fine; the biter's dash is spent.
  function whiff(a, b) {
    a.biteT = 0; a.dashT = 0;
    a.vx *= 0.35; a.vy *= 0.35;
    a.seen = 1; b.seen = Math.max(b.seen, 0.8);
    missCount++;
    fx({ k: 'miss', a: a.i, f: b.i, x: r2(b.x), y: r2(b.y), ang: r2(Math.atan2(b.y - a.y, b.x - a.x)) });
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
    rings = []; eats = []; powerups = []; parries = []; misses = [];
    shots = []; twisters = []; thunders = []; bolts = []; novas = []; sinks = [];
    powerTimer = powerWait('first'); firstPower = true;
    for (const c of crystals) { c.on = false; c.timer = 0.5 + Math.random() * 2.5; }
    // a fresh corner each for everyone (the corner spots dodge any walls the morphing cave grew)
    const starts = cornerStarts();
    bats.forEach((b, k) => {
      const s = starts[k] || randomOpenSpot();
      if (b.trapT) b.trapT = 0;
      Object.assign(b, {
        x: s.x, y: s.y, vx: 0, vy: 0, face: s.x < arena.w / 2 ? 1 : -1, out: false, dead: 0, top: s.top ? 1 : 0, hv: s.top ? 1 : 0, lavaT: 0, lastHit: null,
        echoes: START_ECHOES, stun: 0, safe: SPAWN_SAFE, cooldown: 0, dashCd: 0, dashT: 0, biteT: 0,
        parryT: 0, parryCd: 0, parryRing: null, hitBy: null, power: null, powerT: 0, mega: false, shield: false,
        mouth: 0, puff: 0, seen: 0,
        held: null, heldLeft: 0, specialCd: 0, ghostT: 0, ice: 0, burn: 0, revealT: 0, jumpT: 0, jumpCd: 0, jumps: JUMP_CHARGES, jumpQ: false,
      });
      if (b.ai) { b.ai.path = []; b.ai.roam = null; b.ai.known = null; }
    });
    // the next round waits on the short controls guide (the host, or you offline, taps Start)
    if (noGuide || window.__echoNoGuide) roundGo();
    else guide = { kind: 'round', t: 0 };
  }
  function roundGo() {
    fx({ k: 'banner', text: `Round ${round}`, rgb: '232, 236, 255', t: 1.4 });
    fx({ k: 'sfx', n: 'go' });
  }
  // Start! on the controls guide: the match's countdown, or the next round, begins
  const canStartGuide = () => mode !== 'client';
  function startFromGuide() {
    if (!guide || !canStartGuide()) return;
    const kind = guide.kind;
    guide = null;
    window.EchoAudio?.unlock?.();
    if (kind === 'round') roundGo();
    else fx({ k: 'sfx', n: 'beep' });
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
    if (over && !ended && !eats.length && (matchWinner || done.length) && !sinks.some((k) => k.t < SINK_TIME * 0.8)) {
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

  // Morph modes: every few moments a handful of tiles turn into the next
  // arena's layout, never closing on a bat, until the whole cave has become it.
  // Classic Morphing pauses MORPH_PAUSE seconds between caves; Xtreme holds each
  // themed map XTREME_HOLD seconds, then reshapes fast. Into Lava Hollow, the
  // floor only turns to lava after the blocks are in place and a 3-2-1.
  function updateMorph(dt) {
    if (!morph) return;
    checkTrapped(dt);
    if (morph.pause > 0) {
      morph.pause -= dt;
      if (morph.pause <= 0) {
        morph.target = morph.next ?? nextArenaIndex();
        morph.next = null; morph.total = 0;
        const def = window.ECHO_ARENAS[morph.target];
        if (morph.x) {
          // Xtreme: the themes blend as the walls change. Off lava, the floor cools first
          if (lavaOn) { lavaOn = false; fx({ k: 'popup', x: arena.w / 2, y: arena.h / 2 - 2, text: 'The lava cools', rgb: '255, 190, 120', life: 1.4 }); }
          setTheme(arenaIndex, morph.target, 0);
          const lava = def.theme.style === 'lava';
          fx({ k: 'banner', text: lava ? `${def.name}: get on a block!` : def.name, rgb: def.theme.wall, t: 2.6 });
          fx({ k: 'sfx', n: 'warn' });
        } else {
          // classic: the same stone look all along
          setTheme(arenaIndex, arenaIndex, 0);
          fx({ k: 'sfx', n: 'warn' });
        }
      }
      return;
    }
    if (morph.target < 0) return;
    morph.timer -= dt;
    if (morph.timer > 0) return;
    morph.timer = morph.rescue ? RESCUE_STEP : morph.x ? XTREME_STEP : MORPH_STEP;
    const rows = mapRows(morph.target), { w, h, grid } = arena, diff = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const want = rows[y][x] === '#' || rows[y][x] === 'E' ? 1 : 0;
      if (grid[y * w + x] !== want) diff.push(y * w + x);
    }
    // the colours blend into the new theme as the walls change (Xtreme)
    morph.total = Math.max(morph.total || 0, diff.length);
    if (morph.x) setTheme(themeFrom, morph.target, morph.total ? 1 - diff.length / morph.total : 1);
    if (!diff.length) {
      const keepLit = lit, keepBy = litBy, keepPowers = powerups, keepRegrow = regrow;
      loadArena(morph.target);
      lit = keepLit; litBy = keepBy; powerups = keepPowers;
      if (mossy()) regrow = keepRegrow;
      fx({ k: 'banner', text: arena.def.name, rgb: arena.theme.wall, t: 2 });
      morph.pause = morph.x ? XTREME_HOLD : MORPH_PAUSE;
      morph.rescue = null;
      morph.target = -1;
      for (const b of bats) b.trapT = 0;
      // into lava: 3-2-1, then the floor burns
      if (morph.x && styleNow() === 'lava') { lavaWarn = LAVA_WARN; fx({ k: 'sfx', n: 'warn' }); }
      return;
    }
    const changes = [];
    // freeing a trapped bat: melt the rock nearest it first, many tiles at a time
    let pick = () => diff.splice(Math.floor(Math.random() * diff.length), 1)[0], count = morph.x ? XTREME_TILES : 3;
    if (morph.rescue) {
      const near = (k) => Math.min(...morph.rescue.map((p) => Math.hypot((k % w) + 0.5 - p.x, Math.floor(k / w) + 0.5 - p.y)));
      diff.sort((p, q) => (grid[q] - grid[p]) || near(p) - near(q));   // walls to clear first, nearest first
      pick = () => diff.shift();
      count = RESCUE_TILES;
    }
    for (let n = 0; n < count && diff.length; n++) {
      const k = pick();
      const v = grid[k] ? 0 : 1, cx = (k % w) + 0.5, cy = Math.floor(k / w) + 0.5;
      // (classic: rock never grows on a bat down on the floor; Xtreme: a block
      // rising under a bat lifts it up on top, and one beside it nudges it aside)
      const under = bats.filter((o) => !o.dead && !o.top && o.jumpT <= 0 && o.ghostT <= 0 && Math.abs(o.x - cx) < 1 && Math.abs(o.y - cy) < 1);
      if (v && under.length) {
        if (!morph.x) continue;
        for (const o of under) if (Math.floor(o.x) === k % w && Math.floor(o.y) === Math.floor(k / w)) o.top = 1;
      }
      changes.push([k, v]);
      const here = (p) => Math.floor(p.x) === k % w && Math.floor(p.y) === Math.floor(k / w);
      if (v) {
        powerups = powerups.filter((p) => !here(p));
        for (const c of crystals) if (here(c)) { c.on = false; c.timer = 99; }
      } else for (const p of powerups) if (here(p)) p.top = 0;   // (a power-up on a block that melts drops to the floor)
      regrow = regrow.filter((r) => r.k !== k);
    }
    if (changes.length) {
      fx({ k: 'tiles', c: changes });
      for (const o of bats) if (!o.dead && !o.top && o.jumpT <= 0 && o.ghostT <= 0) easeOut(o);
    }
  }

  // Xtreme into lava: the 3-2-1, then the floor burns. Power-ups left down on
  // the floor burn up.
  function updateLava(dt) {
    if (lavaWarn <= 0) return;
    const before = Math.ceil(lavaWarn);
    lavaWarn = Math.max(0, lavaWarn - dt);
    if (Math.ceil(lavaWarn) !== before) fx({ k: 'sfx', n: lavaWarn <= 0 ? 'crash' : 'beep' });
    if (lavaWarn <= 0) {
      lavaOn = true;
      powerups = powerups.filter((p) => p.top);
      fx({ k: 'banner', text: 'The floor is lava!', rgb: '255, 140, 60', t: 1.8 });
      fx({ k: 'shake', v: 0.25 });
    }
  }

  // Mossy Den: a dash into a bush chomps through it (leaves fly); it grows
  // back REGROW seconds later, waiting while a bat is in the way
  function chompBush(b, x, y) {
    const ch = [];
    for (let ty = Math.floor(y - R); ty <= Math.floor(y + R); ty++) {
      for (let tx = Math.floor(x - R); tx <= Math.floor(x + R); tx++) {
        if (!blockAt(tx + 0.5, ty + 0.5)) continue;
        const nx = Math.max(tx, Math.min(x, tx + 1)), ny = Math.max(ty, Math.min(y, ty + 1));
        if ((x - nx) ** 2 + (y - ny) ** 2 >= R * R) continue;
        const k = ty * arena.w + tx;
        ch.push([k, 0]);
        regrow.push({ k, t: REGROW });
        for (const c of crystals) if (Math.floor(c.x) === tx && Math.floor(c.y) === ty) c.on = false;
        fx({ k: 'leaves', x: tx + 0.5, y: ty + 0.5 });
      }
    }
    if (!ch.length) return false;
    bushCount += ch.length;
    fx({ k: 'tiles', c: ch });
    fx({ k: 'sfx', n: 'chomp', alt: 'crash' });
    fx({ k: 'popup', x: b.x, y: b.y - 1, text: 'CHOMP!', rgb: '150, 255, 120', life: 0.7 });
    return true;
  }
  function updateRegrow(dt) {
    if (!regrow.length) return;
    if (!mossy()) { regrow = []; return; }
    const ch = [];
    regrow = regrow.filter((r) => {
      r.t -= dt;
      if (r.t > 0) return true;
      const tx = r.k % arena.w, ty = Math.floor(r.k / arena.w);
      // a bat (or a power-up) in the way: wait a little and try again
      const near = (p, m) => p.x > tx - m && p.x < tx + 1 + m && p.y > ty - m && p.y < ty + 1 + m;
      if (bats.some((b) => !b.dead && !b.top && near(b, R + 0.05)) || powerups.some((p) => near(p, 0))) { r.t = 0.5; return true; }
      if (arena.grid[r.k] === 0) ch.push([r.k, 1]);
      return false;
    });
    if (ch.length) {
      fx({ k: 'tiles', c: ch });
      for (const [k] of ch) fx({ k: 'leaves', x: (k % arena.w) + 0.5, y: Math.floor(k / arena.w) + 0.5, grow: 1 });
    }
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
      if (b.dead || b.out || b.ghostT > 0 || b.jumpT > 0 || b.top) { b.trapT = 0; continue; }
      const tx = Math.floor(b.x), ty = Math.floor(b.y), id = tx >= 0 && ty >= 0 && tx < arena.w && ty < arena.h ? label[ty * arena.w + tx] : -1;
      const room = id >= 0 && !hitsWall(b.x, b.y, R) ? sizes[id] : 0;   // wedged into rock counts as trapped too
      b.trapT = room < total * TRAP_SHARE ? (b.trapT || 0) + TRAP_CHECK : 0;
      if (b.trapT >= TRAP_TIME) stuck.push({ x: b.x, y: b.y });
    }
    if (!stuck.length) return;
    if (morph.rescue) { morph.rescue = stuck; return; }   // already opening up: just aim at whoever's stuck now
    // classic: morph early, straight into Open Sky (or, with no sky about, the next cave).
    // Xtreme: the map on its way melts nearest the stuck bat first (or the next one does, early)
    const skies = arenaKinds(true);
    if (morph.x) {
      if (lavaSafeOnly()) return;   // (over lava everyone's up on the blocks anyway)
      if (morph.target < 0) { morph.target = nextArenaIndex(); morph.total = 0; setTheme(arenaIndex, morph.target, 0); }
    } else {
      morph.target = skies.length ? skies[Math.floor(Math.random() * skies.length)] : morph.target >= 0 ? morph.target : nextArenaIndex();
      morph.total = 0;
      setTheme(arenaIndex, arenaIndex, 0);
    }
    morph.pause = 0; morph.timer = 0; morph.rescue = stuck;
    fx({ k: 'banner', text: 'Opening up!', rgb: '190, 255, 235', t: 1.6 });
    fx({ k: 'shake', v: 0.3 });
    fx({ k: 'sfx', n: 'crash', alt: 'warn' });
  }

  // back in, at the start spot farthest from everyone (a block top when the floor is lava)
  function respawn(b) {
    const foes = bats.filter((o) => o !== b && !o.dead);
    const score = (s) => foes.length ? Math.min(...foes.map((o) => Math.hypot(o.x - s.x, o.y - s.y))) : 0;
    const spots = cornerSpots(8).filter((p) => p.top || !hitsWall(p.x, p.y, R));
    const s = (spots.length ? spots : [randomOpenSpot()]).slice().sort((p, q) => score(q) - score(p))[0];
    Object.assign(b, { x: s.x, y: s.y, vx: 0, vy: 0, echoes: START_ECHOES, stun: 0, safe: SPAWN_SAFE, dead: 0, cooldown: 0, mouth: 0, dashT: 0, parryT: 0, parryRing: null, hitBy: null, ghostT: 0, ice: 0, burn: 0, jumpT: 0, jumpCd: 0, jumps: JUMP_CHARGES, jumpQ: false,
      top: s.top ? 1 : 0, hv: s.top ? 1 : 0, lavaT: 0, lastHit: null });
  }

  function spawnPowerup(force) {
    const types = force ? [force] : powerOn;
    if (!types.length) return;
    // (over lava they sit on block tops; Extreme packs them closer together)
    const gap = powerFreq?.near || 4, room = powerFreq?.near ? 3 : 5;
    const pool = lavaSafeOnly() ? blockSpots().filter((p) => p.room >= 3) : arena.open.filter((p) => !solid(Math.floor(p.x), Math.floor(p.y)));
    const spots = pool.filter((p) => bats.every((b) => b.dead || dist(p, b) > room) && powerups.every((q) => dist(p, q) > gap));
    if (!spots.length) return;
    const s = spots[Math.floor(Math.random() * spots.length)];
    powerups.push({ x: s.x, y: s.y, type: types[Math.floor(Math.random() * types.length)], phase: Math.random() * 6, top: s.top ? 1 : 0 });
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
    // waiting on the controls guide's Start, then the countdown (guests get snapshots all along)
    if (guide) { guide.t += rawDt; sendSnapshots(rawDt); return; }
    if (countdown > 0) {
      const before = Math.ceil(countdown);
      countdown -= rawDt;
      if (Math.ceil(countdown) !== before) fx({ k: 'sfx', n: countdown <= 0 ? 'go' : 'beep' });
      sendSnapshots(rawDt);
      return;
    }
    slowmo = Math.max(0, slowmo - rawDt);
    const dt = slowmo > 0 ? rawDt * 0.35 : rawDt;
    updateEats(rawDt);

    if (!over) { updateMorph(rawDt); updateLava(rawDt); }
    updateRegrow(dt);
    updateRound(rawDt);
    const slip = iceNow(), bounce = 0.4 + 0.3 * slip;   // icy caves: slippery, and walls bounce harder

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
      b.jumpCd = Math.max(0, b.jumpCd - dt);
      if (b.jumpT > 0) { b.jumpT -= dt; if (b.jumpT <= 0) land(b); }
      // the jump meter refills one charge at a time (on the ground, so a full one really is 3 hops);
      // a press kept from just before landing hops again
      if (b.jumps < JUMP_CHARGES && b.jumpT <= 0) b.jumps = Math.min(JUMP_CHARGES, b.jumps + dt / JUMP_RECHARGE);
      if (b.jumpQ && b.jumpCd <= 0 && !b.dead) jump(b);
      if (b.dead > 0) { if (b.out) continue; b.dead -= dt; if (b.dead <= 0 && !over) respawn(b); continue; }
      let ix = 0, iy = 0;
      if (b.stun > 0) b.stun = Math.max(0, b.stun - dt);
      const wasIce = b.ice > 0;
      b.ice = b.stun > 0 ? Math.max(0, b.ice - dt) : 0;
      if (wasIce && b.ice <= 0) fx({ k: 'shatter', x: r2(b.x), y: r2(b.y), top: b.top });
      if (b.ice > 0) { b.vx = 0; b.vy = 0; }   // frozen solid
      else if (b.stun > 0) {
        // stunned bats can't steer: the hit's knockback dies off fast and they hang still (they slide on ice)
        const k = Math.exp(-STUN_DRAG * (1 - 0.6 * slip) * dt);
        b.dashT = 0;
        b.vx *= k; b.vy *= k;
        // (a stunned CPU can still hop over a bite coming its way)
        if (b.ctrl === 'cpu' && b.ai && !over) { cpuLevel = b.lv || baseLevel; cpuDodge(b); }
      } else if (!over) {
        if (b.ctrl === 'cpu') { cpuLevel = b.lv || baseLevel; ({ ix, iy } = cpuInput(b, dt)); }
        else if (b.ctrl === 'remote') ({ ix, iy } = remoteInput.get(b.i) || { ix: 0, iy: 0 });
        else ({ ix, iy } = localInput(b.local));
      }
      const fast = b.power === 'speed';
      if (b.dashT > 0) {
        b.dashT -= dt;
        if (Math.random() < 0.6) particles.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.3, rgb: b.rgb, size: 5 });
      } else if (ix || iy) {
        // on ice there's less grip: turning and stopping take longer, so bats slide
        const acc = ACCEL * (fast ? 1.3 : 1) * (1 - 0.62 * slip);
        b.vx += ix * acc * dt; b.vy += iy * acc * dt;
      } else if (b.stun <= 0) { const dr = DRAG * (1 - 0.82 * slip); b.vx -= b.vx * dr * dt; b.vy -= b.vy * dr * dt; }
      if (b.ctrl === 'cpu') cpuLevel = b.lv || baseLevel;
      const max = b.dashT > 0 ? DASH_SPEED : b.stun > 0 ? 7 : MAX_SPEED * (fast ? 1.45 : 1) * (b.ctrl === 'cpu' ? cpuLevel.speed : 1);
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
      if (Math.abs(b.vx) > 0.2) b.face = Math.sign(b.vx);
      // (a dash into a bush in Mossy Den chomps right through it)
      const chomps = (x, y) => !b.top && b.jumpT <= 0 && b.ghostT <= 0 && (b.dashT > 0 || b.biteT > 0) && mossy() && hitsWall(x, y, R) && chompBush(b, x, y);
      const nx = b.x + b.vx * dt;
      if (!batBlocked(b, nx, b.y) || chomps(nx, b.y)) b.x = nx; else b.vx *= -(b.top ? 0.2 : bounce);
      const ny = b.y + b.vy * dt;
      if (!batBlocked(b, b.x, ny) || chomps(b.x, ny)) b.y = ny; else b.vy *= -(b.top ? 0.2 : bounce);
      // up on the blocks: flying off the edge drops you to the floor (a ghost just sinks into the rock)
      if (b.top && b.jumpT <= 0 && !blockAt(b.x, b.y)) { if (b.ghostT > 0) b.top = 0; else drop(b); }
      // the floor is lava: down there (not up on a block, not mid-jump, not a ghost) you sizzle
      if (lavaOn && !b.top && b.jumpT <= 0 && b.ghostT <= 0 && !over && !roundEnd) {
        b.lavaT += dt;
        if (b.lavaT >= LAVA_GRACE) sizzle(b);
      } else b.lavaT = 0;
    }

    advanceRings(dt, true);
    updateShots(dt);
    updateThunder(dt);
    updateTwisters(dt);

    // biting: a bat mid-dash (or just after) that touches any rival chomps it,
    // unless the rival parries, blocks with a shield, or is dashing too (a
    // clash). A rival up in a jump is missed: the jaws snap on empty air.
    if (!over && !roundEnd) {
      outer: for (const a of bats) {
        if (a.dead || a.stun > 0 || a.biteT <= 0 || airborne(a)) continue;
        let jumper = null;
        for (const b of bats) {
          if (b === a || b.dead || b.safe > 0 || Math.hypot(a.x - b.x, a.y - b.y) >= BITE_REACH) continue;
          // up in a jump, or on another level (up on a block / down on the floor): the jaws snap on air
          if (airborne(b) || lvl(b) !== lvl(a)) { jumper = jumper || b; continue; }
          const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
          if (b.biteT > 0 && b.stun <= 0) { clash(a, b, ux, uy); continue outer; }
          if (b.parryT > 0 && b.stun <= 0) { parrySucceed(b, a, a.x, a.y, true); continue outer; }
          if (b.shield) {
            a.biteT = 0; a.dashT = 0; a.vx = -ux * 5; a.vy = -uy * 5;
            b.vx = ux * 3; b.vy = uy * 3;
            hitFrom(b, a.i);
            shieldBlock(b);
            continue outer;
          }
          eat(a, b);
          break outer;
        }
        if (jumper) whiff(a, jumper);
      }
    }
    // a missed bite's snap: the whiff sound as the jaws close on nothing
    for (const m of misses) if (!m.snd && m.t >= EAT_PULL - 0.06) { m.snd = true; fx({ k: 'sfx', n: 'whiff', alt: 'dash' }); }

    for (const c of crystals) {
      if (!c.on) {
        c.timer -= dt;
        if (c.timer <= 0 && crystals.filter((k) => k.on).length < 2 + Math.floor(bats.length / 2)) c.on = true;
        continue;
      }
      for (const b of bats) {
        if (b.dead || Math.hypot(c.x - b.x, c.y - b.y) > 0.6 || (!airborne(b) && lvl(b) !== (c.top || 0))) continue;
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
      const b = bats.find((o) => !o.dead && dist(o, p) < 0.6 && (airborne(o) || lvl(o) === (p.top || 0)));
      if (b) { grabPowerup(b, p); return false; }
      return true;
    });

    sendSnapshots(rawDt);
  }
  function sendSnapshots(rawDt) {
    if (mode !== 'host') return;
    snapTimer -= rawDt;
    if (snapTimer <= 0) { snapTimer = SNAPSHOT_EVERY; net?.broadcast(snapshot()); }
  }

  // Rings light walls as they pass and, on the host, stun every other bat they reach
  function advanceRings(dt, simulate) {
    for (let k = 0; k < lit.length; k++) if (lit[k] > 0) lit[k] = Math.max(0, lit[k] - dt * 0.75);
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
        if (foe.i === ring.owner || foe.dead || foe.safe > 0 || ring.hit.has(foe.i) || airborne(foe)) continue;   // passes under a jumping bat
        const d = Math.hypot(foe.x - ring.x, foe.y - ring.y);
        if (d < r + R && d >= prev - R) {
          ring.hit.add(foe.i);
          foe.seen = 1;
          if (foe.stun > 0) continue;
          const k = d || 1;
          if (foe.parryT > 0) { parrySucceed(foe, bats[ring.owner], ring.x, ring.y); continue; }
          hitFrom(foe, ring.owner);
          if (foe.shield) {
            foe.vx = ((foe.x - ring.x) / k) * 3; foe.vy = ((foe.y - ring.y) / k) * 3;
            shieldBlock(foe);
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
    themeShow += (themeK - themeShow) * Math.min(1, dt * 3);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    updateAmbient(dt);
    if (tileGlow) for (let k = 0; k < tileGlow.length; k++) if (tileGlow[k] > 0) tileGlow[k] = Math.max(0, tileGlow[k] - dt * 0.6);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < p.life);
    for (const p of parries) p.t += dt;
    parries = parries.filter((p) => p.t < PARRY_FX);
    for (const list of [shieldPops, shatters, sinks]) for (const p of list) p.t += dt;
    shieldPops = shieldPops.filter((p) => p.t < 0.6); shatters = shatters.filter((p) => p.t < 0.6); sinks = sinks.filter((p) => p.t < SINK_TIME);
    // the lava floor eases in (and cools off); a bat's height eases between the floor and the block tops
    lavaVis += ((lavaOn ? 1 : 0) - lavaVis) * Math.min(1, dt * (lavaOn ? 4 : 1.5));
    for (const b of bats) {
      const want = b.jumpT > 0 ? (blockAt(b.x, b.y) ? 1 : 0) : b.top ? 1 : 0;
      b.hv = b.dead ? want : (b.hv || 0) + (want - (b.hv || 0)) * Math.min(1, dt * (b.jumpT > 0 ? 7 : 14));
    }
    for (const m of misses) {
      m.t += dt;
      // the biter's mouth gapes until the snap (the host's snapshots carry it to guests)
      if (mode !== 'client' && m.eater && !m.shut) {
        if (m.t < EAT_PULL) m.eater.mouth = Math.min(1, m.t / 0.12);
        else { m.shut = true; m.eater.mouth = 0; }
      }
    }
    misses = misses.filter((m) => m.t < MISS_TIME);
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.feather || p.leaf) { p.vy += 1.5 * dt; p.vx *= 1 - 1.5 * dt; } else { p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; }
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
          life: 0.4 + Math.random() * 0.3, rgb: Math.random() < 0.5 ? POWERS.tornado.rgb : TH().wall, size: 2.5 + Math.random() * 2 });
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
  }

  // ---- Online snapshots ----------------------------------------------------
  const r2 = (v) => Math.round(v * 100) / 100;
  function snapshot() {
    const s = {
      t: 's', a: arenaIndex, am: arenaMode, cd: r2(countdown), over,
      gd: guide ? (guide.kind === 'round' ? 2 : 1) : 0,   // the controls guide is up, waiting on the host's Start
      b: bats.map((b) => [r2(b.x), r2(b.y), r2(b.vx), r2(b.vy), b.face, r2(b.stun), r2(b.dead), b.score, b.echoes, r2(b.safe), r2(b.seen),
        r2(b.mouth), r2(b.puff), r2(b.dashCd), b.power || 0, r2(b.powerT), b.mega ? 1 : 0, b.shield ? 1 : 0, b.ctrl === 'cpu' ? 1 : 0, r2(b.dashT), r2(b.jumps), r2(b.parryT), b.out ? 1 : 0,
        b.held || 0, r2(b.ghostT), r2(b.ice), r2(b.burn), r2(b.heldLeft), r2(b.specialCd), r2(b.jumpT), r2(b.jumpCd), b.top ? 1 : 0]),
      r: rings.map((g) => [g.id, r2(g.x), r2(g.y), r2(g.r), g.owner, g.max, g.big ? 1 : 0]),
      c: crystals.map((c) => (c.on ? 1 : 0)).join(''),
      p: powerups.map((p) => [r2(p.x), r2(p.y), p.type, p.top ? 1 : 0]),
      e: eats.map((e) => [e.eater.i, e.food.i, r2(e.food.x), r2(e.food.y), r2(e.t), r2(e.ang)]),
      fx: outbox,
      ft: winScore,
      tm: [themeFrom, themeTo, r2(themeK)],   // the cave theme: from, to, how far it has blended
      lv: [lavaOn ? 1 : 0, r2(lavaWarn)],   // lava: burning, and the 3-2-1 before it does
    };
    // the whole cave's rock, now and then (so chomped bushes and morphs stay in step)
    if (gridSent++ % 20 === 0) s.gr = arena.grid.join('');
    // special powers in play (only sent while there are some)
    if (shots.length) s.sh = shots.map((m) => [m.id, r2(m.x), r2(m.y), r2(m.vx), r2(m.vy), m.owner, m.top ? 1 : 0]);
    if (twisters.length) s.tw = twisters.map((m) => [m.id, r2(m.x), r2(m.y), r2(m.ux), r2(m.uy), r2(m.t), m.owner]);
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
    if (s.tm) setTheme(s.tm[0], s.tm[1], s.tm[2]);
    if (s.lv) { lavaOn = !!s.lv[0]; lavaWarn = s.lv[1] || 0; }
    if (s.gr && s.gr.length === arena.grid.length) {
      for (let k = 0; k < arena.grid.length; k++) { const v = s.gr.charCodeAt(k) - 48; if (arena.grid[k] !== v) { arena.grid[k] = v; tileGlow[k] = 1; } }
    }
    rule = s.ru ? 'survivor' : 'bites';
    if (s.ru) { round = s.ru[0]; roundClock = s.ru[1]; storm = !!s.ru[2]; roundEnd = s.ru[3] ? roundEnd || { t: 0, w: -1 } : null; }
    countdown = s.cd;
    over = s.over;
    const gk = s.gd === 2 ? 'round' : s.gd ? 'match' : null;
    guide = gk ? (guide && guide.kind === gk ? guide : { kind: gk, t: 0 }) : null;
    s.b.forEach((v, i) => {
      const b = bats[i] || (bats[i] = makeBat(i, 'remote', 0));
      const first = b.tx === undefined;
      [b.tx, b.ty, b.vx, b.vy, b.face, b.stun, b.dead, b.score, b.echoes, b.safe, b.seen, b.mouth, b.puff, b.dashCd] = v;
      b.power = v[14] || null; b.powerT = v[15]; b.mega = !!v[16]; b.shield = !!v[17];
      b.cpuFlag = !!v[18]; b.dashT = v[19];
      b.jumps = v[20] >= 0 ? v[20] : JUMP_CHARGES;
      b.parryT = v[21] || 0;
      b.out = !!v[22];
      b.held = v[23] || null; b.heldLeft = v[27] || 0; b.specialCd = v[28] || 0; b.ghostT = v[24] || 0; b.ice = v[25] || 0; b.burn = v[26] || 0;
      // a jump: keep the smoothly running clock unless it's off by a lot
      const jt = v[29] || 0;
      if (jt <= 0) b.jumpT = 0;
      else if (b.jumpT > 0) { if (Math.abs(b.jumpT - jt) > 0.12) b.jumpT = jt; }
      else if (jt > JUMP_TIME * 0.5) b.jumpT = jt;   // (not the tail end of one that just landed here)
      b.jumpCd = v[30] || 0;
      b.top = v[31] ? 1 : 0;
      if (s.lk && s.lk[i] && window.EchoLooks) { try { b.look = window.EchoLooks.clean(s.lk[i]); } catch (e) { /* keep the old look */ } }
      if (first || Math.hypot(b.tx - b.x, b.ty - b.y) > 3) { b.x = b.tx; b.y = b.ty; }
    });
    const known = new Map(rings.map((g) => [g.id, g]));
    rings = s.r.map(([id, x, y, r, owner, max, big]) => {
      const g = known.get(id);
      return { id, x, y, r: g ? Math.max(g.r, r) : r, owner, max, big: !!big, hit: new Set() };
    });
    [...s.c].forEach((ch, k) => { if (crystals[k]) crystals[k].on = ch === '1'; });
    const oldShots = new Map(shots.map((m) => [m.id, m]));
    shots = (s.sh || []).map(([id, x, y, vx, vy, owner, top]) => {
      const m = oldShots.get(id);
      // keep the smoothly predicted position unless it drifted off
      if (m && Math.hypot(m.x - x, m.y - y) < 0.6) { m.vx = vx; m.vy = vy; m.owner = owner; m.top = top; return m; }
      return { id, x, y, vx, vy, owner, t: 0, top };
    });
    const oldTw = new Map(twisters.map((m) => [m.id, m]));
    twisters = (s.tw || []).map(([id, x, y, ux, uy, t, owner]) => {
      const m = oldTw.get(id) || { id, x, y, hit: new Set() };
      if (Math.hypot(m.x - x, m.y - y) > 0.8) { m.x = x; m.y = y; }
      m.tx = x; m.ty = y; m.ux = ux; m.uy = uy; m.t = Math.max(m.t || 0, t); m.owner = owner;
      return m;
    });
    powerups = s.p.map(([x, y, type, top], k) => ({ x, y, type, top: top || 0, phase: powerups[k]?.phase ?? Math.random() * 6 }));
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
    for (const b of bats) {
      if (b.ghostT > 0) b.ghostT = Math.max(0, b.ghostT - dt);
      if (b.jumpT > 0) b.jumpT = Math.max(0, b.jumpT - dt);
      if (b.jumpCd > 0) b.jumpCd = Math.max(0, b.jumpCd - dt);
      if (b.jumps < JUMP_CHARGES && b.jumpT <= 0) b.jumps = Math.min(JUMP_CHARGES, b.jumps + dt / JUMP_RECHARGE);
    }
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
  // a tap (or squeak key) while you're out: watch the next bat still flying
  function watchNext() {
    const cur = watched();
    const alive = bats.filter((b) => !b.out);
    if (!cur || alive.length < 2) return false;
    const k = alive.indexOf(cur);
    watchI = alive[(k + 1) % alive.length].i;
    applyFx({ k: 'sfx', n: 'tick', alt: 'beep' });
    return true;
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
    ctx.fillStyle = TH().bg;
    ctx.beginPath(); ctx.arc(mx + mr * 0.55, my - mr * 0.3, mr * 0.85, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // a faint edge so players know where the sky ends
    ctx.strokeStyle = 'rgba(255, 236, 190, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 8]);
    ctx.strokeRect(X(1), Y(1), (arena.w - 2) * PX, (arena.h - 2) * PX);
    ctx.setLineDash([]);
  }

  // Themed floors, top-down. Drawn the same under rock and open floor, so they
  // give nothing away about where the walls are (except lava, which glows
  // around the blocks standing in it): ice has a frosty sheen with glints,
  // grass a faint carpet of blades, crystal twinkles, lava churns and flows.
  let patterns = null;
  function floorPatterns() {
    if (patterns) return patterns;
    const mk = (size, fn) => { const c = document.createElement('canvas'); c.width = c.height = size; fn(c.getContext('2d'), size); return ctx.createPattern(c, 'repeat'); };
    let seed = 99;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // lava: hot blobs on dark red rock, drawn wrapped so the tile repeats seamlessly
    const blobs = (g, S, n, cols, rmin, rmax) => {
      for (let k = 0; k < n; k++) {
        const x = rnd() * S, y = rnd() * S, r = S * (rmin + rnd() * (rmax - rmin)), c = cols[k % cols.length];
        for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
          const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          gr.addColorStop(0, `rgba(${c}, 0.95)`); gr.addColorStop(1, `rgba(${c}, 0)`);
          g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
        }
      }
    };
    const lavaA = mk(160, (g, S) => { g.fillStyle = '#5a0c02'; g.fillRect(0, 0, S, S); blobs(g, S, 14, ['255, 90, 10', '255, 140, 30'], 0.12, 0.3); blobs(g, S, 9, ['255, 220, 110'], 0.04, 0.1); });
    const lavaB = mk(128, (g, S) => { blobs(g, S, 10, ['255, 170, 50', '255, 80, 20'], 0.08, 0.2); });
    const grass = mk(64, (g, S) => {
      g.lineCap = 'round';
      for (let k = 0; k < 70; k++) {
        const x = rnd() * S, y = rnd() * S, l = 3 + rnd() * 4, a = -Math.PI / 2 + (rnd() - 0.5);
        g.strokeStyle = rnd() < 0.5 ? 'rgba(120, 220, 100, 0.9)' : 'rgba(60, 150, 60, 0.9)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
    });
    return (patterns = { lavaA, lavaB, grass });
  }
  function drawFloorTheme2D(th) {
    const L = th.look, style = th.style, { w, h } = arena;
    ctx.save();
    if (L && L.ice > 0.02) {
      ctx.fillStyle = `rgba(150, 200, 255, ${0.09 * L.ice})`;
      ctx.fillRect(X(0), Y(0), w * PX, h * PX);
      // long pale streaks across the ice
      ctx.strokeStyle = `rgba(220, 240, 255, ${0.05 * L.ice})`; ctx.lineWidth = PX * 0.5;
      ctx.beginPath();
      for (let k = 0; k < w + h; k += 4) { ctx.moveTo(X(k), Y(0)); ctx.lineTo(X(k - h * 0.6), Y(h)); }
      ctx.stroke();
    }
    if (style === 'moss') {
      // a faint carpet of grass
      const P = floorPatterns();
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.translate(X(0), Y(0)); ctx.scale(PX / 22, PX / 22);
      ctx.fillStyle = P.grass; ctx.fillRect(0, 0, w * 22, h * 22);
      ctx.restore();
    }
    ctx.restore();
    ctx.save();
    // the lava itself: a churning layer and a brighter one drifting the other way
    const lavaAmt = Math.max(lavaVis, lavaWarn > 0 ? 0.25 + 0.2 * Math.sin(clock * 9) : 0);
    if (lavaAmt > 0.01 && !arena.def.open) {
      const P = floorPatterns(), sc = PX / 40;
      ctx.beginPath(); ctx.rect(X(1), Y(1), (w - 2) * PX, (h - 2) * PX); ctx.clip();
      ctx.globalAlpha = Math.min(1, lavaAmt);
      ctx.translate(X(0) + ((clock * 9) % 160) * sc, Y(0) + ((clock * 4) % 160) * sc); ctx.scale(sc, sc);
      ctx.fillStyle = P.lavaA; ctx.fillRect(-160, -160, w * 40 + 320, h * 40 + 320);
      ctx.restore(); ctx.save();
      ctx.beginPath(); ctx.rect(X(1), Y(1), (w - 2) * PX, (h - 2) * PX); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, lavaAmt) * (0.35 + 0.15 * Math.sin(clock * 2.3));
      ctx.translate(X(0) - ((clock * 13) % 128) * sc, Y(0) + ((clock * 7) % 128) * sc); ctx.scale(sc, sc);
      ctx.fillStyle = P.lavaB; ctx.fillRect(-128, -128, w * 40 + 256, h * 40 + 256);
    }
    ctx.restore();
    if (!L) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let k = 0; k < w * h; k++) {
      const r = hash(k * 13.7 + 5);
      if (r < 0.9) continue;
      const tx = k % w, ty = (k - tx) / w, x = X(tx), y = Y(ty);
      let a = 0, rgb = '225, 245, 255';
      if (L.ice > 0.02 && r > 0.93) a = L.ice * 0.2 * (0.4 + 0.6 * Math.sin(clock * 2.2 + k * 1.7));
      else if (style === 'crystal') { a = 0.32 * Math.max(0, Math.sin(clock * 2.6 + k * 2.3)) ** 3; rgb = k % 2 ? '120, 235, 255' : '190, 150, 255'; }
      if (a <= 0.01) continue;
      // a glint: a little four-point star, twinkling
      const cx = x + PX * hash(k + 3), cy = y + PX * hash(k + 4), sz = PX * 0.2;
      ctx.strokeStyle = `rgba(${rgb}, ${a})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - sz, cy); ctx.lineTo(cx + sz, cy); ctx.moveTo(cx, cy - sz); ctx.lineTo(cx, cy + sz); ctx.stroke();
    }
    ctx.restore();
  }

  // One block, top-down, in the cave's style. a: how lit (0..1); open: which
  // sides face open floor (top, right, bottom, left); rgb: the light's colour
  function drawBlock2D(style, k, tx, ty, a, open, rgb, th) {
    const x = X(tx), y = Y(ty), s = PX;
    if (style === 'moss') {
      // a bush: a cluster of round leafy clumps (it swells up when it grows back)
      const sc = 1 - 0.5 * tileGlow[k], h1 = hash(k * 3.1);
      ctx.fillStyle = `rgba(20, 60, 25, ${a * 0.85})`;
      ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.55 * sc, 0, Math.PI * 2); ctx.fill();
      for (let j = 0; j < 4; j++) {
        const ang = h1 * 6 + j * 1.57, cx = x + s / 2 + Math.cos(ang) * s * 0.2 * sc, cy = y + s / 2 + Math.sin(ang) * s * 0.2 * sc, rr = s * (0.3 + 0.06 * hash(k + j)) * sc;
        const g = ctx.createRadialGradient(cx - rr * 0.3, cy - rr * 0.35, rr * 0.1, cx, cy, rr);
        g.addColorStop(0, `rgba(170, 245, 120, ${a})`); g.addColorStop(1, `rgba(50, 140, 60, ${a * 0.9})`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
      }
      if (a > 0.3) {
        ctx.strokeStyle = `rgba(${rgb}, ${a * 0.55})`; ctx.lineWidth = Math.max(1, PX * 0.05);
        ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.56 * sc, 0, Math.PI * 2); ctx.stroke();
      }
      return;
    }
    if (style === 'lava') {
      // dark basalt standing in the lava, its foot glowing
      ctx.fillStyle = `rgba(36, 16, 12, ${Math.max(0.92, a)})`;
      ctx.fillRect(x, y, s + 0.5, s + 0.5);
      ctx.fillStyle = `rgba(110, 50, 34, ${0.25 + a * 0.6})`;
      ctx.fillRect(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76);
      ctx.strokeStyle = `rgba(${lavaVis > 0.1 ? '255, 140, 50' : rgb}, ${Math.max(a, lavaVis * 0.85)})`;
      ctx.lineWidth = Math.max(1.5, PX * 0.09);
    } else if (style === 'crystal') {
      // a cut gem: a bright facet, a dark facet, a glowing rim
      ctx.fillStyle = `rgba(${th.fill}, ${a * 0.85})`;
      ctx.fillRect(x, y, s + 0.5, s + 0.5);
      ctx.fillStyle = `rgba(200, 240, 255, ${a * 0.22})`;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s, y); ctx.lineTo(x + s / 2, y + s / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(150, 110, 255, ${a * 0.18})`;
      ctx.beginPath(); ctx.moveTo(x, y + s); ctx.lineTo(x + s, y + s); ctx.lineTo(x + s / 2, y + s / 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = `rgba(220, 245, 255, ${a * 0.35})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y); ctx.lineTo(x, y + s); ctx.stroke();
      ctx.strokeStyle = `rgba(${rgb}, ${a})`;
      ctx.lineWidth = Math.max(1.5, PX * 0.08);
    } else {
      ctx.fillStyle = `rgba(${th.fill}, ${a * 0.8})`;
      ctx.fillRect(x, y, s + 0.5, s + 0.5);
      ctx.strokeStyle = `rgba(${rgb}, ${a})`;
      ctx.lineWidth = Math.max(1.5, PX * 0.08);
    }
    ctx.beginPath();
    if (open[0]) { ctx.moveTo(x, y); ctx.lineTo(x + s, y); }
    if (open[1]) { ctx.moveTo(x + s, y); ctx.lineTo(x + s, y + s); }
    if (open[2]) { ctx.moveTo(x, y + s); ctx.lineTo(x + s, y + s); }
    if (open[3]) { ctx.moveTo(x, y); ctx.lineTo(x, y + s); }
    ctx.stroke();
  }

  // crystals and power-ups stay hidden too, until sound or a bat's senses find them
  function seenAt(x, y) {
    let a = litAt(x, y);
    for (const b of senses()) a = Math.max(a, Math.max(0, Math.min(1, 1 - (Math.hypot(x - b.x, y - b.y) - 1) / 1.5)));
    return Math.min(1, a * 1.2);
  }

  // (indexed by litBy: the bats' slot colours, then fire, ice and lightning)
  const BAT_RGB = LIGHT_RGB.map((rgb) => rgb.split(',').map((v) => +v / 255));
  const NO_BEAMS = [];   // (view3d.js still has a beam pool; battles no longer fire beams)
  function render() {
    if (in3d()) {
      let follow = viewer >= 0 ? bats[viewer] : localBat(0);
      // out (or waiting to come back): follow a teammate on this screen still flying, else whoever you're watching
      if (spectating()) follow = watched() || follow;
      else if (follow && (follow.out || follow.dead)) follow = bats.find((b) => b.ctrl === 'local' && !b.out && !b.dead) || follow;
      const ok = window.EchoDuel3D.render({
        W, H, arena, bats, lit, litBy, tileGlow, near: senses(), clock, rings, beams: NO_BEAMS, crystals, powerups, eats, shake, follow,
        batVisible, seenAt, batRgb: BAT_RGB, POWERS, BEAM_LIFE: 1, EAT_PULL, extra: extras3d,
        theme: TH().look, jumpH, jumpLift: JUMP_LIFT, big: bigArena, level: (b) => b.hv || 0, lava: lavaVis, lavaWarn,
      });
      if (ok) { render3dOverlay(follow); return; }
    }
    window.EchoDuel3D?.hide();
    const th = TH();
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
    else drawFloorTheme2D(th);

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
        const inner = tx > 0 && ty > 0 && tx < arena.w - 1 && ty < arena.h - 1, style = inner ? th.style : 'stone';
        if (!open.some(Boolean) && style !== 'lava' && style !== 'moss') continue;
        const l = lit[ty * arena.w + tx];
        // (blocks in lava always show, dark against the glow)
        let a = style === 'lava' ? Math.max(l, 0.35) : l;
        for (const b of near) {
          const d = Math.hypot(tx + 0.5 - b.x, ty + 0.5 - b.y);
          a = Math.max(a, Math.max(0, Math.min(1, 1 - (d - 0.7) / 1.4)) * 0.35);
        }
        if (a < 0.02) continue;
        const rgb = l > 0.05 ? LIGHT_RGB[litBy[ty * arena.w + tx]] : th.wall;
        drawBlock2D(style, ty * arena.w + tx, tx, ty, a, open, rgb, th);
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

    const P2 = (x, y) => ({ x: X(x), y: Y(y), s: PX });
    drawTwisters2D(P2);
    drawNovas(P2);
    drawShots(P2);

    for (const p of particles) {
      ctx.fillStyle = `rgba(${p.rgb}, ${Math.min(1, p.life * 1.6)})`;
      if (p.feather || p.leaf || p.shard) particleShape(p, X(p.x), Y(p.y), p.size);
      else ctx.fillRect(X(p.x) - p.size / 2, Y(p.y) - p.size / 2, p.size, p.size);
    }

    // (a bat hopping over a bite is drawn after the jaws, up above them)
    const hopping = (b) => airborne(b) && misses.some((m) => m.food === b.i);
    const drawBats = (top) => {
      for (const b of bats) {
        if (b.dead || hopping(b) !== top) continue;
        const v = batVisible(b);
        if (v > 0.03) drawBat(b, X(b.x), Y(b.y), { alpha: b.ctrl === 'local' || viewer === b.i ? undefined : v });
      }
    };
    drawBats(false);
    drawChomps((x, y) => ({ x: X(x), y: Y(y), s: PX }), true);
    drawMisses((x, y) => ({ x: X(x), y: Y(y), s: PX }), (b) => ({ x: X(b.x), y: Y(b.y - jumpH(b) * 0.95 - 0.95), s: PX }));
    drawBats(true);
    drawFxExtras(P2, false);
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
    const th = TH();
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
      if (p.feather || p.leaf || p.shard) particleShape(p, q.x, q.y, size);
      else ctx.fillRect(q.x - size / 2, q.y - size / 2, size, size);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const b of bats) {
      if (b.dead) continue;
      const v = batVisible(b);
      if (v < 0.03 || (b.safe > 0 && Math.floor(b.safe * 10) % 2 === 0)) continue;
      const q = P(b.x, b.y, lift3(b)), s = q.s;
      if (q.off) continue;
      ctx.globalAlpha = b.ctrl === 'local' || viewer === b.i ? 1 : v;
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
      if (isMine(b)) {
        youMarker(q.x, q.y + s * 0.62, Math.max(5, s * 0.13), b.rgb);
        jumpPips(b, q.x, q.y + s * 0.62 + Math.max(5, s * 0.13) * 0.9 + 6, Math.max(2.5, s * 0.055));
      }
      ctx.globalAlpha = 1;
    }
    drawChomps(P);
    // (the missed jaws snap down by the floor, under the bat hopping over them)
    drawMisses((x, y) => P(x, y, 0.12), (b) => P(b.x, b.y, lift3(b) + 0.75), 0.55);
    drawFxExtras(P, true);
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

  // A missed bite (the target was up in a jump): the biter's chomp snaps on
  // empty air and MISS! pops up over the bat that got away. P maps arena to
  // screen; top(bat) gives the spot over a bat for the text.
  function drawMisses(P, top, size) {
    if (!misses.length || !window.EchoChomp?.miss) return;
    for (const m of misses) {
      const a = m.eater;
      if (!a || a.dead) continue;
      const ca = Math.cos(m.ang), sa = Math.sin(m.ang);
      const q = P(a.x - ca * 0.05, a.y - sa * 0.05);
      if (q.off) continue;
      const f = bats[m.food], spot = f && !f.dead ? top(f) : top({ x: m.x, y: m.y, jumpT: 0 });
      EchoChomp.miss(ctx, q, spot && !spot.off ? spot : null, m.ang, m.t, a.color, a.rgb, EAT_PULL, size);
    }
  }
  // your jump meter under your own bat: three little pips, shown while it refills
  function jumpPips(b, x, y, r) {
    if (b.dead || b.jumps >= JUMP_CHARGES - 0.001 || !inPlay()) return;
    for (let k = 0; k < JUMP_CHARGES; k++) {
      const px = x + (k - 1) * r * 3, f = Math.max(0, Math.min(1, b.jumps - k));
      ctx.beginPath(); ctx.arc(px, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 16, 40, 0.75)'; ctx.fill();
      if (f >= 1) { ctx.fillStyle = '#8fdcff'; ctx.fill(); }
      else if (f > 0) {
        ctx.beginPath(); ctx.moveTo(px, y); ctx.arc(px, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); ctx.closePath();
        ctx.fillStyle = 'rgba(143, 220, 255, 0.55)'; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(px, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(143, 220, 255, 0.8)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  // Parry: a bat's open parry window shows as a thin bright guard ring; a
  // successful parry flashes white-gold rings with a spark burst and a crackle
  // of light back to the attacker. P(x, y) maps arena to screen: { x, y, s }.
  // shield pops, ice shattering, bats sinking into the lava. P maps arena to
  // screen; z (3D only) is the height to draw a bat's effects at
  // feathers and leaves flutter (an oval), ice shards spin (a sliver)
  function particleShape(p, x, y, size) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(p.life * 6 + (p.spin || 0));
    ctx.beginPath();
    if (p.shard) { ctx.moveTo(0, -size); ctx.lineTo(size * 0.35, size * 0.5); ctx.lineTo(-size * 0.35, size * 0.5); ctx.closePath(); }
    else ctx.ellipse(0, 0, size, size * (p.leaf ? 0.5 : 0.4), 0, 0, Math.PI * 2);
    ctx.fill(); ctx.restore();
  }
  function drawFxExtras(P, in3d) {
    for (const p of shieldPops) {
      const k = p.t / 0.6, b = bats[p.i], z = in3d && b ? lift3(b) : undefined, q = P(p.x, p.y, z);
      if (q.off) continue;
      drawShieldBubble(q.x, q.y, q.s * 0.72 * (1 + 0.7 * k), (1 - k) * (1 - k), 1 - k);
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * Math.PI * 2 + p.i, d = q.s * 0.72 * (1 + 1.1 * k);
        ctx.fillStyle = `rgba(220, 250, 255, ${0.9 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(q.x + Math.cos(a) * d, q.y + Math.sin(a) * d, Math.max(1.2, q.s * 0.04), 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const p of shatters) {
      const k = p.t / 0.6, q = P(p.x, p.y, in3d ? FLY_Y + (p.top ? 1 : 0) : undefined);
      if (q.off) continue;
      glow(q.x, q.y, q.s * (0.5 + 1.2 * k), '200, 240, 255', 0.55 * (1 - k));
    }
    for (const p of sinks) {
      const k = p.t / SINK_TIME, q = P(p.x, p.y, in3d ? 0.05 : undefined);
      if (q.off) continue;
      // orange ripples spreading over the lava, and the bat going under
      ctx.save();
      for (let j = 0; j < 3; j++) {
        const kk = Math.min(1, k * 1.3 + j * 0.2);
        ctx.strokeStyle = `rgba(255, ${170 + j * 30}, 80, ${0.8 * (1 - kk)})`; ctx.lineWidth = Math.max(1.5, q.s * 0.06);
        ctx.beginPath(); ctx.ellipse(q.x, q.y, q.s * (0.3 + 0.9 * kk), q.s * (0.3 + 0.9 * kk) * (in3d ? 0.5 : 0.7), 0, 0, Math.PI * 2); ctx.stroke();
      }
      glow(q.x, q.y, q.s * 1.2, '255, 150, 50', 0.5 * (1 - k));
      if (p.look) {
        const b = { ...p.look, safe: 0, dead: 0, shield: false, ice: 0, hv: 0, jumpT: 0, held: null, mega: false, power: null, mouth: 0, puff: 0 };
        const up = in3d ? P(p.x, p.y, FLY_Y * (1 - k)) : q;
        drawBat(b, up.x, up.y + (in3d ? 0 : q.s * 0.3 * k), { scale: Math.max(0.05, 1 - k * 0.9), rot: 0.001 + Math.sin(k * 20) * 0.2, alpha: 1 - k * 0.7, stunned: true, tag: false });
      }
      ctx.restore();
    }
  }
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
    if (biteShown()) { drawBiteButton(dashButton(), me); drawJumpButton(jumpButton(), me); }
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
  const FLY_Y = 0.55, JUMP_LIFT = 1.1;   // (a jump lifts a bat this high in 3D, over the 1-high walls)
  // how high a bat flies in 3D: up a block's height on the block tops, plus any jump
  const lift3 = (b) => FLY_Y + JUMP_LIFT * jumpH(b) + (b.hv || 0);
  let x3 = null;
  function build3d(T, scene) {
    const add = (o) => { scene.add(o); return o; };
    const glowMat = (color, opacity = 1) => new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
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
    // Frozen: a cluster of jagged, faceted ice crystals (a lumpy core and
    // spikes of different lengths), glassy, with bright facet edges
    const iceParts = [];
    {
      const core = new T.IcosahedronGeometry(0.4, 0);
      core.scale(1, 1.05, 0.95);
      iceParts.push(core);
      const spikes = [[0.1, 1, 0.15, 0.62, 0.15], [-0.75, 0.6, 0.2, 0.5, 0.13], [0.8, 0.5, -0.3, 0.46, 0.12], [-0.3, 0.55, -0.85, 0.44, 0.12],
        [0.45, 0.35, 0.85, 0.4, 0.11], [-0.9, -0.1, 0.4, 0.34, 0.1], [0.95, -0.15, 0.25, 0.32, 0.1], [0.2, -0.5, -0.8, 0.3, 0.1], [-0.35, 0.95, -0.2, 0.42, 0.11]];
      const up = new T.Vector3(0, 1, 0);
      for (const [x, y, z, len, rad] of spikes) {
        const g = new T.ConeGeometry(rad, len, 5, 1);
        g.translate(0, len / 2 + 0.22, 0);
        const d = new T.Vector3(x, y, z).normalize();
        g.applyQuaternion(new T.Quaternion().setFromUnitVectors(up, d));
        iceParts.push(g);
      }
    }
    const iceEdges = iceParts.map((g) => new T.EdgesGeometry(g, 1));
    const ices = BATS.map(() => {
      const g = new T.Group();
      const mat = new T.MeshPhongMaterial({ color: 0x9fdcff, emissive: 0x1d5a8a, specular: 0xffffff, shininess: 120, flatShading: true, transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide });
      const emat = new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
      for (const geo of iceParts) g.add(new T.Mesh(geo, mat));
      for (const geo of iceEdges) g.add(new T.LineSegments(geo, emat));
      const shine = new T.Mesh(ball, glowMat(0xbfeaff, 0.25)); shine.scale.setScalar(0.75); g.add(shine);
      g.visible = false; add(g);
      return { g, box: { material: mat }, edges: { material: emat }, shine };
    });
    const ghosts = BATS.map(() => { const m = add(new T.Mesh(ball, glowMat(0xd6c4ff, 0.18))); m.visible = false; return m; });
    return { scene, fires, fireLights, flashLight, twists, novas3, ices, ghosts, M: new T.Matrix4(), Q: new T.Quaternion(), E: new T.Euler(), V: new T.Vector3(), S: new T.Vector3(), C: new T.Color() };
  }
  function extras3d(T, scene) {
    if (!x3 || x3.scene !== scene) x3 = build3d(T, scene);
    const { M, Q, E, V, S, C } = x3;
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
      ic.g.position.set(b.x, lift3(b), b.y);
      ic.g.rotation.set(0.12, 0.4 + k * 1.7, 0.08);
      ic.g.scale.setScalar(0.7 + 0.5 * pop);
      ic.box.material.opacity = 0.5 * vis * pop; ic.edges.material.opacity = (0.4 + 0.25 * Math.sin(clock * 3 + k)) * vis * pop;
      ic.shine.material.opacity = (0.05 + 0.04 * Math.sin(clock * 4 + k)) * vis * pop;
    });
    x3.ghosts.forEach((m, k) => {
      const b = bats[k], vis = b && !b.dead && b.ghostT > 0 ? batVisible(b) : 0;
      m.visible = vis > 0.03;
      if (!m.visible) return;
      m.position.set(b.x, lift3(b), b.y);
      m.scale.setScalar(0.55 + 0.05 * Math.sin(clock * 6));
      m.material.opacity = 0.35 * Math.min(1, vis * 2);
    });
  }

  // Screen-space layer shared by both views: warnings, HUD, touch controls, fades
  function drawScreen() {
    // the echo storm pulses the screen edge
    if (storm && !over && !roundEnd) {
      const a = 0.22 + 0.22 * Math.sin(clock * 10);
      ctx.strokeStyle = `rgba(255, 226, 120, ${a})`;
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, W - 6, H - 6);
    }

    drawHud();
    if (guide) { drawGuide(); return; }
    drawSticks();
    if (actionShown()) drawActionButton();
  }

  // ---- The controls guide ----------------------------------------------------
  // Before a match (and, in Rounds, before each next round): a compact glass
  // panel with a row of icons (fly, squeak, bite, jump, power and the map's own
  // rule) and Start! for this device (offline) or the host (online); guests see
  // "Waiting for the host to start". Tap an icon for a card with the whole
  // story and a little looping demo; tap again (anywhere) to close it.
  const GUIDE_RGB = { fly: null, squeak: '255, 226, 120', bite: '166, 139, 255', jump: '143, 220, 255', power: '255, 150, 70' };
  // the map's own rules, for its icon and card
  const MAP_INFO = {
    lava: { title: 'LAVA HOLLOW', rgb: '255, 140, 60', short: 'The floor is lava: hop from block to block',
      text: 'The floor is lava! Everyone starts up on a block. JUMP to hop from block to block (fly off an edge and you drop). Touch the lava and you are out; in Free-for-all, whoever knocked you in scores the point.' },
    moss: { title: 'MOSSY DEN', rgb: '130, 235, 120', short: 'BITE·DASH through the bushes; they grow back',
      text: 'The blocks are bushes on soft grass. BITE·DASH into a bush to chomp right through it and make a shortcut (or an escape). Bushes grow back after a while.' },
    ice: { title: 'FROZEN CAVERN', rgb: '200, 230, 255', short: 'Slippery ice: you slide, so steer early',
      text: 'The floor is solid ice: you keep sliding after you let go, and bounce harder off the rock. Fewer blocks, lots of room to skid, so steer early and use the slide to dodge.' },
    crystal: { title: 'CRYSTAL GROTTO', rgb: '74, 222, 255', short: 'A mirrored crystal cave: every corner is the same',
      text: 'A crystal cave mirrored in all four quarters, so every start is fair. JUMP onto a crystal block to stand on top of it: bats down on the floor cannot bite you up there (and you cannot bite them).' },
    xtreme: { title: 'MORPHING XTREME', rgb: '255, 120, 200', short: 'Crystal, lava, ice and moss in turn',
      text: 'About every 30 seconds the cave turns into the next map: Crystal Grotto, Lava Hollow, Frozen Cavern, Mossy Den, each with its own rules. Before the lava comes a 3-2-1: get on a block!' },
    morph: { title: 'MORPHING', rgb: '150, 130, 255', short: 'The blocks slowly reshape around you',
      text: 'A few blocks at a time, the cave slowly reshapes into a new layout (now and then it melts into open sky). The rock never closes on you. JUMP onto a block to stand on top of it.' },
    sky: { title: 'OPEN SKY', rgb: '255, 236, 190', short: 'No cave at all, just the night',
      text: 'No cave at all, just the night sky and the moon. With no walls to light up, bats are still only found by sound: squeak to find your rivals.' },
  };
  const mapInfoKey = () => (arenaMode === 'xtreme' ? 'xtreme' : arenaMode === 'morph' ? 'morph' : arena?.def.open ? 'sky' : MAP_INFO[styleNow()] ? styleNow() : 'morph');
  function guideCards() {
    const multi = localCount > 1, keys = !touchUsed, m = MAP_INFO[mapInfoKey()];
    const specials = powerOn.filter((t) => POWERS[t].special).map((t) => POWERS[t].name), instant = powerOn.filter((t) => !POWERS[t].special).map((t) => POWERS[t].name);
    return [
      { id: 'fly', title: 'FLY', key: 'WASD / arrows',
        text: (multi ? 'Drag in your own part of the screen to steer.' : keys ? 'Steer with WASD or the arrow keys.' : 'Drag anywhere on the screen to steer.')
          + ' The cave is pitch dark: rivals only see you when sound or a light finds you.' },
      { id: 'squeak', title: 'SQUEAK', key: 'F / Space',
        text: (keys ? 'Squeak (F) to send out an echo ring.' : 'Tap to squeak: an echo ring goes out.')
          + ' It lights the cave and STUNS any rival it hits. Squeaks use echoes (top bar); glowing crystals refill them. Squeak just as a rival\'s echo or bite reaches you to PARRY: it bounces back and stuns them.' },
      { id: 'bite', title: 'BITE·DASH', key: 'G / Shift',
        text: (multi && !keys ? 'Flick to dash.' : 'Dash forward:') + ' touch a rival to chomp it for a point. Stunned rivals can\'t dodge. Bats mid-jump, or up on a different level (block top or floor), are out of reach. Two dashes meeting bounce apart.' },
      { id: 'jump', title: 'JUMP ×3', key: 'R',
        text: 'Hop over rock, echoes, fireballs and bites. Land on a block and you stay up on top: fly along the block tops, and fly off an edge (or jump) to get down. You hold 3 jumps; they refill as you fly.' },
      { id: 'power', title: 'POWER', key: 'E / Q',
        text: !powerFreq || !powerOn.length ? 'Power-ups are off this match.'
          : `Fly into glowing power-ups.${instant.length ? ` ${instant.join(', ')} work at once.` : ''}${specials.length ? ` ${specials.join(', ')} fill your POWER button${keys ? ' (E)' : ''}: use it to unleash them.` : ''}` },
      { id: 'map', title: m.title, key: '', text: m.text, rgb: m.rgb },
    ];
  }
  function guideLayout() {
    const round = guide && guide.kind === 'round';
    const ph = Math.max(30, Math.min(40, H * 0.085)), top = 8 + ph + 6, room = H - top - 6;
    const need = 196;
    const u = Math.max(0.7, Math.min(1.12, room / need, (W - 16) / 500));
    const pw = Math.min(W - 16, 500 * u), phh = Math.min(room, need * u);
    const px = (W - pw) / 2, py = top + Math.max(0, (room - phh) / 2);
    const bw = 160 * u, bh = 34 * u;
    const start = { x: W / 2 - bw / 2, y: py + phh - bh - 9 * u, w: bw, h: bh };
    const cards = guideCards(), n = cards.length, slot = Math.min(80 * u, (pw - 16 * u) / n), r = Math.min(19 * u, slot * 0.3);
    const iy = py + (round ? 78 : 86) * u;
    const icons = cards.map((c, k) => ({ id: c.id, x: W / 2 + (k - (n - 1) / 2) * slot, y: iy, r, slot }));
    const card = { x: px + 8 * u, y: py + 8 * u, w: pw - 16 * u, h: start.y - 7 * u - (py + 8 * u) };
    return { round, u, px, py, pw, ph: phh, start, icons, card, cards };
  }
  // what a tap on the guide hits: 'start', an icon's id, or null
  function guideHit(cx, cy) {
    if (!guide || !W) return null;
    const rect = canvas.getBoundingClientRect(), L = guideLayout(), b = L.start, x = cx - rect.left, y = cy - rect.top;
    if (x > b.x - 10 && x < b.x + b.w + 10 && y > b.y - 8 && y < b.y + b.h + 10) return 'start';
    if (guide.card) return null;
    for (const ic of L.icons) if (Math.abs(x - ic.x) < ic.slot / 2 && y > ic.y - ic.r - 10 && y < ic.y + ic.r + 24 * L.u) return ic.id;
    return null;
  }
  const inStartButton = (cx, cy) => guideHit(cx, cy) === 'start';
  function guideTap(cx, cy) {
    const hit = guideHit(cx, cy);
    if (hit === 'start') { if (canStartGuide()) startFromGuide(); return; }
    if (guide.card) { guide.card = null; return; }
    if (hit) { guide.card = hit; applyFx({ k: 'sfx', n: 'tick', alt: 'beep' }); }
  }
  function wrapLines(text, maxW) {
    const out = [];
    let line = '';
    for (const w of text.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
    return out;
  }
  // each control's picture: the real buttons for bite, jump and power, a drag stick and echo rings for the rest
  function guideIcon(id, x, y, r) {
    const me = localBat(0) || bats[viewer] || bats[0];
    if (id === 'bite') drawBiteButton({ x, y, r }, { dashCd: 0 });
    else if (id === 'jump') drawJumpButton({ x, y, r }, { jumpT: 0, jumpCd: 0, jumps: JUMP_CHARGES });
    else if (id === 'power') drawSpecialFace({ x, y, r }, { held: 'ghost', specialCd: 0, stun: 0, dead: 0, heldLeft: 0 });
    else if (id === 'map') drawMapIcon(x, y, r);
    else if (id === 'fly') {
      const rgb = me ? me.rgb : '150, 130, 255', a = clock * 1.6, kx = Math.cos(a) * r * 0.42, ky = Math.sin(a) * r * 0.42;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20, 16, 52, 0.6)'; ctx.fill();
      glowStroke(`rgba(${rgb}, 0.75)`, 2.5, `rgba(${rgb}, 1)`, 0.6);
      ctx.strokeStyle = `rgba(${rgb}, 0.5)`; ctx.lineWidth = Math.max(2, r * 0.1); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + kx, y + ky); ctx.stroke(); ctx.lineCap = 'butt';
      glow(x + kx, y + ky, r * 0.7, rgb, 0.45);
      ctx.fillStyle = `rgba(${rgb}, 0.95)`;
      ctx.beginPath(); ctx.arc(x + kx, y + ky, r * 0.3, 0, Math.PI * 2); ctx.fill();
    } else if (id === 'squeak') {
      const rgb = GUIDE_RGB.squeak;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(40, 30, 20, 0.5)'; ctx.fill();
      glowStroke(`rgba(${rgb}, 0.6)`, 2, null);
      for (let k = 0; k < 3; k++) {
        const f = (clock * 0.9 + k / 3) % 1;
        ctx.strokeStyle = `rgba(${rgb}, ${0.9 * (1 - f)})`; ctx.lineWidth = Math.max(1.5, r * 0.08);
        ctx.beginPath(); ctx.arc(x, y, r * (0.2 + 0.75 * f), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#fff6d0';
      ctx.beginPath(); ctx.arc(x, y, r * 0.16, 0, Math.PI * 2); ctx.fill();
    }
  }
  // the map's icon: a little picture of its rule
  function drawMapIcon(x, y, r) {
    const key = mapInfoKey(), m = MAP_INFO[key], T = performance.now() / 1000;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    const bg = { lava: 'rgba(120, 30, 6, 0.85)', moss: 'rgba(30, 80, 30, 0.85)', ice: 'rgba(60, 90, 140, 0.8)', crystal: 'rgba(24, 40, 90, 0.85)', sky: 'rgba(16, 20, 60, 0.85)' }[key] || 'rgba(30, 24, 74, 0.85)';
    ctx.fillStyle = bg; ctx.fill();
    ctx.save(); ctx.clip();
    if (key === 'lava') {
      for (let k = 0; k < 5; k++) glow(x + Math.cos(T * 0.7 + k * 1.3) * r * 0.6, y + Math.sin(T * 0.9 + k * 2.1) * r * 0.6, r * 0.6, k % 2 ? '255, 200, 80' : '255, 100, 20', 0.8);
      ctx.fillStyle = 'rgb(40, 18, 14)'; ctx.fillRect(x - r * 0.42, y - r * 0.2, r * 0.5, r * 0.5);
      ctx.strokeStyle = 'rgba(255, 150, 60, 0.9)'; ctx.lineWidth = 1.5; ctx.strokeRect(x - r * 0.42, y - r * 0.2, r * 0.5, r * 0.5);
    } else if (key === 'moss') {
      for (const [dx, dy, rr] of [[-0.3, 0.15, 0.32], [0.25, 0.18, 0.3], [0, -0.12, 0.36]]) {
        const g = ctx.createRadialGradient(x + dx * r - rr * r * 0.3, y + dy * r - rr * r * 0.3, 1, x + dx * r, y + dy * r, rr * r);
        g.addColorStop(0, 'rgb(170, 245, 120)'); g.addColorStop(1, 'rgb(50, 140, 60)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2); ctx.fill();
      }
    } else if (key === 'ice') {
      ctx.strokeStyle = 'rgba(235, 248, 255, 0.95)'; ctx.lineWidth = Math.max(1.5, r * 0.09); ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI + T * 0.3, c = Math.cos(a) * r * 0.62, sn = Math.sin(a) * r * 0.62;
        ctx.moveTo(x - c, y - sn); ctx.lineTo(x + c, y + sn);
        for (const sg of [-1, 1]) {
          const bx = x + c * 0.6 * sg, by = y + sn * 0.6 * sg;
          ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a + 2.4 * sg) * r * 0.2 * sg, by + Math.sin(a + 2.4 * sg) * r * 0.2 * sg);
        }
      }
      ctx.stroke();
    } else if (key === 'crystal') {
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) gem(x + sx * r * 0.36, y + sy * r * 0.36, r * 0.22, sx * sy > 0 ? '120, 235, 255' : '190, 150, 255');
    } else if (key === 'sky') {
      ctx.fillStyle = '#fff6d0'; ctx.beginPath(); ctx.arc(x + r * 0.2, y - r * 0.1, r * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x + r * 0.38, y - r * 0.24, r * 0.36, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 5; k++) { ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + 0.5 * Math.sin(T * 3 + k)})`; ctx.fillRect(x - r * 0.7 + k * r * 0.3, y + ((k * 37) % 10 - 5) * r * 0.1, 2, 2); }
    } else {
      // morphing: blocks flipping on and off
      const cols = key === 'xtreme' ? ['74, 222, 255', '255, 140, 60', '200, 230, 255', '130, 235, 120'] : [m.rgb];
      const c = cols[Math.floor(T / 1.2) % cols.length];
      for (let k = 0; k < 9; k++) {
        const on = Math.sin(T * 1.6 + k * 2.3) > 0;
        if (!on) continue;
        ctx.fillStyle = `rgba(${c}, 0.8)`;
        ctx.fillRect(x - r * 0.6 + (k % 3) * r * 0.42, y - r * 0.6 + Math.floor(k / 3) * r * 0.42, r * 0.36, r * 0.36);
      }
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    glowStroke(`rgba(${m.rgb}, 0.8)`, 2, `rgba(${m.rgb}, 1)`, 0.6);
    ctx.restore();
  }
  function gem(x, y, s, rgb) {
    ctx.beginPath(); ctx.moveTo(x, y - s * 1.2); ctx.lineTo(x + s * 0.75, y); ctx.lineTo(x, y + s * 1.2); ctx.lineTo(x - s * 0.75, y); ctx.closePath();
    ctx.fillStyle = `rgba(${rgb}, 0.75)`; ctx.fill();
    ctx.strokeStyle = 'rgba(240, 250, 255, 0.9)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - s * 1.2); ctx.lineTo(x - s * 0.2, y); ctx.lineTo(x, y + s * 1.2); ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'; ctx.stroke();
  }

  // A little bat for the guide's demos: o.stun (X eyes), o.mouth (0..1), o.ph (flap phase)
  function miniBat(x, y, r, rgb, o = {}) {
    const T = performance.now() / 1000, flap = o.stun ? 0.2 : Math.sin(T * 16 + (o.ph || 0));
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    glow(x, y, r * 2.6, rgb, 0.3);
    ctx.fillStyle = `rgb(${rgb})`;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * r * 0.5, y - r * 0.15); ctx.lineTo(x + s * r * 2.1, y - r * (0.25 + flap * 0.75));
      ctx.lineTo(x + s * r * 1.6, y + r * 0.35); ctx.lineTo(x + s * r * 1.15, y + r * 0.1); ctx.lineTo(x + s * r * 0.8, y + r * 0.45);
      ctx.closePath(); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.75, y - r * 0.5); ctx.lineTo(x - r * 0.45, y - r * 1.35); ctx.lineTo(x - r * 0.1, y - r * 0.8);
    ctx.moveTo(x + r * 0.75, y - r * 0.5); ctx.lineTo(x + r * 0.45, y - r * 1.35); ctx.lineTo(x + r * 0.1, y - r * 0.8);
    ctx.fill();
    if (o.stun) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, r * 0.14);
      for (const s of [-1, 1]) { const ex = x + s * r * 0.32, ey = y - r * 0.1, k = r * 0.14; ctx.beginPath(); ctx.moveTo(ex - k, ey - k); ctx.lineTo(ex + k, ey + k); ctx.moveTo(ex + k, ey - k); ctx.lineTo(ex - k, ey + k); ctx.stroke(); }
      for (let k = 0; k < 3; k++) { const a = T * 5 + k * 2.1; ctx.fillStyle = '#ffe278'; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 1.3, y - r * 1.5 + Math.sin(a) * r * 0.35, Math.max(1.5, r * 0.18), 0, Math.PI * 2); ctx.fill(); }
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x - r * 0.32, y - r * 0.1, r * 0.22, 0, Math.PI * 2); ctx.arc(x + r * 0.32, y - r * 0.1, r * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1030';
      ctx.beginPath(); ctx.arc(x - r * 0.28, y - r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.arc(x + r * 0.36, y - r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.fill();
    }
    if (o.mouth > 0) {
      ctx.fillStyle = '#2a0614';
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.38, r * 0.5 * o.mouth, r * 0.45 * o.mouth, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Each card's looping demo, drawn in the box (x, y, w, h)
  function drawDemo(id, x, y, w, h) {
    const T = performance.now() / 1000, me = (localBat(0) || bats[viewer] || bats[0])?.rgb || '166, 139, 255', foe = '255, 120, 140';
    const r = Math.min(w, h) * 0.075, cx = x + w / 2, cy = y + h / 2;
    const lerp = (a, b, k) => a + (b - a) * k, cl = (v) => Math.max(0, Math.min(1, v)), ease = (k) => k * k * (3 - 2 * k);
    const block = (bx, by, s, rgb = '74, 222, 255', fill = '18, 52, 80') => {
      ctx.fillStyle = `rgba(${fill}, 0.9)`; ctx.fillRect(bx, by, s, s);
      ctx.strokeStyle = `rgba(${rgb}, 0.9)`; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, s, s);
    };
    ctx.save();
    roundRect(x, y, w, h, 8); ctx.clip();
    ctx.fillStyle = '#070816'; ctx.fillRect(x, y, w, h);
    if (id === 'fly') {
      const t = T * 1.1, bx = cx + Math.cos(t) * w * 0.28, by = cy + Math.sin(t * 2) * h * 0.2;
      for (let k = 1; k < 14; k++) { const tt = t - k * 0.06; ctx.fillStyle = `rgba(${me}, ${0.25 * (1 - k / 14)})`; ctx.beginPath(); ctx.arc(cx + Math.cos(tt) * w * 0.28, cy + Math.sin(tt * 2) * h * 0.2, r * 0.5, 0, Math.PI * 2); ctx.fill(); }
      miniBat(bx, by, r, me);
      // the drag stick that steers it
      const sx = x + w * 0.16, sy = y + h * 0.76, sr = h * 0.13, vx = -Math.sin(t), vy = 2 * Math.cos(t * 2), vl = Math.hypot(vx, vy) || 1;
      ctx.strokeStyle = 'rgba(244, 241, 255, 0.4)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(244, 241, 255, 0.75)'; ctx.beginPath(); ctx.arc(sx + (vx / vl) * sr * 0.6, sy + (vy / vl) * sr * 0.6, sr * 0.38, 0, Math.PI * 2); ctx.fill();
    } else if (id === 'squeak') {
      // odd loops: your echo stuns the rival; even loops: the rival's echo is parried back
      const P2 = 2.6, n = Math.floor(T / P2), k = (T % P2) / P2, parry = n % 2 === 1;
      const ax = x + w * 0.25, bx = x + w * 0.75, d = bx - ax;
      for (let j = 0; j < 6; j++) {
        const tx = x + w * (0.08 + j * 0.17), lit = 1 - Math.abs((parry ? bx : ax) + (parry ? -1 : 1) * k * d * 1.6 - tx) / (w * 0.15);
        block(tx, y + 4, w * 0.12, cl(lit) > 0.05 ? GUIDE_RGB.squeak : '60, 60, 110'); block(tx, y + h - 4 - w * 0.12, w * 0.12, cl(lit) > 0.05 ? GUIDE_RGB.squeak : '60, 60, 110');
      }
      if (!parry) {
        const rr = k * d * 1.6;
        ctx.strokeStyle = `rgba(${me}, ${1 - k})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(ax, cy, rr, 0, Math.PI * 2); ctx.stroke();
        miniBat(ax, cy, r, me, { ph: 0 });
        miniBat(bx, cy, r, foe, { stun: rr > d, ph: 2 });
        if (rr > d) { ctx.font = `700 ${Math.round(h * 0.11)}px ${HEAD}`; ctx.fillStyle = `rgba(255, 226, 120, ${1 - k})`; ctx.fillText('STUNNED!', bx, cy - r * 3); }
      } else {
        const hitK = 0.42, back = k > hitK, rr = back ? (k - hitK) * d * 1.9 : k / hitK * d;
        ctx.strokeStyle = `rgba(${back ? me : foe}, 0.95)`; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(back ? ax : bx, cy, Math.max(1, back ? rr : rr), 0, Math.PI * 2); ctx.stroke();
        miniBat(ax, cy, r, me);
        miniBat(bx, cy, r, foe, { stun: back && rr > d, ph: 2 });
        if (back) {
          const f = cl(1 - (k - hitK) * 3);
          ctx.strokeStyle = `rgba(${PARRY_RGB}, ${f})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ax, cy, r * (1.6 + (1 - f)), 0, Math.PI * 2); ctx.stroke();
          ctx.font = `700 ${Math.round(h * 0.13)}px ${HEAD}`; ctx.fillStyle = `rgba(${PARRY_RGB}, ${cl(1.6 - (k - hitK) * 2.5)})`; ctx.fillText('PARRY!', ax, cy - r * 3);
        }
      }
    } else if (id === 'bite') {
      const k = (T % 2.2) / 2.2, bx = x + w * 0.74;
      let ax = x + w * 0.18;
      if (k < 0.35) ax = lerp(x + w * 0.14, x + w * 0.3, k / 0.35);
      else if (k < 0.5) ax = lerp(x + w * 0.3, bx - r * 1.6, ease((k - 0.35) / 0.15));
      else ax = bx - r * 1.6;
      if (k > 0.35 && k < 0.55) for (let j = 1; j < 6; j++) { ctx.fillStyle = `rgba(${me}, ${0.3 - j * 0.05})`; ctx.beginPath(); ctx.arc(ax - j * r * 0.7, cy, r * 0.8, 0, Math.PI * 2); ctx.fill(); }
      const eaten = k > 0.55, sw = cl((k - 0.5) / 0.15);
      if (!eaten || k < 0.62) miniBat(lerp(bx, ax + r, sw), cy, r * (1 - sw * 0.8), foe, { stun: k > 0.3, ph: 2, alpha: 1 - sw * 0.5 });
      miniBat(ax, cy, r * (1 + (k > 0.6 && k < 0.85 ? 0.3 : 0)), me, { mouth: k > 0.45 && k < 0.62 ? 1 : 0 });
      if (k < 0.3) { ctx.font = `700 ${Math.round(h * 0.1)}px ${HEAD}`; ctx.fillStyle = 'rgba(255, 226, 120, 0.9)'; ctx.fillText('stunned', bx, cy - r * 3); }
      if (k > 0.58) { ctx.font = `700 ${Math.round(h * 0.15)}px ${HEAD}`; ctx.fillStyle = `rgba(${GUIDE_RGB.bite}, ${cl((1 - k) * 4)})`; ctx.fillText('CHOMP! +1', cx, y + h * 0.2); }
    } else if (id === 'jump') {
      // seen from the side: the floor, a block, a bat that hops up, stays on top, then drops off
      const gy = y + h * 0.82, bh = h * 0.32, b0 = x + w * 0.38, b1 = x + w * 0.7;
      ctx.fillStyle = 'rgba(80, 80, 160, 0.4)'; ctx.fillRect(x, gy, w, h - (gy - y));
      ctx.fillStyle = 'rgba(18, 52, 80, 0.95)'; ctx.fillRect(b0, gy - bh, b1 - b0, bh);
      ctx.strokeStyle = 'rgba(74, 222, 255, 0.9)'; ctx.lineWidth = 2; ctx.strokeRect(b0, gy - bh, b1 - b0, bh);
      const k = (T % 3.2) / 3.2, fy = gy - r * 1.4;
      let bx, by;
      if (k < 0.18) { bx = lerp(x + w * 0.06, x + w * 0.26, k / 0.18); by = fy; }
      else if (k < 0.36) { const j = (k - 0.18) / 0.18; bx = lerp(x + w * 0.26, b0 + w * 0.08, j); by = lerp(fy, fy - bh, j) - Math.sin(j * Math.PI) * h * 0.22; }
      else if (k < 0.7) { bx = lerp(b0 + w * 0.08, b1 - r * 0.2, (k - 0.36) / 0.34); by = fy - bh; }
      else if (k < 0.8) { const j = (k - 0.7) / 0.1; bx = lerp(b1 - r * 0.2, b1 + w * 0.06, j); by = lerp(fy - bh, fy, j * j); }
      else { bx = lerp(b1 + w * 0.06, x + w * 0.94, (k - 0.8) / 0.2); by = fy; }
      const onTop = bx > b0 && bx < b1 && by < fy - bh * 0.5;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'; ctx.beginPath(); ctx.ellipse(bx, (bx > b0 && bx < b1 ? gy - bh : gy) - 1, r * 1.1, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      miniBat(bx, by, r, me);
      ctx.font = `700 ${Math.round(h * 0.1)}px ${HEAD}`; ctx.fillStyle = 'rgba(143, 220, 255, 0.9)';
      ctx.fillText(k > 0.18 && k < 0.36 ? 'JUMP!' : onTop ? 'up on the block' : k >= 0.7 && k < 0.85 ? 'off the edge' : '', cx, y + h * 0.13);
    } else if (id === 'power') {
      const k = (T % 3) / 3, px = x + w * 0.55, sx = x + w * 0.12;
      const got = k > 0.35, bx = got ? px : lerp(sx, px, ease(k / 0.35));
      if (!got) { glow(px, cy, r * 3, POWERS.shield.rgb, 0.5); drawIcon('shield', px, cy, r * 1.1, `rgb(${POWERS.shield.rgb})`); }
      miniBat(bx, cy, r, me);
      if (got) {
        const hit = k > 0.7, f = hit ? cl(1 - (k - 0.7) * 4) : 1;
        if (f > 0) drawShieldBubble(bx, cy, r * 2.3, f, hit ? 1 - f : 0);
        // a rival's echo comes in and is soaked up
        const ex = x + w * 0.95, rr = cl((k - 0.45) / 0.25) * (ex - bx - r * 2);
        if (k > 0.45 && k < 0.72) { ctx.strokeStyle = `rgba(${foe}, 0.9)`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(ex, cy, rr, Math.PI * 0.7, Math.PI * 1.3); ctx.stroke(); }
        ctx.font = `700 ${Math.round(h * 0.12)}px ${HEAD}`; ctx.fillStyle = `rgba(${POWERS.shield.rgb}, ${hit ? f : 0.9})`;
        ctx.fillText(hit ? 'BLOCKED' : 'SHIELD', bx, cy - r * 3.4);
      }
    } else if (id === 'map') {
      drawMapDemo(mapInfoKey(), x, y, w, h, r, me, foe);
    }
    ctx.restore();
  }
  function drawMapDemo(key, x, y, w, h, r, me, foe) {
    const T = performance.now() / 1000, cy = y + h / 2, lerp = (a, b, k) => a + (b - a) * k;
    if (key === 'lava') {
      const P = floorPatterns();
      ctx.save(); ctx.translate(x + ((T * 12) % 160) - 160, y + ((T * 5) % 160) - 160); ctx.fillStyle = P.lavaA; ctx.fillRect(0, 0, w + 320, h + 320); ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4; ctx.translate(x - ((T * 17) % 128), y + ((T * 9) % 128) - 128); ctx.fillStyle = P.lavaB; ctx.fillRect(0, 0, w + 256, h + 256); ctx.restore();
      const s = h * 0.3, xs = [0.18, 0.5, 0.82].map((f) => x + w * f), k = (T % 3.6) / 3.6;
      for (const bx of xs) {
        ctx.fillStyle = 'rgb(36, 16, 12)'; ctx.fillRect(bx - s / 2, cy - s / 2, s, s);
        ctx.strokeStyle = 'rgba(255, 150, 60, 0.95)'; ctx.lineWidth = 2; ctx.strokeRect(bx - s / 2, cy - s / 2, s, s);
      }
      // hop, hop, then back again
      const seg = k < 0.5 ? k * 2 : (1 - k) * 2, pos = seg * 2, i = Math.min(1, Math.floor(pos)), j = pos - i;
      const hop = Math.max(0, Math.min(1, (j - 0.35) / 0.4)), bx = lerp(xs[i], xs[i + 1], hop), up = Math.sin(hop * Math.PI);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; ctx.beginPath(); ctx.ellipse(bx, cy + r * 0.6, r * (1.1 - up * 0.3), r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      miniBat(bx, cy - up * h * 0.18, r * (1 + up * 0.4), me);
      ctx.font = `700 ${Math.round(h * 0.11)}px ${HEAD}`; ctx.fillStyle = 'rgba(255, 230, 160, 0.95)';
      ctx.fillText(up > 0.1 ? 'HOP!' : 'the floor is lava', x + w / 2, y + h * 0.12);
    } else if (key === 'moss') {
      ctx.fillStyle = 'rgb(40, 90, 40)'; ctx.fillRect(x, y, w, h);
      ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = floorPatterns().grass; ctx.fillRect(x, y, w, h); ctx.restore();
      const k = (T % 4) / 4, s = h * 0.24, bush = (bx, by, sc) => {
        if (sc <= 0.02) return;
        for (const [dx, dy, rr] of [[-0.22, 0.12, 0.3], [0.22, 0.14, 0.28], [0, -0.14, 0.34]]) {
          const g = ctx.createRadialGradient(bx + dx * s - s * 0.1, by + dy * s - s * 0.1, 1, bx + dx * s, by + dy * s, rr * s * 1.4 * sc);
          g.addColorStop(0, 'rgb(170, 245, 120)'); g.addColorStop(1, 'rgb(50, 140, 60)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx + dx * s * sc, by + dy * s * sc, rr * s * 1.4 * sc, 0, Math.PI * 2); ctx.fill();
        }
      };
      const mx = x + w * 0.55, gone = k > 0.3 && k < 0.8, regrow = k >= 0.8 ? (k - 0.8) / 0.2 : 1;
      for (const yy of [cy - s * 1.3, cy + s * 1.3]) bush(mx, yy, 1);
      bush(mx, cy, gone ? 0 : regrow);
      if (k > 0.3 && k < 0.45) for (let j = 0; j < 8; j++) { const a = j * 0.8 + 1, d = (k - 0.3) * w * 0.6; ctx.fillStyle = j % 2 ? 'rgb(170, 255, 120)' : 'rgb(80, 190, 90)'; ctx.beginPath(); ctx.ellipse(mx + Math.cos(a) * d, cy + Math.sin(a) * d, 4, 2, a, 0, Math.PI * 2); ctx.fill(); }
      const bx = k < 0.22 ? lerp(x + w * 0.1, x + w * 0.3, k / 0.22) : k < 0.36 ? lerp(x + w * 0.3, x + w * 0.82, (k - 0.22) / 0.14) : x + w * 0.82;
      miniBat(bx, cy, r, me, { mouth: k > 0.25 && k < 0.36 ? 1 : 0 });
      ctx.font = `700 ${Math.round(h * 0.11)}px ${HEAD}`; ctx.fillStyle = 'rgba(200, 255, 170, 0.95)';
      ctx.fillText(k > 0.28 && k < 0.5 ? 'CHOMP!' : k >= 0.8 ? 'growing back...' : '', x + w / 2, y + h * 0.12);
    } else if (key === 'ice') {
      const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, 'rgb(120, 160, 220)'); g.addColorStop(1, 'rgb(60, 90, 150)');
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'; ctx.lineWidth = 3;
      for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.moveTo(x + k * w * 0.25, y); ctx.lineTo(x + k * w * 0.25 - h * 0.6, y + h); ctx.stroke(); }
      // steer right, let go, and keep sliding past the mark
      const k = (T % 3) / 3, t = k < 0.5 ? k * 2 : 1, bx = x + w * (0.12 + 0.62 * (1 - (1 - t) ** 2.2) + (k > 0.5 ? 0.12 * Math.sin((k - 0.5) * Math.PI) : 0));
      ctx.strokeStyle = 'rgba(240, 250, 255, 0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + w * 0.12, cy + r * 0.9); ctx.lineTo(bx, cy + r * 0.9); ctx.stroke();
      ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'; ctx.beginPath(); ctx.moveTo(x + w * 0.74, y + h * 0.25); ctx.lineTo(x + w * 0.74, y + h * 0.75); ctx.stroke(); ctx.setLineDash([]);
      miniBat(bx, cy, r, me);
      ctx.font = `700 ${Math.round(h * 0.11)}px ${HEAD}`; ctx.fillStyle = 'rgba(235, 248, 255, 0.95)';
      ctx.fillText(k < 0.5 ? 'fly...' : 'let go: still sliding!', x + w / 2, y + h * 0.13);
    } else if (key === 'crystal') {
      ctx.fillStyle = 'rgb(16, 20, 50)'; ctx.fillRect(x, y, w, h);
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        for (const [dx, dy] of [[0.28, 0.25], [0.12, 0.3]]) gem(x + w / 2 + sx * dx * w, cy + sy * dy * h, h * 0.07, (dx > 0.2) ? '120, 235, 255' : '190, 150, 255');
      }
      ctx.strokeStyle = 'rgba(150, 200, 255, 0.25)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); ctx.stroke(); ctx.setLineDash([]);
      const a = T * 0.9;
      for (const [sx, sy, rgb] of [[1, 1, me], [-1, 1, foe], [1, -1, '120, 230, 160'], [-1, -1, '255, 210, 90']]) miniBat(x + w / 2 + sx * Math.cos(a) * w * 0.2, cy + sy * Math.sin(a) * h * 0.18, r * 0.8, rgb);
      ctx.font = `700 ${Math.round(h * 0.1)}px ${HEAD}`; ctx.fillStyle = 'rgba(200, 240, 255, 0.9)'; ctx.fillText('every quarter the same', x + w / 2, y + h * 0.1);
    } else if (key === 'sky') {
      ctx.fillStyle = 'rgb(10, 14, 40)'; ctx.fillRect(x, y, w, h);
      for (let k = 0; k < 30; k++) { ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + 0.4 * Math.sin(T * 2 + k)})`; ctx.fillRect(x + hash(k) * w, y + hash(k + 50) * h, 1.5, 1.5); }
      ctx.fillStyle = '#fff6d0'; ctx.beginPath(); ctx.arc(x + w * 0.8, y + h * 0.25, h * 0.12, 0, Math.PI * 2); ctx.fill();
      miniBat(x + w * 0.5 + Math.cos(T) * w * 0.25, cy + Math.sin(T * 1.3) * h * 0.2, r, me);
    } else {
      // morphing: a grid of blocks reshaping (Xtreme: in each map's colours, with its name)
      const names = ['Crystal Grotto', 'Lava Hollow', 'Frozen Cavern', 'Mossy Den'], cols = ['74, 222, 255', '255, 140, 60', '200, 230, 255', '130, 235, 120'];
      const stage = Math.floor(T / 2.5), k = (T % 2.5) / 2.5, xt = key === 'xtreme';
      const rgb = xt ? cols[stage % 4] : '120, 200, 255', s = h / 6;
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < Math.floor(w / s) - 1; gx++) {
        const h1 = hash(gx * 7 + gy * 13 + stage * 31), h0 = hash(gx * 7 + gy * 13 + (stage - 1) * 31), sw = hash(gx * 3 + gy * 5) < k * 1.3;
        if ((sw ? h1 : h0) < 0.7) continue;
        ctx.fillStyle = `rgba(${rgb}, 0.28)`; ctx.fillRect(x + s * 0.5 + gx * s, y + s * 0.5 + gy * s, s - 2, s - 2);
        ctx.strokeStyle = `rgba(${rgb}, 0.9)`; ctx.lineWidth = 1.2; ctx.strokeRect(x + s * 0.5 + gx * s, y + s * 0.5 + gy * s, s - 2, s - 2);
      }
      miniBat(x + w * 0.5 + Math.cos(T * 0.8) * w * 0.3, cy + Math.sin(T * 1.6) * h * 0.25, r * 0.85, me);
      if (xt) { ctx.font = `700 ${Math.round(h * 0.12)}px ${HEAD}`; ctx.fillStyle = `rgb(${rgb})`; ctx.fillText(names[stage % 4], x + w / 2, y + h * 0.1); }
    }
  }

  function drawGuide() {
    const L = guideLayout(), u = L.u, cards = L.cards, T = performance.now() / 1000;
    ctx.save();
    ctx.fillStyle = 'rgba(4, 3, 16, 0.55)';
    ctx.fillRect(0, 0, W, H);
    // the glass panel
    const pg = ctx.createLinearGradient(0, L.py, 0, L.py + L.ph);
    pg.addColorStop(0, 'rgba(30, 24, 74, 0.9)'); pg.addColorStop(1, 'rgba(8, 8, 28, 0.92)');
    ctx.fillStyle = pg;
    roundRect(L.px, L.py, L.pw, L.ph, 16 * u); ctx.fill();
    glowStroke('rgba(150, 130, 255, 0.85)', 2, 'rgba(150, 130, 255, 1)', 1.2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const open = guide.card && cards.find((c) => c.id === guide.card);
    if (open) {
      // the detail card: a demo on the left, the whole story on the right
      const C = L.card, rgb = open.rgb || GUIDE_RGB[open.id] || (localBat(0) || bats[viewer] || bats[0]).rgb;
      const dh = C.h - 12 * u, dw = Math.min(C.w * 0.42, dh * 1.45), dx = C.x + 6 * u, dy = C.y + 6 * u;
      drawDemo(open.id, dx, dy, dw, dh);
      roundRect(dx, dy, dw, dh, 8); ctx.strokeStyle = `rgba(${rgb}, 0.6)`; ctx.lineWidth = 1.5; ctx.stroke();
      const tx = dx + dw + 12 * u, tw = C.x + C.w - tx - 26 * u;
      ctx.textAlign = 'left';
      ctx.font = `700 ${Math.round(15 * u)}px ${HEAD}`;
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.fillText(open.title, tx, C.y + 15 * u);
      if (!touchUsed && open.key) {
        const t1 = ctx.measureText(open.title).width;
        ctx.font = `700 ${Math.round(9.5 * u)}px ${FONT}`;
        const kw = ctx.measureText(open.key).width + 10 * u, kh = 14 * u, kx = tx + t1 + 8 * u;
        roundRect(kx, C.y + 15 * u - kh / 2, kw, kh, 4 * u);
        ctx.fillStyle = 'rgba(244, 241, 255, 0.12)'; ctx.fill();
        ctx.strokeStyle = 'rgba(244, 241, 255, 0.5)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#f4f1ff'; ctx.fillText(open.key, kx + 5 * u, C.y + 15 * u + 1);
      }
      ctx.font = `600 ${Math.round(10.5 * u)}px ${FONT}`;
      ctx.fillStyle = 'rgba(234, 230, 255, 0.94)';
      const lh = 13 * u, maxL = Math.max(2, Math.floor((C.h - 34 * u) / lh));
      let ty = C.y + 34 * u;
      for (const line of wrapLines(open.text, tw).slice(0, maxL)) { ctx.fillText(line, tx, ty); ty += lh; }
      // close (a tap anywhere does it too)
      const xx = C.x + C.w - 10 * u, xy = C.y + 10 * u, xr = 8 * u;
      ctx.strokeStyle = 'rgba(244, 241, 255, 0.75)'; ctx.lineWidth = Math.max(1.5, 2 * u); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(xx - xr * 0.55, xy - xr * 0.55); ctx.lineTo(xx + xr * 0.55, xy + xr * 0.55); ctx.moveTo(xx + xr * 0.55, xy - xr * 0.55); ctx.lineTo(xx - xr * 0.55, xy + xr * 0.55); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.textAlign = 'center';
    } else {
      ctx.font = `700 ${Math.round(19 * u)}px ${HEAD}`;
      ctx.fillStyle = '#ffe278';
      ctx.fillText(L.round ? `ROUND ${round}` : 'HOW TO PLAY', W / 2, L.py + 20 * u);
      const m = MAP_INFO[mapInfoKey()];
      let ly = L.py + 39 * u;
      if (!L.round) {
        ctx.font = `600 ${Math.round(11 * u)}px ${FONT}`;
        ctx.fillStyle = 'rgba(232, 236, 255, 0.85)';
        ctx.fillText(rule === 'survivor'
          ? `Rounds: get chomped and you're out for the round · first to ${winScore} round win${winScore === 1 ? '' : 's'}`
          : `Free-for-all: bite rivals to score · first to ${winScore} bite${winScore === 1 ? '' : 's'} wins`, W / 2, ly);
        ly += 15 * u;
      }
      ctx.font = `700 ${Math.round(10.5 * u)}px ${FONT}`;
      ctx.fillStyle = `rgb(${m.rgb})`;
      ctx.fillText(`${m.title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}: ${m.short}`, W / 2, ly);
      // the controls in a row, with their names
      for (const [k, ic] of L.icons.entries()) {
        const c = cards[k];
        guideIcon(c.id, ic.x, ic.y, ic.r);
        ctx.font = `700 ${Math.round(9.5 * u)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = c.id === 'fly' ? '#f4f1ff' : `rgb(${c.rgb || GUIDE_RGB[c.id]})`;
        const label = c.id === 'map' ? 'MAP' : c.title;
        ctx.fillText(label, ic.x, ic.y + ic.r + 10 * u);
      }
      ctx.font = `600 ${Math.round(10 * u)}px ${FONT}`;
      ctx.fillStyle = `rgba(232, 236, 255, ${0.55 + 0.25 * Math.sin(T * 3)})`;
      ctx.fillText(touchUsed ? 'Tap an icon to learn more' : 'Click an icon to learn more', W / 2, L.icons[0].y + L.icons[0].r + 25 * u);
    }
    // Start! (this device offline, or the host online), or a wait for the host
    const b = L.start;
    if (canStartGuide()) {
      const pulse = 0.5 + 0.5 * Math.sin(clock * 4);
      glow(W / 2, b.y + b.h / 2, b.w * 0.75, '120, 255, 190', 0.16 + 0.12 * pulse);
      const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      g.addColorStop(0, 'rgba(90, 230, 160, 0.95)'); g.addColorStop(1, 'rgba(24, 120, 96, 0.95)');
      ctx.fillStyle = g;
      roundRect(b.x, b.y, b.w, b.h, b.h / 2); ctx.fill();
      glowStroke('rgba(200, 255, 225, 0.95)', 2, 'rgba(120, 255, 190, 1)', 1 + pulse);
      ctx.font = `800 ${Math.round(b.h * 0.5)}px ${HEAD}`;
      ctx.fillStyle = 'rgba(6, 30, 22, 0.5)'; ctx.fillText(L.round ? 'NEXT ROUND!' : 'START!', W / 2, b.y + b.h / 2 + 2);
      ctx.fillStyle = '#ffffff'; ctx.fillText(L.round ? 'NEXT ROUND!' : 'START!', W / 2, b.y + b.h / 2);
      if (!touchUsed) {
        ctx.font = `600 ${Math.round(10 * u)}px ${FONT}`;
        ctx.fillStyle = 'rgba(232, 236, 255, 0.7)'; ctx.textAlign = 'left';
        ctx.fillText('or press Enter', b.x + b.w + 10 * u, b.y + b.h / 2);
        ctx.textAlign = 'center';
      }
    } else {
      ctx.font = `700 ${Math.round(13 * u)}px ${FONT}`;
      const text = 'Waiting for the host to start' + '.'.repeat(1 + (Math.floor(clock * 2.5) % 3));
      const tw = ctx.measureText('Waiting for the host to start...').width + 36 * u;
      pill(W / 2 - tw / 2, b.y, tw, b.h, 'rgba(150, 130, 255, 0.75)', 6);
      ctx.fillStyle = 'rgba(244, 241, 255, 0.9)'; ctx.textAlign = 'left';
      ctx.fillText(text, W / 2 - tw / 2 + 18 * u, b.y + b.h / 2 + 1);
      ctx.textAlign = 'center';
    }
    ctx.restore();
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
    // jumping: a shadow stays on the floor while the bat rises and grows toward you
    const hj = o.rot ? 0 : jumpH(b);
    if (hj > 0) {
      const sr = PX * (0.62 - 0.17 * hj), a = (o.alpha ?? 1) * (0.8 - 0.3 * hj);
      ctx.fillStyle = `rgba(0, 0, 0, ${a})`;
      ctx.beginPath(); ctx.ellipse(x, y + PX * 0.12, sr, sr * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(${b.rgb}, ${a * 0.8})`; ctx.lineWidth = Math.max(1.5, PX * 0.06);
      ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      y -= hj * PX * 0.95;
    }
    // up on a block: a little bigger (nearer you), with a shadow on the block top
    const up = o.rot ? 0 : Math.max(0, Math.min(1, b.hv || 0));
    if (up > 0.02 && hj <= 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${0.45 * up * (o.alpha ?? 1)})`;
      ctx.beginPath(); ctx.ellipse(x + PX * 0.08, y + PX * 0.2, PX * 0.42, PX * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      y -= up * PX * 0.18;
    }
    const r = PX * R * scale * (1 + 0.6 * hj + 0.16 * up), flap = stunned ? 0.2 : Math.sin(clock * (b.dashT > 0 ? 40 : 18) + b.i);
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
    if (!o.rot && !hj) {   // (mid-jump, the dashed shadow on the floor does this)
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
    if (b.held && b.heldLeft > 0 && !o.rot) {
      // a timed power running: a draining arc in its colour
      ctx.strokeStyle = `rgba(${POWERS[b.held].rgb}, 0.9)`;
      ctx.lineWidth = Math.max(2, PX * 0.07);
      ctx.beginPath(); ctx.arc(0, 0, r * 1.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, b.heldLeft / TIMED_LIFE)); ctx.stroke();
    }
    if (b.shield && !o.rot) drawShieldBubble(0, 0, r * 2.4, 1);
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
      jumpPips(b, x, y + r * 1.7 + Math.max(5, r * 0.42) * 0.9 + 5, Math.max(2.5, PX * 0.07));
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
  // JUMP: a smaller glassy disc with a hop arc over a little wall. The rim is
  // the jump meter: three segments, one per jump, each refilling in turn; it
  // lights up mid-air
  function drawJumpButton(b, me) {
    const up = me.jumpT > 0, ready = !up && me.jumpCd <= 0 && me.jumps >= 1, k = ready || up ? 1 : 0.55;
    if (up) glow(b.x, b.y, b.r * 1.9, '150, 230, 255', 0.3);
    const g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, `rgba(90, 170, 235, ${0.5 * k})`);
    g.addColorStop(1, `rgba(20, 40, 92, ${0.72 * k})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    glowStroke('rgba(60, 120, 170, 0.7)', 3, ready ? 'rgba(130, 220, 255, 1)' : null);
    // the three charges: dark slots, filled bright when a jump is ready, a dimmer partial fill while it refills
    const seg = (Math.PI * 2) / JUMP_CHARGES, gap = 0.34, w = Math.max(3.5, b.r * 0.13);
    ctx.lineCap = 'round';
    for (let j = 0; j < JUMP_CHARGES; j++) {
      const a0 = -Math.PI / 2 + j * seg + gap / 2, a1 = a0 + seg - gap, f = Math.max(0, Math.min(1, me.jumps - j));
      ctx.strokeStyle = 'rgba(8, 14, 36, 0.9)'; ctx.lineWidth = w + 2.5;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, a0, a1); ctx.stroke();
      ctx.strokeStyle = 'rgba(143, 220, 255, 0.2)'; ctx.lineWidth = w; ctx.stroke();
      if (f <= 0) continue;
      ctx.strokeStyle = f >= 1 ? '#8fdcff' : 'rgba(143, 220, 255, 0.45)'; ctx.lineWidth = w;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, a0, a0 + (a1 - a0) * f); ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // the picture: a dashed hop arc over a little block, an arrow at its end
    const c = ready || up ? 'rgba(244, 241, 255, 0.9)' : 'rgba(244, 241, 255, 0.4)', s = b.r;
    ctx.fillStyle = c;
    roundRect(b.x - s * 0.14, b.y - s * 0.02, s * 0.28, s * 0.26, s * 0.05); ctx.fill();
    ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, s * 0.08); ctx.lineCap = 'round';
    ctx.setLineDash([s * 0.12, s * 0.1]);
    ctx.beginPath(); ctx.arc(b.x, b.y + s * 0.2, s * 0.46, Math.PI * 1.08, Math.PI * 1.85); ctx.stroke();
    ctx.setLineDash([]);
    const ax = b.x + Math.cos(Math.PI * 1.9) * s * 0.46, ay = b.y + s * 0.2 + Math.sin(Math.PI * 1.9) * s * 0.46;
    ctx.beginPath(); ctx.moveTo(ax - s * 0.16, ay - s * 0.06); ctx.lineTo(ax + s * 0.02, ay + s * 0.02); ctx.lineTo(ax - s * 0.04, ay - s * 0.2); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.font = `800 ${Math.round(s * 0.3)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = c;
    ctx.fillText('JUMP', b.x, b.y + s * 0.58);
  }
  // Frozen: the bat is locked in a cluster of jagged ice crystals, glassy and
  // see-through, with bright facet edges, a sheen sweeping over them and a
  // little frost. (r: the bat's radius; k: 0..1 as it freezes over)
  const ICE_SHARDS = [
    // [angle, length, width] of each crystal spike around the core
    [-1.75, 1.55, 0.42], [-1.05, 1.25, 0.36], [-2.5, 1.2, 0.34], [-0.3, 1.05, 0.32], [2.75, 1.0, 0.32],
    [0.55, 0.95, 0.3], [2.1, 0.9, 0.3], [1.3, 0.85, 0.28], [-3.05, 0.8, 0.26],
  ];
  function drawIceBlock(r, k) {
    const T = clock, s = r * (0.95 + 0.15 * k);
    ctx.save();
    ctx.lineJoin = 'round';
    glow(0, 0, s * 2.6, '150, 220, 255', 0.3 * k);
    // the core: a chunky faceted lump of ice around the bat
    const core = [];
    for (let j = 0; j < 7; j++) { const a = (j / 7) * Math.PI * 2 + 0.3, l = s * (1.25 + 0.18 * Math.sin(j * 2.7)); core.push([Math.cos(a) * l, Math.sin(a) * l * 0.95]); }
    const fillIce = (pts, a) => {
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      const g = ctx.createLinearGradient(-s, -s * 1.5, s, s * 1.2);
      g.addColorStop(0, `rgba(235, 250, 255, ${0.55 * a})`); g.addColorStop(0.45, `rgba(150, 215, 255, ${0.3 * a})`); g.addColorStop(1, `rgba(90, 160, 235, ${0.5 * a})`);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = `rgba(240, 252, 255, ${0.85 * a})`; ctx.lineWidth = Math.max(1, r * 0.09); ctx.stroke();
    };
    // spikes behind, the core, spikes in front (the long ones point up)
    const spike = ([ang, len, wid], front) => {
      const L = s * len * (0.4 + 0.6 * k), c = Math.cos(ang), sn = Math.sin(ang), px = -sn, py = c, base = s * 0.7;
      const pts = [[c * base + px * s * wid, sn * base + py * s * wid], [c * (base + L), sn * (base + L)], [c * base - px * s * wid, sn * base - py * s * wid]];
      fillIce(pts, front ? k : k * 0.8);
      // a bright facet line down the middle
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 * k})`; ctx.lineWidth = Math.max(0.8, r * 0.05);
      ctx.beginPath(); ctx.moveTo(c * base, sn * base); ctx.lineTo(c * (base + L), sn * (base + L)); ctx.stroke();
    };
    ICE_SHARDS.forEach((sh, j) => { if (j % 2) spike(sh, false); });
    fillIce(core, k);
    // facets inside the core
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 * k})`; ctx.lineWidth = Math.max(0.8, r * 0.05);
    ctx.beginPath();
    for (let j = 0; j < core.length; j += 2) { ctx.moveTo(core[j][0], core[j][1]); ctx.lineTo(core[j][0] * 0.25, core[j][1] * 0.25 - s * 0.15); }
    ctx.stroke();
    ICE_SHARDS.forEach((sh, j) => { if (!(j % 2)) spike(sh, true); });
    // a sheen that sweeps across now and then
    const sw = ((T * 0.7) % 1.6) - 0.3;
    if (sw > 0 && sw < 1) {
      ctx.save();
      ctx.beginPath(); core.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.clip();
      const x0 = -s * 1.6 + sw * s * 3.2, g = ctx.createLinearGradient(x0 - s * 0.4, 0, x0 + s * 0.4, 0);
      g.addColorStop(0, 'rgba(255, 255, 255, 0)'); g.addColorStop(0.5, `rgba(255, 255, 255, ${0.45 * k})`); g.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g; ctx.fillRect(-s * 2, -s * 2, s * 4, s * 4);
      ctx.restore();
    }
    // frost glints
    for (let j = 0; j < 3; j++) {
      const a = Math.max(0, Math.sin(T * 3 + j * 2.1)), gx = Math.cos(j * 2.3 + 0.5) * s * 0.9, gy = Math.sin(j * 2.3 + 0.5) * s * 0.8, g = s * 0.28 * a;
      if (a < 0.2) continue;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * a * k})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx - g, gy); ctx.lineTo(gx + g, gy); ctx.moveTo(gx, gy - g); ctx.lineTo(gx, gy + g); ctx.stroke();
    }
    ctx.restore();
  }

  // Shield: a soft glowing bubble of light, brightest at its rim, a slow
  // shimmer drifting over it and a little highlight up top. flash (0..1)
  // brightens it as it soaks up a hit. No outlines.
  function drawShieldBubble(x, y, R2, a = 1, flash = 0) {
    const rgb = POWERS.shield.rgb, T = clock || performance.now() / 1000;
    const R = R2 * (1 + 0.03 * Math.sin(T * 4) + 0.15 * flash);
    ctx.save();
    // the bubble: clear in the middle, glowing toward the rim, fading outside it
    const g = ctx.createRadialGradient(x, y, R * 0.2, x, y, R * 1.12);
    g.addColorStop(0, `rgba(${rgb}, ${0.03 * a})`);
    g.addColorStop(0.62, `rgba(${rgb}, ${(0.08 + 0.2 * flash) * a})`);
    g.addColorStop(0.86, `rgba(${rgb}, ${(0.32 + 0.4 * flash) * a})`);
    g.addColorStop(0.93, `rgba(235, 252, 255, ${(0.32 + 0.4 * flash) * a})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R * 1.12, 0, Math.PI * 2); ctx.fill();
    // a shimmer band drifting round (soft, a gradient not a line)
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
    const sa = T * 1.3, sx = x + Math.cos(sa) * R * 0.55, sy = y + Math.sin(sa) * R * 0.35;
    const sh = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.6);
    sh.addColorStop(0, `rgba(220, 250, 255, ${0.16 * a})`); sh.addColorStop(1, 'rgba(220, 250, 255, 0)');
    ctx.fillStyle = sh; ctx.fillRect(x - R, y - R, R * 2, R * 2);
    // the highlight, top left
    const hx = x - R * 0.38, hy = y - R * 0.45, hl = ctx.createRadialGradient(hx, hy, 0, hx, hy, R * 0.32);
    hl.addColorStop(0, `rgba(255, 255, 255, ${0.6 * a})`); hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = hl; ctx.beginPath(); ctx.ellipse(hx, hy, R * 0.32, R * 0.2, -0.6, 0, Math.PI * 2); ctx.fill();
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
  const infoText = (cut = 0) => {
    const parts = [arena.def.name];
    if (bigArena && cut < 3) parts.unshift(`${bats.length} bats`);
    // (shorter in Last Bat Standing, which has more to say)
    if (arenaMode === 'morph' && cut < 2) parts.push(rule === 'survivor' || bigArena || cut ? 'morphing' : 'the cave keeps changing');
    else if (arenaMode === 'sky' && rule !== 'survivor' && !cut) parts.push('no cave tonight');
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

  // Scoreboard: one pill per bat along the top, split around the pause button.
  // When they get narrow (big battles) they turn compact: score, name and echo pips only.
  function drawHudPills(ph, size) {
    const n = bats.length, pad = 10, centerGap = 34;
    const left = Math.ceil(n / 2);
    // each side's pills must stay clear of the pause button in the middle
    const compact = (W / 2 - pad - centerGap) / left - 8 < 118, pgap = compact ? 5 : 8;
    const pw = Math.min(250, (W / 2 - pad - centerGap) / left - pgap);
    ctx.textBaseline = 'middle';
    bats.forEach((b, k) => {
      const x = k < left ? pad + k * (pw + pgap) : W - pad - (n - k) * (pw + pgap) + pgap;
      const y = 8;
      const mine = viewer === b.i || (b.ctrl === 'local' && localCount === 1);
      pill(x, y, pw, ph, mine ? b.color : `rgba(${b.rgb}, 0.6)`, mine ? 12 : 6);
      if (compact) { drawCompactPill(b, x, y, pw, ph, mine); return; }
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
    let info = infoText();
    ctx.font = `600 ${Math.round(size * 0.7)}px ${FONT}`;
    // (on a narrow screen, drop the least useful bits until it fits between the buttons)
    for (let cut = 1; ctx.measureText(info).width + 40 > W - 140 && cut < 4; cut++) info = infoText(cut);
    ctx.font = `600 ${Math.round(size * 0.7)}px ${FONT}`;
    const iw = ctx.measureText(info).width + 40, ih = size * 1.55, iy = H - ih - 10;
    const urgent = infoUrgent();
    const edge = urgent ? `rgb(${TH().wall})` : 'rgba(150, 130, 255, 0.75)';
    ctx.strokeStyle = urgent ? `rgba(${TH().wall}, 0.6)` : 'rgba(150, 130, 255, 0.45)';
    ctx.lineWidth = 1.5;
    const ly = iy + ih / 2, ll = Math.min(48, W * 0.05);
    ctx.beginPath();
    ctx.moveTo(W / 2 - iw / 2 - 12, ly); ctx.lineTo(W / 2 - iw / 2 - 12 - ll, ly);
    ctx.moveTo(W / 2 + iw / 2 + 12, ly); ctx.lineTo(W / 2 + iw / 2 + 12 + ll, ly);
    ctx.stroke();
    pill(W / 2 - iw / 2, iy, iw, ih, edge, 8);
    ctx.textAlign = 'center';
    ctx.fillStyle = urgent ? `rgb(${TH().wall})` : 'rgba(234, 230, 255, 0.88)';
    ctx.fillText(info, W / 2, ly + 1);
  }

  // A compact score pill: the score in a coloured lozenge, the name and the echo pips beside it
  function drawCompactPill(b, x, y, pw, ph, mine) {
    const sh = ph * 0.64, sw = sh * 1.6, sx = x + ph * 0.16, cy = y + ph / 2;
    roundRect(sx, cy - sh / 2, sw, sh, sh / 2);
    ctx.fillStyle = b.color; ctx.fill();
    ctx.fillStyle = '#16123a'; ctx.textAlign = 'left';
    ctx.font = `700 ${Math.round(sh * 0.74)}px ${HEAD}`;
    const sc = String(b.score), w1 = ctx.measureText(sc).width;
    ctx.font = `600 ${Math.round(sh * 0.44)}px ${HEAD}`;
    const tot = `/${winScore}`, w2 = ctx.measureText(tot).width, x1 = sx + sw / 2 - (w1 + w2) / 2;
    ctx.fillStyle = 'rgba(22, 18, 58, 0.62)'; ctx.fillText(tot, x1 + w1, cy + 2);
    ctx.fillStyle = '#16123a'; ctx.font = `700 ${Math.round(sh * 0.74)}px ${HEAD}`; ctx.fillText(sc, x1, cy + 1);
    // the name (and a little power dot) on top, echo pips under it
    const nx = sx + sw + ph * 0.16, room = x + pw - ph * 0.3 - nx;
    ctx.fillStyle = b.color;
    ctx.font = `700 ${Math.round(ph * 0.36)}px ${HEAD}`;
    ctx.fillText(b.name, nx, cy - ph * 0.15);
    // holding or running a power: a little badge in its colour on the score's corner
    const pw2 = b.held || b.power || (b.mega && 'mega') || (b.shield && 'shield');
    if (pw2) {
      ctx.beginPath(); ctx.arc(sx + sw - sh * 0.12, cy - sh * 0.42, ph * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${POWERS[pw2].rgb})`; ctx.fill();
      ctx.strokeStyle = 'rgba(10, 8, 30, 0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    const pr = Math.max(1.4, Math.min(ph * 0.065, room / 16)), gap = Math.min(pr * 2.9, (room - pr * 2) / (MAX_ECHOES - 1));
    for (let e = 0; e < MAX_ECHOES; e++) {
      ctx.beginPath(); ctx.arc(nx + pr + e * gap, cy + ph * 0.2, pr, 0, Math.PI * 2);
      ctx.fillStyle = b.power === 'frenzy' || e < b.echoes ? b.color : 'rgba(214, 208, 255, 0.16)'; ctx.fill();
    }
    if (mine) {
      // your own: a little arrow under the pill
      youMarker(x + pw / 2, y + ph + 1, 4, b.rgb);
    }
    if (b.out) {
      ctx.font = `700 ${Math.round(ph * 0.36)}px ${HEAD}`;
      const nw = ctx.measureText(b.name).width;
      ctx.strokeStyle = '#f4f1ff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(nx - 2, cy - ph * 0.15); ctx.lineTo(nx + nw + 2, cy - ph * 0.15); ctx.stroke();
      roundRect(x, y, pw, ph, ph / 2);
      ctx.fillStyle = 'rgba(6, 5, 20, 0.55)'; ctx.fill();
    }
  }

  // countdown, banners and split-screen lines over the middle of the screen
  function drawHudMiddle(size) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const mid = oy + (arena.h * PX) / 2;
    if (guide) return;   // (the controls guide is drawn over everything instead)
    if (countdown > 0 && bigArena) {
      // a big battle: a title over the countdown with every bat's colour along it
      const ty = mid - size * 4.75, fs = size * 1.25;
      ctx.font = `700 ${fs}px ${HEAD}`;
      const text = `${bats.length}-BAT BRAWL`, tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(5, 6, 15, 0.9)'; ctx.fillText(text, W / 2, ty + 3);
      ctx.fillStyle = '#ffe278'; ctx.fillText(text, W / 2, ty);
      const half = Math.ceil(bats.length / 2);
      bats.forEach((b, k) => {
        const side = k < half ? -1 : 1, j = k < half ? half - 1 - k : k - half;
        const cx = W / 2 + side * (tw / 2 + fs * 0.6 + j * fs * 0.75), r = fs * 0.24 * (1 + 0.15 * Math.sin(clock * 6 + k));
        glow(cx, ty, r * 3, b.rgb, 0.35);
        ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(cx, ty, r, 0, Math.PI * 2); ctx.fill();
      });
    }
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
        ? (touchUsed ? 'Drag to fly · tap to squeak · BITE·DASH to bite · JUMP over walls, echoes and bites (3 jumps)'
          : 'WASD or arrows to fly · F to squeak · G to bite·dash · R to jump (3 jumps) · E to use a power · Esc to pause')
        : `Each player owns ${['', 'the screen', 'half', 'a third', 'a quarter'][localCount]} of the screen · tap to squeak · flick to dash`;
      ctx.fillText(how, W / 2, mid + size * 2.7);
      const mk = mapInfoKey();
      if (['lava', 'moss', 'ice', 'xtreme'].includes(mk)) ctx.fillText(`${MAP_INFO[mk].title}: ${MAP_INFO[mk].short}`, W / 2, mid + size * 3.9);
      else ctx.fillText(powerFreq && powerOn.some((t) => POWERS[t].special)
        ? 'Squeak just before a rival\'s echo hits you to PARRY it · special power-ups get their own POWER button'
        : 'Squeak just before a rival\'s echo hits you to PARRY it · grab glowing power-ups', W / 2, mid + size * 3.9);
    } else if (banner && !(lavaWarn > 0 && countdown <= 0)) {   // (the lava's 3-2-1 has the screen to itself)
      const pop = banner.big ? 1 + 0.25 * Math.max(0, 1 - (5.2 - 3 - banner.t) * 4) : 1;
      ctx.font = `700 ${size * 2 * pop}px ${HEAD}`;
      ctx.fillStyle = `rgba(5, 6, 15, ${Math.min(0.9, banner.t * 2)})`;
      ctx.fillText(banner.text, W / 2, mid + 4);
      // a big battle's banner flashes through every bat's colour
      const rgb = banner.big ? bats[Math.floor(clock * 8) % bats.length].rgb : banner.rgb;
      ctx.fillStyle = `rgba(${rgb}, ${Math.min(1, banner.t * 2)})`;
      ctx.fillText(banner.text, W / 2, mid);
    }
    // into the lava (Xtreme): GET ON A BLOCK! and a big 3-2-1
    if (lavaWarn > 0 && countdown <= 0 && !over) {
      const n = Math.ceil(lavaWarn), f = lavaWarn - Math.floor(lavaWarn), pop = 1 + 0.35 * Math.max(0, f - 0.7) / 0.3;
      const ty = mid - size * 2.2;
      ctx.font = `800 ${size * 1.5}px ${HEAD}`;
      ctx.fillStyle = 'rgba(20, 4, 0, 0.85)'; ctx.fillText('GET ON A BLOCK!', W / 2, ty + 3);
      ctx.fillStyle = `rgba(255, ${150 + Math.floor(60 * Math.sin(clock * 12))}, 60, 1)`; ctx.fillText('GET ON A BLOCK!', W / 2, ty);
      ctx.font = `800 ${size * 3.6 * pop}px ${HEAD}`;
      ctx.fillStyle = 'rgba(20, 4, 0, 0.85)'; ctx.fillText(String(n), W / 2, ty + size * 3 + 4);
      ctx.fillStyle = '#ffe0a0'; ctx.fillText(String(n), W / 2, ty + size * 3);
    }
    // out of this round: say so, and whose flight we're following
    if (countdown <= 0 && spectating() && !roundEnd) {
      const w = watched();
      ctx.font = `700 ${size * 0.95}px ${HEAD}`;
      const more = bats.filter((b) => !b.out).length > 1;
      const text = w ? `Watching ${w.name}` : "You're out · watching";
      const hint = more ? (touchUsed ? 'tap to switch' : 'Space / click to switch') : '';
      ctx.font = `700 ${size * 0.9}px ${HEAD}`;
      const t1 = ctx.measureText(text).width;
      ctx.font = `600 ${size * 0.75}px ${FONT}`;
      const t2 = hint ? ctx.measureText(' · ' + hint).width : 0;
      const tw = t1 + t2 + 30, th = size * 1.7, ty = Math.max(H * 0.2, 8 + Math.max(30, Math.min(40, H * 0.085)) + 14);
      pill(W / 2 - tw / 2, ty, tw, th, w ? `rgba(${w.rgb}, 0.8)` : 'rgba(150, 130, 255, 0.75)', 6);
      ctx.textAlign = 'left';
      ctx.font = `700 ${size * 0.9}px ${HEAD}`;
      ctx.fillStyle = w ? `rgb(${w.rgb})` : '#f4f1ff';
      ctx.fillText(text, W / 2 - tw / 2 + 15, ty + th / 2 + 1);
      if (hint) {
        ctx.font = `600 ${size * 0.75}px ${FONT}`;
        ctx.fillStyle = 'rgba(232, 236, 255, 0.8)';
        ctx.fillText(' · ' + hint, W / 2 - tw / 2 + 15 + t1, ty + th / 2 + 1);
      }
      ctx.textAlign = 'center';
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
    get bolts() { return bolts; },
    get novas() { return novas; },
    get specialCount() { return specialCount; },
    special: (i, dx, dy) => useSpecial(bats[i], dx, dy),
    // run the simulation ahead n steps of dt seconds (tests)
    step: (dt, n = 1) => { for (let k = 0; k < n && active && mode !== 'client'; k++) update(dt); },
    give: (i, type) => { const b = bats[i]; if (b && POWERS[type]) grabPowerup(b, { x: b.x, y: b.y, type }); },
    get countdown() { return countdown; },
    get over() { return over; },
    get view() { return view; },
    setView: (v) => { view = v === '2d' ? '2d' : '3d'; if (view === '2d') window.EchoDuel3D?.hide(); },
    setPaused: (p) => { paused = p; if (p) { keys.clear(); sticks.clear(); } },
    setRoundClock: (s) => { roundClock = s; stormWarned = s >= ROUND_LIMIT - STORM_WARN; },
    spawnPowerup: (type) => spawnPowerup(type),
    squeak: (i) => squeak(bats[i]),
    act: (i, a) => doAct(bats[i], a),
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
    cornerSpots: () => cornerSpots(bats.length),
    dash: (i, dx, dy) => dash(bats[i], dx, dy),
    jump: (i) => jump(bats[i]),
    get jumpCount() { return jumpCount; },
    get misses() { return misses; },
    get missCount() { return missCount; },
    JUMP_CHARGES, JUMP_RECHARGE,
    // the controls guide: { kind: 'match' | 'round' } while it's up, else null
    get guide() { return guide ? { kind: guide.kind } : null; },
    // tests: skipGuide() presses Start on the guide now (host/local); skipGuide(true) also
    // turns the guide off for later matches and rounds, skipGuide(false) back on
    skipGuide: (always) => { if (always !== undefined) noGuide = !!always; startFromGuide(); },
    startGuide: () => startFromGuide(),
    get big() { return bigArena; },
    MAX_BATS,
    // seat colours and names, slot 0-7
    SEATS: BATS.map((b) => ({ name: b.name, color: b.color })),
    // the cave theme on show: { from, to, k (0..1 blended into 'to'), title, ice (how slippery) }
    get theme() { return { from: themeFrom, to: themeTo, k: themeK, title: TH().title, ice: iceNow(), lava: TH().look?.lava || 0 }; },
    // tests: morph into arena i as soon as possible (morph mode only)
    morphTo: (i) => { if (morph) { morph.next = i; morph.pause = Math.min(morph.pause, 0.01); } },
    watchNext: () => watchNext(),
    // map rules in play: { style, lavaOn, lavaWarn, regrowing (bushes waiting to grow back), koCount, bushCount }
    get mapState() { return { style: styleNow(), lavaOn, lavaWarn, regrowing: regrow.length, koCount, bushCount }; },
    // the guide's detail card (an id from the icon row) or null; tests can open one
    get guideCard() { return guide?.card || null; },
    openGuideCard: (id) => { if (guide) guide.card = id || null; },
  };
})();
