// Echo Caves: the painted cave behind the menus. Everything is drawn in code.
// The still painting (layered stalactites, faceted side cliffs with ledges,
// crystal clusters, mushroom islands, waterfalls, the pool and the stone bat
// altar) is drawn once per screen size into an offscreen layer. Each frame
// only copies that layer and adds the cheap moving bits: falling water
// streaks, mist, pool ripples, drifting motes, sonar pulses from the altar
// and blinking bat eyes, at about 30 frames a second.
//
// It shows whenever a menu overlay is open: any `.overlay.menu:not([hidden])`
// or one of the menu screens by id. window.EchoBackdrop.altar(false) hides
// the bat altar for screens where it would clash.
(() => {
  'use strict';
  const canvas = document.getElementById('backdrop');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const MENU_IDS = ['title-screen', 'battle-screen', 'multi-screen'];
  const portrait = matchMedia('(orientation: portrait) and (pointer: coarse)');
  let W = 0, H = 0, U = 1, DPR = 1, art = null, on = false, last = 0;
  let showAltar = true;
  let motes = [], falls = [], ripples = [], eyes = [], altar = null, pool = 0;

  // a seeded random source, so the cave looks the same every time
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const between = (a, b) => a + rnd() * (b - a);

  // ---- colour helpers -------------------------------------------------------
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function shade(h, t) { // t > 0 lightens toward white, t < 0 darkens
    const c = hex(h), to = t > 0 ? 255 : 0, k = Math.abs(t);
    return `rgb(${c.map((v) => Math.round(v + (to - v) * k)).join(',')})`;
  }
  const rgba = (h, a) => `rgba(${hex(h).join(',')},${a})`;

  function glow(g, x, y, r, color, a) {
    if (r <= 0) return;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, rgba(color, a)); grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // soft round sprites for the animated glows, far cheaper than gradients per frame
  const sprites = {};
  function sprite(color) {
    if (sprites[color]) return sprites[color];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(color, 1)); grad.addColorStop(0.25, rgba(color, 0.45)); grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return (sprites[color] = c);
  }
  function blob(g, color, x, y, r, a) {
    if (a <= 0.01) return;
    g.globalAlpha = Math.min(1, a); g.drawImage(sprite(color), x - r, y - r, r * 2, r * 2); g.globalAlpha = 1;
  }

  function poly(g, pts) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }

  // A low-poly rock: the polygon is split into facets around a jittered
  // centre, each facet lit by how much it faces up toward the cave glow.
  function rock(g, pts, base, light, rim, rimA = 0.55) {
    poly(g, pts); g.fillStyle = base; g.fill();
    let cx = 0, cy = 0, area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      cx += x1; cy += y1; area += x1 * y2 - x2 * y1;
    }
    cx /= pts.length; cy /= pts.length;
    const sgn = area > 0 ? 1 : -1;
    g.save(); poly(g, pts); g.clip();
    const jx = cx + between(-1, 1) * U * 2, jy = cy + between(-1, 1) * U * 2;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ny = (-(x2 - x1) / len) * sgn, nx = ((y2 - y1) / len) * sgn; // outward normal
      const lit = Math.max(0, -ny * 0.8 - nx * 0.25) * 0.42 + between(0, 0.07);
      g.fillStyle = shade(light, -(1 - lit));
      g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(jx, jy); g.closePath(); g.fill();
    }
    g.globalAlpha = 1; g.restore();
    // bright rims along the up-facing edges (ledge tops)
    if (rim) {
      g.lineWidth = Math.max(1, U * 0.28); g.lineJoin = 'round';
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ny = (-(x2 - x1) / len) * sgn;
        if (ny < -0.45) {
          g.strokeStyle = rgba(rim, rimA * Math.min(1, -ny));
          g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        }
      }
    }
  }

  // ---- cave pieces ------------------------------------------------------------
  function stalactite(g, x, top, w, len, base, lit) {
    const tip = [x + between(-0.2, 0.2) * w, top + len];
    const mid = [x + w * between(-0.1, 0.25), top];
    g.fillStyle = shade(base, lit);
    poly(g, [[x - w, top], mid, tip]); g.fill();
    g.fillStyle = base;
    poly(g, [mid, [x + w, top], tip]); g.fill();
    // a smaller drip beside some of them
    if (rnd() < 0.3) {
      const x2 = x + w * between(0.4, 0.8), w2 = w * 0.35, l2 = len * between(0.3, 0.55);
      g.fillStyle = base; poly(g, [[x2 - w2, top], [x2 + w2, top], [x2, top + l2]]); g.fill();
    }
  }
  function ceilingLayer(g, step, minLen, maxLen, base, lit, calm, top = 0) {
    for (let x = -step; x < W + step; x += step * between(0.5, 1.2)) {
      const fromMid = Math.abs(x - W / 2) / (W / 2);           // 0 centre .. 1 edges
      const k = calm ? Math.min(1, 0.45 + fromMid * fromMid * 1.2) : 1;
      const r = rnd(), big = r > 0.8;                          // now and then a big fang
      const len = (minLen + (maxLen - minLen) * r * r) * k * (big ? 1.25 : 1);
      stalactite(g, x, top - U, step * between(0.3, 0.55) * (big ? 1.5 : 1), len, base, lit);
    }
  }
  function spire(g, x, baseY, w, h, base, lit) {
    const tip = [x + between(-0.25, 0.25) * w, baseY - h];
    g.fillStyle = shade(base, lit); poly(g, [[x - w, baseY], tip, [x, baseY]]); g.fill();
    g.fillStyle = base; poly(g, [[x, baseY], tip, [x + w, baseY]]); g.fill();
  }

  // A cliff along one side of the screen built from stacked rock blocks.
  // profile: [y, depth] pairs in height units; depth is how far it juts in.
  function cliff(g, left, profile, base, light, rim) {
    const ex = left ? -2 : W + 2, sx = left ? 1 : -1;
    const X = (d) => ex + sx * d * U;
    // the whole silhouette first so the blocks never show seams
    g.fillStyle = base; g.beginPath(); g.moveTo(ex, 0);
    for (const [y, d] of profile) g.lineTo(X(d), y * U);
    g.lineTo(ex, H); g.closePath(); g.fill();
    for (let i = 0; i < profile.length - 1; i++) {
      const [y1, d1] = profile[i], [y2, d2] = profile[i + 1];
      const pts = [[ex, y1 * U - 1], [X(d1), y1 * U - 1]];
      if (Math.abs(d2 - d1) > 3) pts.push([X(Math.min(d1, d2) + Math.abs(d2 - d1) * 0.4), (y1 + (y2 - y1) * 0.5) * U]);
      pts.push([X(d2), y2 * U + 1], [ex, y2 * U + 1]);
      rock(g, pts, base, light, null);
      // a crack or two across the face
      g.strokeStyle = 'rgba(3,2,16,0.45)'; g.lineWidth = Math.max(1, U * 0.2);
      g.beginPath(); g.moveTo(X(Math.min(d1, d2) * between(0.2, 0.8)), y1 * U); g.lineTo(X(Math.min(d1, d2) * between(0.2, 0.8)), (y1 + (y2 - y1) * between(0.4, 0.9)) * U); g.stroke();
    }
    // lit ledge tops where a block juts out past the one above, and a rim on the face
    g.lineCap = 'round';
    for (let i = 1; i < profile.length; i++) {
      const [y0, d0] = profile[i - 1], [y, d] = profile[i];
      if (d > d0 + 1.5) {
        g.strokeStyle = rgba(rim, 0.8); g.lineWidth = Math.max(1.2, U * 0.4);
        g.beginPath(); g.moveTo(X(d0 + (d - d0) * 0.1), y0 * U + (y - y0) * U * 0.1); g.lineTo(X(d), y * U); g.stroke();
        glow(g, X((d + d0) / 2), y * U, (d - d0) * U * 0.6, rim, 0.12);
      } else {
        g.strokeStyle = rgba(rim, 0.22); g.lineWidth = Math.max(1, U * 0.22);
        g.beginPath(); g.moveTo(X(d0), y0 * U); g.lineTo(X(d), y * U); g.stroke();
      }
    }
    g.lineCap = 'butt';
  }

  function crystal(g, x, y, h, w, tilt, pal) {
    g.save(); g.translate(x, y); g.rotate(tilt);
    const body = [[-w, 0], [-w, -h * 0.72], [0, -h], [w, -h * 0.72], [w, 0]];
    const grad = g.createLinearGradient(0, -h, 0, 0);
    grad.addColorStop(0, pal[0]); grad.addColorStop(0.5, pal[1]); grad.addColorStop(1, pal[2]);
    g.fillStyle = grad; poly(g, body); g.fill();
    // facets: a bright left face, a dark right face and a light ridge
    g.fillStyle = 'rgba(255,255,255,0.28)';
    poly(g, [[-w, 0], [-w, -h * 0.72], [0, -h], [-w * 0.15, -h * 0.7], [-w * 0.15, 0]]); g.fill();
    g.fillStyle = 'rgba(10,0,60,0.28)';
    poly(g, [[w * 0.35, 0], [w * 0.35, -h * 0.7], [0, -h], [w, -h * 0.72], [w, 0]]); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = Math.max(0.8, w * 0.12);
    g.beginPath(); g.moveTo(-w * 0.15, -h * 0.05); g.lineTo(-w * 0.15, -h * 0.7); g.lineTo(0, -h); g.stroke();
    g.restore();
  }
  const PAL = {
    cyan: ['#e6fdff', '#4adeff', '#1747b8', '#4adeff'],
    violet: ['#f1e6ff', '#a68bff', '#3b23a8', '#9b7bff'],
    blue: ['#e0ecff', '#6a9bff', '#2433a8', '#6a8bff'],
  };
  function crystals(g, x, y, size, hue, spread = 0.55) {
    const pal = PAL[hue];
    glow(g, x, y - size * 0.45, size * 1.6, pal[3], 0.32);
    const n = 4 + Math.floor(rnd() * 3), list = [];
    for (let k = 0; k < n; k++) {
      const off = between(-1, 1);
      list.push([x + off * size * spread * 0.6, size * between(0.45, 1) * (1 - Math.abs(off) * 0.35), off * 0.35 + between(-0.1, 0.1)]);
    }
    list.sort((a, b) => b[1] - a[1]); // tall ones behind
    for (const [cx, h, tilt] of list) crystal(g, cx, y + size * 0.05, h, h * between(0.13, 0.19), tilt, pal);
  }

  function mushroom(g, x, y, s) {
    glow(g, x, y - s, s * 3.2, '#5ae6ff', 0.38);
    g.fillStyle = '#bff6ff';
    g.beginPath(); g.moveTo(x - s * 0.13, y); g.quadraticCurveTo(x - s * 0.2, y - s * 0.6, x - s * 0.1, y - s * 1.05);
    g.lineTo(x + s * 0.1, y - s * 1.05); g.quadraticCurveTo(x + s * 0.2, y - s * 0.6, x + s * 0.13, y); g.fill();
    const cap = g.createLinearGradient(0, y - s * 1.6, 0, y - s * 0.95);
    cap.addColorStop(0, '#e2fdff'); cap.addColorStop(1, '#3fd2ff');
    g.fillStyle = cap;
    g.beginPath(); g.ellipse(x, y - s * 1.0, s * 0.62, s * 0.55, 0, Math.PI, 0); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath(); g.arc(x - s * 0.22, y - s * 1.25, s * 0.08, 0, 7); g.arc(x + s * 0.18, y - s * 1.32, s * 0.06, 0, 7); g.fill();
  }

  // a floating rock island: lit top, tapering underside, mushrooms on top
  function island(g, x, y, w, mush) {
    const pts = [[x - w / 2, y], [x - w * 0.3, y - U * 0.8], [x + w * 0.2, y - U * 0.5], [x + w / 2, y + U * 0.3],
      [x + w * 0.38, y + U * 4], [x + w * 0.15, y + U * 8], [x - w * 0.05, y + U * 11], [x - w * 0.25, y + U * 6], [x - w * 0.45, y + U * 3]];
    rock(g, pts, '#141045', '#3a2fa6', '#9fd8ff', 0.75);
    for (let k = 0; k < mush; k++) mushroom(g, x + between(-0.38, 0.32) * w, y - U * 0.4, U * between(1.1, 2.1));
  }

  function waterfallStatic(g, f) {
    const { x, y0, y1, w } = f, wb = w * 1.25;
    glow(g, x, (y0 + y1) / 2, Math.max(w * 3, (y1 - y0) * 0.55), '#4aa8ff', 0.18);
    // the sheet: bright core, soft see-through edges, flaring toward the bottom
    const sheet = g.createLinearGradient(x - wb / 2, 0, x + wb / 2, 0);
    sheet.addColorStop(0, 'rgba(120,200,255,0.15)'); sheet.addColorStop(0.18, 'rgba(170,235,255,0.75)');
    sheet.addColorStop(0.45, 'rgba(225,250,255,0.9)'); sheet.addColorStop(0.75, 'rgba(110,200,255,0.65)'); sheet.addColorStop(1, 'rgba(80,150,255,0.12)');
    g.fillStyle = sheet;
    g.beginPath(); g.moveTo(x - w / 2, y0); g.lineTo(x + w / 2, y0); g.lineTo(x + wb / 2, y1); g.lineTo(x - wb / 2, y1); g.closePath(); g.fill();
    const fade = g.createLinearGradient(0, y0, 0, y1);
    fade.addColorStop(0, 'rgba(255,255,255,0.25)'); fade.addColorStop(0.3, 'rgba(40,90,200,0)'); fade.addColorStop(1, 'rgba(40,90,200,0.25)');
    g.fillStyle = fade; g.fill();
    g.strokeStyle = 'rgba(30,80,190,0.35)'; g.lineWidth = Math.max(0.8, w * 0.07);
    for (let k = 0; k < 5; k++) { const q = between(-0.4, 0.4); g.beginPath(); g.moveTo(x + q * w, y0 + between(0, 0.3) * (y1 - y0)); g.lineTo(x + q * wb, y1); g.stroke(); }
    // the lip it pours over and the foam where it lands
    g.fillStyle = 'rgba(235,252,255,0.95)';
    g.beginPath(); g.ellipse(x, y0, w * 0.62, Math.max(1, U * 0.4), 0, 0, 7); g.fill();
    glow(g, x, y1, w * 3.2, '#cdeeff', 0.45);
    g.fillStyle = 'rgba(225,248,255,0.6)';
    g.beginPath(); g.ellipse(x, y1, wb * 0.95, Math.max(1.5, U * 0.7), 0, 0, 7); g.fill();
  }

  // a dark bat silhouette roosting on a ledge; eyes are drawn each frame
  function roostingBat(g, x, y, s, spread) {
    g.fillStyle = '#07061a';
    const wx = 1.4 + spread * 0.8, wy = 0.9 + spread * 0.4;
    for (const d of [-1, 1]) {
      g.beginPath(); g.moveTo(x + d * s * 0.3, y - s * 0.3);
      g.quadraticCurveTo(x + d * s * wx * 0.7, y - s * wy * 1.2, x + d * s * wx * 1.25, y - s * wy * 0.55);
      g.quadraticCurveTo(x + d * s * wx * 1.05, y - s * 0.05, x + d * s * wx * 0.85, y + s * 0.15);
      g.quadraticCurveTo(x + d * s * wx * 0.65, y - s * 0.05, x + d * s * wx * 0.45, y + s * 0.3);
      g.quadraticCurveTo(x + d * s * 0.4, y + s * 0.1, x + d * s * 0.2, y + s * 0.4);
      g.closePath(); g.fill();
    }
    g.beginPath(); g.ellipse(x, y, s * 0.62, s * 0.58, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(x - s * 0.5, y - s * 0.25); g.lineTo(x - s * 0.42, y - s * 0.95); g.lineTo(x - s * 0.1, y - s * 0.45); g.fill();
    g.beginPath(); g.moveTo(x + s * 0.5, y - s * 0.25); g.lineTo(x + s * 0.42, y - s * 0.95); g.lineTo(x + s * 0.1, y - s * 0.45); g.fill();
    eyes.push({ x, y: y - s * 0.02, r: s * 0.17, gap: s * 0.24, p: rnd() * 6, every: between(3, 6.5) });
  }

  // ---- the stone bat altar ----------------------------------------------------
  function paintAltar(g) {
    const A = U * 0.74, cx = W / 2, base = Math.min(H * 0.95, pool + U * 5);
    glow(g, cx, base - 28 * A, 40 * A, '#7a5cff', 0.3);
    glow(g, cx, base - 22 * A, 18 * A, '#4adeff', 0.18);
    // stepped platforms, widest at the bottom, each with a lit top face
    const tiers = [[62, 5], [48, 4.5], [36, 4], [24, 3.5]];
    let y = base;
    for (const [w, h] of tiers) {
      const hw = w * A / 2, hh = h * A, depth = 2.4 * A;
      const front = [[cx - hw, y], [cx - hw - A * 0.6, y - hh * 0.5], [cx - hw, y - hh], [cx + hw, y - hh], [cx + hw + A * 0.6, y - hh * 0.5], [cx + hw, y]];
      rock(g, front, '#130f48', '#3a30a8', null);
      // stone joints
      g.strokeStyle = 'rgba(5,4,25,0.7)'; g.lineWidth = Math.max(1, A * 0.25);
      for (let xx = cx - hw + between(3, 6) * A; xx < cx + hw - 2 * A; xx += between(5, 9) * A) {
        g.beginPath(); g.moveTo(xx, y); g.lineTo(xx + between(-0.6, 0.6) * A, y - hh); g.stroke();
      }
      const topFace = [[cx - hw, y - hh], [cx - hw + depth, y - hh - depth * 0.6], [cx + hw - depth, y - hh - depth * 0.6], [cx + hw, y - hh]];
      const tg = g.createLinearGradient(0, y - hh - depth, 0, y - hh);
      tg.addColorStop(0, '#5a4fd0'); tg.addColorStop(1, '#2d2590');
      g.fillStyle = tg; poly(g, topFace); g.fill();
      g.strokeStyle = 'rgba(170,190,255,0.75)'; g.lineWidth = Math.max(1, A * 0.3);
      g.beginPath(); g.moveTo(cx - hw, y - hh); g.lineTo(cx + hw, y - hh); g.stroke();
      y -= hh + depth * 0.6;
    }
    const top = y;
    // the glowing ring on the plinth top
    glow(g, cx, top, 14 * A, '#4adeff', 0.35);
    g.strokeStyle = 'rgba(120,230,255,0.85)'; g.lineWidth = Math.max(1, A * 0.45);
    g.beginPath(); g.ellipse(cx, top - A * 0.3, 9 * A, 1.4 * A, 0, 0, 7); g.stroke();
    // crystals flanking the idol
    crystals(g, cx - 14 * A, top + 4 * A, 13 * A, 'violet', 0.7);
    crystals(g, cx + 14 * A, top + 4 * A, 12 * A, 'violet', 0.7);
    crystals(g, cx - 24 * A, base - 6 * A, 9 * A, 'violet', 0.6);
    crystals(g, cx + 24 * A, base - 5 * A, 10 * A, 'violet', 0.6);

    // spread stone wings behind the body: curved arms, scalloped membranes
    const by = top - 1 * A, bodyTop = by - 26 * A;
    for (const d of [-1, 1]) {
      const P = (px, py) => [cx + d * px * A, bodyTop + py * A];
      const sh = P(5, 8), elbow = P(17, -3), tip = P(31, 2);
      const fingers = [P(29, 10), P(22, 15), P(13, 19)];
      const mem = g.createLinearGradient(cx, bodyTop - 4 * A, cx + d * 30 * A, bodyTop + 18 * A);
      mem.addColorStop(0, '#2a2380'); mem.addColorStop(0.6, '#1a1558'); mem.addColorStop(1, '#0f0c3a');
      g.fillStyle = mem;
      g.beginPath(); g.moveTo(sh[0], sh[1]);
      g.quadraticCurveTo(cx + d * 10 * A, bodyTop - 4 * A, elbow[0], elbow[1]);
      g.quadraticCurveTo(cx + d * 25 * A, bodyTop - 6 * A, tip[0], tip[1]);
      let prev = tip;
      for (const f of fingers) {
        const mx = (prev[0] + f[0]) / 2, my = (prev[1] + f[1]) / 2;
        g.quadraticCurveTo(mx - d * 0.5 * A, my - 3.2 * A, f[0], f[1]);
        prev = f;
      }
      g.quadraticCurveTo(cx + d * 8 * A, bodyTop + 16 * A, cx + d * 5 * A, bodyTop + 22 * A);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(160,140,255,0.55)'; g.lineWidth = Math.max(1, A * 0.5); g.lineCap = 'round';
      g.beginPath(); g.moveTo(sh[0], sh[1]); g.quadraticCurveTo(cx + d * 10 * A, bodyTop - 4 * A, elbow[0], elbow[1]);
      g.quadraticCurveTo(cx + d * 25 * A, bodyTop - 6 * A, tip[0], tip[1]); g.stroke();
      g.strokeStyle = 'rgba(140,120,255,0.4)'; g.lineWidth = Math.max(1, A * 0.35);
      for (const f of fingers) { g.beginPath(); g.moveTo(elbow[0], elbow[1]); g.lineTo(f[0], f[1]); g.stroke(); }
      g.lineCap = 'butt';
    }
    // the idol's body: a rounded stone with ears
    const bw = 8.5 * A;
    const bodyGrad = g.createLinearGradient(cx - bw, 0, cx + bw, 0);
    bodyGrad.addColorStop(0, '#3a2f9a'); bodyGrad.addColorStop(0.45, '#251e72'); bodyGrad.addColorStop(1, '#130f45');
    g.fillStyle = bodyGrad;
    g.beginPath();
    g.moveTo(cx - bw, by);
    g.lineTo(cx - bw * 1.02, bodyTop + bw);
    g.quadraticCurveTo(cx - bw, bodyTop, cx - bw * 0.55, bodyTop - A * 0.2);
    g.lineTo(cx - bw * 0.75, bodyTop - 6 * A); g.lineTo(cx - bw * 0.15, bodyTop - A * 0.4);
    g.lineTo(cx + bw * 0.15, bodyTop - A * 0.4); g.lineTo(cx + bw * 0.75, bodyTop - 6 * A);
    g.lineTo(cx + bw * 0.55, bodyTop - A * 0.2);
    g.quadraticCurveTo(cx + bw, bodyTop, cx + bw * 1.02, bodyTop + bw);
    g.lineTo(cx + bw, by); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(180,165,255,0.55)'; g.lineWidth = Math.max(1, A * 0.35); g.stroke();
    // chest plate
    g.fillStyle = 'rgba(8,6,30,0.45)';
    g.beginPath(); g.ellipse(cx, bodyTop + 16 * A, bw * 0.8, 8 * A, 0, 0, 7); g.fill();
    // brow ridge
    g.fillStyle = '#0d0a33';
    g.beginPath(); g.moveTo(cx - bw * 0.8, bodyTop + 3.2 * A); g.lineTo(cx, bodyTop + 4.6 * A); g.lineTo(cx + bw * 0.8, bodyTop + 3.2 * A); g.lineTo(cx + bw * 0.8, bodyTop + 4.4 * A); g.lineTo(cx, bodyTop + 5.8 * A); g.lineTo(cx - bw * 0.8, bodyTop + 4.4 * A); g.fill();
    // eye sockets (the glow is animated)
    const eyeY = bodyTop + 6.5 * A;
    g.fillStyle = '#05041a';
    g.beginPath(); g.ellipse(cx - 3.2 * A, eyeY, 1.6 * A, 1.3 * A, 0, 0, 7); g.ellipse(cx + 3.2 * A, eyeY, 1.6 * A, 1.3 * A, 0, 0, 7); g.fill();
    // the sonar emblem
    const ey = bodyTop + 16 * A, er = 5.5 * A;
    glow(g, cx, ey, er * 3, '#4adeff', 0.35);
    g.fillStyle = '#0a0828'; g.beginPath(); g.arc(cx, ey, er, 0, 7); g.fill();
    g.strokeStyle = '#6fe6ff'; g.lineWidth = Math.max(1, A * 0.55); g.beginPath(); g.arc(cx, ey, er, 0, 7); g.stroke();
    g.lineCap = 'round';
    for (const d of [-1, 1]) for (const r of [2.2, 3.6]) {
      g.beginPath(); g.arc(cx, ey, r * A, d < 0 ? Math.PI - 0.7 : -0.7, d < 0 ? Math.PI + 0.7 : 0.7); g.stroke();
    }
    g.lineCap = 'butt';
    // tiny falls trickling off the lowest step
    falls.push({ x: cx - 25 * A, y0: base - 5.5 * A, y1: base + 1.5 * A, w: 1.6 * A, sp: 0.9 },
      { x: cx + 27 * A, y0: base - 5 * A, y1: base + 1.5 * A, w: 1.6 * A, sp: 1.1 });
    altar = { cx, eyeY, ey, er, A, base };
  }

  // ---- the still painting -----------------------------------------------------
  function paint() {
    seed = 7; falls = []; ripples = []; eyes = []; altar = null;
    art = document.createElement('canvas');
    art.width = Math.round(W * DPR); art.height = Math.round(H * DPR);
    const g = art.getContext('2d');
    g.scale(DPR, DPR);
    pool = H * 0.86;
    const side = Math.max(16 * U, W * 0.13); // how far the side cliffs reach in

    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0c0930'); sky.addColorStop(0.35, '#1a1262'); sky.addColorStop(0.7, '#1b1868'); sky.addColorStop(1, '#080826');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    glow(g, W * 0.5, H * 0.4, Math.max(W * 0.45, H * 0.8), '#7a55ff', 0.28);
    glow(g, W * 0.5, H * 0.85, W * 0.45, '#2e8cff', 0.22);
    glow(g, W * 0.12, H * 0.45, H * 0.5, '#3a6cff', 0.12);
    glow(g, W * 0.88, H * 0.45, H * 0.5, '#3a6cff', 0.12);

    // the far wall: faint vertical rock columns
    for (let x = 0; x < W; x += U * between(3, 7)) {
      g.fillStyle = rgba(rnd() < 0.5 ? '#2c2490' : '#1b1666', between(0.15, 0.35));
      const y0 = between(0.1, 0.3) * H;
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x + U * between(1, 3), y0 + U * between(-2, 2)); g.lineTo(x + U * between(1, 3), H * 0.8); g.lineTo(x, H * 0.8); g.fill();
    }
    // hazy far cliffs either side of the middle
    for (const d of [-1, 1]) {
      const x0 = W / 2 + d * W * 0.3;
      const pts = [[x0 + d * W * 0.25, H * 0.15], [x0 + d * U * 2, H * 0.12], [x0 - d * U * 3, H * 0.3], [x0 + d * U, H * 0.42], [x0 - d * U * 5, H * 0.55], [x0 - d * U * 2, H * 0.8], [x0 + d * W * 0.25, H * 0.8]];
      rock(g, pts, '#211a6e', '#3b32a0', '#7f78ff', 0.3);
    }
    for (const y of [0.3, 0.5, 0.66]) glow(g, W / 2, H * y, W * 0.4, '#6a50e8', 0.1);
    // distant spires and ridges
    for (let x = -U * 4; x < W + U * 4; x += U * between(4, 9)) {
      const mid = Math.abs(x - W / 2) / (W / 2);
      spire(g, x, H * 0.8, U * between(3, 6), U * between(10, 30) * (0.6 + mid * 0.6), '#211b72', 0.12);
    }
    // the farthest ceiling: long, faint fangs that fill the middle without stealing focus
    g.globalAlpha = 0.55;
    ceilingLayer(g, U * 4, U * 14, U * 52, '#2a2390', 0.2, false);
    g.globalAlpha = 1;
    ceilingLayer(g, U * 3.5, U * 6, U * 20, '#2c2488', 0.18, false);
    ceilingLayer(g, U * 5, U * 8, U * 28, '#221b70', 0.16, true);
    ceilingLayer(g, U * 7, U * 10, U * 34, '#181358', 0.14, true);

    // the middle-distance floor
    const ridgePts = [[-U, H]];
    for (let x = -U; x <= W + U * 6; x += U * between(4, 9)) ridgePts.push([x, H * 0.74 + between(-1, 1) * U * 3 + Math.abs(x - W / 2) / W * -U * 6]);
    ridgePts.push([W + U, H]);
    rock(g, ridgePts, '#17134e', '#2f2795', '#7f8cff', 0.35);

    // cliffs framing both sides, back layer then front layer
    const k = side / U;
    cliff(g, true, [[0, k * 1.3], [10, k * 1.25], [17, k * 1.5], [24, k * 1.1], [36, k * 1.35], [48, k * 1.0], [60, k * 1.2], [72, k * 0.9], [100, k * 1.1]], '#1b1662', '#3b31a8', '#8f86ff');
    cliff(g, false, [[0, k * 1.2], [12, k * 1.4], [22, k * 1.1], [30, k * 1.45], [44, k * 1.0], [56, k * 1.3], [68, k * 0.95], [100, k * 1.15]], '#1b1662', '#3b31a8', '#8f86ff');

    // the near ceiling: big dark fangs mostly over the sides
    ceilingLayer(g, U * 9, U * 5, U * 38, '#0e0b36', 0.12, true);
    // the ceiling rock itself
    const ceil = [[-U, -U]];
    for (let x = -U; x <= W + U * 5; x += U * between(3, 6)) ceil.push([x, U * between(1, 4)]);
    ceil.push([W + U, -U]); poly(g, ceil); g.fillStyle = '#0a0828'; g.fill();

    // floating mushroom islands with waterfalls pouring off them
    const lx = Math.max(side * 1.55, W * 0.22), rx = W - Math.max(side * 1.5, W * 0.22);
    island(g, lx, H * 0.665, 20 * U, 4);
    island(g, rx, H * 0.675, 22 * U, 4);
    island(g, Math.max(side * 0.9, W * 0.1), H * 0.74, 14 * U, 2);
    island(g, W - Math.max(side * 0.85, W * 0.09), H * 0.735, 15 * U, 3);
    falls.push({ x: lx + 7 * U, y0: H * 0.668, y1: pool + U, w: 3 * U, sp: 1 });
    falls.push({ x: rx - 7 * U, y0: H * 0.678, y1: pool + U, w: 3.4 * U, sp: 1.15 });

    // front cliffs with ledges
    const L = [[0, k * 0.85], [8, k * 0.8], [14, k * 1.2], [17, k * 0.75], [30, k * 0.7], [34, k * 1.05], [40, k * 0.6], [58, k * 0.55], [64, k * 0.95], [70, k * 0.7], [100, k * 0.8]];
    const R = [[0, k * 0.8], [10, k * 0.75], [15, k * 1.15], [19, k * 0.7], [36, k * 0.65], [40, k * 1.0], [46, k * 0.55], [60, k * 0.6], [66, k * 0.95], [100, k * 0.9]];
    cliff(g, true, L, '#0e0b36', '#2f2690', '#9a8cff');
    cliff(g, false, R, '#0e0b36', '#2f2690', '#9a8cff');
    // waterfalls down the cliff faces
    falls.push({ x: k * 0.62 * U, y0: 14 * U, y1: 30 * U, w: 2.6 * U, sp: 0.85 });
    falls.push({ x: k * 0.5 * U, y0: 40 * U, y1: 58 * U, w: 2.2 * U, sp: 0.95 });
    falls.push({ x: W - k * 0.5 * U, y0: 40 * U, y1: pool + U, w: 3 * U, sp: 1.05 });

    // crystals on the ledges
    crystals(g, k * 0.5 * U, 34 * U, 15 * U, 'cyan', 0.8);
    crystals(g, W - k * 0.6 * U, 40 * U, 17 * U, 'violet', 0.8);
    crystals(g, k * 0.3 * U, 14 * U, 8 * U, 'blue', 0.6);
    crystals(g, W - k * 0.4 * U, 15 * U, 7 * U, 'cyan', 0.6);

    // the underground pool
    const pg = g.createLinearGradient(0, pool, 0, H);
    pg.addColorStop(0, '#16307a'); pg.addColorStop(0.3, '#0d1c55'); pg.addColorStop(1, '#050820');
    g.fillStyle = pg; g.fillRect(0, pool, W, H - pool);
    g.strokeStyle = 'rgba(140,210,255,0.35)'; g.lineWidth = Math.max(1, U * 0.3);
    g.beginPath(); g.moveTo(0, pool); g.lineTo(W, pool); g.stroke();
    for (const f of falls) {
      const rg = g.createLinearGradient(0, pool, 0, H);
      rg.addColorStop(0, 'rgba(140,220,255,0.35)'); rg.addColorStop(1, 'rgba(140,220,255,0)');
      g.fillStyle = rg; g.fillRect(f.x - f.w, pool, f.w * 2, H - pool);
    }

    if (showAltar) paintAltar(g);
    else glow(g, W / 2, pool, W * 0.25, '#5a8cff', 0.18);

    for (const f of falls) waterfallStatic(g, f);
    for (const f of falls) if (f.y1 >= pool - U) ripples.push({ x: f.x, y: pool + U * between(1, 3), r: f.w * 3, p: rnd() });
    if (altar) ripples.push({ x: W / 2, y: altar.base + U * 1.5, r: 18 * U, p: 0.3 }, { x: W / 2, y: altar.base + U * 1.5, r: 18 * U, p: 0.8 });
    else ripples.push({ x: W * 0.5, y: H * 0.93, r: 10 * U, p: 0.2 });

    // foreground: dark boulders and big crystals in the lower corners
    rock(g, [[-U, H + U], [-U, H * 0.8], [6 * U, H * 0.76], [14 * U, H * 0.8], [22 * U, H * 0.88], [30 * U, H + U]], '#0a0828', '#2a2280', '#8f86ff');
    rock(g, [[W + U, H + U], [W + U, H * 0.78], [W - 8 * U, H * 0.75], [W - 16 * U, H * 0.82], [W - 26 * U, H * 0.9], [W - 34 * U, H + U]], '#0a0828', '#2a2280', '#8f86ff');
    crystals(g, 9 * U, H * 0.84, 20 * U, 'violet', 0.8);
    crystals(g, W - 11 * U, H * 0.82, 22 * U, 'violet', 0.8);
    rock(g, [[W * 0.3, H + U], [W * 0.36, H * 0.965], [W * 0.42, H * 0.985], [W * 0.5, H * 0.975], [W * 0.6, H * 0.985], [W * 0.66, H * 0.96], [W * 0.72, H + U]], '#07061c', '#221c66', '#6f78ff', 0.3);

    // bats roosting up in the corners
    roostingBat(g, k * 0.55 * U, 12.6 * U, 3.2 * U, 1);
    roostingBat(g, W - k * 0.45 * U, 14 * U, 3 * U, 0.6);
    roostingBat(g, W - k * 0.95 * U, 7 * U, 2 * U, 0.2);
    roostingBat(g, k * 1.0 * U, 41 * U, 1.8 * U, 0.3);

    // a soft vignette so the edges recede
    const vg = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(4,3,20,0)'); vg.addColorStop(1, 'rgba(4,3,20,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);

    // streaks for each waterfall
    for (const f of falls) {
      f.streaks = Array.from({ length: Math.max(3, Math.round(f.w / U * 1.6)) }, () => ({ o: rnd(), x: between(-0.4, 0.4), l: between(0.12, 0.3) }));
    }
    const n = Math.round(Math.min(60, Math.max(26, (W * H) / 16000)));
    motes = Array.from({ length: n }, () => ({
      x: rnd() * W, y: rnd() * H, r: between(0.25, 0.6) * U, v: between(1.2, 3.5) * U, p: rnd() * 6,
      c: rnd() < 0.65 ? '#7ae8ff' : (rnd() < 0.5 ? '#b49bff' : '#5a8cff'),
    }));
  }

  // ---- each frame ---------------------------------------------------------------
  function drawFalls(t) {
    ctx.lineCap = 'round';
    for (const f of falls) {
      const len = f.y1 - f.y0;
      ctx.strokeStyle = 'rgba(240,253,255,0.6)'; ctx.lineWidth = Math.max(1, f.w * 0.16);
      ctx.beginPath();
      for (const s of f.streaks) {
        const q = (s.o + t * f.sp * (U * 9) / len) % 1, y = f.y0 + q * len, l = s.l * len * 0.5;
        const x = f.x + s.x * f.w * (1 + q * 0.15);
        ctx.moveTo(x, y); ctx.lineTo(x, Math.min(f.y1, y + l));
      }
      ctx.stroke();
      // mist at the foot
      blob(ctx, '#d8f4ff', f.x + Math.sin(t * 0.9 + f.x) * f.w * 0.6, f.y1 - U * 0.5, f.w * 2.4, 0.22 + 0.08 * Math.sin(t * 1.7 + f.x));
      blob(ctx, '#bfe6ff', f.x - Math.sin(t * 0.7 + f.y0) * f.w * 0.8, f.y1 - U * 1.5, f.w * 1.8, 0.16);
    }
    ctx.lineCap = 'butt';
  }

  function drawPool(t) {
    ctx.lineWidth = Math.max(1, U * 0.25);
    for (const r of ripples) {
      for (const off of [0, 0.5]) {
        const q = (t * 0.35 + r.p + off) % 1, rr = r.r * (0.25 + q);
        ctx.strokeStyle = `rgba(150,220,255,${(0.45 * (1 - q)).toFixed(3)})`;
        ctx.beginPath(); ctx.ellipse(r.x, r.y, rr, rr * 0.22, 0, 0, 7); ctx.stroke();
      }
    }
    for (let k = 0; k < 6; k++) {
      const y = pool + (H - pool) * (0.2 + k * 0.13), x = W * (0.5 + 0.32 * Math.sin(t * 0.25 + k * 1.9)), w = W * (0.04 + 0.015 * k);
      ctx.strokeStyle = `rgba(130,210,255,${(0.1 + 0.07 * Math.sin(t * 1.4 + k)).toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x + w, y); ctx.stroke();
    }
  }

  function drawAltar(t) {
    const { cx, eyeY, ey, er, A } = altar;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    // sonar rings slowly spreading from the emblem
    ctx.lineWidth = Math.max(1, A * 0.45);
    for (let k = 0; k < 3; k++) {
      const q = (t / 3.6 + k / 3) % 1, r = er * (1.1 + q * 5.5);
      ctx.strokeStyle = `rgba(110,230,255,${(0.55 * (1 - q) * (1 - q)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(cx, ey, r, 0, 7); ctx.stroke();
    }
    blob(ctx, '#ff5ce1', cx, ey, er * 0.9, 0.5 + pulse * 0.4);
    ctx.fillStyle = '#ffd6f7'; ctx.beginPath(); ctx.arc(cx, ey, er * 0.2, 0, 7); ctx.fill();
    // glowing eyes that blink now and then
    const blink = (t % 5.3) < 0.14;
    for (const d of [-1, 1]) {
      blob(ctx, '#4adeff', cx + d * 3.2 * A, eyeY, 4 * A, 0.45 + pulse * 0.3);
      ctx.fillStyle = '#c9f8ff';
      ctx.beginPath(); ctx.ellipse(cx + d * 3.2 * A, eyeY, 1.05 * A, blink ? 0.15 * A : 0.85 * A, 0, 0, 7); ctx.fill();
    }
  }

  function drawEyes(t) {
    for (const e of eyes) {
      const shut = ((t + e.p) % e.every) < 0.15;
      blob(ctx, '#ffffff', e.x, e.y, e.r * 4, 0.18);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(e.x - e.gap, e.y, e.r, shut ? e.r * 0.15 : e.r, 0, 0, 7);
      ctx.ellipse(e.x + e.gap, e.y, e.r, shut ? e.r * 0.15 : e.r, 0, 0, 7);
      ctx.fill();
      if (!shut) {
        ctx.fillStyle = '#07061a';
        ctx.beginPath(); ctx.arc(e.x - e.gap + e.r * 0.25, e.y + e.r * 0.15, e.r * 0.5, 0, 7); ctx.arc(e.x + e.gap + e.r * 0.25, e.y + e.r * 0.15, e.r * 0.5, 0, 7); ctx.fill();
      }
    }
  }

  function drawMotes(t, dt) {
    for (const m of motes) {
      m.y -= m.v * dt; m.x += Math.sin(t * 0.6 + m.p) * U * 0.8 * dt;
      if (m.y < -5) { m.y = H + 5; m.x = Math.random() * W; }
      const a = 0.45 + 0.4 * Math.sin(t * 1.3 + m.p);
      blob(ctx, m.c, m.x, m.y, m.r * 6, a * 0.7);
    }
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight; U = H / 100;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    art = null;
  }

  function menuOpen() {
    if (document.querySelector('.overlay.menu:not([hidden])')) return true;
    for (const id of MENU_IDS) { const el = document.getElementById(id); if (el && !el.hidden) return true; }
    return false;
  }

  function render(now) {
    if (innerWidth !== W || innerHeight !== H) resize();
    if (!art) paint();
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(art, 0, 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const t = now / 1000;
    drawPool(t);
    drawFalls(t);
    if (altar) drawAltar(t);
    drawEyes(t);
    drawMotes(t, dt);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const visible = menuOpen() && !portrait.matches;
    if (visible !== on) { on = visible; canvas.hidden = !on; }
    if (!on || document.hidden) return;
    if (now - last < 33) return;            // about 30 frames a second is plenty
    render(now);
  }

  window.EchoBackdrop = {
    altar(v) { const b = v !== false; if (b !== showAltar) { showAltar = b; art = null; } return showAltar; },
    render, // for tests: draw one frame now
  };
  resize();
  requestAnimationFrame(frame);
})();
