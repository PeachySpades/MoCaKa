// Echo Caves: painted scenes for the menu cards, drawn in code with Canvas 2D.
//
// Put <canvas data-art="explore"></canvas> inside a card (absolutely
// positioned, inset 0, behind the text) and it is painted to fit, once per
// size. Kinds: explore, run, multi, bites, last, coop, lobby. The subject sits
// in the upper ~55% of the canvas; the lower part is kept darker and calmer so
// titles and subtitles read on top.
//
//   EchoCardArt.paint(canvas, kind?)  paint one canvas now (kind defaults to data-art)
//   EchoCardArt.refresh()             repaint every canvas[data-art]
//   EchoCardArt.bat(g, x, y, opts)    the shared cute-bat painter
(() => {
  'use strict';

  // ---- small helpers ----------------------------------------------------------
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const between = (a, b) => a + rnd() * (b - a);
  const TAU = Math.PI * 2;

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function shade(h, t) { // t > 0 toward white, t < 0 toward black
    const c = hex(h), to = t > 0 ? 255 : 0, k = Math.abs(t);
    return '#' + c.map((v) => Math.round(v + (to - v) * k).toString(16).padStart(2, '0')).join('');
  }
  const rgba = (h, a) => `rgba(${hex(h).join(',')},${a})`;

  function glow(g, x, y, r, color, a) {
    if (r <= 0 || a <= 0) return;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, rgba(color, a)); grad.addColorStop(0.4, rgba(color, a * 0.45)); grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function poly(g, pts) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }
  function vgrad(g, y0, y1, stops) {
    const gr = g.createLinearGradient(0, y0, 0, y1);
    stops.forEach(([o, c]) => gr.addColorStop(o, c));
    return gr;
  }

  // Low-poly rock: facets around a jittered centre, lit from above.
  function rock(g, pts, base, light, rim, rimA = 0.6, u = 1) {
    poly(g, pts); g.fillStyle = base; g.fill();
    let cx = 0, cy = 0, area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      cx += x1; cy += y1; area += x1 * y2 - x2 * y1;
    }
    cx /= pts.length; cy /= pts.length;
    const sgn = area > 0 ? 1 : -1;
    g.save(); poly(g, pts); g.clip();
    const jx = cx + between(-2, 2) * u, jy = cy + between(-2, 2) * u;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ny = (-(x2 - x1) / len) * sgn, nx = ((y2 - y1) / len) * sgn;
      const lit = Math.max(0, -ny * 0.8 - nx * 0.2) * 0.45 + between(0, 0.08);
      g.fillStyle = shade(light, -(1 - lit)); g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(jx, jy); g.closePath(); g.fill();
    }
    g.globalAlpha = 1; g.restore();
    if (rim) {
      g.lineWidth = Math.max(1, u * 0.35); g.lineCap = 'round';
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1, ny = (-(x2 - x1) / len) * sgn;
        if (ny < -0.4) { g.strokeStyle = rgba(rim, rimA * Math.min(1, -ny)); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
      }
      g.lineCap = 'butt';
    }
  }

  function stalactites(g, w, top, step, minL, maxL, base, lit, u) {
    for (let x = -step; x < w + step; x += step * between(0.5, 1.2)) {
      const r = rnd(), len = minL + (maxL - minL) * r * r, hw = step * between(0.3, 0.55) * (r > 0.8 ? 1.4 : 1);
      const tip = [x + between(-0.2, 0.2) * hw, top + len], mid = [x + hw * between(-0.1, 0.25), top - u];
      g.fillStyle = shade(base, lit); poly(g, [[x - hw, top - u], mid, tip]); g.fill();
      g.fillStyle = base; poly(g, [mid, [x + hw, top - u], tip]); g.fill();
    }
  }
  function spires(g, w, baseY, step, minH, maxH, base, lit) {
    for (let x = -step; x < w + step; x += step * between(0.6, 1.3)) {
      const hw = step * between(0.35, 0.6), tip = [x + between(-0.3, 0.3) * hw, baseY - between(minH, maxH)];
      g.fillStyle = shade(base, lit); poly(g, [[x - hw, baseY], tip, [x, baseY]]); g.fill();
      g.fillStyle = base; poly(g, [[x, baseY], tip, [x + hw, baseY]]); g.fill();
    }
  }
  // a jagged rocky floor across the card
  function floor(g, w, h, y, amp, base, light, rim, u) {
    const pts = [[-2, h + 2]];
    for (let x = -2; x <= w + 8 * u; x += u * between(5, 11)) pts.push([x, y + between(-1, 1) * amp]);
    pts.push([w + 2, h + 2]);
    rock(g, pts, base, light, rim, 0.6, u);
  }

  const PAL = {
    cyan: ['#f0feff', '#7deeff', '#1240b0', '#2fb8ff'],
    blue: ['#eef3ff', '#8fb4ff', '#2430b0', '#4f7bff'],
    violet: ['#f6eeff', '#c3a8ff', '#3d1fb0', '#8a62ff'],
    pink: ['#fff0fc', '#ff9ae9', '#8a1590', '#ff4fd0'],
    green: ['#f0ffe6', '#8dff6a', '#1f8a3a', '#7dff5a'],
  };
  function crystal(g, x, y, h, w, tilt, pal) {
    g.save(); g.translate(x, y); g.rotate(tilt);
    const grad = g.createLinearGradient(0, -h, 0, 0);
    grad.addColorStop(0, pal[1]); grad.addColorStop(0.45, pal[3]); grad.addColorStop(1, pal[2]);
    g.fillStyle = grad; poly(g, [[-w, 0], [-w, -h * 0.74], [0, -h], [w, -h * 0.74], [w, 0]]); g.fill();
    g.fillStyle = rgba(pal[0], 0.3);
    poly(g, [[-w, 0], [-w, -h * 0.74], [0, -h], [-w * 0.15, -h * 0.72], [-w * 0.15, 0]]); g.fill();
    g.fillStyle = rgba(pal[2], 0.45);
    poly(g, [[w * 0.35, 0], [w * 0.35, -h * 0.72], [0, -h], [w, -h * 0.74], [w, 0]]); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = Math.max(0.7, w * 0.13);
    g.beginPath(); g.moveTo(-w * 0.15, -h * 0.06); g.lineTo(-w * 0.15, -h * 0.72); g.lineTo(0, -h); g.stroke();
    g.restore();
  }
  // a cluster; lean > 0 leans the cluster to the right
  function crystals(g, x, y, size, hue, opts = {}) {
    const pal = PAL[hue], n = opts.n || 5, spread = opts.spread || 0.5, lean = opts.lean || 0;
    glow(g, x, y - size * 0.4, size * 1.6, pal[3], opts.glow ?? 0.55);
    const list = [];
    for (let k = 0; k < n; k++) {
      const off = n === 1 ? 0 : (k / (n - 1)) * 2 - 1 + between(-0.15, 0.15);
      list.push([x + off * size * spread * 0.55, size * (1 - Math.abs(off) * 0.45) * between(0.8, 1.05), off * 0.45 + lean + between(-0.08, 0.08)]);
    }
    list.sort((a, b) => b[1] - a[1]);
    for (const [cx, h, tilt] of list) crystal(g, cx, y + size * 0.04, h, h * between(0.14, 0.2), tilt, pal);
  }

  function mushroom(g, x, y, s, color = '#5ae6ff') {
    glow(g, x, y - s, s * 3, color, 0.5);
    g.fillStyle = shade(color, 0.7);
    g.beginPath(); g.moveTo(x - s * 0.14, y); g.quadraticCurveTo(x - s * 0.22, y - s * 0.6, x - s * 0.1, y - s * 1.05);
    g.lineTo(x + s * 0.1, y - s * 1.05); g.quadraticCurveTo(x + s * 0.22, y - s * 0.6, x + s * 0.14, y); g.fill();
    g.fillStyle = vgrad(g, y - s * 1.6, y - s * 0.95, [[0, shade(color, 0.75)], [1, color]]);
    g.beginPath(); g.ellipse(x, y - s * 1.0, s * 0.62, s * 0.55, 0, Math.PI, 0); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath(); g.arc(x - s * 0.22, y - s * 1.25, s * 0.09, 0, TAU); g.arc(x + s * 0.2, y - s * 1.3, s * 0.07, 0, TAU); g.fill();
  }

  function sparkle(g, x, y, r, color = '#ffffff', a = 1) {
    glow(g, x, y, r * 3, color, 0.35 * a);
    g.fillStyle = rgba(shade(color, 0.6), a);
    g.beginPath();
    g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r);
    g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.fill();
  }
  function motes(g, w, h, n, color, u, yMax = 1) {
    for (let k = 0; k < n; k++) {
      const x = rnd() * w, y = rnd() * h * yMax, r = between(0.3, 0.9) * u;
      glow(g, x, y, r * 4, color, between(0.25, 0.6));
      g.fillStyle = rgba(shade(color, 0.6), between(0.5, 0.95)); g.beginPath(); g.arc(x, y, r * 0.5, 0, TAU); g.fill();
    }
  }
  function fog(g, w, y, hgt, color, a) {
    g.fillStyle = vgrad(g, y - hgt, y + hgt, [[0, rgba(color, 0)], [0.5, rgba(color, a)], [1, rgba(color, 0)]]);
    g.fillRect(0, y - hgt, w, hgt * 2);
  }
  function streak(g, x1, y1, x2, y2, color, width, a = 0.8) {
    const gr = g.createLinearGradient(x1, y1, x2, y2);
    gr.addColorStop(0, rgba(color, 0)); gr.addColorStop(1, rgba(color, a));
    g.strokeStyle = gr; g.lineWidth = width; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.lineCap = 'butt';
  }
  function waterfall(g, x, y0, y1, w) {
    glow(g, x, (y0 + y1) / 2, Math.max(w * 3, (y1 - y0) * 0.5), '#4aa8ff', 0.22);
    const sheet = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    sheet.addColorStop(0, 'rgba(120,200,255,0.2)'); sheet.addColorStop(0.25, 'rgba(180,240,255,0.8)');
    sheet.addColorStop(0.5, 'rgba(230,252,255,0.95)'); sheet.addColorStop(0.8, 'rgba(110,200,255,0.7)'); sheet.addColorStop(1, 'rgba(80,150,255,0.15)');
    g.fillStyle = sheet; g.fillRect(x - w / 2, y0, w, y1 - y0);
    g.strokeStyle = 'rgba(40,100,210,0.35)'; g.lineWidth = Math.max(0.7, w * 0.08);
    for (let k = 0; k < 4; k++) { const xx = x + between(-0.35, 0.35) * w, ys = y0 + between(0, 0.5) * (y1 - y0); g.beginPath(); g.moveTo(xx, ys); g.lineTo(xx, ys + between(0.2, 0.5) * (y1 - y0)); g.stroke(); }
    glow(g, x, y1, w * 2.6, '#d8f4ff', 0.55);
  }

  // ---- the cute bat ---------------------------------------------------------------
  // opts: color, s (body radius in px), wings ('spread'|'up'|'down'|'glide'),
  // eyes ('normal'|'angry'|'ko'), mouth ('smile'|'chomp'|'frown'|'o'),
  // face (1 looks right, -1 left), tilt (radians), alpha, glow (0..1), look ([dx,dy] pupils)
  function bat(g, x, y, o = {}) {
    const c = o.color || '#8b5cf6', s = o.s || 20, face = o.face || 1, pose = o.wings || 'spread';
    const eyes = o.eyes || 'normal', mouth = o.mouth || (eyes === 'ko' ? 'o' : 'smile');
    const dark = shade(c, -0.45), darker = shade(c, -0.65), light = shade(c, 0.35);
    g.save();
    g.globalAlpha = o.alpha ?? 1;
    g.translate(x, y); g.rotate(o.tilt || 0); g.scale(s, s);
    if (o.glow !== 0) {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 3.2);
      gr.addColorStop(0, rgba(c, 0.5 * (o.glow ?? 1))); gr.addColorStop(0.5, rgba(c, 0.16 * (o.glow ?? 1))); gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr; g.fillRect(-3.2, -3.2, 6.4, 6.4);
    }
    // wings: shoulder, wrist, tip and three scalloped finger points
    const P = {
      spread: { wr: [1.5, -1.1], tip: [2.85, -0.75], f: [[2.6, 0.2], [1.95, 0.55], [1.25, 0.6]] },
      up: { wr: [1.25, -1.6], tip: [2.25, -2.15], f: [[2.3, -1.1], [1.9, -0.45], [1.25, 0.1]] },
      down: { wr: [1.5, -0.4], tip: [2.6, 0.5], f: [[2.15, 1.05], [1.55, 1.05], [1.05, 0.75]] },
      glide: { wr: [1.6, -0.75], tip: [2.95, -0.35], f: [[2.6, 0.35], [1.95, 0.55], [1.25, 0.55]] },
    }[pose];
    for (const d of [-1, 1]) {
      const sh = [d * 0.72, -0.25], wr = [d * P.wr[0], P.wr[1]], tip = [d * P.tip[0], P.tip[1]];
      const mem = g.createLinearGradient(0, -1.5, d * 2.8, 0.8);
      mem.addColorStop(0, c); mem.addColorStop(1, dark);
      g.fillStyle = mem;
      g.beginPath(); g.moveTo(sh[0], sh[1]);
      g.quadraticCurveTo(d * 1.05, wr[1] - 0.15, wr[0], wr[1]);
      g.quadraticCurveTo((wr[0] + tip[0]) / 2, Math.min(wr[1], tip[1]) - 0.2, tip[0], tip[1]);
      let prev = tip;
      for (const fp of P.f) {
        const f = [d * fp[0], fp[1]], mx = (prev[0] + f[0]) / 2, my = (prev[1] + f[1]) / 2;
        // scallop: the membrane edge bows inward toward the wrist
        g.quadraticCurveTo(mx + (wr[0] - mx) * 0.28, my + (wr[1] - my) * 0.28, f[0], f[1]);
        prev = f;
      }
      g.quadraticCurveTo(d * 0.9, 0.55, d * 0.65, 0.35);
      g.closePath(); g.fill();
      // finger bones
      g.strokeStyle = rgba(light, 0.55); g.lineWidth = 0.07; g.lineCap = 'round';
      for (const fp of P.f) { g.beginPath(); g.moveTo(wr[0], wr[1]); g.lineTo(d * fp[0], fp[1]); g.stroke(); }
      g.strokeStyle = rgba(light, 0.9); g.lineWidth = 0.11;
      g.beginPath(); g.moveTo(sh[0], sh[1]); g.quadraticCurveTo(d * 1.05, wr[1] - 0.15, wr[0], wr[1]);
      g.quadraticCurveTo((wr[0] + tip[0]) / 2, Math.min(wr[1], tip[1]) - 0.2, tip[0], tip[1]); g.stroke();
      // a tiny claw at the wrist
      g.fillStyle = light; g.beginPath(); g.arc(wr[0], wr[1], 0.09, 0, TAU); g.fill();
    }
    // ears
    for (const d of [-1, 1]) {
      g.fillStyle = c;
      g.beginPath(); g.moveTo(d * 0.25, -0.8); g.quadraticCurveTo(d * 0.62, -1.25, d * 0.78, -1.62); g.quadraticCurveTo(d * 0.95, -1.0, d * 0.88, -0.45); g.closePath(); g.fill();
      g.fillStyle = shade(c, 0.45);
      g.beginPath(); g.moveTo(d * 0.45, -0.82); g.quadraticCurveTo(d * 0.66, -1.12, d * 0.76, -1.38); g.quadraticCurveTo(d * 0.84, -0.98, d * 0.78, -0.62); g.closePath(); g.fill();
    }
    // chubby body
    const bg = g.createRadialGradient(-0.35, -0.45, 0.1, 0, 0, 1.15);
    bg.addColorStop(0, light); bg.addColorStop(0.55, c); bg.addColorStop(1, dark);
    g.fillStyle = bg; g.beginPath(); g.ellipse(0, 0, 1.0, 0.95, 0, 0, TAU); g.fill();
    g.strokeStyle = rgba(darker, 0.6); g.lineWidth = 0.05; g.stroke();
    // little feet
    g.fillStyle = dark;
    g.beginPath(); g.ellipse(-0.3, 0.92, 0.16, 0.1, 0, 0, TAU); g.ellipse(0.3, 0.92, 0.16, 0.1, 0, 0, TAU); g.fill();
    // cheeks
    if (eyes !== 'ko') {
      g.fillStyle = 'rgba(255,120,190,0.45)';
      g.beginPath(); g.ellipse(-0.62, 0.3, 0.17, 0.1, 0, 0, TAU); g.ellipse(0.62, 0.3, 0.17, 0.1, 0, 0, TAU); g.fill();
    }
    // eyes
    const fx = face * 0.07, ex = 0.37, ey = -0.12, look = o.look || [face * 0.07, 0.03];
    for (const d of [-1, 1]) {
      const cx = d * ex + fx;
      if (eyes === 'ko') {
        g.strokeStyle = '#140b30'; g.lineWidth = 0.13; g.lineCap = 'round';
        g.beginPath(); g.moveTo(cx - 0.16, ey - 0.16); g.lineTo(cx + 0.16, ey + 0.16); g.moveTo(cx + 0.16, ey - 0.16); g.lineTo(cx - 0.16, ey + 0.16); g.stroke();
        g.lineCap = 'butt';
        continue;
      }
      g.fillStyle = '#ffffff';
      g.beginPath(); g.ellipse(cx, ey, 0.29, 0.33, 0, 0, TAU); g.fill();
      g.fillStyle = '#120a2a';
      g.beginPath(); g.ellipse(cx + look[0], ey + look[1], 0.17, 0.2, 0, 0, TAU); g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(cx + look[0] - 0.07, ey + look[1] - 0.08, 0.065, 0, TAU); g.fill();
      if (eyes === 'angry') { // a stern lid slanting down to the middle
        g.fillStyle = shade(c, -0.15);
        g.beginPath(); g.moveTo(cx - 0.36, ey - 0.4 + (d < 0 ? -0.05 : 0.17)); g.lineTo(cx + 0.36, ey - 0.4 + (d < 0 ? 0.17 : -0.05));
        g.lineTo(cx + 0.36, ey - 0.45); g.lineTo(cx - 0.36, ey - 0.45); g.closePath(); g.fill();
        g.strokeStyle = darker; g.lineWidth = 0.08; g.lineCap = 'round';
        g.beginPath(); g.moveTo(cx - 0.32, ey - 0.33 + (d < 0 ? -0.05 : 0.17)); g.lineTo(cx + 0.32, ey - 0.33 + (d < 0 ? 0.17 : -0.05)); g.stroke();
        g.lineCap = 'butt';
      }
    }
    // mouth
    const my = 0.36, mx = fx;
    g.lineCap = 'round';
    if (mouth === 'chomp') {
      g.fillStyle = '#2a0b2e';
      g.beginPath(); g.ellipse(mx, my + 0.08, 0.25, 0.2, 0, 0, TAU); g.fill();
      g.fillStyle = '#ff6fa8'; g.beginPath(); g.ellipse(mx, my + 0.18, 0.14, 0.07, 0, 0, TAU); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(mx - 0.17, my - 0.06); g.lineTo(mx - 0.1, my + 0.08); g.lineTo(mx - 0.04, my - 0.07); g.fill();
      g.beginPath(); g.moveTo(mx + 0.04, my - 0.07); g.lineTo(mx + 0.1, my + 0.08); g.lineTo(mx + 0.17, my - 0.06); g.fill();
    } else if (mouth === 'frown') {
      g.strokeStyle = '#1a0b30'; g.lineWidth = 0.08;
      g.beginPath(); g.moveTo(mx - 0.14, my + 0.07); g.quadraticCurveTo(mx, my - 0.03, mx + 0.14, my + 0.07); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(mx + 0.02, my + 0.02); g.lineTo(mx + 0.06, my + 0.15); g.lineTo(mx + 0.1, my + 0.03); g.fill();
    } else if (mouth === 'o') {
      g.fillStyle = '#1a0b30'; g.beginPath(); g.ellipse(mx, my + 0.04, 0.08, 0.06, 0, 0, TAU); g.fill();
    } else {
      g.strokeStyle = '#1a0b30'; g.lineWidth = 0.08;
      g.beginPath(); g.moveTo(mx - 0.15, my); g.quadraticCurveTo(mx, my + 0.14, mx + 0.15, my); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(mx + 0.02, my + 0.06); g.lineTo(mx + 0.07, my + 0.18); g.lineTo(mx + 0.11, my + 0.05); g.fill();
    }
    g.lineCap = 'butt';
    g.restore();
  }

  // sonar arcs, like ((( or )))
  function sonar(g, x, y, r, dir, color, n = 3, width = 2, a = 0.95) {
    g.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      const rr = r * (0.45 + k * 0.32), alpha = a * (1 - k * 0.2);
      g.strokeStyle = rgba(color, alpha * 0.35); g.lineWidth = width * 2.4;
      const a0 = dir > 0 ? -0.75 : Math.PI - 0.75, a1 = dir > 0 ? 0.75 : Math.PI + 0.75;
      g.beginPath(); g.arc(x, y, rr, a0, a1); g.stroke();
      g.strokeStyle = rgba(shade(color, 0.4), alpha); g.lineWidth = width;
      g.beginPath(); g.arc(x, y, rr, a0, a1); g.stroke();
    }
    g.lineCap = 'butt';
  }
  function firefly(g, x, y, s) {
    glow(g, x, y, s * 6, '#ffd84a', 0.8);
    glow(g, x, y + s * 0.3, s * 2, '#fff6b0', 0.9);
    g.fillStyle = 'rgba(255,250,220,0.75)';
    for (const d of [-1, 1]) { g.beginPath(); g.ellipse(x + d * s * 0.8, y - s * 0.55, s * 0.85, s * 0.45, d * -0.5, 0, TAU); g.fill(); }
    g.fillStyle = vgrad(g, y - s, y + s * 1.3, [[0, '#fff8c0'], [1, '#ffc21a']]);
    g.beginPath(); g.ellipse(x, y + s * 0.2, s * 0.5, s * 1.0, 0, 0, TAU); g.fill();
    g.fillStyle = '#5a3a00'; g.beginPath(); g.arc(x, y - s * 0.8, s * 0.38, 0, TAU); g.fill();
    g.strokeStyle = '#5a3a00'; g.lineWidth = s * 0.12;
    g.beginPath(); g.moveTo(x - s * 0.15, y - s * 1.1); g.lineTo(x - s * 0.4, y - s * 1.6); g.moveTo(x + s * 0.15, y - s * 1.1); g.lineTo(x + s * 0.4, y - s * 1.6); g.stroke();
    for (const [dx, dy, r] of [[-2.6, -1.5, 0.5], [2.4, -2.2, 0.4], [2.8, 1.2, 0.45], [-2.2, 1.8, 0.35]]) sparkle(g, x + dx * s, y + dy * s, r * s, '#ffe066');
  }

  // a dark vignette plus the calm lower band for the text
  function finish(g, w, h, base, u) {
    g.fillStyle = vgrad(g, h * 0.42, h, [[0, rgba(base, 0)], [0.4, rgba(base, 0.42)], [1, rgba(base, 0.8)]]);
    g.fillRect(0, h * 0.42, w, h * 0.58);
    const r = g.createRadialGradient(w / 2, h * 0.72, 0, w / 2, h * 0.72, Math.max(w * 0.45, h * 0.3));
    r.addColorStop(0, rgba(base, 0.4)); r.addColorStop(1, rgba(base, 0));
    g.fillStyle = r; g.fillRect(0, h * 0.4, w, h * 0.6);
    const v = g.createRadialGradient(w / 2, h * 0.4, Math.min(w, h) * 0.35, w / 2, h * 0.5, Math.max(w, h) * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  }

  // ---- the scenes ---------------------------------------------------------------------
  // Every scene gets the CSS size (w, h) and u = 1% of a size that suits the card,
  // so the art reads the same at 200x150 and 420x320.
  const scenes = {
    explore(g, w, h, u) {
      g.fillStyle = vgrad(g, 0, h, [[0, '#071a44'], [0.5, '#0a2560'], [1, '#040c24']]); g.fillRect(0, 0, w, h);
      glow(g, w * 0.5, h * 0.35, Math.max(w, h) * 0.55, '#2a7cff', 0.35);
      // far wall facets and columns
      for (let x = 0; x < w; x += u * between(4, 8)) { g.fillStyle = rgba('#4a8cf0', between(0.08, 0.2)); g.fillRect(x, h * between(0.1, 0.3), u * between(1, 3), h); }
      spires(g, w, h * 0.78, u * 7, u * 10, u * 26, '#0e2a6a', 0.14);
      stalactites(g, w, 0, u * 4, u * 6, u * 24, '#1a4296', 0.22, u);
      stalactites(g, w, 0, u * 7, u * 6, u * 34, '#0d245e', 0.18, u);
      stalactites(g, w, 0, u * 11, u * 4, u * 40, '#071538', 0.14, u);
      fog(g, w, h * 0.62, h * 0.12, '#4aa8ff', 0.18);
      // side walls
      rock(g, [[-2, -2], [w * 0.16, -2], [w * 0.12, h * 0.25], [w * 0.2, h * 0.5], [w * 0.1, h * 0.8], [-2, h + 2]], '#0a1e50', '#2c62c8', '#7fdcff', 0.7, u);
      rock(g, [[w + 2, -2], [w * 0.86, -2], [w * 0.9, h * 0.3], [w * 0.82, h * 0.55], [w * 0.9, h * 0.85], [w + 2, h + 2]], '#0a1e50', '#2c62c8', '#7fdcff', 0.7, u);
      floor(g, w, h, h * 0.8, u * 3, '#071636', '#1b4296', '#7fdcff', u);
      // the big glowing crystal clusters
      for (const [x, y, r] of [[0.24, 0.2, 1.6], [0.62, 0.32, 1.2], [0.8, 0.14, 1.8], [0.45, 0.5, 1]]) sparkle(g, w * x, h * y, u * r, '#9feeff');
      motes(g, w, h, 14, '#6fe6ff', u, 0.7);
      finish(g, w, h, '#03091e', u);
      // the crystals stay bright at the sides, over the calm band
      crystals(g, w * 0.1, h * 0.9, u * 54, 'cyan', { n: 6, spread: 0.55, lean: 0.12, glow: 0.6 });
      crystals(g, w * 0.9, h * 0.88, u * 38, 'cyan', { n: 5, spread: 0.5, lean: -0.15, glow: 0.5 });
      crystals(g, w * 0.28, h * 0.92, u * 12, 'blue', { n: 3, glow: 0.3 });
      crystals(g, w * 0.74, h * 0.93, u * 10, 'cyan', { n: 3, glow: 0.3 });
    },

    run(g, w, h, u) {
      g.fillStyle = vgrad(g, 0, h, [[0, '#06180f'], [0.45, '#0d3320'], [1, '#03100a']]); g.fillRect(0, 0, w, h);
      // the bright tunnel mouth far ahead
      glow(g, w * 0.55, h * 0.42, Math.max(w, h) * 0.55, '#5cff7a', 0.4);
      glow(g, w * 0.55, h * 0.42, h * 0.18, '#d8ffb0', 0.3);
      spires(g, w, h * 0.7, u * 6, u * 6, u * 18, '#14402a', 0.15);
      stalactites(g, w, 0, u * 6, u * 8, u * 26, '#123a24', 0.18, u);
      // dark rock pillars getting nearer toward the edges
      for (const [x, pw, c] of [[0.3, 6, '#0c2a1a'], [0.75, 7, '#0c2a1a'], [0.12, 11, '#071a10'], [0.92, 12, '#071a10']]) {
        const cx = w * x, hw = u * pw;
        rock(g, [[cx - hw, -2], [cx + hw, -2], [cx + hw * 0.8, h * 0.4], [cx + hw * 1.1, h + 2], [cx - hw * 1.1, h + 2], [cx - hw * 0.8, h * 0.45]], c, '#3fae5e', null, 0.5, u);
        g.strokeStyle = 'rgba(150,255,120,0.35)'; g.lineWidth = Math.max(1, u * 0.4);
        g.beginPath(); g.moveTo(cx - hw, -2); g.lineTo(cx - hw * 0.8, h * 0.45); g.lineTo(cx - hw * 1.1, h); g.stroke();
      }
      stalactites(g, w, 0, u * 9, u * 6, u * 34, '#06160d', 0.12, u);
      // ledges with little glowing mushrooms
      for (const [x, y, lw] of [[0.2, 0.62, 20], [0.82, 0.56, 22], [0.5, 0.78, 26]]) {
        const cx = w * x, cy = h * y, hw = u * lw / 2;
        rock(g, [[cx - hw, cy], [cx - hw * 0.4, cy - u], [cx + hw * 0.5, cy - u * 0.5], [cx + hw, cy + u], [cx + hw * 0.6, cy + u * 6], [cx - hw * 0.7, cy + u * 5]], '#0a2416', '#2f7a44', '#9dff6a', 0.7, u);
        for (let k = 0; k < 4; k++) mushroom(g, cx + between(-0.6, 0.6) * hw, cy - u * 0.5, u * between(2.6, 4.2), '#8dff5a');
      }
      // speed streaks rushing past
      for (let k = 0; k < 9; k++) {
        const y = h * between(0.12, 0.6), x = w * between(0.05, 0.75), l = w * between(0.12, 0.3);
        streak(g, x, y, x + l, y, '#b8ff8a', Math.max(1, u * between(0.4, 0.9)), between(0.35, 0.7));
      }
      floor(g, w, h, h * 0.86, u * 2.5, '#04140b', '#1f5a32', '#9dff6a', u);
      motes(g, w, h, 12, '#9dff6a', u, 0.75);
      finish(g, w, h, '#020c06', u);
    },

    multi(g, w, h, u) {
      g.fillStyle = vgrad(g, 0, h, [[0, '#1c0838'], [0.5, '#2c0d55'], [1, '#0e0420']]); g.fillRect(0, 0, w, h);
      glow(g, w * 0.5, h * 0.32, Math.max(w, h) * 0.5, '#c04dff', 0.3);
      spires(g, w, h * 0.78, u * 7, u * 8, u * 22, '#2c1060', 0.14);
      stalactites(g, w, 0, u * 5, u * 6, u * 20, '#341470', 0.18, u);
      stalactites(g, w, 0, u * 8, u * 5, u * 28, '#1d0a44', 0.14, u);
      fog(g, w, h * 0.66, h * 0.1, '#ff6ad5', 0.12);
      rock(g, [[-2, h * 0.5], [w * 0.1, h * 0.55], [w * 0.2, h * 0.7], [w * 0.15, h + 2], [-2, h + 2]], '#150630', '#5a2a9a', '#ff9ae8', 0.5, u);
      rock(g, [[w + 2, h * 0.45], [w * 0.88, h * 0.52], [w * 0.8, h * 0.72], [w * 0.86, h + 2], [w + 2, h + 2]], '#150630', '#5a2a9a', '#ff9ae8', 0.5, u);
      crystals(g, w * 0.07, h * 0.66, u * 30, 'pink', { n: 5, spread: 0.6, lean: 0.1 });
      crystals(g, w * 0.94, h * 0.6, u * 32, 'violet', { n: 5, spread: 0.6, lean: -0.1 });
      floor(g, w, h, h * 0.88, u * 2, '#0c0420', '#3f1a78', '#ff9ae8', u);
      for (const [x, y, c] of [[0.17, 0.72, '#ff7ae0'], [0.21, 0.73, '#ff7ae0'], [0.82, 0.73, '#5ae6ff'], [0.86, 0.74, '#5ae6ff']]) mushroom(g, w * x, h * y, u * 2.4, c);
      // two bats squeak at each other
      const bs = Math.min(u * 10, w * 0.085);
      bat(g, w * 0.3, h * 0.3, { color: '#ff5fd2', s: bs, face: 1, wings: 'up', tilt: 0.12 });
      bat(g, w * 0.7, h * 0.3, { color: '#4f7bff', s: bs, face: -1, wings: 'up', tilt: -0.12 });
      sonar(g, w * 0.4, h * 0.3, bs * 1.5, 1, '#ff7ae0', 3, Math.max(1.4, u * 0.9));
      sonar(g, w * 0.6, h * 0.3, bs * 1.5, -1, '#6fb6ff', 3, Math.max(1.4, u * 0.9));
      motes(g, w, h, 12, '#ff9ae8', u, 0.7);
      finish(g, w, h, '#0a0318', u);
    },

    bites(g, w, h, u) {
      g.fillStyle = vgrad(g, 0, h, [[0, '#120a3c'], [0.5, '#1a0f55'], [1, '#070424']]); g.fillRect(0, 0, w, h);
      glow(g, w * 0.5, h * 0.32, Math.max(w, h) * 0.5, '#8a4dff', 0.35);
      stalactites(g, w, 0, u * 6, u * 5, u * 16, '#221460', 0.16, u);
      // a burst of light behind the diving bat
      const bx = w * 0.5, by = h * 0.31, bs = Math.min(u * 15, w * 0.13);
      g.save(); g.translate(bx, by);
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * TAU + 0.2, l = bs * between(2.6, 4.2);
        g.fillStyle = rgba(k % 2 ? '#b07bff' : '#ff8ae6', 0.12);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a - 0.08) * l, Math.sin(a - 0.08) * l); g.lineTo(Math.cos(a + 0.08) * l, Math.sin(a + 0.08) * l); g.fill();
      }
      g.restore();
      // speed lines and spark trails from the upper left where it dived from
      for (let k = 0; k < 8; k++) {
        const off = between(-1, 1) * bs * 1.4, len = bs * between(2, 3.6);
        const x2 = bx - bs * 1.2 + off * 0.5, y2 = by - bs * 0.8 + off * 0.6;
        streak(g, x2 - len, y2 - len * 0.55, x2, y2, k % 3 ? '#d8b8ff' : '#ff9ae8', Math.max(1, u * between(0.4, 1)), 0.75);
      }
      for (let k = 0; k < 7; k++) {
        const a = between(-0.6, 1.8), d = bs * between(1.6, 2.8);
        sparkle(g, bx + Math.cos(a) * d, by + Math.sin(a) * d * 0.9, u * between(0.8, 1.6), k % 2 ? '#ffd84a' : '#ff8ae6');
      }
      // crystals and ledges at the bottom
      floor(g, w, h, h * 0.66, u * 3, '#0d0830', '#3a2a9a', '#8f9dff', u);
      crystals(g, w * 0.1, h * 0.68, u * 20, 'violet', { n: 4, lean: 0.15 });
      crystals(g, w * 0.88, h * 0.66, u * 22, 'violet', { n: 4, lean: -0.15 });
      crystals(g, w * 0.32, h * 0.68, u * 8, 'blue', { n: 3 });
      // the gang
      bat(g, w * 0.17, h * 0.44, { color: '#ff5fd2', s: bs * 0.42, face: 1, wings: 'up', tilt: -0.1 });
      bat(g, w * 0.78, h * 0.13, { color: '#3f8cff', s: bs * 0.42, face: -1, wings: 'spread', tilt: 0.15 });
      bat(g, w * 0.85, h * 0.45, { color: '#46e05a', s: bs * 0.36, face: -1, wings: 'up', tilt: 0.1 });
      firefly(g, w * 0.65, h * 0.5, Math.min(u * 4.2, w * 0.04));
      bat(g, bx, by, { color: '#9a52ff', s: bs, face: 1, wings: 'spread', tilt: 0.28, mouth: 'chomp', look: [0.1, 0.06] });
      motes(g, w, h, 12, '#b49bff', u, 0.6);
      finish(g, w, h, '#050318', u);
    },

    last(g, w, h, u) {
      g.fillStyle = vgrad(g, 0, h, [[0, '#04182a'], [0.5, '#082436'], [1, '#020a14']]); g.fillRect(0, 0, w, h);
      spires(g, w, h * 0.75, u * 8, u * 12, u * 34, '#0a2638', 0.14);
      stalactites(g, w, 0, u * 6, u * 6, u * 22, '#0c2a3e', 0.16, u);
      // the spotlight pouring down from a hole in the ceiling
      const cx = w * 0.5;
      const beam = g.createLinearGradient(0, 0, 0, h * 0.6);
      beam.addColorStop(0, 'rgba(190,255,250,0.7)'); beam.addColorStop(1, 'rgba(120,230,255,0.06)');
      g.fillStyle = beam;
      g.beginPath(); g.moveTo(cx - w * 0.07, -2); g.lineTo(cx + w * 0.07, -2); g.lineTo(cx + w * 0.24, h * 0.6); g.lineTo(cx - w * 0.24, h * 0.6); g.closePath(); g.fill();
      g.fillStyle = 'rgba(220,255,255,0.18)';
      g.beginPath(); g.moveTo(cx - w * 0.035, -2); g.lineTo(cx + w * 0.035, -2); g.lineTo(cx + w * 0.12, h * 0.55); g.lineTo(cx - w * 0.12, h * 0.55); g.closePath(); g.fill();
      glow(g, cx, 0, w * 0.18, '#e8ffff', 0.6);
      for (let k = 0; k < 16; k++) { const y = h * between(0.05, 0.55), x = cx + (rnd() - 0.5) * (w * 0.1 + y / h * w * 0.3); g.fillStyle = `rgba(230,255,255,${between(0.3, 0.8)})`; g.beginPath(); g.arc(x, y, u * between(0.2, 0.5), 0, TAU); g.fill(); }
      // the rock pinnacle
      const top = h * 0.52;
      rock(g, [[cx - w * 0.3, h + 2], [cx - w * 0.16, h * 0.7], [cx - w * 0.1, top + u * 2], [cx - w * 0.04, top], [cx + w * 0.05, top + u * 0.5], [cx + w * 0.11, top + u * 3], [cx + w * 0.18, h * 0.72], [cx + w * 0.32, h + 2]], '#0a1c2c', '#3a6a8a', '#bff8ff', 0.8, u);
      glow(g, cx, top, w * 0.14, '#bff8ff', 0.3);
      // knocked-out bats in the shadows either side
      const bs = Math.min(u * 13, w * 0.12);
      floor(g, w, h, h * 0.8, u * 3, '#03101c', '#163a52', '#5fb0d0', u);
      bat(g, w * 0.16, h * 0.56, { color: '#3d4a6a', s: bs * 0.55, eyes: 'ko', wings: 'down', tilt: -0.35, glow: 0, alpha: 0.85 });
      bat(g, w * 0.84, h * 0.5, { color: '#3d4a6a', s: bs * 0.55, eyes: 'ko', wings: 'down', tilt: 0.3, glow: 0, alpha: 0.85 });
      // the last bat standing
      bat(g, cx, top - bs * 0.9, { color: '#7a4dff', s: bs, eyes: 'angry', mouth: 'frown', wings: 'spread', face: 1, look: [0, 0.05] });
      motes(g, w, h, 8, '#9feeff', u, 0.6);
      finish(g, w, h, '#020812', u);
    },

    coop(g, w, h, u) {
      g.fillStyle = vgrad(g, 0, h, [[0, '#120838'], [0.5, '#1d0f52'], [1, '#080420']]); g.fillRect(0, 0, w, h);
      glow(g, w * 0.45, h * 0.35, Math.max(w, h) * 0.5, '#6a4dff', 0.3);
      spires(g, w, h * 0.72, u * 7, u * 6, u * 20, '#20135a', 0.14);
      stalactites(g, w, 0, u * 6, u * 6, u * 22, '#26166a', 0.16, u);
      // a cliff with a waterfall on the right
      const cx = w * 0.8;
      rock(g, [[cx - u * 6, h * 0.18], [cx + u * 2, h * 0.15], [w + 2, h * 0.14], [w + 2, h * 0.7], [cx + u * 4, h * 0.7], [cx + u, h * 0.45]], '#150c44', '#3d2fa8', '#8fd8ff', 0.8, u);
      waterfall(g, cx - u * 2, h * 0.17, h * 0.68, Math.max(4, u * 5));
      // the spiky crystal wall ahead
      const sx = w * 0.95;
      for (let k = 0; k < 5; k++) {
        const y = h * (0.2 + k * 0.085), sz = u * 3.6;
        glow(g, sx - sz, y, sz * 2, '#6fe6ff', 0.35);
        g.fillStyle = vgrad(g, y - sz, y + sz, [[0, '#e8fdff'], [1, '#3fb8ff']]);
        poly(g, [[sx + u, y - sz * 0.8], [sx - sz * 1.6, y], [sx + u, y + sz * 0.8]]); g.fill();
        g.fillStyle = 'rgba(20,40,120,0.4)'; poly(g, [[sx + u, y], [sx - sz * 1.6, y], [sx + u, y + sz * 0.8]]); g.fill();
      }
      // ledges with mushrooms
      floor(g, w, h, h * 0.75, u * 2, '#0b0630', '#33268c', '#8fd8ff', u);
      for (const [x, y, lw] of [[0.22, 0.64, 18], [0.55, 0.66, 22]]) {
        const lx = w * x, ly = h * y, hw = u * lw / 2;
        rock(g, [[lx - hw, ly], [lx + hw, ly - u * 0.5], [lx + hw * 0.7, ly + u * 5], [lx - hw * 0.6, ly + u * 6]], '#100a3c', '#3d2fa8', '#8fd8ff', 0.8, u);
        for (let k = 0; k < 3; k++) mushroom(g, lx + between(-0.6, 0.6) * hw, ly - u * 0.2, u * between(2.6, 3.8));
      }
      // the chevrons pointing on
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (let k = 0; k < 3; k++) {
        const x = w * 0.66 + k * u * 4.2, y = h * 0.55, c = u * 2.4;
        g.strokeStyle = 'rgba(80,220,255,0.35)'; g.lineWidth = Math.max(2, u * 1.6);
        g.beginPath(); g.moveTo(x - c * 0.5, y - c); g.lineTo(x + c * 0.5, y); g.lineTo(x - c * 0.5, y + c); g.stroke();
        g.strokeStyle = '#bff4ff'; g.lineWidth = Math.max(1, u * 0.7); g.stroke();
      }
      g.lineCap = 'butt';
      // three friends flying right together
      const bs = Math.min(u * 8.5, w * 0.08);
      const flock = [[0.36, 0.2, '#3f8cff', 'up'], [0.58, 0.36, '#ff5fd2', 'glide'], [0.24, 0.43, '#8a52ff', 'spread']];
      for (const [x, y] of flock) for (let k = 0; k < 3; k++) streak(g, w * x - bs * between(3, 5), h * y + (k - 1) * bs * 0.45, w * x - bs * 1.3, h * y + (k - 1) * bs * 0.45, '#9fe8ff', Math.max(1, u * 0.5), 0.6);
      for (const [x, y, c, pose] of flock) bat(g, w * x, h * y, { color: c, s: bs, face: 1, wings: pose, tilt: -0.08, look: [0.1, 0] });
      motes(g, w, h, 10, '#8fd8ff', u, 0.6);
      finish(g, w, h, '#050318', u);
    },

    lobby(g, w, h, u) {
      g.fillStyle = vgrad(g, 0, h, [[0, '#0d0a2c'], [1, '#070618']]); g.fillRect(0, 0, w, h);
      glow(g, w * 0.5, h * 1.0, Math.max(w, h) * 0.6, '#5a4dff', 0.22);
      glow(g, w * 0.5, h * 0.45, Math.max(w, h) * 0.4, '#3a2a9a', 0.18);
      stalactites(g, w, 0, u * 7, u * 4, u * 18, '#17123e', 0.12, u);
      spires(g, w, h * 1.02, u * 9, u * 4, u * 14, '#110d30', 0.1);
      motes(g, w, h, 6, '#8f86ff', u * 0.8, 0.8);
    },
  };

  // ---- painting and keeping canvases fresh ---------------------------------------------
  const KEYS = new WeakMap();
  function paint(canvas, kind) {
    kind = kind || canvas.dataset.art;
    const scene = scenes[kind];
    if (!scene) return false;
    const r = canvas.getBoundingClientRect();
    const w = Math.round(canvas.clientWidth || r.width), h = Math.round(canvas.clientHeight || r.height);
    if (!w || !h) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const key = `${kind}:${w}x${h}@${dpr}`;
    if (KEYS.get(canvas) === key) return true;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    seed = [...kind].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 2147483646 + 1;
    // 1u = 1% of the height, but never so big that a narrow card overflows
    const u = Math.min(h, w * 0.85) / 100;
    g.save(); scene(g, w, h, u); g.restore();
    KEYS.set(canvas, key);
    return true;
  }

  const watched = new WeakSet();
  const ro = 'ResizeObserver' in window ? new ResizeObserver((entries) => { for (const e of entries) paint(e.target); }) : null;
  function watch(canvas) {
    if (watched.has(canvas)) return;
    watched.add(canvas);
    if (ro) ro.observe(canvas);
    paint(canvas);
  }
  function refresh() {
    document.querySelectorAll('canvas[data-art]').forEach((c) => { KEYS.delete(c); watch(c); paint(c); });
  }
  let timer = 0;
  window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(refresh, 150); });
  // pick up cards added later (the lobby builds its seats on the fly)
  if ('MutationObserver' in window) {
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes') { if (m.target.tagName !== 'CANVAS') continue; KEYS.delete(m.target); watch(m.target); paint(m.target); continue; }
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches('canvas[data-art]')) watch(n);
          else n.querySelectorAll?.('canvas[data-art]').forEach(watch);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-art'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
  else refresh();
  window.addEventListener('load', refresh);

  window.EchoCardArt = { paint: (c, kind) => { if (kind) KEYS.delete(c); return paint(c, kind); }, refresh, bat, kinds: Object.keys(scenes) };
})();
