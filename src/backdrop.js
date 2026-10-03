// Echo Caves: the painted cave behind the menus. Everything is drawn in code:
// stalactites, rocky walls framing the screen, glowing crystals and mushrooms,
// an underground pool, a few bats roosting, and drifting motes of light.
// It shows whenever the title, battle setup or online screens are open.
(() => {
  'use strict';
  const canvas = document.getElementById('backdrop');
  const ctx = canvas.getContext('2d');
  const screens = ['title-screen', 'battle-screen', 'online-screen'].map((id) => document.getElementById(id));
  let W = 0, H = 0, DPR = 1, art = null, motes = [], on = false, last = 0;

  // a seeded random source, so the cave looks the same every time
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const between = (a, b) => a + rnd() * (b - a);

  function glow(g, x, y, r, color, a) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color.replace('A', a)); grad.addColorStop(1, color.replace('A', 0));
    g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // a jagged band of rock between two baselines
  function ridge(g, y0, amp, step, color, fromTop = false) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, fromTop ? 0 : H);
    for (let x = 0; x <= W + step; x += step * between(0.6, 1.4)) g.lineTo(x, y0 + (fromTop ? 1 : -1) * amp * rnd());
    g.lineTo(W, fromTop ? 0 : H);
    g.closePath(); g.fill();
  }

  function stalactites(g, n, maxLen, color, edge) {
    for (let k = 0; k < n; k++) {
      const x = rnd() * W, w = between(10, 34) * (H / 400), len = between(0.3, 1) * maxLen;
      g.fillStyle = color;
      g.beginPath(); g.moveTo(x - w, 0); g.quadraticCurveTo(x - w * 0.3, len * 0.6, x + between(-3, 3), len); g.quadraticCurveTo(x + w * 0.3, len * 0.6, x + w, 0); g.fill();
      g.strokeStyle = edge; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - w * 0.5, 0); g.quadraticCurveTo(x - w * 0.2, len * 0.5, x, len); g.stroke();
    }
  }

  // a cave wall bulging in from one side, with ledges
  function sideWall(g, left, color, rim) {
    const s = left ? 1 : -1, x0 = left ? 0 : W;
    g.fillStyle = color;
    g.beginPath(); g.moveTo(x0, 0);
    let y = 0;
    while (y < H) {
      y += between(14, 40) * (H / 400);
      const depth = W * (0.06 + 0.09 * Math.sin(y / H * Math.PI) + rnd() * 0.05);
      g.lineTo(x0 + s * depth, y);
    }
    g.lineTo(x0, H); g.closePath(); g.fill();
    g.strokeStyle = rim; g.lineWidth = 1.5; g.stroke();
  }

  function crystal(g, x, y, h, w, tilt, hue) {
    const colors = hue === 'cyan' ? ['#bff8ff', '#4adeff', '#1a5dd6'] : ['#e6d4ff', '#9b7bff', '#4a2bb8'];
    g.save(); g.translate(x, y); g.rotate(tilt);
    const grad = g.createLinearGradient(-w, -h, w, 0);
    grad.addColorStop(0, colors[0]); grad.addColorStop(0.45, colors[1]); grad.addColorStop(1, colors[2]);
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(-w, 0); g.lineTo(-w, -h * 0.75); g.lineTo(0, -h); g.lineTo(w, -h * 0.75); g.lineTo(w, 0); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.moveTo(-w * 0.2, 0); g.lineTo(-w * 0.2, -h * 0.8); g.lineTo(0, -h); g.lineTo(0, 0); g.closePath(); g.fill();
    g.restore();
  }
  function crystals(g, x, y, size, hue) {
    glow(g, x, y - size * 0.5, size * 2.2, hue === 'cyan' ? 'rgba(74,222,255,A)' : 'rgba(155,123,255,A)', 0.35);
    const n = 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) crystal(g, x + between(-size * 0.5, size * 0.5), y, size * between(0.5, 1.1), size * between(0.09, 0.15), between(-0.5, 0.5), hue);
  }

  function mushroom(g, x, y, s) {
    glow(g, x, y - s, s * 3, 'rgba(90,230,255,A)', 0.4);
    g.fillStyle = '#9ff3ff';
    g.fillRect(x - s * 0.12, y - s * 1.1, s * 0.24, s * 1.1);
    g.fillStyle = '#5ee6ff';
    g.beginPath(); g.ellipse(x, y - s * 1.1, s * 0.6, s * 0.38, 0, Math.PI, 0); g.fill();
  }

  function roostingBat(g, x, y, s) {
    g.fillStyle = '#0b0a22';
    g.beginPath();
    g.moveTo(x, y - s * 0.4);
    g.quadraticCurveTo(x - s * 1.2, y - s * 1.1, x - s * 1.9, y - s * 0.3);
    g.quadraticCurveTo(x - s * 1.1, y - s * 0.2, x - s * 0.5, y + s * 0.3);
    g.lineTo(x + s * 0.5, y + s * 0.3);
    g.quadraticCurveTo(x + s * 1.1, y - s * 0.2, x + s * 1.9, y - s * 0.3);
    g.quadraticCurveTo(x + s * 1.2, y - s * 1.1, x, y - s * 0.4);
    g.fill();
    g.beginPath(); g.arc(x, y, s * 0.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(x - s * 0.4, y - s * 0.2); g.lineTo(x - s * 0.3, y - s * 0.75); g.lineTo(x - s * 0.1, y - s * 0.35); g.fill();
    g.beginPath(); g.moveTo(x + s * 0.4, y - s * 0.2); g.lineTo(x + s * 0.3, y - s * 0.75); g.lineTo(x + s * 0.1, y - s * 0.35); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(x - s * 0.18, y - s * 0.02, s * 0.13, 0, Math.PI * 2); g.arc(x + s * 0.18, y - s * 0.02, s * 0.13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b0a22';
    g.beginPath(); g.arc(x - s * 0.16, y, s * 0.06, 0, Math.PI * 2); g.arc(x + s * 0.2, y, s * 0.06, 0, Math.PI * 2); g.fill();
  }

  // The still part of the painting, drawn once per screen size
  function paint() {
    seed = 7;
    art = document.createElement('canvas');
    art.width = Math.round(W * DPR); art.height = Math.round(H * DPR);
    const g = art.getContext('2d');
    g.scale(DPR, DPR);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b0b2e'); sky.addColorStop(0.55, '#15124a'); sky.addColorStop(1, '#06071a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    glow(g, W * 0.5, H * 0.18, H * 0.9, 'rgba(110,80,255,A)', 0.22);
    glow(g, W * 0.5, H * 0.95, H * 0.8, 'rgba(40,160,255,A)', 0.2);

    // distant cave depths: layered rock silhouettes getting darker toward us
    ridge(g, H * 0.62, H * 0.22, 26, '#1d1a5c');
    ridge(g, H * 0.72, H * 0.16, 22, '#16134a');
    stalactites(g, Math.round(W / 40), H * 0.22, '#141142', 'rgba(140,120,255,0.18)');
    stalactites(g, Math.round(W / 70), H * 0.34, '#0c0b2c', 'rgba(140,120,255,0.12)');

    // the underground pool
    const pool = g.createLinearGradient(0, H * 0.8, 0, H);
    pool.addColorStop(0, '#0d1c52'); pool.addColorStop(1, '#050717');
    g.fillStyle = pool; g.fillRect(0, H * 0.8, W, H * 0.2);
    glow(g, W * 0.5, H * 0.86, W * 0.35, 'rgba(60,170,255,A)', 0.18);

    // ledges with glowing mushrooms in the middle distance
    for (const [fx, fy, fw] of [[0.2, 0.7, 0.16], [0.82, 0.66, 0.14], [0.66, 0.78, 0.1], [0.32, 0.8, 0.08]]) {
      const x = W * fx, y = H * fy, w = W * fw;
      g.fillStyle = '#100e36';
      g.beginPath(); g.moveTo(x - w / 2, y); g.lineTo(x + w / 2, y); g.lineTo(x + w * 0.35, y + H * 0.05); g.lineTo(x - w * 0.4, y + H * 0.06); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(120,200,255,0.25)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x - w / 2, y); g.lineTo(x + w / 2, y); g.stroke();
      const n = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) mushroom(g, x + between(-w * 0.4, w * 0.4), y, between(4, 8) * (H / 400));
    }

    // cave walls framing both sides
    sideWall(g, true, '#0a0925', 'rgba(130,110,255,0.25)');
    sideWall(g, false, '#0a0925', 'rgba(130,110,255,0.25)');
    stalactites(g, Math.round(W / 90), H * 0.16, '#07061a', 'rgba(140,120,255,0.1)');

    // crystals: big clusters in the corners and a few smaller ones
    const s = H / 400;
    crystals(g, W * 0.05, H * 0.36, 70 * s, 'cyan');
    crystals(g, W * 0.95, H * 0.8, 80 * s, 'violet');
    crystals(g, W * 0.1, H * 0.98, 70 * s, 'violet');
    crystals(g, W * 0.9, H * 0.45, 40 * s, 'violet');
    crystals(g, W * 0.17, H * 0.6, 34 * s, 'cyan');
    crystals(g, W * 0.75, H * 0.97, 36 * s, 'cyan');

    // foreground rocks along the bottom
    ridge(g, H * 0.94, H * 0.12, 30, '#05051a');

    // a few bats roosting up on the right
    roostingBat(g, W * 0.88, H * 0.14, 11 * s);
    roostingBat(g, W * 0.93, H * 0.19, 9 * s);

    motes = Array.from({ length: 40 }, () => ({ x: rnd() * W, y: rnd() * H, r: between(1, 2.6), v: between(4, 12), p: rnd() * 6 }));
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    art = null;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const visible = screens.some((s) => s && !s.hidden) && !matchMedia('(orientation: portrait) and (pointer: coarse)').matches;
    if (visible !== on) { on = visible; canvas.hidden = !on; }
    if (!on || document.hidden) return;
    if (innerWidth !== W || innerHeight !== H) resize();
    if (now - last < 33) return;            // about 30 frames a second is plenty
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!art) paint();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(art, 0, 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const t = now / 1000;
    // shimmer on the pool
    for (let k = 0; k < 7; k++) {
      const y = H * (0.83 + k * 0.022), x = W * (0.5 + 0.3 * Math.sin(t * 0.3 + k * 1.7)), w = W * (0.06 + 0.02 * k);
      ctx.strokeStyle = `rgba(120, 210, 255, ${0.12 + 0.08 * Math.sin(t * 1.5 + k)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x + w, y); ctx.stroke();
    }
    // drifting motes of light
    for (const m of motes) {
      m.y -= m.v * dt; m.x += Math.sin(t * 0.6 + m.p) * 4 * dt;
      if (m.y < -5) { m.y = H + 5; m.x = Math.random() * W; }
      const a = 0.35 + 0.35 * Math.sin(t * 1.3 + m.p);
      glow(ctx, m.x, m.y, m.r * 5, 'rgba(90,200,255,A)', a * 0.5);
      ctx.fillStyle = `rgba(160, 230, 255, ${a})`;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  resize();
  requestAnimationFrame(frame);
})();
