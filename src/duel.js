// Bat Brawl: 2 to 4 bats in a dark arena. A squeak that hits a rival stuns
// them; fly into a stunned bat to eat it. First to 3 bites wins.
// Every so often the cave shifts into a new arena with a new look.
// Any mix of players on one screen (split touch or shared keyboard) and CPU bats.
(() => {
  'use strict';

  const R = 0.3, ACCEL = 30, MAX_SPEED = 4.6, DRAG = 3.4;
  const RING_SPEED = 11, RING_MAX = 7, COOLDOWN = 0.45;
  const STUN_TIME = 1.8, SPAWN_SAFE = 1.6, RESPAWN_DELAY = 1.4;
  const START_ECHOES = 4, MAX_ECHOES = 6, CRYSTAL_ECHOES = 2;
  const WIN_SCORE = 3;
  const SHIFT_EVERY = 25, SHIFT_WARNING = 3, SHIFT_FADE = 0.9;
  const EAT_PULL = 0.35, EAT_TIME = 1.1;     // seconds: victim pulled in, then whole animation
  const BATS = [
    { name: 'Mo', color: '#8b6cff', rgb: '139, 108, 255' },
    { name: 'Ka', color: '#ff7ad9', rgb: '255, 122, 217' },
    { name: 'Ca', color: '#9dff6a', rgb: '157, 255, 106' },
    { name: 'Bo', color: '#ffb347', rgb: '255, 179, 71' },
  ];
  // keys for each player slot on a shared keyboard
  const KEYMAP = [
    { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], squeak: ['KeyF', 'Space'] },
    { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], squeak: ['Enter', 'Slash'] },
    { up: ['KeyI'], down: ['KeyK'], left: ['KeyJ'], right: ['KeyL'], squeak: ['KeyH'] },
    { up: ['Numpad8'], down: ['Numpad5'], left: ['Numpad4'], right: ['Numpad6'], squeak: ['Numpad0', 'NumpadEnter'] },
  ];

  // ---- Arena -------------------------------------------------------------
  let arena, arenaIndex = 0;
  function loadArena(i) {
    arenaIndex = i % window.ECHO_ARENAS.length;
    const def = window.ECHO_ARENAS[arenaIndex];
    const h = def.map.length, w = def.map[0].length;
    const a = { def, theme: def.theme, w, h, grid: new Uint8Array(w * h), spawns: [], crystalSpots: [] };
    def.map.forEach((row, y) => [...row].forEach((c, x) => {
      a.grid[y * w + x] = c === '#' ? 1 : 0;
      if ('ABCD'.includes(c)) a.spawns.push({ x: x + 0.5, y: y + 0.5, key: c });
      if (c === 'e') a.crystalSpots.push({ x: x + 0.5, y: y + 0.5 });
    }));
    a.spawns.sort((p, q) => p.key.localeCompare(q.key));
    arena = a;
    lit = new Float32Array(w * h);
    litBy = new Uint8Array(w * h);
    crystals = a.crystalSpots.map((c) => ({ ...c, on: false, timer: 0.5 + Math.random() * 2.5, phase: Math.random() * 6 }));
    ambient = makeAmbient(a);
  }
  const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= arena.w || ty >= arena.h || arena.grid[ty * arena.w + tx] === 1;
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

  // Floating embers, snow, spores or sparkles that give each arena its mood
  function makeAmbient(a) {
    return Array.from({ length: 46 }, () => ({
      x: Math.random() * a.w, y: Math.random() * a.h,
      v: 0.3 + Math.random() * 0.7, phase: Math.random() * 6, size: 0.04 + Math.random() * 0.06,
    }));
  }
  function updateAmbient(dt) {
    const kind = arena.theme.ambient;
    for (const p of ambient) {
      p.phase += dt;
      if (kind === 'ember') { p.y -= p.v * 0.8 * dt; p.x += Math.sin(p.phase * 2) * 0.3 * dt; }
      else if (kind === 'snow') { p.y += p.v * 0.6 * dt; p.x += Math.sin(p.phase) * 0.4 * dt; }
      else if (kind === 'spore') { p.x += Math.cos(p.phase * 0.7) * 0.25 * dt; p.y += Math.sin(p.phase * 0.5) * 0.2 * dt; }
      if (p.y < 0) p.y += arena.h;
      if (p.y > arena.h) p.y -= arena.h;
      if (p.x < 0) p.x += arena.w;
      if (p.x > arena.w) p.x -= arena.w;
    }
  }

  // ---- State -------------------------------------------------------------
  let active = false, cfg = { humans: 1, cpus: 1 }, onEnd = null;
  let bats, rings, crystals, particles, popups, eats, ambient, lit, litBy;
  let clock, countdown, over, banner, shiftTimer, shift, slowmo, shake;
  const sfx = () => (window.EchoAudio && window.EchoAudio.sfx) || {};

  function start(o = {}) {
    const humans = Math.max(1, Math.min(4, o.humans || 1));
    const cpus = Math.max(0, Math.min(4 - humans, o.cpus ?? 1));
    cfg = { humans, cpus: humans + cpus < 2 ? 1 : cpus };
    onEnd = o.onEnd || null;
    loadArena(Math.floor(Math.random() * window.ECHO_ARENAS.length));
    const total = cfg.humans + cfg.cpus;
    bats = [];
    for (let i = 0; i < total; i++) {
      const s = arena.spawns[i];
      bats.push({
        i, ...BATS[i], x: s.x, y: s.y, vx: 0, vy: 0, face: s.x < arena.w / 2 ? 1 : -1,
        echoes: START_ECHOES, cooldown: 0, stun: 0, safe: 0, dead: 0, score: 0, seen: 0,
        mouth: 0, puff: 0, cpu: i >= cfg.humans,
        ai: i >= cfg.humans ? { path: [], repath: 0, think: Math.random() * 0.3, wander: null } : null,
      });
    }
    rings = [];
    particles = [];
    popups = [];
    eats = [];
    clock = 0;
    countdown = 3;
    over = false;
    banner = { text: arena.def.name, rgb: arena.theme.wall, t: 3.2 };
    shiftTimer = SHIFT_EVERY;
    shift = null;
    slowmo = 0;
    shake = 0;
    keys.clear();
    sticks.clear();
    active = true;
  }
  function stop() { active = false; }

  // ---- Input -------------------------------------------------------------
  const keys = new Set();
  const sticks = new Map();      // pointerId -> stick, each owned by a player slot
  const STICK_RANGE = 56;
  const canvas = document.getElementById('game');

  // A lone player can use either of the first two key sets
  const keysFor = (i, what) => (cfg.humans === 1 && i === 0) ? [...KEYMAP[0][what], ...KEYMAP[1][what]] : KEYMAP[i][what];

  addEventListener('keydown', (e) => {
    if (!active) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    for (const b of bats) if (!b.cpu && keysFor(b.i, 'squeak').includes(e.code)) squeak(b);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); sticks.clear(); });

  // Touch zones: 1 player owns the screen, 2–3 split it into columns, 4 into quarters
  function zoneAt(clientX, clientY) {
    const n = cfg.humans;
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
    const owner = zoneAt(e.clientX, e.clientY);
    if ([...sticks.values()].some((s) => s.owner === owner)) { squeak(bats[owner]); return; }
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
    if (!s.moved && performance.now() - s.t < 280) squeak(bats[s.owner]);
    sticks.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', endStick);
  canvas.addEventListener('pointercancel', endStick);

  function humanInput(b) {
    let ix = 0, iy = 0;
    const down = (w) => keysFor(b.i, w).some((k) => keys.has(k));
    if (down('left')) ix -= 1;
    if (down('right')) ix += 1;
    if (down('up')) iy -= 1;
    if (down('down')) iy += 1;
    for (const s of sticks.values()) {
      if (s.owner !== b.i) continue;
      const dx = s.x - s.sx, dy = s.y - s.sy, len = Math.hypot(dx, dy);
      if (len > 8) { const m = Math.min(len / STICK_RANGE, 1); ix += (dx / len) * m; iy += (dy / len) * m; }
    }
    const len = Math.hypot(ix, iy);
    return len > 1 ? { ix: ix / len, iy: iy / len } : { ix, iy };
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

  function cpuInput(b, dt) {
    const ai = b.ai;
    const foes = bats.filter((o) => o !== b && !o.dead);
    if (!foes.length) return { ix: 0, iy: 0 };
    foes.sort((p, q) => dist(p, b) - dist(q, b));
    const nearest = foes[0];
    const snack = foes.find((o) => o.stun > 0 && dist(o, b) < 9);
    let target = snack;
    if (!target && b.echoes === 0) {
      target = crystals.filter((c) => c.on).sort((p, q) => dist(p, b) - dist(q, b))[0];
    }
    if (!target) {
      if (!ai.wander || Math.random() < dt * 0.4) ai.wander = { dx: (Math.random() - 0.5) * 6, dy: (Math.random() - 0.5) * 4 };
      target = { x: nearest.x + ai.wander.dx, y: nearest.y + ai.wander.dy };
      if (solid(Math.floor(target.x), Math.floor(target.y))) target = nearest;
    }
    ai.repath -= dt;
    if (ai.repath <= 0) { ai.path = bfsPath(b.x, b.y, target.x, target.y); ai.repath = 0.25; }
    while (ai.path.length && Math.hypot(ai.path[0].x - b.x, ai.path[0].y - b.y) < 0.35) ai.path.shift();
    const next = ai.path[0] || target;

    ai.think -= dt;
    if (ai.think <= 0) {
      ai.think = 0.35;
      const shootable = foes.some((o) => o.safe <= 0 && o.stun <= 0 && dist(o, b) < RING_MAX * 0.7);
      if (shootable && b.echoes > 0 && Math.random() < 0.4) squeak(b);
    }
    const dx = next.x - b.x, dy = next.y - b.y, len = Math.hypot(dx, dy) || 1;
    const speed = snack ? 1 : 0.8;
    return { ix: (dx / len) * speed, iy: (dy / len) * speed };
  }

  // ---- Actions -----------------------------------------------------------
  function squeak(b) {
    if (!active || !b || countdown > 0 || over || shift || b.dead || b.stun > 0 || b.cooldown > 0) return;
    b.cooldown = COOLDOWN;
    if (b.echoes <= 0) { sfx().empty?.(); return; }
    b.echoes--;
    b.seen = 1;
    rings.push({ x: b.x, y: b.y, r: 0, owner: b.i, hit: new Set() });
    sfx().squeak?.();
  }

  function burst(x, y, rgb, n, speed = 3, size = 4) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * speed;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.6, rgb, size });
    }
  }

  // The bite: the stunned bat gets slurped into the eater's open mouth,
  // CHOMP, the eater puffs up, then burps out a few feathers.
  function eat(eater, food) {
    eater.score++;
    food.dead = RESPAWN_DELAY + EAT_TIME;
    eats.push({ eater, food: { ...food }, t: 0, chomped: false, burped: false });
    food.stun = 0;
    slowmo = 0.45;
    sfx().slurp?.();
    if (eater.score >= WIN_SCORE) over = true;
  }

  function updateEats(dt) {
    for (const e of eats) {
      e.t += dt;
      const b = e.eater;
      b.mouth = e.t < EAT_PULL ? Math.min(1, e.t / 0.12) : 0;
      if (!e.chomped && e.t >= EAT_PULL) {
        e.chomped = true;
        sfx().chomp?.();
        shake = 0.25;
        b.puff = 1;
        const mx = b.x + b.face * R * 0.4, my = b.y + R * 0.3;
        burst(mx, my, e.food.rgb, 22, 4, 5);
        burst(mx, my, '255, 255, 255', 8, 3, 3);
        popups.push({ x: b.x, y: b.y - 1.1, text: 'CHOMP!', rgb: b.rgb, t: 0, life: 0.9, big: true });
      }
      if (!e.burped && e.t >= EAT_TIME - 0.3) {
        e.burped = true;
        sfx().burp?.();
        popups.push({ x: b.x + b.face * 0.5, y: b.y - 0.4, text: 'burp', rgb: '232, 236, 255', t: 0, life: 0.8, big: false });
        for (let k = 0; k < 4; k++) {
          particles.push({ x: b.x + b.face * 0.4, y: b.y, vx: b.face * (1 + Math.random()), vy: -0.5 - Math.random(), life: 1, rgb: e.food.rgb, size: 6, feather: true });
        }
      }
    }
    for (const b of bats) if (b.puff > 0) b.puff = Math.max(0, b.puff - dt * 1.6);
    const done = eats.filter((e) => e.t >= EAT_TIME);
    eats = eats.filter((e) => e.t < EAT_TIME);
    if (over && !eats.length && done.length) {
      const winner = done[done.length - 1].eater;
      setTimeout(() => {
        if (!active || !onEnd) return;
        const standings = bats.map((o) => ({ name: o.name, score: o.score, cpu: o.cpu, color: o.color })).sort((p, q) => q.score - p.score);
        onEnd({ winner: winner.name, winnerCpu: winner.cpu, color: winner.color, standings, humans: cfg.humans });
      }, 600);
    }
  }

  function safeSpawn(b) {
    const foes = bats.filter((o) => o !== b && !o.dead);
    const score = (s) => foes.length ? Math.min(...foes.map((o) => Math.hypot(o.x - s.x, o.y - s.y))) : 0;
    return arena.spawns.slice().sort((p, q) => score(q) - score(p))[0];
  }
  function respawn(b) {
    const s = safeSpawn(b);
    Object.assign(b, { x: s.x, y: s.y, vx: 0, vy: 0, echoes: START_ECHOES, stun: 0, safe: SPAWN_SAFE, dead: 0, cooldown: 0, mouth: 0 });
  }

  function shiftArena() {
    loadArena(arenaIndex + 1);
    rings = [];
    bats.forEach((b, k) => {
      const s = arena.spawns[k % arena.spawns.length];
      Object.assign(b, { x: s.x, y: s.y, vx: 0, vy: 0, safe: SPAWN_SAFE, stun: 0 });
      if (b.ai) b.ai.path = [];
    });
    banner = { text: arena.def.name, rgb: arena.theme.wall, t: 2.2 };
    sfx().crash?.();
  }

  // ---- Update ------------------------------------------------------------
  function update(rawDt) {
    clock += rawDt;
    shake = Math.max(0, shake - rawDt);
    if (banner) { banner.t -= rawDt; if (banner.t <= 0) banner = null; }
    updateAmbient(rawDt);
    if (countdown > 0) {
      const before = Math.ceil(countdown);
      countdown -= rawDt;
      if (Math.ceil(countdown) !== before) sfx().squeak?.();
      return;
    }
    // a short slow-motion beat while a bite happens
    slowmo = Math.max(0, slowmo - rawDt);
    const dt = slowmo > 0 ? rawDt * 0.35 : rawDt;
    updateEats(rawDt);
    for (const p of popups) p.t += rawDt;
    popups = popups.filter((p) => p.t < p.life);

    // the cave shifts every so often, with a warning first
    if (!over) {
      if (shift) {
        shift.t += rawDt;
        if (!shift.swapped && shift.t >= SHIFT_FADE / 2) { shift.swapped = true; shiftArena(); }
        if (shift.t >= SHIFT_FADE) shift = null;
        return;
      }
      shiftTimer -= rawDt;
      if (shiftTimer <= SHIFT_WARNING && shiftTimer + rawDt > SHIFT_WARNING) {
        banner = { text: 'The cave is shifting!', rgb: arena.theme.wall, t: SHIFT_WARNING };
        sfx().wake?.();
      }
      if (shiftTimer <= 0) { shift = { t: 0, swapped: false }; shiftTimer = SHIFT_EVERY; }
    }

    for (const b of bats) {
      b.cooldown = Math.max(0, b.cooldown - dt);
      b.safe = Math.max(0, b.safe - dt);
      b.seen = Math.max(0, b.seen - dt * 0.8);
      if (b.dead > 0) { b.dead -= dt; if (b.dead <= 0 && !over) respawn(b); continue; }
      let ix = 0, iy = 0;
      if (b.stun > 0) b.stun = Math.max(0, b.stun - dt);
      else if (!over) ({ ix, iy } = b.ai ? cpuInput(b, dt) : humanInput(b));
      if (ix || iy) { b.vx += ix * ACCEL * dt; b.vy += iy * ACCEL * dt; }
      else { b.vx -= b.vx * DRAG * dt; b.vy -= b.vy * DRAG * dt; }
      const max = b.stun > 0 ? 7 : MAX_SPEED, sp = Math.hypot(b.vx, b.vy);
      if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
      if (Math.abs(b.vx) > 0.2) b.face = Math.sign(b.vx);
      const nx = b.x + b.vx * dt;
      if (!hitsWall(nx, b.y, R)) b.x = nx; else b.vx *= -0.4;
      const ny = b.y + b.vy * dt;
      if (!hitsWall(b.x, ny, R)) b.y = ny; else b.vy *= -0.4;
    }

    for (let k = 0; k < lit.length; k++) if (lit[k] > 0) lit[k] = Math.max(0, lit[k] - dt * 0.75);

    // rings light walls and stun every other bat they pass
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
      for (const foe of bats) {
        if (foe.i === ring.owner || foe.dead || foe.safe > 0 || ring.hit.has(foe.i)) continue;
        const d = Math.hypot(foe.x - ring.x, foe.y - ring.y);
        if (d < r + R && d >= prev - R) {
          ring.hit.add(foe.i);
          foe.seen = 1;
          if (foe.stun <= 0) {
            foe.stun = STUN_TIME;
            const push = 2 + 4 * (1 - d / RING_MAX), k = d || 1;
            foe.vx = ((foe.x - ring.x) / k) * push;
            foe.vy = ((foe.y - ring.y) / k) * push;
            burst(foe.x, foe.y, '255, 226, 120', 10);
            sfx().wake?.();
          }
        }
      }
    }
    rings = rings.filter((ring) => ring.r < RING_MAX);

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
        burst(c.x, c.y, '150, 240, 255', 12);
        sfx().crystal?.();
        break;
      }
    }

    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.feather) { p.vy += 1.5 * dt; p.vx *= 1 - 1.5 * dt; } else { p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; }
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  // ---- Render ------------------------------------------------------------
  let ctx, W, H, PX, ox, oy;
  const FONT = '"Chakra Petch", "Trebuchet MS", system-ui, sans-serif';
  const X = (x) => ox + x * PX, Y = (y) => oy + y * PX;

  function glow(x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${a})`); g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function render() {
    const th = arena.theme;
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, H);
    const top = Math.max(54, H * 0.15);       // room for the scoreboard
    const bottom = Math.max(22, H * 0.06);
    PX = Math.min(W / arena.w, (H - top - bottom) / arena.h);
    const sx = shake > 0 ? (Math.random() - 0.5) * shake * 30 : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake * 30 : 0;
    ox = (W - arena.w * PX) / 2 + sx;
    oy = top + (H - top - bottom - arena.h * PX) / 2 + sy;

    // a soft tint of the arena's color behind everything
    glow(W / 2, oy + (arena.h * PX) / 2, Math.max(W, H) * 0.6, th.wall, 0.06);

    // ambient particles
    for (const p of ambient) {
      let a = 0.35;
      if (th.ambient === 'sparkle') a = 0.15 + 0.35 * Math.max(0, Math.sin(p.phase * 2.2 + clock * 1.5));
      if (th.ambient === 'ember') a = 0.25 + 0.35 * Math.abs(Math.sin(p.phase * 3));
      ctx.fillStyle = `rgba(${th.ambientRgb}, ${a})`;
      const s = Math.max(1.5, p.size * PX);
      if (th.ambient === 'snow' || th.ambient === 'spore') { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), s * 0.6, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(X(p.x) - s / 2, Y(p.y) - s / 2, s, s);
    }

    // walls: dim outline always, bright where sound or a nearby bat lights them
    const warn = shiftTimer < SHIFT_WARNING && !over ? 0.25 + 0.25 * Math.sin(clock * 20) : 0;
    for (let ty = 0; ty < arena.h; ty++) {
      for (let tx = 0; tx < arena.w; tx++) {
        if (!solid(tx, ty)) continue;
        const open = [!solid(tx, ty - 1), !solid(tx + 1, ty), !solid(tx, ty + 1), !solid(tx - 1, ty)];
        if (!open.some(Boolean)) continue;
        const l = lit[ty * arena.w + tx];
        let a = Math.max(l, 0.16, warn);
        for (const b of bats) {
          if (b.dead) continue;
          const d = Math.hypot(tx + 0.5 - b.x, ty + 0.5 - b.y);
          a = Math.max(a, Math.max(0, Math.min(1, 1 - (d - 0.7) / 1.4)) * 0.35);
        }
        const rgb = l > 0.05 ? BATS[litBy[ty * arena.w + tx]].rgb : th.wall;
        const x = X(tx), y = Y(ty), s = PX;
        ctx.fillStyle = `rgba(${th.fill}, ${0.35 + a * 0.5})`;
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
      const cx = X(c.x), cy = Y(c.y + Math.sin(clock * 2 + c.phase) * 0.1);
      glow(cx, cy, PX * 0.9, '150, 240, 255', 0.45);
      ctx.fillStyle = '#96f0ff';
      ctx.beginPath();
      ctx.moveTo(cx, cy - PX * 0.26); ctx.lineTo(cx + PX * 0.15, cy); ctx.lineTo(cx, cy + PX * 0.26); ctx.lineTo(cx - PX * 0.15, cy);
      ctx.closePath(); ctx.fill();
    }

    for (const ring of rings) {
      const f = 1 - ring.r / RING_MAX;
      ctx.strokeStyle = `rgba(${BATS[ring.owner].rgb}, ${f * 0.95})`;
      ctx.lineWidth = Math.max(2, PX * 0.12);
      ctx.beginPath(); ctx.arc(X(ring.x), Y(ring.y), ring.r * PX, 0, Math.PI * 2); ctx.stroke();
    }

    // victims being slurped into a mouth
    for (const e of eats) {
      if (e.t >= EAT_PULL) continue;
      const p = e.t / EAT_PULL, ease = p * p;
      const mx = e.eater.x + e.eater.face * R * 0.4, my = e.eater.y + R * 0.3;
      const fx = e.food.x + (mx - e.food.x) * ease, fy = e.food.y + (my - e.food.y) * ease;
      drawBat(e.food, X(fx), Y(fy), { scale: 1 - 0.85 * ease, rot: p * 9, alpha: 1, stunned: true, tag: false });
    }

    for (const p of particles) {
      ctx.fillStyle = `rgba(${p.rgb}, ${Math.min(1, p.life * 1.6)})`;
      if (p.feather) {
        ctx.save(); ctx.translate(X(p.x), Y(p.y)); ctx.rotate(p.life * 6);
        ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * 0.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else ctx.fillRect(X(p.x) - p.size / 2, Y(p.y) - p.size / 2, p.size, p.size);
    }

    for (const b of bats) if (!b.dead) drawBat(b, X(b.x), Y(b.y));

    for (const p of popups) {
      const k = p.t / p.life;
      const pop = p.big ? 1 + 0.6 * Math.max(0, 1 - p.t * 6) : 1;
      ctx.font = `700 ${Math.max(p.big ? 18 : 11, PX * (p.big ? 0.9 : 0.45)) * pop}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(${p.rgb}, ${1 - k * k})`;
      ctx.fillText(p.text, X(p.x), Y(p.y - k * 0.6));
    }

    drawHud();
    drawSticks();

    // the shift: fade to black and back
    if (shift) {
      const a = 1 - Math.abs(shift.t / (SHIFT_FADE / 2) - 1);
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, Math.min(1, a))})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawBat(b, x, y, o = {}) {
    const scale = o.scale ?? (1 + (b.puff > 0 ? 0.4 * b.puff * (0.8 + 0.2 * Math.sin(clock * 30)) : 0));
    const stunned = o.stunned ?? b.stun > 0;
    if (!o.rot && b.safe > 0 && Math.floor(b.safe * 10) % 2 === 0) return;
    const r = PX * R * scale, flap = stunned ? 0.2 : Math.sin(clock * 18 + b.i);
    // bodies are dim in the dark; squeaking, being hit or eating lights you up
    const vis = o.alpha ?? Math.max(0.35, b.seen, stunned || b.mouth > 0 || b.puff > 0 ? 1 : 0);
    ctx.save();
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    ctx.globalAlpha = vis;
    glow(0, 0, r * 3, b.rgb, 0.3);
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
    ctx.globalAlpha = 1;

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
    // mouth: wide open with fangs while eating, a fat grin while puffed up
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
    ctx.restore();

    if (stunned && !o.rot) {
      for (let k = 0; k < 3; k++) {
        const a = clock * 5 + k * 2.1;
        ctx.fillStyle = '#ffe278';
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 1.4, y - r * 1.5 + Math.sin(a) * r * 0.4, Math.max(2, r * 0.18), 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = `700 ${Math.max(10, PX * 0.4)}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffe278';
      ctx.fillText('STUNNED', x, y - r * 2.6);
    }
    if (o.tag !== false) {
      ctx.font = `700 ${Math.max(9, PX * 0.34)}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(${b.rgb}, 0.9)`;
      ctx.fillText(b.cpu ? `${b.name} · CPU` : b.name, x, y + r * 2.1);
    }
  }

  function drawHud() {
    const n = bats.length, pad = 16;
    const size = Math.max(13, Math.min(22, H / 24, (W - pad * 2) / n / 6));
    const y = Math.max(20, H * 0.05);
    const slot = (W - pad * 2) / n;
    ctx.textBaseline = 'middle';
    bats.forEach((b, k) => {
      const x0 = pad + k * slot;
      ctx.textAlign = 'left';
      ctx.font = `700 ${size * 1.3}px ${FONT}`;
      ctx.fillStyle = b.color;
      const label = `${b.name} ${b.score}`;
      ctx.fillText(label, x0, y);
      if (b.cpu) {
        ctx.font = `600 ${size * 0.6}px ${FONT}`;
        ctx.fillStyle = `rgba(${b.rgb}, 0.7)`;
        ctx.fillText('CPU', x0, y + size * 1.05);
      }
      const pr = size * 0.18, gap = size * 0.5;
      ctx.font = `700 ${size * 1.3}px ${FONT}`;
      const px0 = x0 + ctx.measureText(label).width + size * 0.7;
      for (let e = 0; e < MAX_ECHOES; e++) {
        const px = px0 + e * gap;
        ctx.beginPath(); ctx.arc(px, y, pr, 0, Math.PI * 2);
        if (e < b.echoes) { ctx.fillStyle = `rgba(${b.rgb}, 0.95)`; ctx.fill(); }
        else { ctx.strokeStyle = 'rgba(232, 236, 255, 0.2)'; ctx.lineWidth = 1; ctx.stroke(); }
      }
    });

    ctx.textAlign = 'center';
    ctx.font = `600 ${Math.max(11, size * 0.7)}px ${FONT}`;
    ctx.fillStyle = 'rgba(232, 236, 255, 0.55)';
    const secs = Math.max(0, Math.ceil(shiftTimer));
    ctx.fillText(`${arena.def.name}  ·  first to ${WIN_SCORE} bites  ·  cave shifts in ${secs}s`, W / 2, H - Math.max(11, H * 0.03));

    const mid = oy + (arena.h * PX) / 2;
    if (countdown > 0) {
      ctx.font = `700 ${size * 4}px ${FONT}`;
      ctx.fillStyle = `rgb(${arena.theme.wall})`;
      ctx.fillText(String(Math.ceil(countdown)), W / 2, mid - size);
      ctx.font = `600 ${size}px ${FONT}`;
      ctx.fillStyle = 'rgba(232, 236, 255, 0.9)';
      ctx.fillText('Squeak to stun. Fly into a stunned bat to eat it.', W / 2, mid + size * 2);
      ctx.fillStyle = 'rgba(232, 236, 255, 0.65)';
      ctx.font = `600 ${size * 0.8}px ${FONT}`;
      const zones = ['', 'Drag anywhere to fly, tap to squeak', 'Each player owns half the screen', 'Each player owns a third of the screen', 'Each player owns a quarter of the screen'];
      ctx.fillText(zones[cfg.humans], W / 2, mid + size * 3.3);
    } else if (banner) {
      ctx.font = `700 ${size * 1.7}px ${FONT}`;
      ctx.fillStyle = `rgba(${banner.rgb}, ${Math.min(1, banner.t * 2)})`;
      ctx.fillText(banner.text, W / 2, mid);
    }
    // show touch zones during the countdown
    if (cfg.humans > 1 && countdown > 0) {
      ctx.strokeStyle = 'rgba(232, 236, 255, 0.18)';
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      if (cfg.humans === 4) { ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); }
      else for (let k = 1; k < cfg.humans; k++) { ctx.moveTo((W * k) / cfg.humans, 0); ctx.lineTo((W * k) / cfg.humans, H); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawSticks() {
    const rect = canvas.getBoundingClientRect();
    for (const s of sticks.values()) {
      if (!s.moved) continue;
      const bx = s.sx - rect.left, by = s.sy - rect.top;
      let dx = s.x - s.sx, dy = s.y - s.sy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RANGE) { dx *= STICK_RANGE / len; dy *= STICK_RANGE / len; }
      ctx.strokeStyle = `rgba(${BATS[s.owner].rgb}, 0.3)`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, STICK_RANGE, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(${BATS[s.owner].rgb}, 0.3)`;
      ctx.beginPath(); ctx.arc(bx + dx, by + dy, 20, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Called by the main loop each frame while a battle is on
  function frame(dt, context, width, height) {
    ctx = context; W = width; H = height;
    if (active) update(dt);
    render();
  }

  window.EchoDuel = {
    start, stop, frame,
    get active() { return active; },
    // for automated tests
    get bats() { return bats; },
    get arena() { return arena; },
    get countdown() { return countdown; },
    get eats() { return eats; },
    setShiftTimer: (s) => { shiftTimer = s; },
    squeak: (i) => squeak(bats[i]),
  };
})();
