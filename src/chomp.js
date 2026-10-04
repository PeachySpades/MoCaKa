// The big battle chomp, shared by every mode: a Pac-Man mouth with jagged teeth
// opens wide, snaps shut at PULL seconds, then three bold slashes rip across.
// q = { x, y, s } is the mouth's centre on screen (s = pixels per tile), c the
// slashes' centre, ang the way the mouth faces, t seconds since it started.
(() => {
  const PULL = 0.35, TIME = 1.1;
  function glow(ctx, x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${a})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function draw(ctx, q, c, ang, t, color, rgb, EAT_PULL = PULL) {
    const ca = Math.cos(ang), sa = Math.sin(ang), S = q.s;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // the mouth: pops up, gapes, snaps shut at EAT_PULL, then shrinks away
    if (t < EAT_PULL + 0.3) {
      const grow = Math.min(1, t / 0.08), after = Math.max(0, t - EAT_PULL) / 0.3;
      const rad = S * (0.85 + 0.35 * grow) * (1 - after * 0.6) * (1 + 0.12 * Math.max(0, 1 - Math.abs(t - EAT_PULL) / 0.06));
      const gape = t < EAT_PULL * 0.6 ? 0.95 * Math.min(1, t / (EAT_PULL * 0.45)) : t < EAT_PULL ? 0.95 * (1 - ((t - EAT_PULL * 0.6) / (EAT_PULL * 0.4)) ** 2) : 0;
      const op = gape + 0.02, alpha = 1 - after;
      ctx.globalAlpha = alpha;
      glow(ctx, q.x, q.y, rad * 1.7, rgb, 0.35);
      // dark throat behind the jaws
      ctx.fillStyle = '#1a0610';
      ctx.beginPath(); ctx.arc(q.x, q.y, rad * 0.94, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
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

    // three big slashes across the bite, drawn in fast and fading out
    const st = t - EAT_PULL + 0.04;
    if (st > 0 && st < 0.75) {
      const L = c.s * 1.5, fade = st < 0.45 ? 1 : 1 - (st - 0.45) / 0.3;
      const sl = ang + Math.PI / 2 + 0.6, ux = Math.cos(sl), uy = Math.sin(sl), px = -uy, py = ux;
      for (let k = 0; k < 3; k++) {
        const draw = Math.min(1, Math.max(0, (st - k * 0.035) / 0.09));
        if (draw <= 0) continue;
        const off = (k - 1) * c.s * 0.42, x0 = c.x + px * off - ux * L, y0 = c.y + py * off - uy * L;
        const x1 = x0 + ux * L * 2 * draw, y1 = y0 + uy * L * 2 * draw;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        ctx.strokeStyle = `rgba(${rgb}, ${0.5 * fade})`; ctx.lineWidth = Math.max(6, c.s * 0.34); ctx.stroke();
        ctx.strokeStyle = `rgba(255, 70, 90, ${0.75 * fade})`; ctx.lineWidth = Math.max(3.5, c.s * 0.17); ctx.stroke();
        ctx.strokeStyle = `rgba(255, 255, 255, ${fade})`; ctx.lineWidth = Math.max(1.5, c.s * 0.065); ctx.stroke();
      }
    }
    ctx.restore();
  }
  window.EchoChomp = { draw, PULL, TIME };
})();
