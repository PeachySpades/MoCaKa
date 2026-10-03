// Bat Brawl: two bats in a dark arena. A squeak that hits your rival stuns
// them; fly into a stunned bat to eat it. First to 3 bites wins.
// Plays as 2 players on one screen (split touch or shared keyboard) or vs CPU.
(() => {
  'use strict';

  const ARENA = [
    '##################################',
    '#................................#',
    '#.A......####.........####.....B.#',
    '#..e....######...e...######..e...#',
    '#........####.........####.......#',
    '#................................#',
    '#....##.........####........##...#',
    '#...####.......######......####..#',
    '#....##.........####........##...#',
    '#................................#',
    '#........####.........####.......#',
    '#..e....######...e...######..e...#',
    '#.C......####.........####.....D.#',
    '#................................#',
    '##################################',
  ];

  const R = 0.3, ACCEL = 30, MAX_SPEED = 4.6, DRAG = 3.4;
  const RING_SPEED = 11, RING_MAX = 7, COOLDOWN = 0.45;
  const STUN_TIME = 1.8, SPAWN_SAFE = 1.6, RESPAWN_DELAY = 1.2;
  const START_ECHOES = 4, MAX_ECHOES = 6, CRYSTAL_ECHOES = 2;
  const WIN_SCORE = 3;
  const PLAYERS = [
    { name: 'Mo', color: '#8b6cff', rgb: '139, 108, 255' },
    { name: 'Ka', color: '#ff7ad9', rgb: '255, 122, 217' },
  ];

  // ---- Arena -------------------------------------------------------------
  const AW = ARENA[0].length, AH = ARENA.length;
  const grid = new Uint8Array(AW * AH);
  const spawns = [], crystalSpots = [];
  ARENA.forEach((row, y) => [...row].forEach((c, x) => {
    grid[y * AW + x] = c === '#' ? 1 : 0;
    if ('ABCD'.includes(c)) spawns.push({ x: x + 0.5, y: y + 0.5, key: c });
    if (c === 'e') crystalSpots.push({ x: x + 0.5, y: y + 0.5 });
  }));
  spawns.sort((a, b) => a.key.localeCompare(b.key));
  const solid = (tx, ty) => tx < 0 || ty < 0 || tx >= AW || ty >= AH || grid[ty * AW + tx] === 1;
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

  // ---- State -------------------------------------------------------------
  let active = false, opts = { cpu: true }, onEnd = null;
  let bats, rings, crystals, particles, lit, litBy, clock, countdown, over, banner;
  const sfx = () => (window.EchoAudio && window.EchoAudio.sfx) || {};

  function newBat(i) {
    const s = spawns[i === 0 ? 0 : 1];
    return {
      i, ...PLAYERS[i], x: s.x, y: s.y, vx: 0, vy: 0, face: i === 0 ? 1 : -1,
      echoes: START_ECHOES, cooldown: 0, stun: 0, safe: SPAWN_SAFE, dead: 0, score: 0,
      seen: 0, ai: i === 1 && opts.cpu ? { path: [], repath: 0, think: 0, wander: null } : null,
    };
  }

  function start(o = {}) {
    opts = { cpu: !!o.cpu };
    onEnd = o.onEnd || null;
    bats = [newBat(0), newBat(1)];
    if (opts.cpu) bats[1].name = 'CPU';
    rings = [];
    particles = [];
    crystals = crystalSpots.map((c) => ({ ...c, on: false, timer: 1 + Math.random() * 3, phase: Math.random() * 6 }));
    lit = new Float32Array(AW * AH);
    litBy = new Uint8Array(AW * AH);
    clock = 0;
    countdown = 3;
    over = false;
    banner = null;
    keys.clear();
    sticks.clear();
    active = true;
  }
  function stop() { active = false; }

  // ---- Input -------------------------------------------------------------
  const keys = new Set();
  const sticks = new Map();      // pointerId -> stick, each owned by a player
  const STICK_RANGE = 56;
  const canvas = document.getElementById('game');

  const KEYMAP = {
    0: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], squeak: ['KeyF', 'Space'] },
    1: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], squeak: ['Enter', 'KeyL', 'Slash'] },
  };
  // against the CPU, player 1 can use either set of keys
  const keysFor = (i, what) => (opts.cpu && i === 0) ? [...KEYMAP[0][what], ...KEYMAP[1][what]] : KEYMAP[i][what];

  addEventListener('keydown', (e) => {
    if (!active) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    for (const b of bats) if (!b.ai && keysFor(b.i, 'squeak').includes(e.code)) squeak(b);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); sticks.clear(); });

  // Touch: vs CPU the whole screen is yours; in 2-player the left half is Mo, the right half is Ka.
  const ownerAt = (clientX) => {
    if (opts.cpu) return 0;
    const rect = canvas.getBoundingClientRect();
    return clientX - rect.left < rect.width / 2 ? 0 : 1;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    e.preventDefault();
    window.EchoAudio?.unlock();
    const owner = ownerAt(e.clientX);
    const already = [...sticks.values()].some((s) => s.owner === owner);
    if (already) { squeak(bats[owner]); return; }
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

  // ---- CPU rival -----------------------------------------------------------
  function bfsNext(fromX, fromY, toX, toY) {
    const sx = Math.floor(fromX), sy = Math.floor(fromY), gx = Math.floor(toX), gy = Math.floor(toY);
    if (sx === gx && sy === gy) return [];
    const prev = new Int32Array(AW * AH).fill(-1);
    const q = [sy * AW + sx];
    prev[q[0]] = q[0];
    for (let h = 0; h < q.length; h++) {
      const c = q[h], cx = c % AW, cy = (c / AW) | 0;
      if (cx === gx && cy === gy) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, n = ny * AW + nx;
        if (!solid(nx, ny) && prev[n] < 0) { prev[n] = c; q.push(n); }
      }
    }
    const goal = gy * AW + gx;
    if (prev[goal] < 0) return [];
    const path = [];
    for (let c = goal; c !== prev[c]; c = prev[c]) path.push({ x: (c % AW) + 0.5, y: ((c / AW) | 0) + 0.5 });
    return path.reverse();
  }

  function cpuInput(b, dt) {
    const foe = bats[0], ai = b.ai;
    const d = Math.hypot(foe.x - b.x, foe.y - b.y);
    let target;
    if (foe.stun > 0 && !foe.dead) target = foe;                       // go eat
    else if (b.echoes === 0) {                                         // refill
      const on = crystals.filter((c) => c.on);
      target = on.sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
    }
    if (!target) {
      // circle in at a cautious distance, with a bit of wandering
      if (!ai.wander || Math.random() < dt * 0.4) ai.wander = { dx: (Math.random() - 0.5) * 6, dy: (Math.random() - 0.5) * 4 };
      target = { x: foe.x + ai.wander.dx, y: foe.y + ai.wander.dy };
      if (solid(Math.floor(target.x), Math.floor(target.y))) target = foe;
    }
    ai.repath -= dt;
    if (ai.repath <= 0) { ai.path = bfsNext(b.x, b.y, target.x, target.y); ai.repath = 0.25; }
    while (ai.path.length && Math.hypot(ai.path[0].x - b.x, ai.path[0].y - b.y) < 0.35) ai.path.shift();
    const next = ai.path[0] || target;

    ai.think -= dt;
    if (ai.think <= 0) {
      ai.think = 0.35;
      if (!foe.dead && foe.safe <= 0 && foe.stun <= 0 && b.echoes > 0 && d < RING_MAX * 0.7 && Math.random() < 0.45) squeak(b);
    }
    const dx = next.x - b.x, dy = next.y - b.y, len = Math.hypot(dx, dy) || 1;
    const speed = foe.stun > 0 ? 1 : 0.8;
    return { ix: (dx / len) * speed, iy: (dy / len) * speed };
  }

  // ---- Actions -----------------------------------------------------------
  function squeak(b) {
    if (!active || countdown > 0 || over || b.dead || b.stun > 0 || b.cooldown > 0) return;
    b.cooldown = COOLDOWN;
    if (b.echoes <= 0) { sfx().empty?.(); return; }
    b.echoes--;
    b.seen = 1;
    rings.push({ x: b.x, y: b.y, r: 0, owner: b.i, hit: false });
    sfx().squeak?.();
  }

  function burst(x, y, rgb, n, speed = 3) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * speed;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.6, rgb });
    }
  }

  function eat(eater, food) {
    eater.score++;
    food.dead = RESPAWN_DELAY;
    food.stun = 0;
    burst(food.x, food.y, food.rgb, 26, 4);
    sfx().chomp?.();
    banner = { text: `${eater.name} ate ${food.name}!`, rgb: eater.rgb, t: 1.4 };
    if (eater.score >= WIN_SCORE) {
      over = true;
      setTimeout(() => { if (active && onEnd) onEnd({ winner: eater.name, color: eater.color, scores: bats.map((b) => b.score), cpu: opts.cpu }); }, 1200);
    }
  }

  function respawn(b) {
    const foe = bats[1 - b.i];
    const s = spawns.slice().sort((p, q) => Math.hypot(q.x - foe.x, q.y - foe.y) - Math.hypot(p.x - foe.x, p.y - foe.y))[0];
    Object.assign(b, { x: s.x, y: s.y, vx: 0, vy: 0, echoes: START_ECHOES, stun: 0, safe: SPAWN_SAFE, dead: 0, cooldown: 0 });
  }

  // ---- Update ------------------------------------------------------------
  function update(dt) {
    clock += dt;
    if (countdown > 0) {
      const before = Math.ceil(countdown);
      countdown -= dt;
      if (Math.ceil(countdown) !== before) sfx().squeak?.();
      return;
    }
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }

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

    // light fades
    for (let k = 0; k < lit.length; k++) if (lit[k] > 0) lit[k] = Math.max(0, lit[k] - dt * 0.75);

    // rings light walls and stun the other bat
    for (const ring of rings) {
      const prev = ring.r;
      ring.r += RING_SPEED * dt;
      const r = ring.r;
      for (let ty = Math.max(0, Math.floor(ring.y - r - 1)); ty <= Math.min(AH - 1, Math.ceil(ring.y + r + 1)); ty++) {
        for (let tx = Math.max(0, Math.floor(ring.x - r - 1)); tx <= Math.min(AW - 1, Math.ceil(ring.x + r + 1)); tx++) {
          const d = Math.hypot(tx + 0.5 - ring.x, ty + 0.5 - ring.y);
          if (d >= prev - 0.6 && d < r + 0.6) { lit[ty * AW + tx] = 1; litBy[ty * AW + tx] = ring.owner; }
        }
      }
      const foe = bats[1 - ring.owner];
      if (!ring.hit && !foe.dead && foe.safe <= 0) {
        const d = Math.hypot(foe.x - ring.x, foe.y - ring.y);
        if (d < r + R && d >= prev - R) {
          ring.hit = true;
          foe.seen = 1;
          if (foe.stun <= 0) {
            foe.stun = STUN_TIME;
            const push = 2 + 4 * (1 - d / RING_MAX);
            const k = d || 1;
            foe.vx = ((foe.x - ring.x) / k) * push;
            foe.vy = ((foe.y - ring.y) / k) * push;
            burst(foe.x, foe.y, '255, 226, 120', 10);
            sfx().wake?.();
          }
        }
      }
    }
    rings = rings.filter((ring) => ring.r < RING_MAX);

    // eating: touch a stunned rival
    if (!over) {
      const [a, b] = bats;
      if (!a.dead && !b.dead && Math.hypot(a.x - b.x, a.y - b.y) < R * 2 + 0.15) {
        if (b.stun > 0 && a.stun <= 0) eat(a, b);
        else if (a.stun > 0 && b.stun <= 0) eat(b, a);
      }
    }

    // crystals
    for (const c of crystals) {
      if (!c.on) {
        c.timer -= dt;
        if (c.timer <= 0 && crystals.filter((k) => k.on).length < 3) c.on = true;
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

    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
  }

  // ---- Render ------------------------------------------------------------
  let ctx, W, H, PX, ox, oy;
  const FONT = '"Chakra Petch", "Trebuchet MS", system-ui, sans-serif';

  function glow(x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${a})`); g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function render() {
    ctx.fillStyle = '#05060d';
    ctx.fillRect(0, 0, W, H);
    const top = Math.max(44, H * 0.12);       // room for the scoreboard
    PX = Math.min(W / AW, (H - top - 8) / AH);
    ox = (W - AW * PX) / 2;
    oy = top + (H - top - AH * PX) / 2;
    const X = (x) => ox + x * PX, Y = (y) => oy + y * PX;

    // a faint outline of the arena so players always know the bounds
    ctx.strokeStyle = 'rgba(74, 222, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(X(1), Y(1), (AW - 2) * PX, (AH - 2) * PX);

    for (let ty = 0; ty < AH; ty++) {
      for (let tx = 0; tx < AW; tx++) {
        if (!solid(tx, ty)) continue;
        const open = [!solid(tx, ty - 1), !solid(tx + 1, ty), !solid(tx, ty + 1), !solid(tx - 1, ty)];
        if (!open.some(Boolean)) continue;
        let a = lit[ty * AW + tx];
        for (const b of bats) {
          if (b.dead) continue;
          const d = Math.hypot(tx + 0.5 - b.x, ty + 0.5 - b.y);
          a = Math.max(a, Math.max(0, Math.min(1, 1 - (d - 0.7) / 1.4)) * 0.3);
        }
        if (a < 0.02) continue;
        const rgb = lit[ty * AW + tx] > 0.05 ? PLAYERS[litBy[ty * AW + tx]].rgb : '74, 222, 255';
        const x = X(tx), y = Y(ty), s = PX;
        ctx.fillStyle = `rgba(18, 52, 80, ${a * 0.7})`;
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
      const f = 1 - ring.r / RING_MAX, rgb = PLAYERS[ring.owner].rgb;
      ctx.strokeStyle = `rgba(${rgb}, ${f * 0.95})`;
      ctx.lineWidth = Math.max(2, PX * 0.12);
      ctx.beginPath(); ctx.arc(X(ring.x), Y(ring.y), ring.r * PX, 0, Math.PI * 2); ctx.stroke();
    }

    for (const p of particles) {
      ctx.fillStyle = `rgba(${p.rgb}, ${Math.min(1, p.life * 1.6)})`;
      ctx.fillRect(X(p.x) - 2, Y(p.y) - 2, 4, 4);
    }

    for (const b of bats) if (!b.dead) drawBat(b, X(b.x), Y(b.y));
    drawHud();
    drawSticks();
  }

  function drawBat(b, x, y) {
    if (b.safe > 0 && Math.floor(b.safe * 10) % 2 === 0) return;
    const r = PX * R, flap = b.stun > 0 ? 0.2 : Math.sin(clock * 18 + b.i);
    // bodies are dim in the dark; squeaking or being hit lights you up
    const vis = Math.max(0.3, b.seen, b.stun > 0 ? 1 : 0);
    ctx.save();
    ctx.globalAlpha = vis;
    glow(x, y, r * 3, b.rgb, 0.3);
    ctx.fillStyle = b.color;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * r * 0.6, y - r * 0.2); ctx.lineTo(x + s * r * 2.3, y - r * (0.2 + flap * 0.9));
      ctx.lineTo(x + s * r * 1.8, y + r * 0.25); ctx.lineTo(x + s * r * 1.3, y + r * 0.05); ctx.lineTo(x + s * r * 0.9, y + r * 0.45);
      ctx.closePath(); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.75, y - r * 0.5); ctx.lineTo(x - r * 0.45, y - r * 1.35); ctx.lineTo(x - r * 0.1, y - r * 0.8);
    ctx.moveTo(x + r * 0.75, y - r * 0.5); ctx.lineTo(x + r * 0.45, y - r * 1.35); ctx.lineTo(x + r * 0.1, y - r * 0.8);
    ctx.fill();
    ctx.restore();
    // eyes always show in the player's color so you can track yourself
    const lx = b.face * r * 0.18;
    if (b.stun > 0) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.2, PX * 0.05);
      for (const s of [-1, 1]) {
        const ex = x + s * r * 0.32, ey = y - r * 0.1, k = r * 0.14;
        ctx.beginPath(); ctx.moveTo(ex - k, ey - k); ctx.lineTo(ex + k, ey + k); ctx.moveTo(ex + k, ey - k); ctx.lineTo(ex - k, ey + k); ctx.stroke();
      }
      // circling stars
      for (let k = 0; k < 3; k++) {
        const a = clock * 5 + k * 2.1;
        ctx.fillStyle = '#ffe278';
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 1.4, y - r * 1.5 + Math.sin(a) * r * 0.4, Math.max(2, r * 0.18), 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = `700 ${Math.max(10, PX * 0.42)}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffe278';
      ctx.fillText('STUNNED', x, y - r * 2.6);
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x - r * 0.32 + lx, y - r * 0.1, r * 0.22, 0, Math.PI * 2); ctx.arc(x + r * 0.32 + lx, y - r * 0.1, r * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1030';
      ctx.beginPath(); ctx.arc(x - r * 0.28 + lx * 1.4, y - r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.arc(x + r * 0.36 + lx * 1.4, y - r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.fill();
    }
    // name tag
    ctx.font = `700 ${Math.max(9, PX * 0.36)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${b.rgb}, 0.9)`;
    ctx.fillText(b.name, x, y + r * 2.1);
  }

  function drawHud() {
    const size = Math.max(14, Math.min(22, H / 22)), pad = 16, y = Math.max(22, H * 0.06);
    ctx.textBaseline = 'middle';
    bats.forEach((b, k) => {
      const left = k === 0;
      ctx.textAlign = left ? 'left' : 'right';
      ctx.font = `700 ${size * 1.4}px ${FONT}`;
      ctx.fillStyle = b.color;
      const label = left ? `${b.name}  ${b.score}` : `${b.score}  ${b.name}`;
      ctx.fillText(label, left ? pad : W - pad, y);
      const w = ctx.measureText(label).width;
      // echo pips next to the score
      const pr = size * 0.2, gap = size * 0.55;
      for (let e = 0; e < MAX_ECHOES; e++) {
        const px = left ? pad + w + size + e * gap : W - pad - w - size - e * gap;
        ctx.beginPath(); ctx.arc(px, y, pr, 0, Math.PI * 2);
        if (e < b.echoes) { ctx.fillStyle = `rgba(${b.rgb}, 0.95)`; ctx.fill(); }
        else { ctx.strokeStyle = 'rgba(232, 236, 255, 0.2)'; ctx.lineWidth = 1; ctx.stroke(); }
      }
    });
    ctx.textAlign = 'center';
    ctx.font = `600 ${size * 0.8}px ${FONT}`;
    ctx.fillStyle = 'rgba(232, 236, 255, 0.55)';
    ctx.fillText(`First to ${WIN_SCORE} bites`, W / 2, y);

    const mid = oy + (AH * PX) / 2;
    if (countdown > 0) {
      ctx.font = `700 ${size * 4}px ${FONT}`;
      ctx.fillStyle = '#4adeff';
      ctx.fillText(String(Math.ceil(countdown)), W / 2, mid);
      ctx.font = `600 ${size}px ${FONT}`;
      ctx.fillStyle = 'rgba(232, 236, 255, 0.85)';
      ctx.fillText('Squeak to stun. Fly into a stunned bat to eat it.', W / 2, mid + size * 3);
      ctx.fillStyle = 'rgba(232, 236, 255, 0.6)';
      const help = opts.cpu
        ? 'Drag to fly, tap to squeak  ·  Keys: arrows or WASD, Space'
        : 'Mo: left half, or WASD + F  ·  Ka: right half, or arrows + Enter';
      ctx.fillText(help, W / 2, mid + size * 4.4);
    } else if (banner) {
      ctx.font = `700 ${size * 1.8}px ${FONT}`;
      ctx.fillStyle = `rgba(${banner.rgb}, ${Math.min(1, banner.t * 2)})`;
      ctx.fillText(banner.text, W / 2, mid);
    }
    if (!opts.cpu && countdown > 0) {
      ctx.strokeStyle = 'rgba(232, 236, 255, 0.15)';
      ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.moveTo(W / 2, oy); ctx.lineTo(W / 2, oy + AH * PX); ctx.stroke();
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
      ctx.strokeStyle = `rgba(${PLAYERS[s.owner].rgb}, 0.3)`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, STICK_RANGE, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(${PLAYERS[s.owner].rgb}, 0.3)`;
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
    get countdown() { return countdown; },
    squeak: (i) => squeak(bats[i]),
  };
})();
