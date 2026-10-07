// Echo Caves in 3D, drawn with three.js. The game rules stay flat (tiles on a
// grid) in game.js and duel.js; this file only draws them.
//  - Bat Brawl (EchoDuel3D): arena tile (x, y) is the 3D point (x, height, y),
//    seen by a chase camera that follows your bat. duel.js asks where things land
//    on screen so it can draw labels on top.
//  - Explore and Cave Run (EchoCave3D): the cave is a cross-section, tile (x, y) is
//    (x, -y, 0), and the rock reaches back into the screen. The camera looks
//    straight at that plane, so game.js keeps drawing creatures, rings and sparks
//    on its flat canvas on top, at exactly the right places.
(() => {
  'use strict';
  const T = window.THREE;
  const WALL_H = 1, BAT_Y = 0.55, VIEW_W = 20, PITCH = 0.98, FOV = 50;

  let renderer = null, failed = !T, canvas = null;
  let scene, camera, hemi, sun;
  let walls, floor, ringPool = [], beamPool = [], batRigs = [], crystalMeshes = [], powerMeshes = [];
  let starField = null, moon = null;
  const target = { x: 0, y: 0, ready: false };
  const tmpM2 = new (T ? T.Matrix4 : Object)(), ZERO = T ? new T.Matrix4().makeScale(0, 0, 0) : null;
  const tmpM = new (T ? T.Matrix4 : Object)(), tmpC = new (T ? T.Color : Object)(), tmpV = new (T ? T.Vector3 : Object)();
  let lastTiles = 0, lastClock = 0, W = 0, H = 0, wallTop = new Float32Array(0);   // wallTop: how tall each tile's wall is drawn (0: none)

  const floorHash = (k) => { const v = Math.sin(k * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const rgbOf = (s) => s.split(',').map((v) => +v / 255);
  const hexRgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
  const rng = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // The look shared by every mode: deep blue-violet cave stone, glowing cyan and
  // violet crystals, little cyan mushrooms. Stone is tinted by whoever's echo lights it.
  const CAVE_BG = [0.025, 0.028, 0.085];
  const STONE = [0.5, 0.52, 1.0];
  const CYAN = [0.3, 0.9, 1.0], VIOLET = [0.62, 0.4, 1.0];

  // ---- Stone textures, painted once on canvases -----------------------------
  // block: a chunky bevelled stone face (battle walls); rough: seamless rock
  // (cave walls, rubble, ground); tile: a floor slab with grout. Each comes with
  // a "glow" map of crystal veins that only shines when the stone itself is lit.
  let TX = null;
  function textures() {
    if (TX) return TX;
    const rnd = rng(4242);
    const canvasOf = (s, fill) => {
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d');
      g.fillStyle = fill; g.fillRect(0, 0, s, s);
      return [c, g];
    };
    const poly = (g, pts, style, width, off = 0) => {
      g.strokeStyle = style; g.lineWidth = width; g.lineJoin = g.lineCap = 'round';
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x + off, y + off) : g.moveTo(x + off, y + off)));
      g.stroke();
    };
    // draws fn at the 9 wrapped offsets so a rough texture tiles without seams
    const wrapped = (g, s, wrap, fn) => {
      const offs = wrap ? [-s, 0, s] : [0];
      for (const dx of offs) for (const dy of offs) { g.save(); g.translate(dx, dy); fn(); g.restore(); }
    };
    function rock(g, s, wrap, cracks, contrast = 1) {
      for (let k = 0; k < 28; k++) {
        const x = rnd() * s, y = rnd() * s, r = s * (0.06 + rnd() * 0.2), dark = rnd() < 0.6;
        wrapped(g, s, wrap, () => {
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, dark ? `rgba(14, 12, 50, ${0.3 * contrast})` : `rgba(205, 210, 255, ${0.16 * contrast})`);
          gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
          g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
        });
      }
      for (let k = 0; k < (s * s) / 70; k++) {
        const x = rnd() * s, y = rnd() * s, z = 1 + rnd() * s / 200;
        g.fillStyle = rnd() < 0.55 ? `rgba(8, 8, 36, ${(0.08 + rnd() * 0.16) * contrast})` : `rgba(230, 232, 255, ${(0.04 + rnd() * 0.1) * contrast})`;
        g.fillRect(x, y, z, z);
      }
      for (let k = 0; k < cracks; k++) {
        const pts = [];
        let x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI * 2;
        const n = 3 + Math.floor(rnd() * 6);
        for (let i = 0; i <= n; i++) {
          pts.push([x, y]);
          a += (rnd() - 0.5) * 1.5;
          const l = s * (0.035 + rnd() * 0.06);
          x += Math.cos(a) * l; y += Math.sin(a) * l;
        }
        const w = (1.2 + rnd() * 2.2) * s / 512;
        wrapped(g, s, wrap, () => {
          poly(g, pts, `rgba(255, 255, 255, ${0.16 * contrast})`, w * 0.7, w * 0.8);
          poly(g, pts, `rgba(6, 4, 28, ${0.8 * contrast})`, w);
          // a short branch
          if (pts.length > 3) {
            const [bx, by] = pts[2], b2 = [[bx, by], [bx + (rnd() - 0.5) * s * 0.12, by + (rnd() - 0.5) * s * 0.12]];
            poly(g, b2, `rgba(6, 4, 28, ${0.6 * contrast})`, w * 0.6);
          }
        });
      }
    }
    // crystal shards poking out of the stone, drawn on both the colour and glow maps
    function shards(gs, x, y, rgb, n, size, up) {
      for (const [g, glow] of gs) {
        g.save();
        g.translate(x, y);
        if (glow) { g.shadowColor = `rgb(${rgb})`; g.shadowBlur = size * 0.9; }
        for (let k = 0; k < n; k++) {
          const a = up + (k - (n - 1) / 2) * 0.45, l = size * (0.55 + 0.45 * ((k * 7) % 3) / 2), w = size * 0.16;
          g.save(); g.rotate(a);
          g.beginPath(); g.moveTo(-w, 0); g.lineTo(-w * 0.8, -l * 0.75); g.lineTo(0, -l); g.lineTo(w * 0.8, -l * 0.75); g.lineTo(w, 0); g.closePath();
          g.fillStyle = glow ? `rgb(${rgb})` : `rgba(${rgb}, 0.95)`; g.fill();
          g.fillStyle = 'rgba(255, 255, 255, 0.45)';
          g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -l); g.lineTo(w * 0.8, -l * 0.75); g.lineTo(w, 0); g.closePath(); g.fill();
          g.restore();
        }
        g.restore();
      }
    }
    function specks(gs, s, n, wrap) {
      for (let k = 0; k < n; k++) {
        const x = rnd() * s, y = rnd() * s, r = (1.5 + rnd() * 2.5) * s / 512, rgb = rnd() < 0.55 ? '120, 235, 255' : '175, 135, 255';
        for (const [g, glow] of gs) {
          wrapped(g, s, wrap, () => {
            g.save();
            if (glow) { g.shadowColor = `rgb(${rgb})`; g.shadowBlur = r * 5; }
            g.fillStyle = `rgb(${rgb})`;
            g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
            g.restore();
          });
        }
      }
    }
    const tex = (c, wrap, aniso = 1) => {
      const t = new T.CanvasTexture(c);
      if (wrap) t.wrapS = t.wrapT = T.RepeatWrapping;
      t.anisotropy = Math.min(aniso, renderer.capabilities.getMaxAnisotropy());
      return t;
    };

    // block faces: a 2x2 atlas of four different chunky stones, so neighbouring
    // blocks don't repeat each other
    const S = 512, Q = S / 2;
    const [bc, bg] = canvasOf(S, 'rgb(168, 172, 228)'), [gc, gg] = canvasOf(S, '#000');
    const inQuad = (k, fn) => {
      const ox = (k % 2) * Q, oy = Math.floor(k / 2) * Q;
      for (const g of [bg, gg]) { g.save(); g.beginPath(); g.rect(ox, oy, Q, Q); g.clip(); g.translate(ox, oy); }
      fn();
      for (const g of [bg, gg]) g.restore();
    };
    for (let k = 0; k < 4; k++) {
      inQuad(k, () => {
        rock(bg, Q, false, 4 + k);
        // bevel: a light rim, a dark groove inside it, a dark seam at the very edge
        const b = Q * 0.08;
        const rim = bg.createLinearGradient(0, 0, Q, Q);
        rim.addColorStop(0, 'rgba(235, 238, 255, 0.6)'); rim.addColorStop(1, 'rgba(190, 195, 255, 0.28)');
        bg.strokeStyle = rim; bg.lineWidth = b; bg.strokeRect(b / 2, b / 2, Q - b, Q - b);
        bg.strokeStyle = 'rgba(8, 6, 34, 0.45)'; bg.lineWidth = b * 0.35; bg.strokeRect(b * 1.15, b * 1.15, Q - b * 2.3, Q - b * 2.3);
        bg.strokeStyle = 'rgba(4, 4, 20, 0.9)'; bg.lineWidth = Q * 0.03; bg.strokeRect(0, 0, Q, Q);
        for (const [cx, cy] of [[0, 0], [Q, 0], [0, Q], [Q, Q]]) {
          if (rnd() < 0.5) continue;
          bg.fillStyle = 'rgba(6, 5, 26, 0.7)';
          bg.beginPath(); bg.arc(cx, cy, b * (0.8 + rnd() * 0.9), 0, Math.PI * 2); bg.fill();
        }
        const both = [[bg, false], [gg, true]];
        if (k === 0) shards(both, Q * 0.22, Q * 0.96, '110, 230, 255', 3, Q * 0.2, -0.15);
        if (k === 1) shards(both, Q * 0.8, Q * 0.95, '170, 125, 255', 3, Q * 0.17, 0.2);
        if (k !== 1) {
          // a glowing vein along a crack
          const x0 = Q * (0.3 + rnd() * 0.4), vein = [[x0, Q * 0.1], [x0 + Q * 0.06, Q * 0.28], [x0 - Q * 0.04, Q * 0.42], [x0 + Q * 0.05, Q * 0.58]];
          const rgb = k === 2 ? '170, 125, 255' : '120, 235, 255';
          for (const [g, glow] of both) {
            g.save(); if (glow) { g.shadowColor = `rgb(${rgb})`; g.shadowBlur = 10; }
            poly(g, vein, `rgb(${rgb})`, Q * 0.012); g.restore();
          }
        }
        specks(both, Q, 3, false);
      });
    }

    // rough rock, seamless
    const [rc, rg] = canvasOf(S, 'rgb(140, 144, 205)'), [rgc, rgg] = canvasOf(S, '#000');
    rock(rg, S, true, 7, 0.75);
    specks([[rg, false], [rgg, true]], S, 7, true);

    // floor slabs with grout, also a 2x2 atlas
    const F = 256, FQ = F / 2;
    const [fc, fg] = canvasOf(F, 'rgb(128, 132, 196)');
    for (let k = 0; k < 4; k++) {
      const ox = (k % 2) * FQ, oy = Math.floor(k / 2) * FQ;
      fg.save(); fg.beginPath(); fg.rect(ox, oy, FQ, FQ); fg.clip(); fg.translate(ox, oy);
      rock(fg, FQ, false, 1 + (k % 3), 0.7);
      fg.strokeStyle = 'rgba(225, 230, 255, 0.22)'; fg.lineWidth = FQ * 0.03; fg.strokeRect(FQ * 0.06, FQ * 0.06, FQ * 0.88, FQ * 0.88);
      fg.strokeStyle = 'rgba(3, 3, 14, 0.95)'; fg.lineWidth = FQ * 0.08; fg.strokeRect(0, 0, FQ, FQ);
      fg.restore();
    }

    // themed battle floors, 2x2 atlases like the slabs: ice, grass and crystal
    const atlas = (fill, fn) => {
      const [c, g] = canvasOf(F, fill);
      for (let k = 0; k < 4; k++) {
        const ox = (k % 2) * FQ, oy = Math.floor(k / 2) * FQ;
        g.save(); g.beginPath(); g.rect(ox, oy, FQ, FQ); g.clip(); g.translate(ox, oy);
        fn(g, k);
        g.restore();
      }
      return c;
    };
    // ice: pale glassy slabs, long white streaks, a few fine cracks
    const iceC = atlas('rgb(196, 222, 255)', (g, k) => {
      const gr = g.createLinearGradient(0, 0, FQ, FQ);
      gr.addColorStop(0, 'rgba(255, 255, 255, 0.35)'); gr.addColorStop(0.5, 'rgba(160, 200, 255, 0.1)'); gr.addColorStop(1, 'rgba(120, 170, 240, 0.35)');
      g.fillStyle = gr; g.fillRect(0, 0, FQ, FQ);
      for (let j = 0; j < 3; j++) {
        const y0 = rnd() * FQ * 1.4 - FQ * 0.2;
        g.strokeStyle = `rgba(255, 255, 255, ${0.12 + rnd() * 0.18})`; g.lineWidth = FQ * (0.03 + rnd() * 0.06);
        g.beginPath(); g.moveTo(-5, y0); g.lineTo(FQ + 5, y0 - FQ * 0.6); g.stroke();
      }
      for (let j = 0; j < 2 + (k % 2); j++) {
        const pts = []; let x = rnd() * FQ, y = rnd() * FQ, a = rnd() * 6;
        for (let i = 0; i < 5; i++) { pts.push([x, y]); a += (rnd() - 0.5) * 1.6; x += Math.cos(a) * FQ * 0.12; y += Math.sin(a) * FQ * 0.12; }
        poly(g, pts, 'rgba(255, 255, 255, 0.55)', 1.2);
      }
      g.strokeStyle = 'rgba(90, 130, 200, 0.35)'; g.lineWidth = FQ * 0.03; g.strokeRect(0, 0, FQ, FQ);
    });
    // grass: blades of green in light and dark, now and then a tiny flower
    const grassC = atlas('rgb(86, 150, 70)', (g) => {
      for (let j = 0; j < 22; j++) {
        const x = rnd() * FQ, y = rnd() * FQ, r = FQ * (0.08 + rnd() * 0.15);
        g.fillStyle = rnd() < 0.5 ? 'rgba(40, 90, 30, 0.35)' : 'rgba(150, 210, 110, 0.25)';
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
      g.lineCap = 'round';
      for (let j = 0; j < 150; j++) {
        const x = rnd() * FQ, y = rnd() * FQ, l = FQ * (0.04 + rnd() * 0.06), a = -Math.PI / 2 + (rnd() - 0.5) * 0.9;
        g.strokeStyle = rnd() < 0.5 ? 'rgba(30, 80, 25, 0.75)' : 'rgba(170, 235, 120, 0.7)'; g.lineWidth = 1 + rnd() * 1.4;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
      for (let j = 0; j < 2; j++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(255, 240, 150, 0.9)' : 'rgba(255, 170, 220, 0.9)';
        g.beginPath(); g.arc(rnd() * FQ, rnd() * FQ, 1.8, 0, Math.PI * 2); g.fill();
      }
    });
    // crystal: glassy diamond facets with bright edges
    const crysC = atlas('rgb(120, 130, 220)', (g, k) => {
      const m = FQ / 2;
      const tri = (pts, a) => { g.fillStyle = `rgba(${a > 0 ? '235, 240, 255' : '20, 20, 70'}, ${Math.abs(a)})`; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
      tri([[0, 0], [m, 0], [m, m]], 0.18); tri([[0, 0], [0, m], [m, m]], -0.15);
      tri([[FQ, 0], [m, 0], [m, m]], -0.08); tri([[FQ, 0], [FQ, m], [m, m]], 0.22);
      tri([[0, FQ], [0, m], [m, m]], 0.1); tri([[0, FQ], [m, FQ], [m, m]], -0.2);
      tri([[FQ, FQ], [m, FQ], [m, m]], 0.16); tri([[FQ, FQ], [FQ, m], [m, m]], -0.1);
      g.strokeStyle = 'rgba(200, 235, 255, 0.55)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(m, 0); g.lineTo(FQ, m); g.lineTo(m, FQ); g.lineTo(0, m); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(0, 0); g.lineTo(FQ, FQ); g.moveTo(FQ, 0); g.lineTo(0, FQ); g.strokeStyle = 'rgba(200, 235, 255, 0.18)'; g.stroke();
      g.strokeStyle = 'rgba(10, 10, 40, 0.8)'; g.lineWidth = FQ * 0.04; g.strokeRect(0, 0, FQ, FQ);
      if (k === 1 || k === 2) { g.fillStyle = 'rgba(255, 255, 255, 0.9)'; g.beginPath(); g.arc(m + (rnd() - 0.5) * m, m + (rnd() - 0.5) * m, 1.6, 0, Math.PI * 2); g.fill(); }
    });

    const ground = tex(rc, true);
    ground.repeat.set(0.5, 0.5);
    // the floor is seen at a slant, so it gets anisotropic filtering to keep its grout crisp
    return (TX = { block: tex(bc), blockGlow: tex(gc), rough: tex(rc, true), roughGlow: tex(rgc, true), tile: tex(fc, false, 4), ground,
      floors: { stone: tex(fc, false, 4), lava: tex(fc, false, 4), ice: tex(iceC, false, 4), moss: tex(grassC, false, 4), crystal: tex(crysC, false, 4), sky: tex(fc, false, 4) } });
  }

  // Stone materials. The patched shader picks a texture variant per block (by
  // flipping it, from the block's position) or, in 'world' mode, lays rough rock
  // continuously across neighbouring blocks; and it scales the crystal glow by the
  // block's own echo light so dark stone never glows on its own.
  // tint: the battle walls' veins can glow in the cave theme's colour instead
  // (mat.userData.tint = { color, mix } uniforms, set each frame)
  function patch(mat, mode, glowK, key, tint) {
    if (tint) mat.userData.tint = { color: { value: new T.Color(1, 1, 1) }, mix: { value: 0 } };
    mat.onBeforeCompile = (s) => {
      if (tint) {
        s.uniforms.veinTint = mat.userData.tint.color; s.uniforms.veinMix = mat.userData.tint.mix;
        s.fragmentShader = 'uniform vec3 veinTint;\nuniform float veinMix;\n' + s.fragmentShader;
      }
      const hash = 'vec2 h2 = fract(sin(vec2(dot(tp.xz, vec2(12.99, 78.23)), dot(tp.xz, vec2(39.35, 11.13)))) * 43758.55);\n vec2 fl = step(0.5, h2);';
      const st = mode === 'world' ? 'vec2 st = (uv + tp.xy) * 0.25;'
        : mode === 'atlas' ? `${hash}\n vec2 st = ((mix(uv, 1.0 - uv, fl) * 0.97 + 0.015) + step(0.5, fract(h2 * 7.0))) * 0.5;`
          : `${hash}\n vec2 st = mix(uv, 1.0 - uv, fl);`;
      s.vertexShader = s.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_INSTANCING
  vec3 tp = instanceMatrix[3].xyz;
  ${st}
  #ifdef USE_MAP
  vMapUv = st;
  #endif
  #ifdef USE_EMISSIVEMAP
  vEmissiveMapUv = st;
  #endif
#endif`);
      s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#ifdef USE_COLOR
  totalEmissiveRadiance *= max(vColor.r, max(vColor.g, vColor.b)) * ${glowK.toFixed(2)};
#endif
${tint ? 'totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(max(totalEmissiveRadiance.r, max(totalEmissiveRadiance.g, totalEmissiveRadiance.b))) * veinTint, veinMix);' : ''}`);
    };
    mat.customProgramCacheKey = () => key;
    return mat;
  }
  const stoneMat = (map, glow, mode, glowK, key, tint) => patch(new T.MeshLambertMaterial(glow ? { map, emissive: 0xffffff, emissiveMap: glow } : { map }), mode, glowK, key, tint);
  // crystals glow in their own colour (instance colour), with flat-shaded facets on top
  function crystalMat() {
    const m = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    m.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance += vColor * 0.75;\n#endif');
    };
    m.customProgramCacheKey = () => 'crystal';
    return m;
  }
  // a pointed six-sided crystal, base at 0, tip at 1, whiter toward the tip
  function crystalGeo() {
    const g = new T.LatheGeometry([new T.Vector2(0, 0), new T.Vector2(0.12, 0), new T.Vector2(0.13, 0.72), new T.Vector2(0, 1)], 6);
    return shadeByHeight(g, 0.45, 1.25);
  }
  // a little mushroom: stem and a domed cap
  function mushroomGeo() {
    const p = [[0, 0], [0.028, 0], [0.022, 0.12], [0.03, 0.15], [0.11, 0.15], [0.1, 0.19], [0.06, 0.225], [0, 0.235]];
    return shadeByHeight(new T.LatheGeometry(p.map(([x, y]) => new T.Vector2(x, y)), 8), 0.5, 1.2);
  }
  function shadeByHeight(g, lo, hi) {
    g.computeBoundingBox();
    const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3), top = g.boundingBox.max.y || 1;
    for (let i = 0; i < n; i++) { const k = lo + (hi - lo) * (pos.getY(i) / top); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    return g;
  }
  // a battle block in Frozen Grotto: a faceted six-sided crystal with a bevelled top
  function crystalBlockGeo() {
    const g = new T.LatheGeometry([[0, 0], [0.7, 0], [0.66, 0.78], [0.42, 1.0], [0, 1.06]].map(([x, y]) => new T.Vector2(x, y)), 6);
    g.rotateY(Math.PI / 6); g.translate(0.5, 0, 0.5);
    return shadeByHeight(g, 0.5, 1.3);
  }
  // a battle block in Mossy Den: a round leafy bush, a few lumpy balls of leaves
  function bushGeo() {
    const parts = [[0.3, 0.32, 0.32, 0.36], [0.7, 0.36, 0.34, 0.36], [0.36, 0.4, 0.7, 0.36], [0.68, 0.34, 0.68, 0.35], [0.5, 0.66, 0.5, 0.4]];
    const pos = [];
    parts.forEach(([x, y, z, r], j) => {
      const ico = new T.IcosahedronGeometry(r, 1), p = ico.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), n = 0.85 + 0.3 * floorHash(Math.round(vx * 50) * 7 + Math.round(vy * 50) * 13 + Math.round(vz * 50) * 3 + j * 101);
        pos.push(x + vx * n, Math.max(0, y + vy * n * 0.9), z + vz * n);
      }
      ico.dispose();
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return shadeByHeight(g, 0.45, 1.25);
  }
  // Lava Hollow's floor: glowing lava that churns and flows (u.amt: 0 none .. 1 full)
  function lavaMaterial() {
    return new T.ShaderMaterial({
      uniforms: { time: { value: 0 }, amt: { value: 0 }, rock: { value: null }, size: { value: new T.Vector2(1, 1) } },
      transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float time; uniform float amt; uniform sampler2D rock; uniform vec2 size; varying vec2 vP;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
        float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * n(p); p = p * 2.03 + 1.7; a *= 0.5; } return v; }
        void main() {
          vec2 p = vP * 0.6; float t = time * 0.22;
          vec2 q = vec2(fbm(p + vec2(t, 0.0)), fbm(p + vec2(3.1, t * 1.3)));
          float f = fbm(p * 1.4 + q * 2.2 + vec2(-t * 0.7, t * 0.5));
          vec3 c = mix(vec3(0.32, 0.03, 0.0), vec3(1.0, 0.3, 0.02), smoothstep(0.32, 0.58, f));
          c = mix(c, vec3(1.0, 0.86, 0.4), smoothstep(0.6, 0.78, f));
          float crust = smoothstep(0.03, 0.0, abs(f - 0.47)) * 0.6;
          c = mix(c, vec3(0.12, 0.02, 0.0), crust);
          c *= 0.85 + 0.2 * sin(time * 2.0 + f * 9.0);
          // the lava glows hot where it laps against the rock islands (rock: 1 per rock tile, smoothed)
          float r = texture2D(rock, vP / size).r;
          float rim = smoothstep(0.04, 0.42, r + (f - 0.5) * 0.12);
          c = mix(c, vec3(1.0, 0.78, 0.32), rim * (0.55 + 0.15 * sin(time * 3.0 + vP.x * 1.7 + vP.y * 1.3)));
          gl_FragColor = vec4(c, amt);
        }`,
    });
  }
  // Lava Hollow's islands: a rock tile whose corners round off where two of its
  // sides face the lava, with a bevelled rim, so an island reads as one rounded
  // lump of basalt rather than a stack of boxes. mask: bit 1 top (-z), 2 right,
  // 4 bottom (+z), 8 left open. (Sides against other rock stay square, hidden.)
  function rockTileGeo(mask) {
    const bs = 0.07, bt = 0.07, rad = 0.42, o = [1, 2, 4, 8].map((b) => !!(mask & b));
    const x0 = o[3] ? bs : 0, x1 = o[1] ? 1 - bs : 1, y0 = o[0] ? bs : 0, y1 = o[2] ? 1 - bs : 1;
    const rTL = o[0] && o[3] ? rad : 0, rTR = o[0] && o[1] ? rad : 0, rBR = o[2] && o[1] ? rad : 0, rBL = o[2] && o[3] ? rad : 0;
    // (drawn in the shape's plane as (x, -z), so standing it up needs no mirror)
    const sh = new T.Shape(), M = (x, z) => sh.moveTo(x, -z), L = (x, z) => sh.lineTo(x, -z), Q = (cx, cz, x, z) => sh.quadraticCurveTo(cx, -cz, x, -z);
    M(x0 + rTL, y0);
    L(x1 - rTR, y0); if (rTR) Q(x1, y0, x1, y0 + rTR);
    L(x1, y1 - rBR); if (rBR) Q(x1, y1, x1 - rBR, y1);
    L(x0 + rBL, y1); if (rBL) Q(x0, y1, x0, y1 - rBL);
    L(x0, y0 + rTL); if (rTL) Q(x0, y0, x0 + rTL, y0);
    const g = new T.ExtrudeGeometry(sh, { depth: WALL_H - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: 2, curveSegments: 6 });
    // shape (x, -z) -> world (x, z); the extrusion stands up along y, from 0 to WALL_H
    g.rotateX(-Math.PI / 2); g.translate(0, bt, 0);
    // (texture coordinates: the tops by position in the tile, the sides by height)
    const pos = g.attributes.position, uv = g.attributes.uv, nr = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const up = Math.abs(nr.getY(i)) > 0.7;
      uv.setXY(i, up ? pos.getX(i) : (Math.abs(nr.getX(i)) > Math.abs(nr.getZ(i)) ? pos.getZ(i) : pos.getX(i)), up ? 1 - pos.getZ(i) : pos.getY(i) / WALL_H);
    }
    return g;
  }
  // ...and the inside corners: a concave fillet of rock filling the corner of a
  // lava tile hemmed in by rock on two sides (local u and z run into that tile)
  function rockFilletGeo() {
    const r = 0.3, sh = new T.Shape();
    // (in the shape's plane as (u, -z), like rockTileGeo)
    sh.moveTo(0, 0); sh.lineTo(r, 0);
    sh.absarc(r, -r, r, Math.PI / 2, Math.PI, false);
    sh.lineTo(0, 0);
    const g = new T.ExtrudeGeometry(sh, { depth: WALL_H, bevelEnabled: false, curveSegments: 8 });
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, uv = g.attributes.uv, nr = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) { const up = Math.abs(nr.getY(i)) > 0.7; uv.setXY(i, up ? pos.getX(i) : pos.getX(i) + pos.getZ(i), up ? 1 - pos.getZ(i) : pos.getY(i) / WALL_H); }
    return g;
  }
  // the shield: a smooth glass bubble, brightest at its rim, with a slow shimmer
  // drifting over it and a soft highlight (u.alpha fades it, u.flash brightens it)
  function shieldMaterial() {
    return new T.ShaderMaterial({
      uniforms: { time: { value: 0 }, alpha: { value: 1 }, color: { value: new T.Color(0.55, 0.94, 1.0) } },
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float time; uniform float alpha; uniform vec3 color; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          vec3 N = normalize(vN);
          float fr = pow(1.0 - abs(dot(N, normalize(vV))), 2.4);
          float sh = smoothstep(0.75, 1.0, sin(vP.y * 9.0 + vP.x * 4.0 - time * 2.4)) * 0.35;
          float hl = pow(max(0.0, dot(N, normalize(vec3(-0.45, 0.65, 0.6)))), 30.0);
          vec3 c = color * (0.08 + fr * 1.1 + sh * (0.3 + fr)) + vec3(1.0) * (pow(fr, 5.0) * 0.5 + hl * 0.9);
          gl_FragColor = vec4(c * alpha, 1.0);
        }`,
    });
  }
  const glowMatOf = () => new T.MeshBasicMaterial({ map: softDot(), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false });
  function instanced(geo, mat, n) {
    const m = new T.InstancedMesh(geo, mat, n);
    m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    m.frustumCulled = false;
    return m;
  }

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
    // cool blue-violet cave light: tops of blocks catch it, sides fall into shade
    hemi = new T.HemisphereLight(0xb4b8ff, 0x2a2260, 1.05);
    sun = new T.DirectionalLight(0xd8dcff, 1.25);
    sun.position.set(-0.5, 1, 0.55);
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
  let wallMat = null, floorMat = null, gemMat = null, bushMat = null, gems = null, bushes = null, lavaPlane = null, floorStyle = '';
  let rocks = [], rockData = null, rockTex = null, rockN = new Int32Array(17), rockCol = null;
  const FILLET_AXES = [[1, 0, 0, 0], [0, 1, 1, 0], [-1, 0, 1, 1], [0, -1, 0, 1]];   // per corner TL, TR, BR, BL: u (x, z), corner offset (x, z)
  function buildTiles(arena) {
    if (walls) {
      scene.remove(walls, floor, gems, bushes, lavaPlane, ...rocks);
      for (const m of [walls, floor, gems, bushes, ...rocks]) { m.geometry.dispose(); m.dispose(); }
      lavaPlane.geometry.dispose(); rockTex.dispose();
    }
    const n = arena.w * arena.h, tx = textures();
    const wg = new T.BoxGeometry(1, WALL_H, 1);
    wg.translate(0.5, WALL_H / 2, 0.5);
    wallMat = wallMat || stoneMat(tx.block, tx.blockGlow, 'atlas', 0.9, 'stone-block-tint', true);
    walls = new T.InstancedMesh(wg, wallMat, n);
    const fg = new T.PlaneGeometry(1, 1);
    fg.rotateX(-Math.PI / 2); fg.translate(0.5, 0, 0.5);
    floorMat = floorMat || patch(new T.MeshBasicMaterial({ map: tx.tile }), 'atlas', 0, 'stone-floor');
    floor = new T.InstancedMesh(fg, floorMat, n);
    // the themed blocks: crystals (Frozen Grotto) and bushes (Mossy Den); one block mesh shows at a time
    if (!gemMat) {
      gemMat = crystalMat();
      bushMat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      bushMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance += vColor * 0.22;\n#endif'); };
      bushMat.customProgramCacheKey = () => 'bush';
    }
    gems = new T.InstancedMesh(crystalBlockGeo(), gemMat, n);
    bushes = new T.InstancedMesh(bushGeo(), bushMat, n);
    // Lava Hollow's rock islands: one mesh per shape of tile (which sides face the lava)
    rocks = Array.from({ length: 17 }, (_, mask) => {
      const m = new T.InstancedMesh(mask < 16 ? rockTileGeo(mask) : rockFilletGeo(), wallMat, mask < 16 ? n : n * 2);
      m.count = 0; m.visible = false;
      return m;
    });
    rockCol = new Float32Array(n * 3);
    // where the rock is, for the lava's hot rim (smoothed between tile centres)
    rockData = new Uint8Array(n * 4);
    rockTex = new T.DataTexture(rockData, arena.w, arena.h, T.RGBAFormat);
    rockTex.magFilter = rockTex.minFilter = T.LinearFilter; rockTex.needsUpdate = true;
    lavaPlane = new T.Mesh(new T.PlaneGeometry(arena.w, arena.h).rotateX(-Math.PI / 2).translate(arena.w / 2, 0.012, arena.h / 2), lavaMaterial());
    lavaPlane.material.uniforms.rock.value = rockTex; lavaPlane.material.uniforms.size.value.set(arena.w, arena.h);
    // (drawn first of all the see-through things: they blend over the lava, and none of them
    // gets painted over by it. Drawn after them, it covered every half-see-through bat (ghosts,
    // wings) and glow over it, so they looked cut out of the scene.)
    lavaPlane.visible = false; lavaPlane.renderOrder = -10;
    scene.add(lavaPlane);
    for (const m of [walls, floor, gems, bushes, ...rocks]) {
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      m.instanceColor.setUsage(T.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }
    // the floor never moves: lay every tile once, only colours change per frame
    for (let k = 0; k < n; k++) { tmpM.makeTranslation(k % arena.w, 0, Math.floor(k / arena.w)); floor.setMatrixAt(k, tmpM); }
    floor.instanceMatrix.needsUpdate = true;
    buildDecor(arena.w, arena.h);
    lastTiles = n;
  }

  // ---- Scenery outside the arena: crystals, mushrooms, rubble, floating motes ----
  // All of it sits beyond the border wall, so it never hides or hints at
  // anything inside the playable cave.
  let decor = null, motes = null, senseRings = [], decorTints = [], decorKey = '', decorGround = null;
  function buildDecor(w, h) {
    if (decor) { scene.remove(decor); decor.traverse((o) => o.isMesh && o.geometry.dispose()); }
    const tx = textures(), rnd = rng(1234);
    decor = new T.Group();
    decorTints = []; decorKey = '';
    const spot = (minD, maxD) => {
      for (;;) {
        const x = -8 + rnd() * (w + 16), z = -8 + rnd() * (h + 12);
        const d = Math.max(-x, x - w, -z, z - h);
        if (d > minD && d < maxD) return { x, z, d };
      }
    };
    const q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3(), c = new T.Color();
    // tint: [0 or 1 (the theme's first or second accent), brightness], so a cave theme can recolour it
    const put = (mesh, k, x, y, z, rx, ry, rz, sx, sy, sz, rgb, tint) => {
      p.set(x, y, z); q.setFromEuler(e.set(rx, ry, rz)); s.set(sx, sy, sz);
      mesh.setMatrixAt(k, tmpM.compose(p, q, s));
      mesh.setColorAt(k, c.setRGB(rgb[0], rgb[1], rgb[2]));
      if (tint) decorTints.push({ mesh, k, kind: tint[0], f: tint[1] });
    };
    // soft glows face the camera (it only ever slides, never turns), pools lie on the ground
    const bbGeo = new T.PlaneGeometry(1, 1); bbGeo.rotateX(-PITCH);
    const poolGeo = new T.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2);
    const NC = 30, NM = 22;
    const crystals = instanced(crystalGeo(), crystalMat(), NC * 6);
    const shrooms = instanced(mushroomGeo(), crystalMat(), NM * 5);
    const glows = instanced(bbGeo, glowMatOf(), NC + NM);
    const pools = instanced(poolGeo, glowMatOf(), NC + NM);
    let nc = 0, ns = 0, ng = 0;
    for (let k = 0; k < NC; k++) {
      // most clusters hug the outside of the border wall, a few stand farther back and taller
      const far = k % 3 === 0, o = spot(far ? 2.5 : 0.35, far ? 7.5 : 2.6);
      const col = rnd() < 0.55 ? CYAN : VIOLET, kind = col === CYAN ? 0 : 1, n = 3 + Math.floor(rnd() * 4), big = far ? 1.7 : 1;
      let top = 0;
      for (let j = 0; j < n; j++) {
        const a = rnd() * Math.PI * 2, r = j ? 0.12 + rnd() * 0.3 : 0, hh = (j ? 0.45 + rnd() * 0.7 : 0.9 + rnd() * 0.8) * big;
        const t = j ? 0.25 + rnd() * 0.45 : rnd() * 0.15, k2 = 0.85 + rnd() * 0.3;
        put(crystals, nc++, o.x + Math.cos(a) * r, -0.05, o.z + Math.sin(a) * r, Math.sin(a) * t, rnd() * 3, -Math.cos(a) * t,
          (0.9 + rnd() * 0.6) * big, hh, (0.9 + rnd() * 0.6) * big, [col[0] * k2, col[1] * k2, col[2] * k2], [kind, k2]);
        top = Math.max(top, hh);
      }
      put(glows, ng, o.x, top * 0.5, o.z, 0, 0, 0, 2.2 * big + top, 2.2 * big + top, 1, col.map((v) => v * 0.32), [kind, 0.32]);
      put(pools, ng++, o.x, 0.01, o.z, 0, 0, 0, 3.2 * big, 1, 3.2 * big, col.map((v) => v * 0.3), [kind, 0.3]);
    }
    for (let k = 0; k < NM; k++) {
      const o = spot(0.3, 4), n = 2 + Math.floor(rnd() * 4);
      for (let j = 0; j < n; j++) {
        const sc = 0.9 + rnd() * 1.1;
        put(shrooms, ns++, o.x + (rnd() - 0.5) * 0.7, 0, o.z + (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.3, rnd() * 3, (rnd() - 0.5) * 0.3, sc, sc, sc, CYAN, [0, 1]);
      }
      put(glows, ng, o.x, 0.25, o.z, 0, 0, 0, 1.1, 1.1, 1, CYAN.map((v) => v * 0.4), [0, 0.4]);
      put(pools, ng++, o.x, 0.01, o.z, 0, 0, 0, 1.6, 1, 1.6, CYAN.map((v) => v * 0.3), [0, 0.3]);
    }
    crystals.count = nc; shrooms.count = ns; glows.count = pools.count = ng;
    // dark rubble and stalagmites
    const rockMat = stoneMat(tx.rough, null, 'flip', 0, 'stone-rubble');
    const lumps = instanced(new T.DodecahedronGeometry(0.5, 0), rockMat, 70);
    for (let k = 0; k < 70; k++) {
      const o = spot(0.15, 7), sc = 0.35 + rnd() * 0.7 + (o.d > 3 ? 0.6 : 0), dk = 0.22 + rnd() * 0.12;
      put(lumps, k, o.x, 0, o.z, rnd() * 3, rnd() * 3, rnd() * 3, sc * (1 + rnd() * 0.6), sc * 0.7, sc, [dk, dk, dk * 1.9]);
    }
    const spikes = instanced(new T.ConeGeometry(0.5, 1, 7).translate(0, 0.5, 0), rockMat, 46);
    for (let k = 0; k < 46; k++) {
      const o = spot(2.2, 8), sc = 0.6 + rnd() * 0.9 + (o.d - 2) * 0.15, dk = 0.18 + rnd() * 0.1;
      put(spikes, k, o.x, -0.1, o.z, (rnd() - 0.5) * 0.2, rnd() * 3, (rnd() - 0.5) * 0.2, sc, sc * (1.6 + rnd() * 2.2), sc, [dk, dk, dk * 2]);
    }
    // rocky ground around the arena only (a frame with the arena cut out, so no pixel is shaded twice)
    const outer = new T.Shape([new T.Vector2(-22, -16), new T.Vector2(w + 22, -16), new T.Vector2(w + 22, h + 14), new T.Vector2(-22, h + 14)]);
    outer.holes.push(new T.Path([new T.Vector2(0, 0), new T.Vector2(0, h), new T.Vector2(w, h), new T.Vector2(w, 0)]));
    const ground = new T.Mesh(new T.ShapeGeometry(outer).rotateX(Math.PI / 2), new T.MeshLambertMaterial({ map: tx.ground, color: 0x2a2a58, side: T.DoubleSide }));
    ground.position.y = -0.04;
    decorGround = ground;
    decor.add(ground, lumps, spikes, pools, crystals, shrooms, glows);
    scene.add(decor);

    // floating motes drift over the whole cave
    if (!motes) {
      const N = 140, pts = new Float32Array(N * 3), base = new Float32Array(N * 4);
      for (let k = 0; k < N; k++) {
        base[k * 4] = -4 + rnd() * (w + 8); base[k * 4 + 1] = 0.3 + rnd() * 2.6; base[k * 4 + 2] = -5 + rnd() * (h + 7); base[k * 4 + 3] = rnd() * 6.28;
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pts, 3).setUsage(T.DynamicDrawUsage));
      motes = new T.Points(g, new T.PointsMaterial({ color: 0x9fdcff, size: 0.09, map: softDot(), transparent: true, opacity: 0.75, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
      motes.userData.base = base;
      motes.frustumCulled = false;
      scene.add(motes);
      // two faint rings on the floor around your bat: how far its senses reach
      for (const r of [2.1, 3.4]) {
        const m = new T.Mesh(new T.RingGeometry(r - 0.04, r, 64).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
        m.visible = false; scene.add(m); senseRings.push(m);
      }
    }
  }
  // a cave theme recolours the crystals, mushrooms and glows around the arena, the ground and the motes
  function tintDecor(th) {
    if (!th || th.key === decorKey) return;
    decorKey = th.key;
    const touched = new Set();
    for (const d of decorTints) {
      const a = d.kind ? th.accB : th.accA;
      d.mesh.setColorAt(d.k, tmpC.setRGB(a[0] * d.f, a[1] * d.f, a[2] * d.f));
      touched.add(d.mesh);
    }
    for (const m of touched) m.instanceColor.needsUpdate = true;
    if (decorGround) decorGround.material.color.setRGB(th.floor[0] * 0.45, th.floor[1] * 0.45, th.floor[2] * 0.45);
    if (motes) motes.material.color.setRGB(th.mote[0], th.mote[1], th.mote[2]);
    hemi.color.setRGB(...th.hemi[0]); hemi.groundColor.setRGB(...th.hemi[1]);
    if (wallMat?.userData.tint) { wallMat.userData.tint.color.value.setRGB(...th.accA); wallMat.userData.tint.mix.value = th.vein || 0; }
  }
  function driftMotes(clock, on) {
    motes.visible = on;
    if (!on) return;
    const pos = motes.geometry.attributes.position, a = pos.array, b = motes.userData.base;
    for (let k = 0; k < pos.count; k++) {
      const ph = b[k * 4 + 3];
      a[k * 3] = b[k * 4] + Math.sin(clock * 0.3 + ph) * 0.6;
      a[k * 3 + 1] = b[k * 4 + 1] + Math.sin(clock * 0.5 + ph * 2) * 0.35;
      a[k * 3 + 2] = b[k * 4 + 2] + Math.cos(clock * 0.25 + ph) * 0.6;
    }
    pos.needsUpdate = true;
    motes.material.opacity = 0.55 + 0.2 * Math.sin(clock * 1.3);
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

  // A bat's look (src/looks.js): b.look when the mode sets one, else a classic
  // bat in the bat's colour. lookKey says when a rig must be rebuilt.
  function lookOf(b) {
    const L = window.EchoLooks;
    if (!L) return null;
    if (b.look) return b.look;
    if (!b.color || !/^#[0-9a-f]{6}$/i.test(b.color)) return L.preset(0);
    return Object.assign(L.preset(0), { body: b.color, wing: b.color });
  }
  function lookKey(b) {
    const L = window.EchoLooks;
    return (b.color || '') + '/' + (L && b.look ? L.key(b.look) : '');
  }
  // the bat itself (no glow, shield or stars): { group, wings, eyes, mats }
  function batBody(b) {
    const look = lookOf(b);
    if (look) {
      try { return window.EchoLooks.rig3D(T, look); } catch (e) { console.warn('bat look', e); }
    }
    return legacyBat(b);
  }
  function batRig(b, into = scene) {
    const g = new T.Group();
    const body = batBody(b);
    g.add(body.group);
    const glow = new T.Mesh(new T.PlaneGeometry(1.8, 1.8), new T.MeshBasicMaterial({ color: b.color, map: softDot(), transparent: true, opacity: 0.18, depthWrite: false, blending: T.AdditiveBlending }));
    // the pool of light lies flat on the floor, so it lives outside the tilting bat
    glow.rotation.x = -Math.PI / 2;
    into.add(glow);
    // a dark shadow on the floor while it jumps
    const shadow = new T.Mesh(new T.CircleGeometry(0.34, 24).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
    shadow.visible = false; into.add(shadow);
    const shield = new T.Mesh(new T.SphereGeometry(0.62, 32, 20), shieldMaterial());
    shield.renderOrder = 3;
    g.add(shield);
    const stars = [0, 1, 2].map(() => {
      const s = new T.Mesh(new T.OctahedronGeometry(0.06), new T.MeshBasicMaterial({ color: 0xffe278, transparent: true }));
      g.add(s); return s;
    });
    into.add(g);
    return { g, yaw: 0, wings: body.wings, eyes: body.eyes, glow, shadow, shield, shieldMat: shield.material, stars, mats: [...body.mats, glow.material, ...stars.map((s) => s.material)], color: b.color, key: lookKey(b), into, tick: body.tick };
  }
  function dropRig(r) {
    if (!r) return;
    r.into.remove(r.g, r.glow);
    if (r.shadow) { r.into.remove(r.shadow); r.shadow.geometry.dispose(); r.shadow.material.dispose(); }
    for (const m of r.mats) m.dispose();
    r.shieldMat?.dispose();
  }
  // set every material's opacity (looks can be see-through, e.g. ghost bats)
  // (and move its trail, if it has one)
  function rigAlpha(r, a, clock = 0) {
    for (const m of r.mats) m.opacity = a * (m.userData.base ?? 1);
    if (r.shieldMat) { r.shieldMat.uniforms.time.value = clock; r.shieldMat.uniforms.alpha.value = a * (0.85 + 0.15 * Math.sin(clock * 3)); }
    if (r.tick) r.tick(clock, a);
  }
  // the original single-colour bat, used if looks.js is missing
  function legacyBat(b) {
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
    const eyeGroup = new T.Group();
    eyeGroup.position.set(0, 0.05, 0.22);
    g.add(eyeGroup);
    [-1, 1].forEach((s) => {
      const e = new T.Mesh(new T.SphereGeometry(0.075, 12, 10), white);
      e.position.set(s * 0.1, 0, 0);
      const p = new T.Mesh(new T.SphereGeometry(0.038, 10, 8), dark);
      p.position.set(0, 0, 0.055); e.add(p);
      eyeGroup.add(e);
    });
    return { group: g, wings, eyes: eyeGroup, mats: [mat, wingMat, white, dark] };
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

    const open = !!arena.def.open, th = v.theme || null;
    const bg = th ? th.bg : open ? hexRgb(arena.theme.bg) : CAVE_BG, stone = th ? th.stone : STONE, base = th ? th.floor : [0.36, 0.37, 0.72];
    const ice = th ? th.ice : 0, style = th?.style || 'stone';
    // the lava floor: v.lava (0..1, as it eases in), or a pulsing warning glow during the 3-2-1
    const lavaAmt = Math.max(v.lava || 0, v.lavaWarn > 0 ? 0.18 + 0.14 * Math.sin(clock * 9) : 0);
    tintDecor(th);
    // (the floor's own texture: Frozen Grotto has crystal blocks on an ice floor)
    const fStyle = th?.floorStyle || style;
    if (floorStyle !== fStyle) { floorStyle = fStyle; floorMat.map = textures().floors[fStyle] || textures().tile; floorMat.needsUpdate = true; }
    const blockMesh = style === 'crystal' ? gems : style === 'moss' ? bushes : walls;
    for (const m of [walls, gems, bushes]) m.visible = m === blockMesh || m === walls;
    const rocky = style === 'lava' && blockMesh === walls;
    rockN.fill(0);
    lavaPlane.visible = !open && lavaAmt > 0.01;
    if (lavaPlane.visible) { lavaPlane.material.uniforms.time.value = clock; lavaPlane.material.uniforms.amt.value = Math.min(1, lavaAmt); }
    const lavaLit = style === 'lava' ? Math.max(0.3, (v.lava || 0) * 0.5) : 0;
    if (!scene.fog) { scene.background = new T.Color(); scene.fog = new T.Fog(0, 15, 36); }
    scene.background.setRGB(bg[0], bg[1], bg[2]);
    scene.fog.color.setRGB(bg[0], bg[1], bg[2]);
    buildSky(open);
    decor.visible = !open;
    driftMotes(clock, !open);

    // tiles: walls rise where sound has been. The border wall always shows faintly
    // so the arena reads as a room; walls inside stay hidden until heard or sensed.
    // The floor is laid everywhere, under walls too, so its glow gives nothing away.
    const w = arena.w, h = arena.h;
    if (wallTop.length !== w * h) wallTop = new Float32Array(w * h);
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const k = ty * w + tx, solid = arena.grid[k] === 1;
        const border = tx === 0 || ty === 0 || tx === w - 1 || ty === h - 1;
        // (over lava the blocks always show, lit from below)
        let a = Math.max(lit[k], solid && !border ? lavaLit : 0), pool = 0;
        for (let j = 0; j < near.length; j++) {
          const d = Math.hypot(tx + 0.5 - near[j].x, ty + 0.5 - near[j].y);
          a = Math.max(a, Math.max(0, Math.min(1, 1 - (d - 0.7) / 1.4)) * (solid ? 0.65 : 0.35));
          pool = Math.max(pool, Math.max(0, 1 - d / 4.2));
        }
        a = Math.max(a, tileGlow[k] * 0.5);
        const by = lit[k] > 0.05 ? v.batRgb[litBy[k]] : null;
        // walls: blue-violet stone, washed with the colour of whoever's echo lit it
        if (solid && (a > 0.02 || border)) {
          const e = by ? Math.min(1, lit[k] * 1.3) * 0.75 : 0;
          let r = stone[0], g = stone[1], b = stone[2];
          if (by) { r += (by[0] * 1.15 - r) * e; g += (by[1] * 1.15 - g) * e; b += (by[2] * 1.15 - b) * e; }
          let k2 = a;
          if (border) k2 = Math.max(a, open ? 0.3 : 0.62);
          // (lights in three are physically scaled, so stone needs a boost to read as bright blue-violet)
          k2 = Math.min(1, k2 * 1.05) * 1.75;
          // (themed blocks stand full height: bats stand on them)
          const top = border || blockMesh !== walls || style === 'lava' ? 1 : 0.6 + 0.4 * Math.min(1, a * 1.6);
          wallTop[k] = top * WALL_H;
          const mesh = border ? walls : blockMesh;
          if (mesh === gems) {
            // crystals glow in the theme's two accent colours, by tile, a little taller now and then
            const acc = (tx + ty) % 2 ? th.accB : th.accA, hh = 0.92 + 0.16 * floorHash(k * 3);
            tmpM.makeScale(1, hh, 1).setPosition(tx, 0, ty);
            r = acc[0] * 0.8 + (r - stone[0]) * 0.5; g = acc[1] * 0.8 + (g - stone[1]) * 0.5; b = acc[2] * 0.8 + (b - stone[2]) * 0.5;
            k2 *= 0.62;
          } else if (mesh === bushes) {
            // a bush that just grew back swells up into place
            const sc = 1 - 0.55 * tileGlow[k], hsh = floorHash(k * 5);
            tmpM.makeTranslation(-0.5, 0, -0.5)
              .premultiply(tmpM2.makeScale(sc, sc * (0.95 + 0.15 * hsh), sc))
              .premultiply(tmpM2.makeRotationY(Math.floor(hsh * 4) * Math.PI / 2))
              .premultiply(tmpM2.makeTranslation(tx + 0.5, 0, ty + 0.5));
            const lf = 0.82 + 0.3 * hsh;
            r = 0.36 * lf + (r - stone[0]) * 0.4; g = 0.86 * lf + (g - stone[1]) * 0.4; b = 0.3 * lf + (b - stone[2]) * 0.4;
            k2 *= 0.7;
          } else tmpM.makeScale(1, top, 1).setPosition(tx, 0, ty);
          if (style === 'lava' && !border) { r *= 0.42; g *= 0.4; b *= 0.42; }
          tmpC.setRGB(bg[0] + (r - bg[0]) * k2, bg[1] + (g - bg[1]) * k2, bg[2] + (b - bg[2]) * k2);
          if (rocky && !border) {
            // a rounded rock tile, by which of its sides face the lava
            const o = (x2, y2) => x2 <= 0 || y2 <= 0 || x2 >= w - 1 || y2 >= h - 1 || arena.grid[y2 * w + x2] !== 1;
            const mask = (o(tx, ty - 1) ? 1 : 0) | (o(tx + 1, ty) ? 2 : 0) | (o(tx, ty + 1) ? 4 : 0) | (o(tx - 1, ty) ? 8 : 0);
            const rm = rocks[mask], j = rockN[mask]++;
            rm.setMatrixAt(j, tmpM.makeTranslation(tx, 0, ty)); rm.setColorAt(j, tmpC);
            rockCol[k * 3] = tmpC.r; rockCol[k * 3 + 1] = tmpC.g; rockCol[k * 3 + 2] = tmpC.b;
            for (const m of [walls, gems, bushes]) if (m.visible) m.setMatrixAt(k, ZERO);
          } else {
            for (const m of [walls, gems, bushes]) if (m !== mesh && m.visible) m.setMatrixAt(k, ZERO);
            mesh.setMatrixAt(k, tmpM);
            mesh.setColorAt(k, tmpC);
          }
        } else {
          for (const m of [walls, gems, bushes]) if (m.visible) m.setMatrixAt(k, ZERO);
          wallTop[k] = 0;
        }
        // floor: a dim base everywhere, brighter around your bat and where echoes pass
        // (ice and grass show a little even in the dark, so the cave reads as icy or grassy)
        if (!open) {
          const lf = Math.max(lit[k] * 0.75, pool * pool * 0.5);
          const f = 0.1 + lf * 0.95 + ice * 0.12 + (style === 'moss' ? 0.05 : 0);
          let r = base[0], g = base[1], b = base[2];
          if (by) { const e = Math.min(1, lit[k]) * 0.5; r += (by[0] - r) * e; g += (by[1] - g) * e; b += (by[2] - b) * e; }
          r = bg[0] + (r - bg[0]) * f; g = bg[1] + (g - bg[1]) * f; b = bg[2] + (b - bg[2]) * f;
          // lava caves: some floor slabs are glowing lava, pulsing; ice caves: frost glints.
          // (laid everywhere, under rock too, so they don't give the walls away)
          const hsh = floorHash(k);
          if (ice > 0.02 && hsh > 0.86) { const p = ice * 0.2 * (0.45 + 0.55 * Math.sin(clock * 2.2 + k * 1.7)); r += p * 0.8; g += p * 0.95; b += p; }
          // crystal floors sparkle here and there
          if (style === 'crystal' && hsh > 0.9) { const p = 0.22 * Math.max(0, Math.sin(clock * 2.6 + k * 2.3)) ** 4; r += p * 0.6; g += p * 0.95; b += p; }
          floor.setColorAt(k, tmpC.setRGB(r, g, b));
        } else floor.setColorAt(k, tmpC.setRGB(0, 0, 0));
      }
    }
    floor.visible = !open && lavaAmt < 0.99;
    if (rocky) {
      // inside corners: fill the corner of a lava tile that has rock on two sides (and across)
      const R = (x2, y2) => x2 > 0 && y2 > 0 && x2 < w - 1 && y2 < h - 1 && arena.grid[y2 * w + x2] === 1;
      const fm = rocks[16];
      for (let ty = 1; ty < h - 1; ty++) for (let tx = 1; tx < w - 1; tx++) {
        if (arena.grid[ty * w + tx] === 1) continue;
        // corners TL, TR, BR, BL: the two sides and the diagonal
        const cs = [[-1, 0, 0, -1], [0, -1, 1, 0], [1, 0, 0, 1], [0, 1, -1, 0]];
        for (let c = 0; c < 4; c++) {
          const [ax, ay, bx, by] = cs[c];
          if (!R(tx + ax, ty + ay) || !R(tx + bx, ty + by) || !R(tx + ax + bx, ty + ay + by)) continue;
          const [ux, uz, ox, oz] = FILLET_AXES[c], kk = (ty + ay) * w + tx + ax, j = rockN[16]++;
          // basis: u, up, and z = u x up (into the tile as well)
          tmpM.set(ux, 0, -uz, tx + ox, 0, 1, 0, 0, uz, 0, ux, ty + oz, 0, 0, 0, 1);
          fm.setMatrixAt(j, tmpM); fm.setColorAt(j, tmpC.setRGB(rockCol[kk * 3], rockCol[kk * 3 + 1], rockCol[kk * 3 + 2]));
        }
      }
    }
    rocks.forEach((m, j) => { m.count = rockN[j]; m.visible = rockN[j] > 0; if (m.visible) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; } });
    if (lavaPlane.visible) {
      // the rock map for the lava's hot rim (only rewritten when the cave changes shape)
      let changed = false;
      for (let k = 0; k < w * h; k++) {
        const tx = k % w, ty = (k - tx) / w, v2 = arena.grid[k] === 1 && tx > 0 && ty > 0 && tx < w - 1 && ty < h - 1 ? 255 : 0;
        if (rockData[k * 4] !== v2) { rockData[k * 4] = rockData[k * 4 + 1] = rockData[k * 4 + 2] = v2; rockData[k * 4 + 3] = 255; changed = true; }
      }
      if (changed) rockTex.needsUpdate = true;
    }
    for (const m of [walls, gems, bushes]) if (m.visible) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    floor.instanceColor.needsUpdate = true;
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
      m.position.set(c.x, 0.45 + (c.top ? WALL_H : 0) + Math.sin(clock * 2 + c.phase) * 0.08, c.y);
      m.rotation.y = clock * 1.5 + c.phase;
      m.material.opacity = a;
    });
    powerMeshes.forEach((g, k) => {
      const p = v.powerups[k];
      const a = p ? v.seenAt(p.x, p.y) : 0;
      g.visible = a > 0.03;
      if (!g.visible) return;
      g.position.set(p.x, 0.55 + (p.top ? WALL_H : 0) + Math.sin(clock * 2.5 + p.phase) * 0.1, p.y);
      const rgb = rgbOf(v.POWERS[p.type].rgb);
      g.userData.core.material.color.setRGB(...rgb); g.userData.shell.material.color.setRGB(...rgb);
      g.userData.core.material.opacity = a; g.userData.shell.material.opacity = a * 0.8;
      g.userData.core.rotation.set(clock * 1.3, clock * 2, 0);
      g.userData.shell.rotation.set(Math.PI / 2 + Math.sin(clock) * 0.4, clock * 1.5, 0);
    });

    // bats
    while (batRigs.length < bats.length) batRigs.push(batRig(bats[batRigs.length]));
    // a bat whose look (or colour) changed gets a new rig
    for (let k = 0; k < bats.length; k++) {
      const b = bats[k];
      if (b && batRigs[k].key !== lookKey(b)) { const yaw = batRigs[k].yaw; dropRig(batRigs[k]); batRigs[k] = batRig(b); batRigs[k].yaw = yaw; }
    }
    batRigs.forEach((rig, k) => {
      const b = bats[k];
      let x = b?.x, y = b?.y, scale = 1 + (b && b.puff > 0 ? 0.4 * b.puff : 0), spin = 0, alpha = b ? v.batVisible(b) : 0;
      const eat = b && b.dead ? v.eats.find((e) => (e.food === b || e.food.i === b.i) && e.eater && e.t < v.EAT_PULL) : null;
      if (eat) {
        const p = eat.t / v.EAT_PULL, ease = p * p;
        x = b.x + (eat.eater.x - b.x) * ease; y = b.y + (eat.eater.y - b.y) * ease;
        scale = 1 - 0.85 * ease; spin = p * 9; alpha = 1;
      } else if (!b || b.dead) alpha = 0;
      const blink = b && b.safe > 0 && Math.floor(b.safe * 10) % 2 === 0;
      rig.g.visible = rig.glow.visible = alpha > 0.03 && !blink;
      const hop = b && v.jumpH ? v.jumpH(b) : 0, up = b && v.level ? v.level(b) : 0, ha0 = b && v.hopArc ? v.hopArc(b) : 0;
      rig.shadow.visible = rig.g.visible && (hop > 0 || up > 0.02) && !open;
      if (!rig.g.visible) return;
      rig.glow.position.set(x, 0.03 + up * WALL_H, y);
      if (rig.shadow.visible) {
        // on the floor, or on top of the wall it's hopping over
        const tk = Math.floor(y) * arena.w + Math.floor(x);
        rig.shadow.position.set(x, (wallTop[tk] || 0) + 0.035, y);
        rig.shadow.scale.setScalar(1.3 - 0.3 * hop);
        rig.shadow.material.opacity = alpha * (hop > 0 ? 0.85 - 0.2 * hop : ha0 > 0 ? 0.75 - 0.2 * ha0 : 0.5);   // (standing on a block: a softer one)
      }
      const stunned = b.stun > 0;
      const flap = stunned ? 0.15 : Math.sin(clock * (b.dashT > 0 ? 40 : hop > 0 ? 28 : 16) + b.i);
      rig.g.position.set(x, BAT_Y + Math.sin(clock * 3 + b.i) * 0.05 + hop * (v.jumpLift || 1.1) + up * WALL_H, y);
      rig.g.scale.setScalar(scale * 1.15 * (1 + 0.2 * hop));
      // just landed from a hop off a block: squash flat, a quick stretch, back to round
      const sq = v.squash ? v.squash(b) : 0, ha = v.hopArc ? v.hopArc(b) : 0;
      if (ha) rig.g.scale.multiplyScalar(1 + 0.14 * ha);   // (and a touch bigger, nearer you, at the top of a hop)
      if (sq) { rig.g.scale.x *= 1 + 0.3 * sq; rig.g.scale.z *= 1 + 0.3 * sq; rig.g.scale.y *= 1 - 0.34 * sq; rig.g.position.y -= 0.12 * sq; }
      // turn to face the way it's flying: toward the camera you see its face,
      // flying away you see its back
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > 0.6) {
        const want = Math.atan2(b.vx, b.vy);
        let d = want - rig.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        rig.yaw += d * Math.min(1, dt * 10);
      }
      rig.g.rotation.order = 'YXZ';
      rig.g.rotation.set(-0.25, rig.yaw + (stunned ? clock * 6 : 0) + spin, Math.max(-0.35, Math.min(0.35, -speed * 0.04 * Math.sign(Math.sin(rig.yaw)))));
      rig.wings[0].rotation.z = -flap * 0.7; rig.wings[1].rotation.z = flap * 0.7;
      rig.eyes.scale.set(1, stunned ? 0.25 : 1, 1);
      rig.shield.visible = b.shield;
      rig.shield.rotation.y = clock * 0.4;
      rig.shield.scale.setScalar(1 + 0.025 * Math.sin(clock * 4 + b.i));
      rig.stars.forEach((s, j) => {
        s.visible = stunned;
        const a = clock * 5 + j * 2.1;
        s.position.set(Math.cos(a) * 0.38, 0.45, Math.sin(a) * 0.38);
      });
      rigAlpha(rig, alpha, clock);
      rig.glow.material.opacity = alpha * (0.35 + (b.power ? 0.25 * (1 + Math.sin(clock * 10)) : 0));
    });

    // faint sense rings on the floor around your bat
    const fb = v.follow && !v.follow.dead ? v.follow : null;
    senseRings.forEach((m, j) => {
      m.visible = !!fb && !open;
      if (!m.visible) return;
      m.position.set(fb.x, 0.02, fb.y);
      m.material.color.setRGB(...v.batRgb[fb.i]).multiplyScalar(j ? 0.16 : 0.24);
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
    // duel.js draws its special-power effects (walls, fireballs, twisters, ice) into the scene
    if (v.extra) { try { v.extra(T, scene, dt); } catch (e) { console.warn('duel 3D effects', e); } }
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
    batRigs.forEach(dropRig);
    batRigs = [];
  }

  // ---- Explore and Cave Run ------------------------------------------------
  const CAVE_DEPTH = 2.2, CAVE_POOL = 3200, CAVE_UP = 1.6, DECO_POOL = 360, CAVE_MOTES = 60, HAZ_POOL = 80;
  let cave = null;
  function caveInit() {
    if (cave) return true;
    if (!init()) return false;
    const sc = new T.Scene(), tx = textures();
    const hemiC = new T.HemisphereLight(0xb4b8ff, 0x2a2260, 1.0);
    sc.add(hemiC);
    const key = new T.DirectionalLight(0xd8dcff, 1.2);
    key.position.set(-0.5, 0.9, 1);
    sc.add(key);
    // rock: a block per tile, reaching back from the play plane into the screen,
    // the same cracked blue-violet stone as the battle arenas
    const bg = new T.BoxGeometry(1, 1, CAVE_DEPTH);
    bg.translate(0.5, -0.5, -CAVE_DEPTH / 2);
    // (the veins can glow in a cave theme's colour: Co-op Explore's lava and ice caves)
    const rock = new T.InstancedMesh(bg, stoneMat(tx.rough, tx.roughGlow, 'world', 1.6, 'stone-cave-tint', true), CAVE_POOL);
    // the back wall behind open air, which the echo washes over too
    const pg = new T.PlaneGeometry(1, 1);
    pg.translate(0.5, -0.5, -CAVE_DEPTH);
    const back = new T.InstancedMesh(pg, stoneMat(tx.rough, tx.roughGlow, 'world', 0.9, 'stone-back-tint', true), CAVE_POOL);
    // crystals and mushrooms growing on ledges, with soft glows (the camera looks straight on)
    const crystals = new T.InstancedMesh(crystalGeo(), crystalMat(), DECO_POOL);
    const shrooms = new T.InstancedMesh(mushroomGeo(), crystalMat(), DECO_POOL);
    const glows = new T.InstancedMesh(new T.PlaneGeometry(1, 1), glowMatOf(), DECO_POOL);
    // falling-crystal hazards (v.hazards): bright clumps on the play plane, with their own glows
    const hazards = new T.InstancedMesh(crystalGeo(), crystalMat(), HAZ_POOL * 3);
    const hazGlows = new T.InstancedMesh(new T.PlaneGeometry(1, 1), glowMatOf(), HAZ_POOL);
    for (const m of [rock, back, crystals, shrooms, glows, hazards, hazGlows]) {
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(m.count * 3), 3);
      m.instanceColor.setUsage(T.DynamicDrawUsage);
      m.frustumCulled = false;
      sc.add(m);
    }
    const mg = new T.BufferGeometry(), base = new Float32Array(CAVE_MOTES * 4), mr = rng(77);
    for (let k = 0; k < CAVE_MOTES; k++) { base[k * 4] = mr() * 26; base[k * 4 + 1] = mr() * 14; base[k * 4 + 2] = -0.4 - mr() * 1.6; base[k * 4 + 3] = mr() * 6.28; }
    mg.setAttribute('position', new T.BufferAttribute(new Float32Array(CAVE_MOTES * 3), 3).setUsage(T.DynamicDrawUsage));
    const motes = new T.Points(mg, new T.PointsMaterial({ color: 0x9fdcff, size: 0.07, map: softDot(), transparent: true, opacity: 0.6, depthWrite: false, blending: T.AdditiveBlending }));
    motes.frustumCulled = false;
    sc.add(motes);
    const cam = new T.PerspectiveCamera(FOV, 2, 0.1, 100);
    // Co-op Explore's exit: a big cave mouth onto the night sky (v.mouth), with a glow around it
    const mouth = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    const mouthGlow = new T.Mesh(new T.PlaneGeometry(1, 1), glowMatOf());
    mouth.visible = mouthGlow.visible = false;
    sc.add(mouth, mouthGlow);
    cave = { scene: sc, rock, back, crystals, shrooms, glows, hazards, hazGlows, motes, moteBase: base, cam, bat: null, W: 0, H: 0, last: 0,
      hemi: hemiC, mouth, mouthGlow, mouthSrc: null,
      p: new T.Vector3(), q: new T.Quaternion(), e: new T.Euler(), s: new T.Vector3() };
    return true;
  }

  // the same hash for a tile every frame, so ledge decorations never flicker
  const tileHash = (x, y, k = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };

  // v: { W, H, PX, cam: {x, y}, shake: {x, y} (pixels), level: {w, h, grid, lit}, near(x, y) -> 0..1,
  //      moka: {x, y, face, vx, vy, hurt}, clock, wall (echo colour),
  //      theme (optional, an ECHO_ARENAS look: stone, bg, accA, accB, mote, hemi, lava, ice, vein),
  //      mouth (optional: { x, y, r, open, canvas } the exit's cave mouth, painted on canvas) }
  function renderCave(v) {
    if (!caveInit()) return false;
    const { W: w, H: h, PX: px, level: L, clock } = v;
    if (canvas.style.display === 'none') canvas.style.display = '';
    const c = cave;
    if (c.W !== w || c.H !== h) { c.W = w; c.H = h; renderer.setSize(w, h, false); }
    // a cave theme (Co-op Explore's crystal, lava and ice caves) recolours the stone, the light,
    // the crystals and the motes; lava glows along the floors and ice glints on them
    const th = v.theme || null;
    const bg = th ? th.bg : CAVE_BG, echo = rgbOf(v.wall), STONE_C = th ? th.stone : STONE, ACC_A = th ? th.accA : CYAN, ACC_B = th ? th.accB : VIOLET;
    const lava = th ? th.lava || 0 : 0, ice = th ? th.ice || 0 : 0;
    const tkey = th ? th.stone.join() + th.accA.join() : '';
    if (c.tkey !== tkey) {
      c.tkey = tkey;
      if (th) { c.hemi.color.setRGB(...th.hemi[0]); c.hemi.groundColor.setRGB(...th.hemi[1]); c.motes.material.color.setRGB(...th.mote); }
      else { c.hemi.color.setHex(0xb4b8ff); c.hemi.groundColor.setHex(0x2a2260); c.motes.material.color.setHex(0x9fdcff); }
      for (const m of [c.rock.material, c.back.material]) {
        if (!m.userData.tint) continue;
        m.userData.tint.color.value.setRGB(...ACC_A); m.userData.tint.mix.value = th ? th.vein || 0 : 0;
      }
    }
    if (!c.scene.background) c.scene.background = new T.Color();
    c.scene.background.setRGB(bg[0], bg[1], bg[2]);

    // only the tiles near the screen get blocks
    const halfW = w / px / 2 + 4, halfH = h / px / 2 + 4;
    const tx0 = Math.max(0, Math.floor(v.cam.x - halfW)), tx1 = Math.min(L.w - 1, Math.ceil(v.cam.x + halfW));
    const ty0 = Math.max(0, Math.floor(v.cam.y - halfH)), ty1 = Math.min(L.h - 1, Math.ceil(v.cam.y + halfH));
    const solidAt = (x, y) => x < 0 || y < 0 || x >= L.w || y >= L.h || L.grid[y * L.w + x] === 1;
    // stone lit by the echo: mostly its own blue-violet (or the theme's stone), with a wash of the echo colour
    const sr = STONE_C[0] + (echo[0] - STONE_C[0]) * 0.3, sg = STONE_C[1] + (echo[1] - STONE_C[1]) * 0.3, sb = STONE_C[2] + (echo[2] - STONE_C[2]) * 0.3;
    let nr = 0, nb = 0, nc = 0, nm = 0, ng = 0;
    // faint stone starts a touch brighter than the background, so it fades in rather than reading as a shadow
    const b0 = [bg[0] * 1.6, bg[1] * 1.6, bg[2] * 1.6];
    const { p, q, e, s } = c;
    const put = (mesh, n, x, y, z, ry, rz, sx, sy, r, g, b) => {
      p.set(x, y, z); q.setFromEuler(e.set(0, ry, rz)); s.set(sx, sy, sx);
      mesh.setMatrixAt(n, tmpM.compose(p, q, s));
      mesh.setColorAt(n, tmpC.setRGB(r, g, b));
    };
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const k = ty * L.w + tx, solid = L.grid[k] === 1;
        const a = Math.max(L.lit[k], v.near(tx + 0.5, ty + 0.5));
        if (a < 0.02) continue;
        if (solid && nr < CAVE_POOL) {
          tmpM.makeTranslation(tx, -ty, 0); c.rock.setMatrixAt(nr, tmpM);
          const f = Math.min(1, a * 1.1) * 1.7;
          c.rock.setColorAt(nr++, tmpC.setRGB(b0[0] + (sr - b0[0]) * f, b0[1] + (sg - b0[1]) * f, b0[2] + (sb - b0[2]) * f));
          // a few ledges grow mushrooms or crystals, a few ceilings hang crystals
          const hsh = tileHash(tx, ty), up = !solidAt(tx, ty - 1), down = !solidAt(tx, ty + 1);
          const col = tileHash(tx, ty, 3) < 0.55 ? ACC_A : ACC_B, kk = Math.min(1, a * 1.25);
          if (up && lava > 0.02 && tileHash(tx, ty, 7) < 0.16 && ng < DECO_POOL) {
            // lava glowing in a crack along the floor, pulsing
            const p2 = lava * (0.6 + 0.4 * Math.sin(clock * 1.7 + tx * 3.1));
            put(c.glows, ng++, tx + 0.5, -ty + 0.12, 0.05, 0, 0, 1.5, 0.7, 1.0 * p2, 0.38 * p2, 0.06 * p2);
          } else if (up && ice > 0.02 && tileHash(tx, ty, 7) > 0.82 && ng < DECO_POOL) {
            // frost glinting on the floor
            const p2 = ice * 0.45 * Math.max(0, Math.sin(clock * 2.2 + tx * 1.7));
            put(c.glows, ng++, tx + 0.2 + tileHash(tx, ty, 7) * 0.6, -ty + 0.08, 0.05, 0, 0, 0.5, 0.5, 0.85 * p2, 0.95 * p2, p2);
          }
          if (up && hsh < 0.12 && nm < DECO_POOL - 4) {
            const n = 2 + Math.floor(tileHash(tx, ty, 1) * 3);
            for (let j = 0; j < n; j++) {
              const sc = 0.9 + tileHash(tx, ty, 10 + j) * 1.0;
              put(c.shrooms, nm++, tx + 0.2 + tileHash(tx, ty, 20 + j) * 0.6, -ty, -0.25 - tileHash(tx, ty, 30 + j) * 1.4, j, 0, sc, sc, ACC_A[0] * kk, ACC_A[1] * kk, ACC_A[2] * kk);
            }
            if (ng < DECO_POOL) put(c.glows, ng++, tx + 0.5, -ty + 0.2, -0.2, 0, 0, 1.3, 1.3, ACC_A[0] * kk * 0.35, ACC_A[1] * kk * 0.35, ACC_A[2] * kk * 0.35);
          } else if (((up && hsh < 0.2) || (down && hsh > 0.92 && !v.noCeilDecor)) && nc < DECO_POOL - 4) {
            const n = 2 + Math.floor(tileHash(tx, ty, 1) * 3), flip = !(up && hsh < 0.2);
            for (let j = 0; j < n; j++) {
              const hh = (j ? 0.3 + tileHash(tx, ty, 10 + j) * 0.4 : 0.55 + tileHash(tx, ty, 11) * 0.35);
              const tilt = (j - (n - 1) / 2) * 0.35;
              // shards lean apart; on a ceiling they hang upside down
              put(c.crystals, nc++, tx + 0.3 + tileHash(tx, ty, 20 + j) * 0.4, flip ? -ty - 1 : -ty, -0.3 - tileHash(tx, ty, 30 + j) * 1.2,
                tileHash(tx, ty, 50 + j) * 3, flip ? Math.PI + tilt : tilt, 0.8 + tileHash(tx, ty, 40 + j) * 0.6, hh, col[0] * kk, col[1] * kk, col[2] * kk);
            }
            if (ng < DECO_POOL) put(c.glows, ng++, tx + 0.5, flip ? -ty - 1.35 : -ty + 0.35, -0.2, 0, 0, 1.8, 1.8, col[0] * kk * 0.4, col[1] * kk * 0.4, col[2] * kk * 0.4);
          }
        } else if (!solid && nb < CAVE_POOL) {
          tmpM.makeTranslation(tx, -ty, 0); c.back.setMatrixAt(nb, tmpM);
          const f = a * 0.3;
          c.back.setColorAt(nb++, tmpC.setRGB(b0[0] + (sr - b0[0]) * f, b0[1] + (sg - b0[1]) * f, b0[2] + (sb - b0[2]) * f));
        }
      }
    }
    // falling-crystal hazards, v.hazards: [{ x, y (ceiling line, tiles), len, wob (x shake, tiles), a (light 0..1), fall }]
    // each is a clump hanging down from y: one big shard and two small ones, bright cyan.
    // Hidden in the dark like other hazards; once shaking or falling it shines at full brightness.
    let nh = 0, nhg = 0;
    for (const hz of v.hazards || []) {
      const k = hz.fall || hz.wob ? 1 : Math.min(1, (hz.a || 0) * 1.3);
      if (k < 0.02 || nhg >= HAZ_POOL || hz.x < tx0 - 1 || hz.x > tx1 + 2) continue;
      const hx = hz.x + (hz.wob || 0), len = hz.len || 0.7, hr = 0.55 * k, hg = 1.0 * k, hb = 1.0 * k;
      put(c.hazards, nh++, hx, -hz.y, 0.02, 0.4, Math.PI, 1.75, len, hr, hg, hb);
      put(c.hazards, nh++, hx - 0.17, -hz.y, -0.04, 1.1, Math.PI + 0.32, 1.05, len * 0.55, hr, hg, hb);
      put(c.hazards, nh++, hx + 0.16, -hz.y, -0.06, 2.0, Math.PI - 0.3, 1.0, len * 0.48, hr, hg, hb);
      put(c.hazGlows, nhg++, hx, -hz.y - len * 0.45, 0.1, 0, 0, 1.5, 1.5, CYAN[0] * k * 0.55, CYAN[1] * k * 0.55, CYAN[2] * k * 0.55);
    }
    // the cave mouth: the night sky through a round opening just behind the play plane (so rock
    // around it hides its edges and the bats fly in front of it), glowing green once it's open
    const mo = v.mouth;
    c.mouth.visible = c.mouthGlow.visible = !!mo;
    if (mo) {
      if (c.mouthSrc !== mo.canvas) {
        c.mouthSrc = mo.canvas;
        if (c.mouth.material.map) c.mouth.material.map.dispose();
        c.mouth.material.map = new T.CanvasTexture(mo.canvas);
        c.mouth.material.needsUpdate = true;
      }
      const d = mo.r * 2.3;
      c.mouth.position.set(mo.x, -mo.y, -0.35); c.mouth.scale.set(d, d, 1);
      const pulse = 0.6 + 0.4 * Math.sin(clock * 2.6), gc = mo.open ? [0.47, 1.0, 0.67] : [1.0, 0.84, 0.35], gk = (mo.open ? 0.55 : 0.28) * pulse;
      c.mouthGlow.position.set(mo.x, -mo.y, -0.3); c.mouthGlow.scale.set(d * 1.6, d * 1.6, 1);
      c.mouthGlow.material.color.setRGB(gc[0] * gk, gc[1] * gk, gc[2] * gk);
    }
    c.hazards.count = nh; c.hazGlows.count = nhg;
    c.rock.count = nr; c.back.count = nb; c.crystals.count = nc; c.shrooms.count = nm; c.glows.count = ng;
    for (const m of [c.rock, c.back, c.crystals, c.shrooms, c.glows, c.hazards, c.hazGlows]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

    // motes drift in the air, wrapped around the view
    const mp = c.motes.geometry.attributes.position, ma = mp.array, mb = c.moteBase;
    for (let k = 0; k < CAVE_MOTES; k++) {
      const ph = mb[k * 4 + 3];
      const wx = mb[k * 4] + Math.sin(clock * 0.3 + ph) * 0.6, wy = mb[k * 4 + 1] + Math.sin(clock * 0.45 + ph * 2) * 0.4;
      ma[k * 3] = v.cam.x - 13 + ((((wx - v.cam.x + 13) % 26) + 26) % 26);
      ma[k * 3 + 1] = -(v.cam.y - 7 + ((((wy - v.cam.y + 7) % 14) + 14) % 14));
      ma[k * 3 + 2] = mb[k * 4 + 2];
    }
    mp.needsUpdate = true;
    c.motes.material.opacity = 0.45 + 0.2 * Math.sin(clock * 1.3);

    const dt = Math.max(0, Math.min(0.1, clock - c.last)); c.last = clock;
    // Co-op Run (coop.js) passes a whole team instead of Moka: v.bats, each
    // { x, y, vx, face, color, look (EchoLooks look, optional), alpha (0..1), hidden, flap (wing speed) }
    if (v.bats) {
      if (c.bat) c.bat.g.visible = false;
      c.team = c.team || [];
      v.bats.forEach((b, k) => {
        let r = c.team[k];
        if (!r || r.key !== lookKey(b)) { dropRig(r); r = c.team[k] = batRig({ color: b.color, look: b.look }, c.scene); }
        r.g.visible = !b.hidden;
        r.g.position.set(b.x, -b.y, 0.15 + (b.z || 0));
        r.g.scale.setScalar(((v.mokaR || 0.28) / 0.3) * (b.scale ?? 1));
        const wantK = Math.max(-0.7, Math.min(0.7, (b.vx || 0) * 0.15)) + (b.face || 0) * 0.15;
        r.yaw += (wantK - r.yaw) * Math.min(1, dt * 8);
        r.g.rotation.set(0.1, r.yaw, Math.max(-0.3, Math.min(0.3, -(b.vx || 0) * 0.04)));
        const fl = Math.sin(clock * (b.flap || 18) + k);
        r.wings[0].rotation.z = -fl * 0.7; r.wings[1].rotation.z = fl * 0.7;
        r.glow.visible = false; r.shield.visible = !!b.shield && !b.hidden; r.stars.forEach((st) => (st.visible = false));
        if (r.shield.visible) r.shield.rotation.y = clock;
        const al = b.alpha ?? 1;
        rigAlpha(r, al, clock);
      });
      for (let k = v.bats.length; k < c.team.length; k++) c.team[k].g.visible = false;
    } else if (c.team) for (const r of c.team) r.g.visible = false;

    // Moka
    // Moka wears v.mokaLook if the mode passes one, else this device's saved look
    const mokaB = { color: v.mokaColor, look: v.mokaLook || (window.EchoLooks ? window.EchoLooks.mine() : null) };
    if (c.bat && c.bat.key !== lookKey(mokaB)) { dropRig(c.bat); c.bat = null; }
    if (!c.bat) c.bat = batRig(mokaB, c.scene);
    const m = v.moka || { x: -99, y: -99 }, rig = c.bat;
    rig.g.visible = !v.bats && !(m.hurt > 0 && Math.floor(m.hurt * 12) % 2 === 0);
    rig.g.position.set(m.x, -m.y, 0.15);
    rig.g.scale.setScalar(v.mokaR / 0.3);
    const want = Math.max(-0.7, Math.min(0.7, (m.vx || 0) * 0.15)) + (m.face || 0) * 0.15;
    rig.yaw += (want - rig.yaw) * Math.min(1, dt * 8);
    rig.g.rotation.set(0.1, rig.yaw, Math.max(-0.3, Math.min(0.3, -(m.vx || 0) * 0.04)));
    const flap = Math.sin(clock * 18);
    rig.wings[0].rotation.z = -flap * 0.7; rig.wings[1].rotation.z = flap * 0.7;
    rig.glow.visible = false; rig.shield.visible = false; rig.stars.forEach((s) => (s.visible = false));
    rigAlpha(rig, 1, clock);

    // camera: square on to the cave plane so the flat layer lines up, raised a
    // little with a shifted lens so you can see the tops of ledges below you
    const vfov = (FOV * Math.PI) / 180, dist = h / (2 * Math.tan(vfov / 2) * px);
    c.cam.aspect = w / h;
    const up = CAVE_UP;
    c.cam.position.set(v.cam.x - v.shake.x / px, -v.cam.y + up - v.shake.y / -px, dist);
    c.cam.lookAt(c.cam.position.x, c.cam.position.y, 0);
    c.cam.setViewOffset(w, h, 0, up * px, w, h);
    c.cam.updateProjectionMatrix();
    renderer.render(c.scene, c.cam);
    return true;
  }

  window.EchoCave3D = {
    get supported() { return init(); },
    render: renderCave,
    reset() {
      if (cave && cave.bat) { dropRig(cave.bat); cave.bat = null; }
      if (cave && cave.team) { for (const r of cave.team) dropRig(r); cave.team = null; }
    },
    hide() { window.EchoDuel3D?.hide(); },
  };

  window.EchoDuel3D = {
    get supported() { return init(); },
    render, project, hide, reset,
  };
})();
