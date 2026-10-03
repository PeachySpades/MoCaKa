// Echo Caves: the 3D view of Bat Brawl.
// The battle itself (rules, CPUs, online sync) lives in duel.js and stays flat:
// arena tile (x, y) is the 3D point (x, height, y). This file only draws that
// world with three.js, using a chase camera that follows your bat, and tells
// duel.js where things land on screen so it can draw labels on top.
(() => {
  'use strict';
  const T = window.THREE;
  const WALL_H = 1, BAT_Y = 0.55, VIEW_W = 20, PITCH = 0.98, FOV = 50;

  let renderer = null, failed = !T, canvas = null;
  let scene, camera, hemi, sun;
  let walls, floor, ringPool = [], beamPool = [], batRigs = [], crystalMeshes = [], powerMeshes = [];
  let starField = null, moon = null;
  const target = { x: 0, y: 0, ready: false };
  const tmpM = new (T ? T.Matrix4 : Object)(), tmpC = new (T ? T.Color : Object)(), tmpV = new (T ? T.Vector3 : Object)();
  let lastTiles = 0, lastClock = 0, W = 0, H = 0;

  const rgbOf = (s) => s.split(',').map((v) => +v / 255);
  const hexRgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);

  function init() {
    if (renderer || failed) return !!renderer;
    try {
      canvas = document.getElementById('game3d');
      renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      failed = true;
      renderer = null;
      return false;
    }
    // colours here are the same hex values as the 2D view, so skip three's colour conversion
    T.ColorManagement.enabled = false;
    renderer.outputColorSpace = T.LinearSRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(FOV, 2, 0.1, 200);
    hemi = new T.HemisphereLight(0xffffff, 0x334466, 1.1);
    sun = new T.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-0.6, 1, 0.8);
    scene.add(hemi, sun);

    // the beams and rings of sound glow, so they add light instead of covering things
    const glowMat = (opts = {}) => new T.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, ...opts });
    for (let k = 0; k < 24; k++) {
      const m = new T.Mesh(new T.RingGeometry(0.955, 1, 72), glowMat());
      m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); ringPool.push(m);
    }
    const beamGeo = new T.CylinderGeometry(0.5, 0.5, 1, 10, 1, true);
    beamGeo.rotateZ(Math.PI / 2);
    for (let k = 0; k < 6; k++) {
      const outer = new T.Mesh(beamGeo, glowMat()), inner = new T.Mesh(beamGeo, glowMat({ color: 0xffffff }));
      outer.visible = inner.visible = false; scene.add(outer, inner); beamPool.push({ outer, inner });
    }
    const cg = new T.OctahedronGeometry(0.2);
    cg.scale(0.75, 1.3, 0.75);
    for (let k = 0; k < 12; k++) {
      const m = new T.Mesh(cg, new T.MeshBasicMaterial({ color: 0x96f0ff, transparent: true }));
      m.visible = false; scene.add(m); crystalMeshes.push(m);
    }
    const pg = new T.IcosahedronGeometry(0.22, 0);
    for (let k = 0; k < 6; k++) {
      const g = new T.Group();
      const core = new T.Mesh(pg, new T.MeshBasicMaterial({ transparent: true }));
      const shell = new T.Mesh(new T.TorusGeometry(0.34, 0.03, 8, 40), new T.MeshBasicMaterial({ transparent: true }));
      g.add(core, shell); g.userData = { core, shell }; g.visible = false; scene.add(g); powerMeshes.push(g);
    }
    return true;
  }

  // ---- Arena: one block per tile, shown only where sound or senses reach ----
  function buildTiles(arena) {
    if (walls) { scene.remove(walls, floor); walls.geometry.dispose(); floor.geometry.dispose(); }
    const n = arena.w * arena.h;
    const wg = new T.BoxGeometry(1, WALL_H, 1);
    wg.translate(0.5, WALL_H / 2, 0.5);
    walls = new T.InstancedMesh(wg, new T.MeshLambertMaterial(), n);
    const fg = new T.PlaneGeometry(0.96, 0.96);
    fg.rotateX(-Math.PI / 2); fg.translate(0.5, 0, 0.5);
    floor = new T.InstancedMesh(fg, new T.MeshBasicMaterial(), n);
    for (const m of [walls, floor]) {
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      m.instanceColor.setUsage(T.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }
    lastTiles = n;
  }

  function buildSky(on) {
    if (on && !starField) {
      // Open Sky: you fly above a deep field of stars instead of a cave floor
      let seed = 11;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const pts = new Float32Array(900 * 3);
      for (let k = 0; k < 900; k++) {
        pts[k * 3] = -30 + rnd() * 94; pts[k * 3 + 1] = -3 - rnd() * 40; pts[k * 3 + 2] = -30 + rnd() * 75;
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pts, 3));
      starField = new T.Points(g, new T.PointsMaterial({ color: 0xe8ecff, size: 0.16, transparent: true, opacity: 0.8, fog: false }));
      moon = new T.Mesh(new T.CircleGeometry(2.2, 48), new T.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.55, fog: false }));
      moon.rotation.x = -Math.PI / 2;
      scene.add(starField, moon);
    }
    if (starField) starField.visible = moon.visible = on;
  }

  // a soft round light, used for the pool of light under each bat
  let dotTex = null;
  function softDot() {
    if (dotTex) return dotTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return (dotTex = new T.CanvasTexture(c));
  }

  function batRig(b) {
    const g = new T.Group();
    const mat = new T.MeshLambertMaterial({ color: b.color, transparent: true, emissive: new T.Color(b.color), emissiveIntensity: 0.35 });
    const body = new T.Mesh(new T.SphereGeometry(1, 20, 14), mat);
    body.scale.set(0.3, 0.3, 0.27);
    g.add(body);
    // ears
    for (const s of [-1, 1]) {
      const ear = new T.Mesh(new T.ConeGeometry(0.09, 0.22, 10), mat);
      ear.position.set(s * 0.15, 0.3, 0); ear.rotation.z = -s * 0.35; g.add(ear);
    }
    // wings: a scalloped bat wing shape, hinged at the shoulder so they can flap
    const shape = new T.Shape();
    shape.moveTo(0, 0.06); shape.lineTo(0.72, 0.2); shape.lineTo(0.58, -0.08); shape.lineTo(0.42, 0.0);
    shape.lineTo(0.3, -0.14); shape.lineTo(0.16, -0.04); shape.lineTo(0, -0.1); shape.closePath();
    const wingGeo = new T.ShapeGeometry(shape);
    const wingMat = new T.MeshLambertMaterial({ color: b.color, transparent: true, side: T.DoubleSide, emissive: new T.Color(b.color), emissiveIntensity: 0.25 });
    const wings = [-1, 1].map((s) => {
      const hinge = new T.Group();
      const w = new T.Mesh(wingGeo, wingMat);
      w.scale.x = s; hinge.add(w);
      hinge.position.set(s * 0.18, 0.04, -0.02);
      g.add(hinge);
      return hinge;
    });
    // eyes look at the camera
    const white = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true });
    const dark = new T.MeshBasicMaterial({ color: 0x1a1030, transparent: true });
    const eyes = [-1, 1].map((s) => {
      const e = new T.Mesh(new T.SphereGeometry(0.075, 12, 10), white);
      e.position.set(s * 0.1, 0.05, 0.22);
      const p = new T.Mesh(new T.SphereGeometry(0.038, 10, 8), dark);
      p.position.set(0, 0, 0.055); e.add(p);
      g.add(e);
      return e;
    });
    const glow = new T.Mesh(new T.PlaneGeometry(1.8, 1.8), new T.MeshBasicMaterial({ color: b.color, map: softDot(), transparent: true, opacity: 0.18, depthWrite: false, blending: T.AdditiveBlending }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = -BAT_Y + 0.02;
    g.add(glow);
    const shield = new T.Mesh(new T.SphereGeometry(0.62, 20, 14), new T.MeshBasicMaterial({ color: 0x96f0ff, transparent: true, opacity: 0.22, wireframe: true }));
    g.add(shield);
    const stars = [0, 1, 2].map(() => {
      const s = new T.Mesh(new T.OctahedronGeometry(0.06), new T.MeshBasicMaterial({ color: 0xffe278, transparent: true }));
      g.add(s); return s;
    });
    scene.add(g);
    return { g, wings, eyes, glow, shield, stars, mats: [mat, wingMat, white, dark, glow.material, ...stars.map((s) => s.material)], color: b.color };
  }

  // ---- Per-frame drawing ----------------------------------------------------
  // v: everything duel.js knows about the moment being drawn
  function render(v) {
    if (!init()) return false;
    const { arena, bats, lit, litBy, tileGlow, near, clock } = v;
    const dt = Math.max(0, Math.min(0.1, clock - lastClock)); lastClock = clock;
    if (canvas.style.display === 'none') canvas.style.display = '';
    if (W !== v.W || H !== v.H) { W = v.W; H = v.H; renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); }
    if (lastTiles !== arena.w * arena.h) buildTiles(arena);

    const th = arena.theme, bg = hexRgb(th.bg), open = !!arena.def.open;
    if (!scene.fog) { scene.background = new T.Color(); scene.fog = new T.Fog(0, 14, 34); }
    scene.background.setRGB(bg[0], bg[1], bg[2]);
    scene.fog.color.setRGB(bg[0], bg[1], bg[2]);
    buildSky(open);

    // tiles: walls rise where sound has been, the floor shows faintly under the echo
    const wallRgb = rgbOf(th.wall), fillRgb = rgbOf(th.fill);
    for (let ty = 0; ty < arena.h; ty++) {
      for (let tx = 0; tx < arena.w; tx++) {
        const k = ty * arena.w + tx, solid = arena.grid[k] === 1;
        let a = lit[k];
        for (const b of near) {
          const d = Math.hypot(tx + 0.5 - b.x, ty + 0.5 - b.y);
          a = Math.max(a, Math.max(0, Math.min(1, 1 - (d - 0.7) / 1.4)) * (solid ? 0.65 : 0.35));
        }
        a = Math.max(a, tileGlow[k] * 0.5);
        const by = lit[k] > 0.05 ? v.batRgb[litBy[k]] : null;
        // walls
        if (solid && a > 0.02) {
          const c = by ? by.map((x, j) => Math.min(1, x * 0.95 + wallRgb[j] * 0.25)) : wallRgb.map((x, j) => x * 0.6 + fillRgb[j] * 0.4);
          tmpM.makeScale(1, 0.6 + 0.4 * Math.min(1, a * 1.6), 1).setPosition(tx, 0, ty);
          walls.setMatrixAt(k, tmpM);
          walls.setColorAt(k, tmpC.setRGB(bg[0] + (c[0] - bg[0]) * a, bg[1] + (c[1] - bg[1]) * a, bg[2] + (c[2] - bg[2]) * a));
        } else {
          tmpM.makeScale(0, 0, 0); walls.setMatrixAt(k, tmpM);
        }
        // floor
        if (!solid && !open && a > 0.02) {
          const c = by || wallRgb, f = a * 0.32;
          tmpM.makeTranslation(tx, 0, ty); floor.setMatrixAt(k, tmpM);
          floor.setColorAt(k, tmpC.setRGB(bg[0] + (c[0] * 0.6 - bg[0]) * f, bg[1] + (c[1] * 0.6 - bg[1]) * f, bg[2] + (c[2] * 0.6 - bg[2]) * f));
        } else {
          tmpM.makeScale(0, 0, 0); floor.setMatrixAt(k, tmpM);
        }
      }
    }
    walls.instanceMatrix.needsUpdate = true; walls.instanceColor.needsUpdate = true;
    floor.instanceMatrix.needsUpdate = true; floor.instanceColor.needsUpdate = true;
    if (open && moon) { moon.position.set(arena.w * 0.8, -6, arena.h * 0.15); starField.material.opacity = 0.55 + 0.25 * Math.sin(clock * 0.8); }

    // rings of sound
    ringPool.forEach((m, k) => {
      const r = v.rings[k];
      m.visible = !!r;
      if (!r) return;
      const f = 1 - r.r / r.max;
      m.position.set(r.x, BAT_Y, r.y);
      const s = Math.max(0.05, r.r);
      m.scale.set(s, s, s);
      m.material.color.setRGB(...v.batRgb[r.owner]);
      m.material.opacity = Math.min(1, f * 1.4);
    });
    beamPool.forEach((p, k) => {
      const m = v.beams[k];
      p.outer.visible = p.inner.visible = !!m;
      if (!m) return;
      const f = 1 - m.t / v.BEAM_LIFE, ang = Math.atan2(m.uy, m.ux);
      for (const [mesh, w] of [[p.outer, 0.8 * f + 0.1], [p.inner, 0.14 * f + 0.04]]) {
        mesh.position.set(m.x + m.ux * m.len / 2, BAT_Y, m.y + m.uy * m.len / 2);
        mesh.rotation.set(0, -ang, 0);
        mesh.scale.set(m.len, w, w);
      }
      p.outer.material.color.setRGB(...v.batRgb[m.owner]);
      p.outer.material.opacity = 0.45 * f; p.inner.material.opacity = 0.95 * f;
    });

    crystalMeshes.forEach((m, k) => {
      const c = v.crystals.filter((x) => x.on)[k];
      const a = c ? v.seenAt(c.x, c.y) : 0;
      m.visible = a > 0.03;
      if (!m.visible) return;
      m.position.set(c.x, 0.45 + Math.sin(clock * 2 + c.phase) * 0.08, c.y);
      m.rotation.y = clock * 1.5 + c.phase;
      m.material.opacity = a;
    });
    powerMeshes.forEach((g, k) => {
      const p = v.powerups[k];
      const a = p ? v.seenAt(p.x, p.y) : 0;
      g.visible = a > 0.03;
      if (!g.visible) return;
      g.position.set(p.x, 0.55 + Math.sin(clock * 2.5 + p.phase) * 0.1, p.y);
      const rgb = rgbOf(v.POWERS[p.type].rgb);
      g.userData.core.material.color.setRGB(...rgb); g.userData.shell.material.color.setRGB(...rgb);
      g.userData.core.material.opacity = a; g.userData.shell.material.opacity = a * 0.8;
      g.userData.core.rotation.set(clock * 1.3, clock * 2, 0);
      g.userData.shell.rotation.set(Math.PI / 2 + Math.sin(clock) * 0.4, clock * 1.5, 0);
    });

    // bats
    while (batRigs.length < bats.length) batRigs.push(batRig(bats[batRigs.length]));
    batRigs.forEach((rig, k) => {
      const b = bats[k];
      let x = b?.x, y = b?.y, scale = 1 + (b && b.puff > 0 ? 0.4 * b.puff : 0), spin = 0, alpha = b ? v.batVisible(b) : 0;
      const eat = b && b.dead ? v.eats.find((e) => e.food === b && e.eater && e.t < v.EAT_PULL) : null;
      if (eat) {
        const p = eat.t / v.EAT_PULL, ease = p * p;
        x = b.x + (eat.eater.x - b.x) * ease; y = b.y + (eat.eater.y - b.y) * ease;
        scale = 1 - 0.85 * ease; spin = p * 9; alpha = 1;
      } else if (!b || b.dead) alpha = 0;
      const blink = b && b.safe > 0 && Math.floor(b.safe * 10) % 2 === 0;
      rig.g.visible = alpha > 0.03 && !blink;
      if (!rig.g.visible) return;
      const stunned = b.stun > 0;
      const flap = stunned ? 0.15 : Math.sin(clock * (b.dashT > 0 ? 40 : 16) + b.i);
      rig.g.position.set(x, BAT_Y + Math.sin(clock * 3 + b.i) * 0.05, y);
      rig.g.scale.setScalar(scale * 1.15);
      rig.g.rotation.set(Math.max(-0.5, Math.min(0.5, b.vy * 0.08)) - 0.35, Math.max(-0.6, Math.min(0.6, b.vx * 0.1)) + (stunned ? clock * 6 : 0) + spin, Math.max(-0.4, Math.min(0.4, -b.vx * 0.05)));
      rig.wings[0].rotation.z = -flap * 0.7; rig.wings[1].rotation.z = flap * 0.7;
      rig.eyes.forEach((e) => e.scale.set(1, stunned ? 0.25 : 1, 1));
      rig.shield.visible = b.shield;
      rig.shield.rotation.y = clock;
      rig.stars.forEach((s, j) => {
        s.visible = stunned;
        const a = clock * 5 + j * 2.1;
        s.position.set(Math.cos(a) * 0.38, 0.45, Math.sin(a) * 0.38);
      });
      for (const m of rig.mats) m.opacity = alpha;
      rig.glow.material.opacity = alpha * (0.35 + (b.power ? 0.25 * (1 + Math.sin(clock * 10)) : 0));
    });

    // camera: chase your bat, tilted so the cave fills the screen
    const vfov = (FOV * Math.PI) / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dist = (VIEW_W / 2) / Math.tan(hfov / 2);
    const me = v.follow;
    let tx = me ? me.x : arena.w / 2, ty = me ? me.y : arena.h / 2;
    const halfW = VIEW_W / 2 - 1.5;
    tx = arena.w > VIEW_W ? Math.max(halfW, Math.min(arena.w - halfW, tx)) : arena.w / 2;
    const visD = dist * Math.tan(vfov / 2) * 1.1, halfD = Math.min(arena.h / 2, visD - 1);
    ty = Math.max(halfD, Math.min(arena.h - halfD, ty));
    if (!target.ready) { target.x = tx; target.y = ty; target.ready = true; }
    const ease = 1 - Math.exp(-dt * 5);
    target.x += (tx - target.x) * ease; target.y += (ty - target.y) * ease;
    const sx = v.shake > 0 ? (Math.random() - 0.5) * v.shake * 1.2 : 0, sy = v.shake > 0 ? (Math.random() - 0.5) * v.shake * 1.2 : 0;
    camera.position.set(target.x + sx, BAT_Y + dist * Math.sin(PITCH), target.y + dist * Math.cos(PITCH) + sy);
    camera.lookAt(target.x + sx, BAT_Y, target.y + sy);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    return true;
  }

  // Where a point of the arena lands on screen, and how many pixels one tile is there
  function project(x, y, h = BAT_Y) {
    tmpV.set(x, h, y);
    const d = tmpV.distanceTo(camera.position);
    tmpV.project(camera);
    return { x: (tmpV.x + 1) / 2 * W, y: (1 - tmpV.y) / 2 * H, s: H / (2 * Math.tan((FOV * Math.PI) / 360) * d), off: tmpV.z > 1 };
  }

  function hide() {
    target.ready = false;
    if (canvas && canvas.style.display !== 'none') canvas.style.display = 'none';
  }
  function reset() {
    target.ready = false;
    batRigs.forEach((r) => scene.remove(r.g));
    batRigs = [];
  }

  window.EchoDuel3D = {
    get supported() { return init(); },
    render, project, hide, reset,
  };
})();
