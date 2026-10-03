// Bat looks: the bat creator, shared by every mode.
//
// A look is a tiny plain object, saved on this device and sent online:
//   { kind, scheme, body, wing, belly, ears, wings, eyes, hat, face, pattern, trail }
// The kind (bat type) sets the body shape and a few touches of its own (a fruit
// bat's snout, a vampire's collar and fangs, a ghost's wispy tail, a crystal's
// facets); every other part can be swapped independently, and every kind can
// wear every accessory. The scheme is a named colour set (body, wing, belly).
//
// EchoLooks.draw2D draws a bat on a 2D canvas (cached per look, wing beat and
// size, so modes can call it every frame), drawTrail2D draws its trail,
// rig3D builds the same bat from three.js primitives for view3d.js,
// preview3D shows a spinnable 3D bat on any canvas, and openEditor opens the
// full-screen "Customize Your Bat" creator, which builds its own DOM and CSS.
(() => {
  'use strict';

  // ---- Options ---------------------------------------------------------------
  const KINDS = [
    { id: 'classic', name: 'Classic', blurb: 'The original cave flyer. Pointy ears, brave heart.' },
    { id: 'fruit', name: 'Fruit bat', blurb: 'Round, fluffy and all eyes. Would do anything for a mango.' },
    { id: 'longear', name: 'Long-eared', blurb: 'Those ears can hear a moth sneeze across the cave.' },
    { id: 'vampire', name: 'Vampire', blurb: 'Swishy cape, tiny fangs, extremely dramatic.' },
    { id: 'ghost', name: 'Ghost', blurb: 'See-through, wispy and a little bit spooky. Boo!' },
    { id: 'crystal', name: 'Crystal', blurb: 'Cut from glowing cave crystal. Sparkles in the dark.' },
  ];
  // named colour schemes: body, wing, belly
  const SCHEMES = [
    ['moonlight', 'Moonlight', '#8b6cff', '#6a4fe0', '#d9c8ff'],
    ['bubblegum', 'Bubblegum', '#ff7ad9', '#d94fb0', '#ffd0ec'],
    ['limefizz', 'Lime Fizz', '#9dff6a', '#56c23a', '#e6ffd0'],
    ['sunset', 'Sunset', '#ffb347', '#ff6a3a', '#ffe6c2'],
    ['frost', 'Frost', '#6ff3ff', '#3aa8ff', '#d6fbff'],
    ['lava', 'Lava', '#ff5468', '#8a1a2a', '#ffd23f'],
    ['lemonade', 'Lemonade', '#ffd23f', '#e0a800', '#fff3a3'],
    ['mint', 'Mint', '#2fd6b0', '#1e9e86', '#c8fff0'],
    ['caramel', 'Caramel', '#e8915a', '#9a5a3a', '#ffe0b8'],
    ['sandstone', 'Sandstone', '#c49a6c', '#6b4a34', '#f5dcc0'],
    ['midnight', 'Midnight', '#4a3a6e', '#2a1838', '#d23a5a'],
    ['ghostly', 'Ghostly', '#dfe8ff', '#b8c8ff', '#ffffff'],
    ['gold', 'Gold', '#ffcf4a', '#b8860b', '#fff1c2'],
    ['ocean', 'Ocean', '#3a7bff', '#1d3fa8', '#9fe8ff'],
    ['cotton', 'Cotton Candy', '#ffb6e6', '#7fd8ff', '#ffffff'],
    ['shadow', 'Shadow', '#3b3a4a', '#1c1b26', '#ff5468'],
    ['toxic', 'Toxic', '#b6ff3a', '#7a2fd6', '#f0ffd0'],
    ['royal', 'Royal', '#6a3fd6', '#ffcf4a', '#f3e8ff'],
    ['coral', 'Coral', '#ff8a7a', '#ff5a8a', '#fff0e6'],
    ['storm', 'Storm', '#7a86a8', '#4a5272', '#dfe6ff'],
  ].map(([id, name, body, wing, belly]) => ({ id, name, body, wing, belly }));
  const opt = (list) => list.map(([id, name]) => ({ id, name }));
  const OPTIONS = {
    kind: KINDS.map(({ id, name }) => ({ id, name })),
    scheme: SCHEMES.map((s) => ({ ...s })),
    ears: opt([['pointy', 'Pointy'], ['round', 'Round'], ['long', 'Long'], ['tufted', 'Tufted'], ['floppy', 'Floppy'], ['tiny', 'Tiny'], ['wide', 'Wide']]),
    wings: opt([['classic', 'Classic'], ['scalloped', 'Scalloped'], ['feathery', 'Feathery'], ['tattered', 'Tattered'], ['dragon', 'Dragon'], ['stubby', 'Stubby'], ['butterfly', 'Butterfly']]),
    eyes: opt([['round', 'Round'], ['sleepy', 'Sleepy'], ['fierce', 'Fierce'], ['sparkly', 'Sparkly'], ['happy', 'Happy'], ['starry', 'Starry'], ['hearts', 'Hearts'], ['wink', 'Wink'], ['googly', 'Googly']]),
    hat: opt([['none', 'No hat'], ['crown', 'Crown'], ['cap', 'Cap'], ['wizard', 'Wizard hat'], ['tophat', 'Top hat'], ['party', 'Party hat'], ['pirate', 'Pirate hat'], ['beanie', 'Beanie'],
      ['bow', 'Bow'], ['headphones', 'Headphones'], ['flower', 'Flower'], ['horns', 'Horns'], ['halo', 'Halo'], ['viking', 'Viking helmet'], ['chef', 'Chef hat'], ['propeller', 'Propeller cap']]),
    face: opt([['none', 'Nothing'], ['glasses', 'Glasses'], ['shades', 'Shades'], ['goggles', 'Goggles'], ['monocle', 'Monocle'], ['mask', 'Hero mask'], ['bandana', 'Bandana'],
      ['mustache', 'Mustache'], ['blush', 'Rosy cheeks'], ['eyepatch', 'Eye patch']]),
    pattern: opt([['none', 'Plain'], ['stripes', 'Stripes'], ['spots', 'Spots'], ['glow', 'Glow'], ['stars', 'Stars'], ['heart', 'Heart'], ['zigzag', 'Zigzag'], ['tips', 'Wing tips']]),
    trail: opt([['none', 'No trail'], ['sparkles', 'Sparkles'], ['hearts', 'Hearts'], ['bubbles', 'Bubbles'], ['notes', 'Music'], ['stars', 'Stars'], ['flames', 'Flames'], ['rainbow', 'Rainbow']]),
  };
  // the creator's rows, in order
  const CATEGORIES = [['kind', 'Bat'], ['scheme', 'Colours'], ['ears', 'Ears'], ['wings', 'Wings'], ['eyes', 'Eyes'], ['hat', 'Hat'], ['face', 'Face'], ['pattern', 'Pattern'], ['trail', 'Trail']]
    .map(([field, name]) => ({ field, name }));
  const PARTS = ['ears', 'wings', 'eyes', 'hat', 'face', 'pattern', 'trail'];
  const IDS = {};
  for (const f in OPTIONS) IDS[f] = OPTIONS[f].map((o) => o.id);
  const SCHEME = Object.fromEntries(SCHEMES.map((s) => [s.id, s]));

  // each kind's own parts and colours (hats, face extras and trails are yours to keep)
  const KIND_DEFAULTS = {
    classic: { scheme: 'moonlight', ears: 'pointy', wings: 'classic', eyes: 'round', pattern: 'none' },
    fruit: { scheme: 'caramel', ears: 'round', wings: 'scalloped', eyes: 'sparkly', pattern: 'none' },
    longear: { scheme: 'sandstone', ears: 'long', wings: 'classic', eyes: 'sleepy', pattern: 'none' },
    vampire: { scheme: 'midnight', ears: 'pointy', wings: 'tattered', eyes: 'fierce', pattern: 'none' },
    ghost: { scheme: 'ghostly', ears: 'round', wings: 'feathery', eyes: 'round', pattern: 'glow' },
    crystal: { scheme: 'frost', ears: 'pointy', wings: 'classic', eyes: 'sparkly', pattern: 'glow' },
  };
  const KIND_HAT = { fruit: 'flower' };
  // the four seats: Mo violet, Ka pink, Ca green, Bo orange
  const PRESETS = [
    { kind: 'classic', scheme: 'moonlight' },
    { kind: 'fruit', scheme: 'bubblegum', hat: 'bow' },
    { kind: 'longear', scheme: 'limefizz' },
    { kind: 'crystal', scheme: 'sunset' },
  ];
  const FIELDS = ['kind', 'scheme', 'body', 'wing', 'belly', 'ears', 'wings', 'eyes', 'hat', 'face', 'pattern', 'trail'];

  function defaults(kind) {
    const d = KIND_DEFAULTS[kind] || KIND_DEFAULTS.classic, s = SCHEME[d.scheme];
    return { kind: KIND_DEFAULTS[kind] ? kind : 'classic', scheme: d.scheme, body: s.body, wing: s.wing, belly: s.belly, ears: d.ears, wings: d.wings, eyes: d.eyes, hat: KIND_HAT[kind] || 'none', face: 'none', pattern: d.pattern, trail: 'none' };
  }
  const HEX = /^#[0-9a-f]{6}$/i;
  // A valid copy of any look. A known scheme sets the colours; scheme 'custom'
  // (or none, as in older saved looks) keeps the look's own colours.
  function clean(look) {
    const l = look && typeof look === 'object' ? look : {};
    const kind = IDS.kind.includes(l.kind) ? l.kind : 'classic';
    const out = defaults(kind);
    for (const f of PARTS) if (IDS[f].includes(l[f])) out[f] = l[f];
    if (SCHEME[l.scheme]) {
      const s = SCHEME[l.scheme];
      Object.assign(out, { scheme: s.id, body: s.body, wing: s.wing, belly: s.belly });
    } else if (HEX.test(l.body || '') || HEX.test(l.wing || '') || HEX.test(l.belly || '')) {
      for (const f of ['body', 'wing', 'belly']) if (HEX.test(l[f] || '')) out[f] = l[f].toLowerCase();
      const m = SCHEMES.find((s) => s.body === out.body && s.wing === out.wing && s.belly === out.belly);
      out.scheme = m ? m.id : 'custom';
    }
    return out;
  }
  function preset(slot) {
    const p = PRESETS[((slot | 0) % 4 + 4) % 4];
    return clean({ ...defaults(p.kind), ...p });
  }
  function rng(seed) {
    let a = (seed | 0) ^ 0x9e3779b9;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // a fun random look; the same seed always gives the same bat
  function random(seed) {
    const r = rng(seed == null ? (Math.random() * 2 ** 31) | 0 : seed * 7919 + 13);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const l = defaults(pick(IDS.kind));
    for (const p of ['ears', 'wings', 'eyes', 'pattern']) if (r() < 0.6) l[p] = pick(IDS[p]);
    if (r() < 0.8) l.scheme = pick(IDS.scheme);
    l.hat = r() < 0.65 ? pick(IDS.hat.slice(1)) : 'none';
    l.face = r() < 0.35 ? pick(IDS.face.slice(1)) : 'none';
    l.trail = r() < 0.35 ? pick(IDS.trail.slice(1)) : 'none';
    return clean(l);
  }
  const sig = (look) => FIELDS.map((f) => look[f]).join('|');
  function key(look) { return look ? sig(look) : ''; }
  // draw2D and rig3D clean every look they get, remembering the last answer per object
  const cleaned = new WeakMap();
  function ready(look) {
    if (!look || typeof look !== 'object') return clean(look);
    const s = sig(look), c = cleaned.get(look);
    if (c && c.s === s) return c.l;
    const l = clean(look);
    cleaned.set(look, { s, l });
    return l;
  }

  const STORE = 'echo-look';
  let mineRaw = null, mineLook = null;
  // this device's look; re-read every call so a save from anywhere shows up at once
  function mine() {
    let raw = null;
    try { raw = localStorage.getItem(STORE); } catch (e) { raw = mineRaw; }
    if (raw !== mineRaw || !mineLook) {
      mineRaw = raw;
      let l = null;
      try { l = raw ? JSON.parse(raw) : null; } catch (e) { l = null; }
      mineLook = l ? clean(l) : preset(0);
    }
    return { ...mineLook };
  }
  function save(look) {
    const l = clean(look);
    mineRaw = JSON.stringify(l); mineLook = l;
    try { localStorage.setItem(STORE, mineRaw); } catch (e) { /* private mode: keep it for this visit */ }
    return { ...l };
  }

  // ---- Colour helpers -----------------------------------------------------------
  const rgbCache = new Map();
  function rgb(hex) {
    let c = rgbCache.get(hex);
    if (!c) { const n = parseInt(hex.slice(1), 16); c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; rgbCache.set(hex, c); }
    return c;
  }
  // k > 0 mixes toward white, k < 0 toward black
  function shade(hex, k, a = 1) {
    const [r, g, b] = rgb(hex), t = k > 0 ? 255 : 0, m = Math.abs(k);
    return `rgba(${Math.round(r + (t - r) * m)},${Math.round(g + (t - g) * m)},${Math.round(b + (t - b) * m)},${a})`;
  }
  function mix(h1, h2, k) {
    const a = rgb(h1), b = rgb(h2);
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)})`;
  }
  const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0');
  function shadeHex(hex, k) {
    const [r, g, b] = rgb(hex), t = k > 0 ? 255 : 0, m = Math.abs(k);
    return '#' + hex2(r + (t - r) * m) + hex2(g + (t - g) * m) + hex2(b + (t - b) * m);
  }
  function mixHex(h1, h2, k) {
    const a = rgb(h1), b = rgb(h2);
    return '#' + hex2(a[0] + (b[0] - a[0]) * k) + hex2(a[1] + (b[1] - a[1]) * k) + hex2(a[2] + (b[2] - a[2]) * k);
  }
  const lum = (hex) => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  // a darker shade on light colours, a lighter one on dark colours
  const contrast = (hex, k, a = 1) => shade(hex, lum(hex) > 0.42 ? -k : k * 1.2, a);
  const near = (h1, h2) => { const a = rgb(h1), b = rgb(h2); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 120; };
  const pickApart = (body, a, b) => (near(body, a) ? b : a);
  const INK = '#1a1030';
  // accessory colours that stand out from the bat
  const ACC = {
    cap: (L) => pickApart(L.body, '#ff5468', '#3aa8ff'),
    bow: (L) => pickApart(L.body, '#ff5fa8', '#ffd23f'),
    neon: (L) => pickApart(L.body, '#4adeff', '#ff7ad9'),
    petal: (L) => pickApart(L.body, '#ffffff', '#ff9ad5'),
    beanie: (L) => pickApart(L.body, '#ff8a3a', '#2fd6b0'),
    party: (L) => pickApart(L.body, '#4adeff', '#ff5fa8'),
    mask: (L) => pickApart(L.body, '#ff3a5c', '#3a7bff'),
    bandana: (L) => pickApart(L.body, '#e8344e', '#3a7bff'),
    ribbon: (L) => pickApart(L.wing, '#e8344e', '#ffcf4a'),
  };

  // ---- Shapes (in units of the body radius) -------------------------------------
  const KIND_SHAPE = {
    classic: { bx: 1, by: 1, eye: 1, wing: 1 },
    fruit: { bx: 1.1, by: 1, eye: 1.28, wing: 0.95 },
    longear: { bx: 0.93, by: 1, eye: 0.96, wing: 1.05 },
    vampire: { bx: 1, by: 1, eye: 1, wing: 1.04 },
    ghost: { bx: 0.96, by: 1, eye: 1.08, wing: 0.96 },
    crystal: { bx: 1.02, by: 1.02, eye: 1, wing: 1 },
  };
  // right wing, at rest, as path segments ['M'|'L', x, y] or ['Q', cx, cy, x, y];
  // bones are drawn from the wrist to each finger tip
  const WINGS = {
    classic: {
      path: [['M', 0.5, -0.3], ['L', 1.35, -0.6], ['L', 2.3, -0.32], ['L', 1.9, 0.25], ['L', 1.68, 0.05], ['L', 1.35, 0.4], ['L', 1.12, 0.17], ['L', 0.82, 0.48], ['L', 0.55, 0.3]],
      wrist: [1.35, -0.6], tips: [[2.3, -0.32], [1.9, 0.25], [1.35, 0.4]],
    },
    scalloped: {
      path: [['M', 0.5, -0.3], ['Q', 0.95, -0.75, 1.4, -0.62], ['Q', 1.9, -0.55, 2.3, -0.3], ['Q', 2.16, 0.0, 2.02, 0.3], ['Q', 1.82, 0.02, 1.58, 0.36],
        ['Q', 1.4, 0.08, 1.15, 0.44], ['Q', 0.98, 0.16, 0.75, 0.48], ['Q', 0.62, 0.32, 0.55, 0.3]],
      wrist: [1.4, -0.62], tips: [[2.3, -0.3], [2.02, 0.3], [1.58, 0.36], [1.15, 0.44]],
    },
    feathery: {
      path: [['M', 0.5, -0.32], ['Q', 1.0, -0.8, 1.6, -0.62], ['Q', 2.25, -0.5, 2.38, -0.18], ['Q', 2.48, 0.2, 2.0, 0.22], ['Q', 2.0, 0.56, 1.55, 0.42],
        ['Q', 1.46, 0.72, 1.08, 0.5], ['Q', 0.9, 0.74, 0.62, 0.42], ['Q', 0.5, 0.2, 0.52, 0.1]],
      wrist: [0.75, -0.25], tips: [[2.0, 0.22], [1.55, 0.42], [1.08, 0.5]], soft: true,
    },
    tattered: {
      path: [['M', 0.5, -0.3], ['L', 1.35, -0.62], ['L', 1.72, -0.52], ['L', 1.82, -0.42], ['L', 1.95, -0.5], ['L', 2.34, -0.36], ['L', 2.1, -0.15], ['L', 2.2, -0.02],
        ['L', 1.98, 0.05], ['L', 2.02, 0.3], ['L', 1.8, 0.12], ['L', 1.72, 0.24], ['L', 1.6, 0.06], ['L', 1.47, 0.34], ['L', 1.38, 0.17], ['L', 1.22, 0.44],
        ['L', 1.08, 0.2], ['L', 0.98, 0.32], ['L', 0.9, 0.16], ['L', 0.78, 0.46], ['L', 0.55, 0.28]],
      wrist: [1.35, -0.62], tips: [[2.34, -0.36], [2.02, 0.3], [1.47, 0.34]],
    },
    dragon: {
      path: [['M', 0.5, -0.3], ['L', 1.15, -0.68], ['L', 1.24, -0.92], ['L', 1.36, -0.7], ['L', 2.46, -0.58], ['L', 2.02, -0.16], ['L', 2.16, 0.12], ['L', 1.72, -0.02],
        ['L', 1.66, 0.34], ['L', 1.32, 0.08], ['L', 1.08, 0.44], ['L', 0.86, 0.18], ['L', 0.55, 0.3]],
      wrist: [1.3, -0.68], tips: [[2.46, -0.58], [2.16, 0.12], [1.66, 0.34], [1.08, 0.44]],
    },
    stubby: {
      path: [['M', 0.5, -0.3], ['Q', 1.0, -0.7, 1.5, -0.45], ['Q', 1.85, -0.22, 1.62, 0.1], ['Q', 1.46, 0.36, 1.2, 0.24], ['Q', 1.02, 0.46, 0.8, 0.34], ['Q', 0.6, 0.42, 0.55, 0.25]],
      wrist: [0.8, -0.3], tips: [[1.62, 0.1], [1.2, 0.24]], soft: true,
    },
    butterfly: {
      path: [['M', 0.5, -0.3], ['Q', 1.1, -1.1, 2.0, -0.92], ['Q', 2.55, -0.62, 2.06, -0.1], ['Q', 2.4, 0.3, 1.86, 0.56], ['Q', 1.25, 0.78, 0.92, 0.36], ['Q', 0.66, 0.38, 0.55, 0.25]],
      wrist: [0.7, -0.2], tips: [[2.0, -0.6], [2.06, -0.1], [1.7, 0.4]], soft: true,
    },
  };

  // where a wing point lands for a kind and a wing lift (-1 down .. 1 up)
  function wingPoint(kind, x, y, lift) {
    const S = KIND_SHAPE[kind];
    let x1 = 0.5 + (x - 0.5) * S.wing, y1 = y;
    if (kind === 'vampire') y1 = y * 1.35 + (x - 0.5) * 0.14; // drapes down like a cape
    const u = Math.max(0, Math.min(1, (x1 - 0.5) / 1.85));
    return [0.5 + (x1 - 0.5) * (1 - 0.12 * Math.abs(lift) * u), y1 - lift * u];
  }
  function wingPath(g, kind, type, lift, s) {
    const W = WINGS[type], facet = kind === 'crystal';
    g.beginPath();
    for (const seg of W.path) {
      if (seg[0] === 'Q') {
        const c = wingPoint(kind, seg[1], seg[2], lift), p = wingPoint(kind, seg[3], seg[4], lift);
        if (facet) { g.lineTo(s * c[0], c[1]); g.lineTo(s * p[0], p[1]); } else g.quadraticCurveTo(s * c[0], c[1], s * p[0], p[1]);
      } else {
        const p = wingPoint(kind, seg[1], seg[2], lift);
        if (seg[0] === 'M') g.moveTo(s * p[0], p[1]); else g.lineTo(s * p[0], p[1]);
      }
    }
    g.closePath();
  }

  function bodyPath(g, L, phase) {
    const S = KIND_SHAPE[L.kind];
    g.beginPath();
    if (L.kind === 'crystal') {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8, rr = k % 2 ? 1.04 : 0.98;
        const x = Math.cos(a) * rr * S.bx, y = Math.sin(a) * rr * S.by;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
    } else if (L.kind === 'ghost') {
      // a round head flowing into three wisps that sway with the wing beat
      const sw = Math.sin(phase * Math.PI * 2) * 0.1;
      g.moveTo(S.bx, 0.05);
      g.arc(0, 0.05, S.bx, 0, Math.PI, true);
      g.quadraticCurveTo(-S.bx, 0.75, -0.66 + sw, 1.38);
      g.quadraticCurveTo(-0.45, 0.9, -0.3, 0.98);
      g.quadraticCurveTo(-0.1 + sw, 1.1, 0 + sw, 1.48);
      g.quadraticCurveTo(0.1, 1.05, 0.3, 0.98);
      g.quadraticCurveTo(0.45, 0.9, 0.66 + sw, 1.38);
      g.quadraticCurveTo(S.bx, 0.75, S.bx, 0.05);
      g.closePath();
    } else {
      g.ellipse(0, 0, S.bx, S.by, 0, 0, Math.PI * 2);
    }
  }

  // one ear (s = -1 left, 1 right); inner = the smaller inside of the ear
  function earPath(g, L, s, inner) {
    const ex = KIND_SHAPE[L.kind].bx;
    g.beginPath();
    switch (L.ears) {
      case 'round':
        g.ellipse(s * 0.56 * ex, inner ? -0.9 : -0.88, inner ? 0.17 : 0.31, inner ? 0.2 : 0.35, s * 0.5, 0, Math.PI * 2); break;
      case 'long':
        if (!inner) { g.moveTo(s * 0.1 * ex, -0.72); g.quadraticCurveTo(s * 0.12 * ex, -1.62, s * 0.44 * ex, -2.02); g.quadraticCurveTo(s * 0.76 * ex, -1.55, s * 0.68 * ex, -0.6); }
        else { g.moveTo(s * 0.28 * ex, -0.86); g.quadraticCurveTo(s * 0.28 * ex, -1.5, s * 0.44 * ex, -1.8); g.quadraticCurveTo(s * 0.6 * ex, -1.45, s * 0.55 * ex, -0.82); }
        break;
      case 'floppy':
        if (!inner) { g.moveTo(s * 0.22 * ex, -0.88); g.quadraticCurveTo(s * 0.85 * ex, -1.3, s * 1.2 * ex, -0.62); g.quadraticCurveTo(s * 1.08 * ex, -0.42, s * 0.78 * ex, -0.52); }
        else { g.moveTo(s * 0.4 * ex, -0.86); g.quadraticCurveTo(s * 0.86 * ex, -1.12, s * 1.06 * ex, -0.64); g.quadraticCurveTo(s * 0.92 * ex, -0.56, s * 0.74 * ex, -0.62); }
        break;
      case 'tiny':
        if (!inner) { g.moveTo(s * 0.2 * ex, -0.86); g.lineTo(s * 0.42 * ex, -1.2); g.lineTo(s * 0.6 * ex, -0.74); }
        else { g.moveTo(s * 0.32 * ex, -0.9); g.lineTo(s * 0.42 * ex, -1.08); g.lineTo(s * 0.52 * ex, -0.84); }
        break;
      case 'wide':
        if (!inner) { g.moveTo(s * 0.15 * ex, -0.82); g.quadraticCurveTo(s * 0.5 * ex, -1.2, s * 1.18 * ex, -1.4); g.quadraticCurveTo(s * 1.0 * ex, -0.8, s * 0.88 * ex, -0.4); }
        else { g.moveTo(s * 0.36 * ex, -0.82); g.quadraticCurveTo(s * 0.6 * ex, -1.08, s * 1.0 * ex, -1.22); g.quadraticCurveTo(s * 0.86 * ex, -0.82, s * 0.8 * ex, -0.56); }
        break;
      default: // pointy and tufted
        if (!inner) { g.moveTo(s * 0.12 * ex, -0.76); g.lineTo(s * 0.45 * ex, -1.38); g.lineTo(s * 0.8 * ex, -0.48); }
        else { g.moveTo(s * 0.3 * ex, -0.82); g.lineTo(s * 0.46 * ex, -1.16); g.lineTo(s * 0.63 * ex, -0.66); }
    }
    g.closePath();
  }

  function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  function star(g, x, y, r, rot = 0) {
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + rot + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  }
  function heart(g, x, y, r) {
    g.beginPath();
    g.moveTo(x, y + r * 0.9);
    g.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.65, y - r * 1.15, x, y - r * 0.4);
    g.bezierCurveTo(x + r * 0.65, y - r * 1.15, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
    g.fill();
  }
  function sparkle(g, x, y, r) {
    g.beginPath();
    g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r); g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r);
    g.fill();
  }

  // ---- The 2D bat ------------------------------------------------------------------
  // Draws look L centred at the origin with body radius 1. px: device pixels per
  // unit (for blur sizes and hairlines). phase: wing beat 0..1. eyesState: 0 open,
  // 1 closed, 2 stunned. The eyes look a little toward +x (the face direction).
  function drawBat(g, L, phase, eyesState, px) {
    const S = KIND_SHAPE[L.kind], lift = Math.sin(phase * Math.PI * 2);
    const ghost = L.kind === 'ghost', crystal = L.kind === 'crystal', glow = L.pattern === 'glow';
    const hair = Math.max(0.045, 1 / px), lx = 0.1;
    const glowCol = shade(L.wing, 0.35);
    g.lineJoin = 'round'; g.lineCap = 'round';

    // halo behind glowing and ghostly bats
    if (glow || ghost) {
      const h = g.createRadialGradient(0, 0.1, 0.2, 0, 0.1, glow ? 2.1 : 1.7);
      h.addColorStop(0, ghost && !glow ? 'rgba(220,235,255,0.32)' : shade(L.wing, 0.3, 0.42));
      h.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = h;
      g.beginPath(); g.arc(0, 0.1, glow ? 2.1 : 1.7, 0, Math.PI * 2); g.fill();
    }
    // the back half of a halo floats behind the head
    if (L.hat === 'halo') drawHalo(g, L, true);

    // a vampire's high collar, behind the head
    if (L.kind === 'vampire') {
      for (const s of [-1, 1]) {
        g.fillStyle = shade(L.wing, 0.08);
        g.beginPath(); g.moveTo(s * 0.15, -0.55); g.lineTo(s * 1.18, -1.22); g.quadraticCurveTo(s * 1.0, -0.6, s * 0.95, 0.05); g.closePath(); g.fill();
        g.fillStyle = L.belly;
        g.beginPath(); g.moveTo(s * 0.3, -0.55); g.lineTo(s * 1.02, -1.0); g.quadraticCurveTo(s * 0.88, -0.55, s * 0.84, -0.05); g.closePath(); g.fill();
      }
    }

    // wings
    const W = WINGS[L.wings];
    g.save();
    if (ghost) g.globalAlpha *= 0.68;
    for (const s of [-1, 1]) {
      wingPath(g, L.kind, L.wings, lift, s);
      const tip = wingPoint(L.kind, 2.3, -0.3, lift);
      const grad = g.createLinearGradient(s * 0.5, 0, s * tip[0], tip[1]);
      grad.addColorStop(0, shade(L.wing, -0.18)); grad.addColorStop(0.6, L.wing); grad.addColorStop(1, shade(L.wing, 0.14));
      g.fillStyle = grad;
      if (glow) { g.shadowColor = glowCol; g.shadowBlur = 0.35 * px; }
      g.fill();
      g.shadowBlur = 0;
      if (L.kind === 'vampire' || L.pattern === 'tips') {
        g.save(); g.clip();
        if (L.pattern === 'tips') { g.fillStyle = L.belly; g.fillRect(s > 0 ? 1.62 : -3, -2, 1.38, 4); }
        if (L.kind === 'vampire') { wingPath(g, L.kind, L.wings, lift, s); g.strokeStyle = L.belly; g.lineWidth = 0.16; g.stroke(); }
        g.restore();
        wingPath(g, L.kind, L.wings, lift, s);
      }
      g.strokeStyle = glow ? glowCol : (ghost ? 'rgba(235,242,255,0.7)' : shade(L.wing, -0.5, 0.6));
      g.lineWidth = glow ? 0.07 : 0.055; g.stroke();
      // bones (or feather lines) from the wrist out to the finger tips
      const wr = wingPoint(L.kind, W.wrist[0], W.wrist[1], lift);
      g.strokeStyle = crystal || glow ? shade(L.wing, 0.5, 0.75) : W.soft ? shade(L.wing, 0.22, 0.6) : shade(L.wing, -0.42, 0.7);
      g.lineWidth = L.pattern === 'stripes' ? 0.1 : Math.max(hair, 0.05);
      g.beginPath();
      if (!W.soft) { const sh = wingPoint(L.kind, 0.5, -0.3, lift); g.moveTo(s * sh[0], sh[1]); g.lineTo(s * wr[0], wr[1]); }
      for (const t of W.tips) { const p = wingPoint(L.kind, t[0], t[1], lift); g.moveTo(s * wr[0], wr[1]); g.lineTo(s * (wr[0] + (p[0] - wr[0]) * 0.92), wr[1] + (p[1] - wr[1]) * 0.92); }
      g.stroke();
      if (L.pattern === 'spots' || L.pattern === 'stars') {
        g.fillStyle = L.pattern === 'stars' ? '#fff3a3' : contrast(L.wing, 0.38);
        for (const [x, y, r] of [[1.15, -0.22, 0.12], [1.68, -0.28, 0.09], [0.9, 0.12, 0.08]]) {
          const p = wingPoint(L.kind, x, y, lift);
          if (L.pattern === 'stars') star(g, s * p[0], p[1], r * 1.2); else circle(g, s * p[0], p[1], r);
        }
      }
    }
    g.restore();

    // ears (their bases tuck under the head)
    g.save();
    if (ghost) g.globalAlpha *= 0.85;
    const inner = mix(L.belly, L.body, 0.25), earLine = ghost ? 'rgba(235,242,255,0.7)' : shade(L.body, -0.5, 0.55);
    for (const s of [-1, 1]) {
      earPath(g, L, s, false); g.fillStyle = L.body; g.fill();
      g.strokeStyle = earLine; g.lineWidth = 0.06; g.stroke();
      if (L.pattern === 'tips') { g.save(); g.clip(); g.fillStyle = L.belly; g.fillRect(-2, -2.3, 4, 1.0); g.restore(); }
      earPath(g, L, s, true); g.fillStyle = inner; g.fill();
    }
    if (L.ears === 'tufted') {
      // a fluffy flame of fur growing out of each ear tip
      g.fillStyle = mix(L.belly, '#ffffff', 0.2);
      g.strokeStyle = shade(L.body, -0.5, 0.5); g.lineWidth = 0.04;
      for (const s of [-1, 1]) {
        const tx = s * 0.45 * S.bx, ty = -1.2;
        g.beginPath();
        g.moveTo(tx - s * 0.13, ty + 0.2);
        g.lineTo(tx - s * 0.24, ty - 0.24); g.lineTo(tx - s * 0.05, ty - 0.1);
        g.lineTo(tx + s * 0.02, ty - 0.4); g.lineTo(tx + s * 0.11, ty - 0.1);
        g.lineTo(tx + s * 0.3, ty - 0.22); g.lineTo(tx + s * 0.18, ty + 0.22);
        g.closePath(); g.fill(); g.stroke();
      }
    }
    g.restore();

    // body
    g.save();
    if (ghost) g.globalAlpha *= 0.84;
    bodyPath(g, L, phase);
    const bg = g.createRadialGradient(-0.35, -0.45, 0.08, 0, 0, 1.3 * S.bx);
    bg.addColorStop(0, shade(L.body, 0.28)); bg.addColorStop(0.55, L.body); bg.addColorStop(1, shade(L.body, -0.2));
    g.fillStyle = bg;
    if (glow) { g.shadowColor = glowCol; g.shadowBlur = 0.5 * px; }
    g.fill();
    g.shadowBlur = 0;
    g.save();
    g.clip();
    // belly
    g.fillStyle = L.belly;
    g.beginPath(); g.ellipse(0, ghost ? 0.62 : 0.5, 0.56 * S.bx, ghost ? 0.62 : 0.44, 0, 0, Math.PI * 2); g.fill();
    const pc = contrast(L.body, 0.34);
    switch (L.pattern) {
      case 'stripes':
        g.fillStyle = pc;
        for (const i of [-1, 0, 1]) {
          g.beginPath();
          g.moveTo(i * 0.3 - 0.07, -1.1); g.lineTo(i * 0.3 + 0.07, -1.1); g.lineTo(i * 0.22, -0.62 + Math.abs(i) * 0.1); g.closePath(); g.fill();
        }
        for (const s of [-1, 1]) for (const y of [-0.05, 0.22]) {
          g.beginPath(); g.moveTo(s * 1.1, y - 0.07); g.lineTo(s * 1.1, y + 0.07); g.lineTo(s * 0.68, y + 0.02); g.closePath(); g.fill();
        }
        break;
      case 'spots':
        g.fillStyle = pc;
        for (const [x, y, r] of [[-0.6, -0.58, 0.15], [0.66, -0.46, 0.11], [-0.86, 0.28, 0.13], [0.84, 0.3, 0.16], [0.05, -0.82, 0.1], [-0.25, 0.86, 0.1], [0.42, 0.78, 0.09]]) circle(g, x, y, r);
        break;
      case 'stars':
        g.fillStyle = lum(L.body) > 0.6 ? pc : '#fff3a3';
        for (const [x, y, r, a] of [[-0.6, -0.6, 0.14, 0.2], [0.66, -0.5, 0.11, -0.3], [-0.86, 0.26, 0.1, 0.5], [0.84, 0.32, 0.13, 0.1], [0.02, -0.84, 0.09, 0]]) star(g, x, y, r, a);
        break;
      case 'heart':
        g.fillStyle = pickApart(L.belly, '#ff5a8a', '#e8344e');
        heart(g, 0, 0.6, 0.24);
        break;
      case 'zigzag': {
        g.strokeStyle = pc; g.lineWidth = 0.13; g.lineJoin = 'miter';
        g.beginPath();
        for (let k = 0; k <= 8; k++) { const x = -1.1 + k * 0.275, y = -0.62 + (k % 2 ? -0.13 : 0.08); if (k) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke(); g.lineJoin = 'round';
        break;
      }
      case 'glow': {
        const ig = g.createRadialGradient(0, 0.15, 0.05, 0, 0.15, 1);
        ig.addColorStop(0, 'rgba(255,255,255,0.4)'); ig.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = ig; g.fillRect(-1.2, -1.2, 2.4, 2.8);
        break;
      }
    }
    if (crystal) {
      // a cut gem: a flat table in the middle, eight facets around it, lit from the top left
      const out = [], inn = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
        out.push([Math.cos(a) * 1.1 * S.bx, Math.sin(a) * 1.1 * S.by]);
        inn.push([-0.06 + Math.cos(a) * 0.52, -0.12 + Math.sin(a) * 0.5]);
      }
      for (let k = 0; k < 8; k++) {
        const j = (k + 1) % 8, mid = ((k + 0.5) / 8) * Math.PI * 2 + Math.PI / 8;
        const lit = Math.cos(mid + Math.PI * 0.75);
        g.fillStyle = lit > 0 ? `rgba(255,255,255,${0.26 * lit})` : `rgba(10,20,70,${-0.2 * lit})`;
        g.beginPath(); g.moveTo(...inn[k]); g.lineTo(...out[k]); g.lineTo(...out[j]); g.lineTo(...inn[j]); g.closePath(); g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.beginPath(); inn.forEach((p, k) => (k ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = Math.max(hair, 0.03);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = ghost ? 'rgba(240,246,255,0.8)' : glow ? glowCol : shade(L.body, -0.5, 0.55);
    g.lineWidth = 0.07; g.stroke();
    g.restore();
    if (crystal) { g.fillStyle = 'rgba(255,255,255,0.95)'; sparkle(g, -0.48, -0.5, 0.16); }

    // face
    if (L.kind === 'fruit') {
      g.fillStyle = mix(L.belly, L.body, 0.35);
      g.beginPath(); g.ellipse(lx * 0.5, 0.26, 0.3, 0.2, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = INK;
      g.beginPath(); g.ellipse(lx * 0.6, 0.16, 0.08, 0.05, 0, 0, Math.PI * 2); g.fill();
    }
    const my = L.kind === 'fruit' ? 0.24 : 0.2;
    g.strokeStyle = shade(L.body, -0.7, 0.9); g.lineWidth = Math.max(hair, 0.055);
    g.beginPath(); g.arc(lx * 0.6, my, 0.13, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    if (L.kind === 'vampire') {
      g.fillStyle = '#ffffff';
      for (const s of [-1, 1]) {
        const fx = lx * 0.6 + s * 0.09, fy = my + 0.1;
        g.beginPath(); g.moveTo(fx - 0.045, fy); g.lineTo(fx + 0.045, fy); g.lineTo(fx, fy + 0.13); g.closePath(); g.fill();
      }
    }
    if (L.face === 'mask' || L.face === 'blush') drawFace(g, L, lx, hair);
    drawEyes(g, L, eyesState, lx, hair);
    if (L.face !== 'none' && L.face !== 'mask' && L.face !== 'blush') drawFace(g, L, lx, hair);
    drawHat(g, L, px, phase);
  }

  function eyeGeom(L) {
    const S = KIND_SHAPE[L.kind], big = L.eyes === 'sparkly' ? 1.14 : L.eyes === 'googly' ? 1.22 : 1;
    return { e: 0.22 * S.eye * big, ey: -0.12, ex: 0.34 * Math.max(1, S.eye * 0.95) };
  }
  function drawEyes(g, L, state, lx, hair) {
    const { e, ey, ex } = eyeGeom(L);
    for (const s of [-1, 1]) {
      const cx = s * ex + lx, cy = ey;
      if (state === 2) {
        // stunned: dizzy X eyes, outlined so they read on any colour
        const k = e * 0.62;
        for (const [col, w] of [[INK, 0.13], ['#ffffff', 0.065]]) {
          g.strokeStyle = col; g.lineWidth = w;
          g.beginPath(); g.moveTo(cx - k, cy - k); g.lineTo(cx + k, cy + k); g.moveTo(cx + k, cy - k); g.lineTo(cx - k, cy + k); g.stroke();
        }
        continue;
      }
      const happy = L.eyes === 'happy' || (L.eyes === 'wink' && s < 0);
      if (state === 1 || happy) {
        g.strokeStyle = INK; g.lineWidth = Math.max(hair, 0.075);
        g.beginPath();
        if (happy && state !== 1) g.arc(cx, cy + e * 0.45, e * 0.72, 1.15 * Math.PI, 1.85 * Math.PI);
        else g.arc(cx, cy - e * 0.3, e * 0.7, 0.18 * Math.PI, 0.82 * Math.PI);
        g.stroke();
        continue;
      }
      g.fillStyle = '#ffffff';
      circle(g, cx, cy, e);
      switch (L.eyes) {
        case 'sleepy':
          g.fillStyle = INK; circle(g, cx + lx * 0.5, cy + e * 0.3, e * 0.46);
          g.fillStyle = shade(L.body, -0.12);
          g.beginPath(); g.arc(cx, cy, e * 1.06, Math.PI * 1.02, Math.PI * 1.98); g.lineTo(cx + e * 1.06, cy + e * 0.08); g.lineTo(cx - e * 1.06, cy + e * 0.08); g.closePath(); g.fill();
          g.strokeStyle = INK; g.lineWidth = Math.max(hair, 0.05);
          g.beginPath(); g.moveTo(cx - e * 1.02, cy + e * 0.08); g.lineTo(cx + e * 1.02, cy + e * 0.08); g.stroke();
          break;
        case 'fierce':
          g.fillStyle = INK; circle(g, cx + lx * 0.5 - s * e * 0.12, cy + e * 0.15, e * 0.42);
          // the brow slants down toward the middle
          g.fillStyle = shade(L.body, -0.08);
          g.beginPath(); g.moveTo(cx - s * e * 1.4, cy + e * 0.05); g.lineTo(cx + s * e * 1.4, cy - e * 1.05); g.lineTo(cx + s * e * 1.4, cy - e * 1.6); g.lineTo(cx - s * e * 1.4, cy - e * 1.6); g.closePath(); g.fill();
          g.strokeStyle = INK; g.lineWidth = Math.max(hair, 0.075);
          g.beginPath(); g.moveTo(cx - s * e * 1.15, cy - e * 0.1); g.lineTo(cx + s * e * 1.1, cy - e * 0.95); g.stroke();
          break;
        case 'sparkly':
          g.fillStyle = '#2a1650'; circle(g, cx + lx * 0.4, cy + e * 0.08, e * 0.66);
          g.fillStyle = '#ffffff'; circle(g, cx + lx * 0.4 - e * 0.26, cy - e * 0.22, e * 0.27); circle(g, cx + lx * 0.4 + e * 0.24, cy + e * 0.3, e * 0.12);
          break;
        case 'starry':
          g.fillStyle = '#2a1650'; star(g, cx + lx * 0.5, cy + e * 0.08, e * 0.72);
          g.fillStyle = '#ffffff'; circle(g, cx + lx * 0.5 - e * 0.3, cy - e * 0.3, e * 0.16);
          break;
        case 'hearts':
          g.fillStyle = '#ff3a6a'; heart(g, cx + lx * 0.5, cy + e * 0.1, e * 0.62);
          g.fillStyle = '#ffffff'; circle(g, cx + lx * 0.5 - e * 0.28, cy - e * 0.18, e * 0.13);
          break;
        case 'googly':
          g.strokeStyle = INK; g.lineWidth = Math.max(hair, 0.045);
          g.beginPath(); g.arc(cx, cy, e, 0, Math.PI * 2); g.stroke();
          g.fillStyle = INK; circle(g, cx + (s < 0 ? -e * 0.42 : e * 0.38), cy + (s < 0 ? e * 0.45 : -e * 0.3), e * 0.36);
          break;
        default: // round, and the open eye of a wink
          g.fillStyle = INK; circle(g, cx + lx * 0.6, cy + e * 0.08, e * 0.48);
          g.fillStyle = '#ffffff'; circle(g, cx + lx * 0.6 - e * 0.18, cy - e * 0.12, e * 0.17);
      }
    }
  }

  // face extras (the mask and cheeks are drawn before the eyes, the rest after)
  function drawFace(g, L, lx, hair) {
    const { e, ey, ex } = eyeGeom(L), bx = KIND_SHAPE[L.kind].bx;
    const rim = Math.max(e * 1.32, 0.27);
    switch (L.face) {
      case 'blush':
        g.fillStyle = 'rgba(255,110,150,0.55)';
        for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * (ex + 0.12) + lx, ey + e + 0.12, 0.16, 0.09, 0, 0, Math.PI * 2); g.fill(); }
        break;
      case 'mask': {
        const col = ACC.mask(L);
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(-bx * 1.0, ey - 0.06);
        g.quadraticCurveTo(-ex, ey - rim * 1.45, lx, ey - 0.18);
        g.quadraticCurveTo(ex, ey - rim * 1.45, bx * 1.0, ey - 0.06);
        g.lineTo(bx * 1.06, ey + 0.04);
        g.quadraticCurveTo(ex + 0.1, ey + rim * 1.3, lx, ey + 0.1);
        g.quadraticCurveTo(-ex - 0.1, ey + rim * 1.3, -bx * 1.06, ey + 0.04);
        g.closePath(); g.fill();
        g.strokeStyle = shade(col, -0.45); g.lineWidth = hair; g.stroke();
        // ribbon tails
        g.beginPath(); g.moveTo(-bx * 0.98, ey); g.lineTo(-bx * 1.3, ey - 0.12); g.lineTo(-bx * 1.26, ey + 0.1); g.closePath(); g.fill();
        break;
      }
      case 'glasses':
      case 'monocle':
      case 'goggles': {
        const gog = L.face === 'goggles', mono = L.face === 'monocle';
        if (gog) {
          g.strokeStyle = '#3a3448'; g.lineWidth = 0.12;
          g.beginPath(); g.moveTo(-bx * 1.02, ey - 0.05); g.lineTo(bx * 1.02, ey - 0.05); g.stroke();
        }
        for (const s of mono ? [1] : [-1, 1]) {
          const cx = s * ex + lx;
          if (gog) { g.fillStyle = 'rgba(120,230,255,0.35)'; circle(g, cx, ey, rim); }
          g.strokeStyle = gog ? '#6a6480' : mono ? '#e0a800' : '#2a2440';
          g.lineWidth = gog ? 0.12 : 0.065;
          g.beginPath(); g.arc(cx, ey, rim, 0, Math.PI * 2); g.stroke();
          g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 0.04;
          g.beginPath(); g.arc(cx, ey, rim * 0.72, Math.PI * 1.1, Math.PI * 1.4); g.stroke();
        }
        if (mono) {
          g.strokeStyle = '#e0a800'; g.lineWidth = 0.03;
          g.beginPath(); g.moveTo(ex + lx + rim * 0.7, ey + rim * 0.7); g.quadraticCurveTo(ex + 0.4, 0.45, ex + 0.1, 0.62); g.stroke();
        } else {
          g.strokeStyle = gog ? '#6a6480' : '#2a2440'; g.lineWidth = gog ? 0.09 : 0.06;
          g.beginPath(); g.moveTo(-ex + lx + rim, ey); g.quadraticCurveTo(lx, ey - 0.08, ex + lx - rim, ey); g.stroke();
        }
        break;
      }
      case 'shades':
        g.fillStyle = '#16121f';
        for (const s of [-1, 1]) {
          const cx = s * ex + lx;
          g.beginPath(); g.moveTo(cx - rim, ey - rim * 0.7); g.lineTo(cx + rim, ey - rim * 0.7); g.quadraticCurveTo(cx + rim, ey + rim * 0.95, cx, ey + rim * 0.85); g.quadraticCurveTo(cx - rim, ey + rim * 0.95, cx - rim, ey - rim * 0.7); g.fill();
        }
        g.strokeStyle = '#16121f'; g.lineWidth = 0.07;
        g.beginPath(); g.moveTo(-bx, ey - rim * 0.55); g.lineTo(bx, ey - rim * 0.55); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 0.035;
        for (const s of [-1, 1]) { const cx = s * ex + lx; g.beginPath(); g.moveTo(cx - rim * 0.6, ey - rim * 0.35); g.lineTo(cx - rim * 0.2, ey - rim * 0.35); g.stroke(); }
        break;
      case 'eyepatch': {
        const cx = -ex + lx;
        g.strokeStyle = '#16121f'; g.lineWidth = 0.05;
        g.beginPath(); g.moveTo(-bx * 0.95, ey - 0.42); g.lineTo(bx * 0.9, ey + 0.32); g.stroke();
        g.fillStyle = '#16121f';
        g.beginPath(); g.ellipse(cx, ey + 0.02, rim * 0.95, rim * 0.85, 0.3, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'bandana': {
        const col = ACC.bandana(L), y0 = 0.02;
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(-bx * 0.98, y0); g.quadraticCurveTo(0, y0 + 0.12, bx * 0.98, y0);
        g.quadraticCurveTo(bx * 0.6, 0.55, lx * 0.6, 0.78); g.quadraticCurveTo(-bx * 0.6, 0.55, -bx * 0.98, y0);
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.85)';
        for (const [x, y] of [[-0.45, 0.2], [0.45, 0.2], [0, 0.32], [-0.2, 0.52], [0.24, 0.5], [0.0, 0.66]]) circle(g, x, y, 0.035);
        break;
      }
      case 'mustache': {
        g.fillStyle = '#4a2a1a';
        for (const s of [-1, 1]) {
          const x = lx * 0.6;
          g.beginPath(); g.moveTo(x, 0.1);
          g.quadraticCurveTo(x + s * 0.2, 0.0, x + s * 0.36, 0.12);
          g.quadraticCurveTo(x + s * 0.46, 0.18, x + s * 0.44, 0.04);
          g.quadraticCurveTo(x + s * 0.5, 0.24, x + s * 0.3, 0.24);
          g.quadraticCurveTo(x + s * 0.12, 0.24, x, 0.16);
          g.closePath(); g.fill();
        }
        break;
      }
    }
  }

  function drawHalo(g, L, back) {
    const top = -KIND_SHAPE[L.kind].by;
    g.strokeStyle = back ? 'rgba(255,230,120,0.45)' : '#ffe278'; g.lineWidth = back ? 0.2 : 0.09;
    g.beginPath(); g.ellipse(0, top - 0.42, 0.5, 0.14, 0, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI); g.stroke();
    if (back) { g.strokeStyle = '#ffe278'; g.lineWidth = 0.09; g.stroke(); }
  }

  function drawHat(g, L, px, phase) {
    const top = -KIND_SHAPE[L.kind].by, bx = KIND_SHAPE[L.kind].bx, hair = Math.max(0.04, 1 / px);
    const dome = (col, y, r) => {
      g.fillStyle = col;
      g.beginPath(); g.arc(0, y, r, Math.PI, 0); g.closePath(); g.fill();
      g.strokeStyle = shade(col, -0.45); g.lineWidth = hair * 1.2; g.stroke();
    };
    switch (L.hat) {
      case 'crown': {
        const y = top + 0.12;
        g.fillStyle = '#ffd23f'; g.strokeStyle = '#a8740d'; g.lineWidth = hair * 1.4;
        g.beginPath();
        g.moveTo(-0.44, y); g.lineTo(-0.48, y - 0.42); g.lineTo(-0.24, y - 0.2); g.lineTo(0, y - 0.52); g.lineTo(0.24, y - 0.2); g.lineTo(0.48, y - 0.42); g.lineTo(0.44, y);
        g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#ff5468'; circle(g, 0, y - 0.12, 0.07);
        g.fillStyle = '#4adeff'; circle(g, -0.27, y - 0.08, 0.05); circle(g, 0.27, y - 0.08, 0.05);
        g.fillStyle = '#fff6c8'; circle(g, -0.48, y - 0.44, 0.05); circle(g, 0, y - 0.54, 0.05); circle(g, 0.48, y - 0.44, 0.05);
        break;
      }
      case 'cap': {
        const col = ACC.cap(L), y = top + 0.32;
        g.fillStyle = shade(col, -0.15);
        g.beginPath(); g.ellipse(0.42, y, 0.5, 0.11, -0.08, 0, Math.PI * 2); g.fill();
        dome(col, y, 0.6);
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath(); g.arc(0, y, 0.6, Math.PI * 1.35, Math.PI * 1.65); g.lineTo(0, y); g.closePath(); g.fill();
        g.fillStyle = shade(col, -0.2); circle(g, 0, y - 0.6, 0.07);
        break;
      }
      case 'propeller': {
        const y = top + 0.32;
        dome('#ffd23f', y, 0.58);
        g.save(); g.beginPath(); g.arc(0, y, 0.58, Math.PI, 0); g.closePath(); g.clip();
        g.fillStyle = '#ff5468'; g.beginPath(); g.moveTo(0, y); g.arc(0, y, 0.6, Math.PI, Math.PI * 1.33); g.fill();
        g.fillStyle = '#3a7bff'; g.beginPath(); g.moveTo(0, y); g.arc(0, y, 0.6, Math.PI * 1.66, Math.PI * 2); g.fill();
        g.restore();
        g.fillStyle = '#6a6480'; g.fillRect(-0.03, y - 0.78, 0.06, 0.22);
        // the blades spin with the wing beat
        const w = Math.cos(phase * Math.PI * 4) * 0.5;
        g.fillStyle = '#ff5468'; g.beginPath(); g.ellipse(w / 2, y - 0.8, Math.abs(w) / 2 + 0.03, 0.07, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#3a7bff'; g.beginPath(); g.ellipse(-w / 2, y - 0.8, Math.abs(w) / 2 + 0.03, 0.07, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffd23f'; circle(g, 0, y - 0.8, 0.06);
        break;
      }
      case 'beanie': {
        const col = ACC.beanie(L), y = top + 0.4;
        dome(col, y, 0.66);
        g.fillStyle = shade(col, -0.15);
        g.beginPath(); g.rect(-0.7, y - 0.16, 1.4, 0.2); g.fill();
        g.strokeStyle = shade(col, -0.35); g.lineWidth = hair;
        g.beginPath(); for (let x = -0.6; x <= 0.61; x += 0.15) { g.moveTo(x, y - 0.14); g.lineTo(x, y + 0.02); } g.stroke();
        g.fillStyle = '#ffffff'; circle(g, 0, y - 0.68, 0.14);
        break;
      }
      case 'wizard': {
        const y = top + 0.18;
        g.fillStyle = '#3b3fd8';
        g.beginPath(); g.ellipse(0, y, 0.68, 0.14, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(-0.45, y); g.quadraticCurveTo(-0.1, y - 0.6, 0.1, y - 1.05); g.quadraticCurveTo(0.12, y - 0.92, 0.32, y - 1.0); g.quadraticCurveTo(0.2, y - 0.5, 0.45, y); g.closePath(); g.fill();
        g.strokeStyle = '#1d1f86'; g.lineWidth = hair * 1.2; g.stroke();
        g.fillStyle = '#ffd23f';
        star(g, 0.02, y - 0.38, 0.12); star(g, 0.2, y - 0.7, 0.07); circle(g, -0.18, y - 0.16, 0.035);
        break;
      }
      case 'tophat': {
        const y = top + 0.16;
        g.fillStyle = '#1e1a2a';
        g.beginPath(); g.ellipse(0, y, 0.62, 0.13, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(-0.36, y); g.lineTo(-0.4, y - 0.82); g.quadraticCurveTo(0, y - 0.9, 0.4, y - 0.82); g.lineTo(0.36, y); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(160,150,220,0.5)'; g.lineWidth = hair; g.stroke();
        g.fillStyle = ACC.ribbon(L); g.fillRect(-0.37, y - 0.24, 0.74, 0.14);
        g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 0.05;
        g.beginPath(); g.moveTo(-0.26, y - 0.32); g.lineTo(-0.28, y - 0.74); g.stroke();
        break;
      }
      case 'party': {
        const col = ACC.party(L), y = top + 0.16;
        g.save();
        g.beginPath(); g.moveTo(-0.34, y); g.lineTo(0.06, y - 0.95); g.lineTo(0.36, y); g.closePath();
        g.fillStyle = col; g.fill();
        g.clip();
        g.fillStyle = '#ffd23f';
        for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(-0.5, y - 0.1 - k * 0.26); g.lineTo(0.5, y - 0.3 - k * 0.26); g.lineTo(0.5, y - 0.4 - k * 0.26); g.lineTo(-0.5, y - 0.2 - k * 0.26); g.fill(); }
        g.restore();
        g.fillStyle = '#ff5fa8'; circle(g, 0.06, y - 0.98, 0.11);
        g.fillStyle = 'rgba(255,255,255,0.8)'; circle(g, 0.03, y - 1.01, 0.04);
        break;
      }
      case 'pirate': {
        const y = top + 0.28;
        g.fillStyle = '#1e1a2a';
        g.beginPath();
        g.moveTo(-0.82, y); g.quadraticCurveTo(-0.62, y - 0.72, 0, y - 0.6); g.quadraticCurveTo(0.62, y - 0.72, 0.82, y);
        g.quadraticCurveTo(0, y - 0.18, -0.82, y); g.closePath(); g.fill();
        g.strokeStyle = '#ffcf4a'; g.lineWidth = 0.05;
        g.beginPath(); g.moveTo(-0.78, y - 0.03); g.quadraticCurveTo(0, y - 0.22, 0.78, y - 0.03); g.stroke();
        g.fillStyle = '#ffffff'; circle(g, 0, y - 0.38, 0.1);
        g.fillRect(-0.05, y - 0.31, 0.1, 0.06);
        g.strokeStyle = '#ffffff'; g.lineWidth = 0.035;
        g.beginPath(); g.moveTo(-0.15, y - 0.2); g.lineTo(0.15, y - 0.12); g.moveTo(0.15, y - 0.2); g.lineTo(-0.15, y - 0.12); g.stroke();
        g.fillStyle = '#1e1a2a'; circle(g, -0.035, y - 0.39, 0.025); circle(g, 0.035, y - 0.39, 0.025);
        break;
      }
      case 'halo':
        drawHalo(g, L, false);
        break;
      case 'viking': {
        const y = top + 0.36;
        for (const s of [-1, 1]) {
          g.fillStyle = '#f3e6c8';
          g.beginPath(); g.moveTo(s * 0.45, y - 0.25); g.quadraticCurveTo(s * 0.95, y - 0.35, s * 0.92, y - 0.95); g.quadraticCurveTo(s * 0.72, y - 0.5, s * 0.4, y - 0.48); g.closePath(); g.fill();
          g.strokeStyle = '#a89870'; g.lineWidth = hair; g.stroke();
        }
        dome('#9aa3b8', y, 0.64);
        g.fillStyle = '#b8860b'; g.fillRect(-0.66, y - 0.12, 1.32, 0.12);
        g.fillRect(-0.06, y - 0.64, 0.12, 0.6);
        g.fillStyle = '#ffcf4a'; for (const x of [-0.45, -0.15, 0.15, 0.45]) circle(g, x, y - 0.06, 0.03);
        break;
      }
      case 'chef': {
        const y = top + 0.2;
        g.fillStyle = '#ffffff'; g.strokeStyle = '#c8c8dc'; g.lineWidth = hair * 1.2;
        for (const [x, yy, r] of [[-0.3, y - 0.5, 0.26], [0.3, y - 0.5, 0.26], [0, y - 0.62, 0.3]]) { g.beginPath(); g.arc(x, yy, r, 0, Math.PI * 2); g.fill(); g.stroke(); }
        g.beginPath(); g.rect(-0.42, y - 0.42, 0.84, 0.42); g.fill(); g.stroke();
        g.strokeStyle = '#d8d8e8';
        g.beginPath(); g.moveTo(-0.14, y - 0.38); g.lineTo(-0.14, y - 0.04); g.moveTo(0.14, y - 0.38); g.lineTo(0.14, y - 0.04); g.stroke();
        break;
      }
      case 'bow': {
        const col = ACC.bow(L), x = 0.38, y = top + 0.02;
        g.fillStyle = col; g.strokeStyle = shade(col, -0.4); g.lineWidth = hair * 1.2;
        for (const s of [-1, 1]) {
          g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + s * 0.3, y - 0.36, x + s * 0.42, y - 0.08); g.quadraticCurveTo(x + s * 0.34, y + 0.2, x, y); g.closePath(); g.fill(); g.stroke();
        }
        g.fillStyle = shade(col, -0.15); circle(g, x, y, 0.09);
        g.fillStyle = 'rgba(255,255,255,0.7)'; circle(g, x - 0.22, y - 0.12, 0.05);
        break;
      }
      case 'headphones': {
        const neon = ACC.neon(L);
        g.strokeStyle = '#2a2440'; g.lineWidth = 0.15;
        g.beginPath(); g.arc(0, -0.05, bx * 1.04, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.04;
        g.beginPath(); g.arc(0, -0.05, bx * 1.04, Math.PI * 1.3, Math.PI * 1.55); g.stroke();
        for (const s of [-1, 1]) {
          g.fillStyle = '#2a2440';
          g.beginPath(); g.ellipse(s * bx * 0.98, -0.08, 0.17, 0.29, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = neon;
          g.beginPath(); g.ellipse(s * bx * 1.04, -0.08, 0.09, 0.2, 0, 0, Math.PI * 2); g.fill();
        }
        break;
      }
      case 'flower': {
        const x = 0.5, y = top + 0.1, petal = ACC.petal(L);
        g.fillStyle = petal;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          g.beginPath(); g.ellipse(x + Math.cos(a) * 0.16, y + Math.sin(a) * 0.16, 0.13, 0.08, a, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = '#ffd23f'; circle(g, x, y, 0.1);
        g.fillStyle = '#e09a00'; circle(g, x + 0.03, y + 0.03, 0.04);
        break;
      }
      case 'horns': {
        const y = top + 0.18;
        for (const s of [-1, 1]) {
          const hg = g.createLinearGradient(s * 0.3, y, s * 0.5, y - 0.55);
          hg.addColorStop(0, '#c4314a'); hg.addColorStop(1, '#ff8a7a');
          g.fillStyle = hg;
          g.beginPath(); g.moveTo(s * 0.18, y); g.quadraticCurveTo(s * 0.22, y - 0.42, s * 0.5, y - 0.58); g.quadraticCurveTo(s * 0.38, y - 0.3, s * 0.44, y + 0.04); g.closePath(); g.fill();
          g.strokeStyle = '#6a1020'; g.lineWidth = hair; g.stroke();
        }
        break;
      }
    }
  }

  // ---- Sprite cache -------------------------------------------------------------
  // the bat fits in x -2.6..2.6, y -2.3..1.6 (units of r)
  const BX = 2.6, BTOP = 2.3, BBOT = 1.6, BUCKETS = 16, MAX_CACHED_PX = 90, CACHE_MAX = 180;
  const cache = new Map();
  function sprite(L, k, bucket, eyesState, R) {
    const id = `${k}#${bucket}#${eyesState}#${R}`;
    let c = cache.get(id);
    if (c) return c;
    if (cache.size >= CACHE_MAX) cache.clear();
    c = document.createElement('canvas');
    c.width = Math.ceil(BX * 2 * R) + 2; c.height = Math.ceil((BTOP + BBOT) * R) + 2;
    const g = c.getContext('2d');
    g.translate(BX * R + 1, BTOP * R + 1); g.scale(R, R);
    drawBat(g, L, (bucket + 0.5) / BUCKETS, eyesState, R);
    cache.set(id, c);
    return c;
  }

  function draw2D(ctx, look, x, y, r, o = {}) {
    if (!look || !(r > 0)) return;
    const L = ready(look);
    const t = ctx.getTransform ? ctx.getTransform() : null;
    const scale = t ? Math.hypot(t.a, t.b) || 1 : 1;
    const px = r * scale, face = o.face < 0 ? -1 : 1;
    const eyesState = o.stunned ? 2 : o.eyesClosed ? 1 : 0;
    let ph = (o.flap ?? 0.15) % 1; if (ph < 0) ph += 1;
    ctx.save();
    ctx.translate(x, y);
    if (o.angle) ctx.rotate(o.angle);
    if (face < 0) ctx.scale(-1, 1);
    if (o.alpha != null) ctx.globalAlpha *= Math.max(0, Math.min(1, o.alpha));
    if (px > MAX_CACHED_PX || o.noCache) {
      ctx.scale(r, r);
      drawBat(ctx, L, ph, eyesState, px);
    } else {
      // quantise the pixel size so a bat that breathes or zooms reuses its sprites
      const R = px < 24 ? Math.max(4, Math.round(px)) : Math.round(px / 3) * 3;
      const c = sprite(L, key(L), Math.floor(ph * BUCKETS) % BUCKETS, eyesState, R);
      const k = r / R;
      ctx.drawImage(c, (-BX * R - 1) * k, (-BTOP * R - 1) * k, c.width * k, c.height * k);
    }
    ctx.restore();
  }

  // ---- Trails ------------------------------------------------------------------------
  // one trail particle, centred at (x, y), size s, i = which particle
  function trailGlyph(g, L, type, x, y, s, i) {
    switch (type) {
      case 'sparkles': g.fillStyle = i % 2 ? '#ffffff' : shade(L.wing, 0.55); sparkle(g, x, y, s); break;
      case 'hearts': g.fillStyle = i % 2 ? '#ff5a8a' : '#ff9ad5'; heart(g, x, y, s * 0.8); break;
      case 'bubbles':
        g.strokeStyle = 'rgba(160,235,255,0.95)'; g.lineWidth = Math.max(1, s * 0.16);
        g.beginPath(); g.arc(x, y, s * 0.7, 0, Math.PI * 2); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.85)'; circle(g, x - s * 0.25, y - s * 0.25, s * 0.18); break;
      case 'notes':
        g.fillStyle = g.strokeStyle = i % 2 ? '#ffe278' : '#c9b6ff'; g.lineWidth = Math.max(1, s * 0.16);
        g.beginPath(); g.ellipse(x - s * 0.2, y + s * 0.45, s * 0.32, s * 0.24, -0.4, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(x + s * 0.1, y + s * 0.42); g.lineTo(x + s * 0.1, y - s * 0.6); g.lineTo(x + s * 0.5, y - s * 0.35); g.stroke(); break;
      case 'stars': g.fillStyle = i % 2 ? '#ffe278' : '#fff6c8'; star(g, x, y, s, i); break;
      case 'flames': {
        const fg = g.createRadialGradient(x, y + s * 0.2, 0, x, y, s);
        fg.addColorStop(0, '#fff3a3'); fg.addColorStop(0.5, '#ffb347'); fg.addColorStop(1, 'rgba(255,84,60,0)');
        g.fillStyle = fg;
        g.beginPath(); g.moveTo(x, y - s * 1.1); g.quadraticCurveTo(x + s * 0.8, y, x, y + s * 0.7); g.quadraticCurveTo(x - s * 0.8, y, x, y - s * 1.1); g.fill(); break;
      }
      case 'rainbow': g.fillStyle = `hsl(${(i * 52) % 360}, 95%, 65%)`; circle(g, x, y, s * 0.7); break;
    }
  }
  // Draws look's trail behind a bat at (x, y), body radius r. o: { t (seconds),
  // face (1|-1), vx, vy (any units, only the direction counts), alpha }.
  // Call it before draw2D so the trail sits behind the bat.
  function drawTrail2D(ctx, look, x, y, r, o = {}) {
    if (!look || !(r > 0)) return;
    const L = ready(look);
    if (L.trail === 'none') return;
    let dx = -(o.vx || 0), dy = -(o.vy || 0);
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) { dx = -(o.face < 0 ? -1 : 1); dy = 0.15; } else { dx /= d; dy /= d; }
    const t = o.t ?? performance.now() / 1000, N = L.trail === 'rainbow' ? 9 : 6;
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    const a0 = ctx.globalAlpha;
    for (let i = 0; i < N; i++) {
      const age = (t * 1.1 + i / N) % 1;
      const k = i + Math.floor(t * 1.1 + i / N) * N; // a stable id per particle
      const wob = Math.sin(k * 2.3 + t * 4) * r * 0.45 * age;
      const dist = r * (0.9 + age * 3.4);
      const px = x + dx * dist - dy * wob, py = y + dy * dist + dx * wob + (L.trail === 'bubbles' || L.trail === 'flames' ? -age * r * 0.8 : 0);
      ctx.globalAlpha = a0 * (1 - age) * 0.9;
      trailGlyph(ctx, L, L.trail, px, py, r * (L.trail === 'rainbow' ? 0.5 : 0.36) * (1 - age * 0.45), k);
    }
    ctx.restore();
  }

  // ---- The 3D bat ------------------------------------------------------------------
  // Same coordinates as the old view3d rig: body radius ~0.3 at the origin, facing
  // +z, ears up +y, wings hinged at x = ±0.18 and flapped by rotation.z.
  let geoT = null;
  const geos = new Map(), texes = new Map();
  function geo(T, name, make) {
    if (geoT !== T) { geoT = T; geos.clear(); texes.clear(); }
    let g = geos.get(name);
    if (!g) { g = make(); geos.set(name, g); }
    return g;
  }
  function wingShape3D(T, kind, type) {
    // map the 2D wing (shoulder at x 0.5) into the hinge's frame, 0.42 units per r
    const k = 0.42, P = (x, y) => { const p = wingPoint(kind, x, y, 0); return [(p[0] - 0.5) * k, -(p[1] + 0.05) * k]; };
    const s = new T.Shape(), facet = kind === 'crystal';
    for (const seg of WINGS[type].path) {
      if (seg[0] === 'Q') {
        const c = P(seg[1], seg[2]), p = P(seg[3], seg[4]);
        if (facet) { s.lineTo(c[0], c[1]); s.lineTo(p[0], p[1]); } else s.quadraticCurveTo(c[0], c[1], p[0], p[1]);
      } else {
        const p = P(seg[1], seg[2]);
        if (seg[0] === 'M') s.moveTo(p[0], p[1]); else s.lineTo(p[0], p[1]);
      }
    }
    s.closePath();
    return new T.ShapeGeometry(s, 6);
  }
  function canvasTex(T, name, w, h, paint) {
    return geo(T, 'tex:' + name, () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      paint(c.getContext('2d'), w, h);
      return new T.CanvasTexture(c);
    });
  }
  const dotTex = (T) => canvasTex(T, 'dot', 64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  function cachedTex(T, id, w, h, paint) {
    geo(T, 'x', () => 0); // resets the caches if three.js changed
    let t = texes.get(id);
    if (!t) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      paint(c.getContext('2d'));
      t = new T.CanvasTexture(c);
      texes.set(id, t);
    }
    return t;
  }
  // the wing texture: colour, bones and wing-tip, spot or star patterns
  function wingTex(T, L) {
    return cachedTex(T, `w|${L.kind}|${L.wings}|${L.wing}|${L.belly}|${L.pattern}`, 256, 128, (g) => {
      // the 2D wing's x 0.4..2.6 and y -1.2..1.0 map onto the texture
      g.scale(256 / 2.2, 128 / 2.2); g.translate(-0.4, 1.2);
      const W = WINGS[L.wings];
      g.fillStyle = L.wing; g.fillRect(0, -2, 3, 4);
      if (L.pattern === 'tips') { g.fillStyle = L.belly; g.fillRect(1.62, -2, 2, 4); }
      g.strokeStyle = shade(L.wing, L.pattern === 'glow' || L.kind === 'crystal' ? 0.5 : -0.42, 0.8); g.lineWidth = 0.05; g.lineCap = 'round';
      const wr = wingPoint(L.kind, W.wrist[0], W.wrist[1], 0);
      g.beginPath();
      if (!W.soft) { const sh = wingPoint(L.kind, 0.5, -0.3, 0); g.moveTo(sh[0], sh[1]); g.lineTo(wr[0], wr[1]); }
      for (const tp of W.tips) { const p = wingPoint(L.kind, tp[0], tp[1], 0); g.moveTo(wr[0], wr[1]); g.lineTo(wr[0] + (p[0] - wr[0]) * 0.92, wr[1] + (p[1] - wr[1]) * 0.92); }
      g.stroke();
      if (L.pattern === 'spots' || L.pattern === 'stars') {
        g.fillStyle = L.pattern === 'stars' ? '#fff3a3' : contrast(L.wing, 0.38);
        for (const [x, y, r] of [[1.15, -0.22, 0.12], [1.68, -0.28, 0.09], [0.9, 0.12, 0.08]]) { const p = wingPoint(L.kind, x, y, 0); if (L.pattern === 'stars') star(g, p[0], p[1], r * 1.2); else circle(g, p[0], p[1], r); }
      }
    });
  }
  // body colour, belly patch and pattern, wrapped round the body sphere (u 0.25 faces front)
  function bodyTex(T, L) {
    return cachedTex(T, `b|${L.body}|${L.belly}|${L.pattern}`, 256, 128, (g) => {
      g.fillStyle = L.body; g.fillRect(0, 0, 256, 128);
      g.fillStyle = contrast(L.body, 0.34);
      switch (L.pattern) {
        case 'stripes':
          for (const i of [-1, 0, 1]) { g.beginPath(); g.moveTo(64 + i * 16 - 6, 0); g.lineTo(64 + i * 16 + 6, 0); g.lineTo(64 + i * 12, 40 - Math.abs(i) * 6); g.closePath(); g.fill(); }
          for (const y of [36, 60, 84]) { g.beginPath(); g.moveTo(96, y - 6); g.quadraticCurveTo(160, y - 12, 224, y - 6); g.lineTo(224, y + 6); g.quadraticCurveTo(160, y, 96, y + 6); g.closePath(); g.fill(); }
          break;
        case 'spots':
          for (const [x, y, r] of [[120, 28, 12], [164, 52, 14], [208, 32, 10], [140, 80, 12], [192, 92, 10], [236, 68, 12], [16, 40, 10], [28, 84, 10], [88, 16, 8], [44, 16, 8]]) circle(g, x, y, r);
          break;
        case 'stars':
          g.fillStyle = lum(L.body) > 0.6 ? contrast(L.body, 0.34) : '#fff3a3';
          for (const [x, y, r] of [[120, 28, 12], [170, 56, 13], [212, 30, 10], [146, 84, 11], [236, 76, 11], [20, 40, 10], [30, 86, 9], [90, 14, 8]]) star(g, x, y, r);
          break;
        case 'zigzag':
          g.strokeStyle = contrast(L.body, 0.34); g.lineWidth = 9; g.lineJoin = 'miter';
          g.beginPath(); for (let k = 0; k <= 16; k++) { const x = k * 16, y = 34 + (k % 2 ? -8 : 6); if (k) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
          break;
      }
      // belly patch, front and low
      g.fillStyle = L.belly;
      g.beginPath(); g.ellipse(64, 96, 38, 30, 0, 0, Math.PI * 2); g.fill();
      if (L.pattern === 'heart') { g.fillStyle = pickApart(L.belly, '#ff5a8a', '#e8344e'); heart(g, 64, 92, 14); }
    });
  }
  // a trail particle sprite, cached per trail type
  function trailTex(T, L, i) {
    const type = L.trail, k = i % (type === 'rainbow' ? 7 : 2);
    return cachedTex(T, `t|${type}|${k}|${type === 'sparkles' ? L.wing : ''}`, 64, 64, (g) => trailGlyph(g, L, type, 32, 34, 22, k));
  }

  function rig3D(T, look) {
    const L = ready(look), S = KIND_SHAPE[L.kind];
    const ghost = L.kind === 'ghost', crystal = L.kind === 'crystal', glow = L.pattern === 'glow';
    const mats = [];
    const lam = (color, o = {}) => {
      const m = new T.MeshLambertMaterial({ color, transparent: true, emissive: new T.Color(color), emissiveIntensity: o.ei ?? 0.35, side: o.side ?? T.FrontSide, flatShading: !!o.flat });
      m.userData.base = o.base ?? 1;
      if (o.base != null && o.base < 1) m.depthWrite = false;
      if (o.map) { m.color.set('#ffffff'); m.emissive.set('#ffffff'); m.map = o.map; m.emissiveMap = o.map; }
      mats.push(m); return m;
    };
    const basic = (color, base = 1) => { const m = new T.MeshBasicMaterial({ color, transparent: true }); m.userData.base = base; mats.push(m); return m; };
    const group = new T.Group();
    const mesh = (gm, m, x = 0, y = 0, z = 0, parent = group) => { const o = new T.Mesh(gm, m); o.position.set(x, y, z); parent.add(o); return o; };
    const ei = (glow ? 0.6 : 0.35) + (crystal ? 0.15 : 0);
    const bodyBase = ghost ? 0.74 : 1;
    const sphere = geo(T, 'sphere', () => new T.SphereGeometry(1, 20, 14));
    const lowSphere = geo(T, 'sphere-lo', () => new T.SphereGeometry(1, 12, 8));
    const hemi = geo(T, 'hemi', () => new T.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2));
    const cyl = geo(T, 'cyl', () => new T.CylinderGeometry(1, 1, 1, 16));
    const cone = geo(T, 'cone', () => new T.ConeGeometry(1, 1, 12));
    const torus = geo(T, 'torus', () => new T.TorusGeometry(1, 0.1, 6, 20));
    const box = geo(T, 'box', () => new T.BoxGeometry(1, 1, 1));
    const tickers = [];

    // body
    const bodyMat = lam(L.body, { ei, base: bodyBase, flat: crystal, map: crystal ? null : bodyTex(T, L) });
    const plainMat = lam(L.body, { ei, base: bodyBase, flat: crystal });
    if (crystal) {
      const b = mesh(geo(T, 'ico', () => new T.IcosahedronGeometry(1, 1)), bodyMat);
      b.scale.set(0.31 * S.bx, 0.31 * S.by, 0.28);
      const bl = mesh(lowSphere, lam(L.belly, { ei: 0.4, flat: true }), 0, -0.11, 0.2); bl.scale.set(0.17, 0.14, 0.08);
    } else if (ghost) {
      const b = mesh(geo(T, 'ghost', () => {
        const pts = [];
        for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI / 2; pts.push(new T.Vector2(Math.max(0.001, Math.sin(a)), Math.cos(a))); }
        pts.push(new T.Vector2(0.97, -0.35), new T.Vector2(0.86, -0.75), new T.Vector2(0.66, -1.08), new T.Vector2(0.38, -1.3), new T.Vector2(0.001, -1.42));
        const lg = new T.LatheGeometry(pts, 16);
        lg.rotateY(-Math.PI / 2); // put the texture's front (u 0.25) facing +z like the sphere
        return lg;
      }), bodyMat);
      b.scale.set(0.29, 0.29, 0.26);
      for (const s of [-1, 0, 1]) {
        const w = mesh(cone, plainMat, s * 0.13, -0.42 + Math.abs(s) * 0.05, -0.02);
        w.scale.set(0.06, 0.2, 0.06); w.rotation.set(Math.PI, 0, s * 0.35);
      }
    } else {
      const b = mesh(sphere, bodyMat);
      b.scale.set(...(L.kind === 'fruit' ? [0.33, 0.31, 0.29] : L.kind === 'longear' ? [0.28, 0.3, 0.26] : [0.3, 0.3, 0.27]));
    }
    // kind touches
    if (L.kind === 'fruit') {
      const sn = mesh(lowSphere, lam(L.belly, { ei: 0.3 }), 0, -0.05, 0.28); sn.scale.set(0.1, 0.07, 0.06);
      const ns = mesh(lowSphere, basic(INK), 0, -0.02, 0.335); ns.scale.set(0.028, 0.018, 0.015);
    }
    if (L.kind === 'vampire') {
      const flap = geo(T, 'collar', () => { const s = new T.Shape(); s.moveTo(0, 0); s.lineTo(0.36, 0.34); s.quadraticCurveTo(0.3, 0.12, 0.3, -0.16); s.closePath(); return new T.ShapeGeometry(s); });
      const cm = lam(L.wing, { ei: 0.25, side: T.DoubleSide }), lm = lam(L.belly, { ei: 0.3, side: T.DoubleSide });
      for (const s of [-1, 1]) {
        const c = mesh(flap, cm, s * 0.04, 0.08, -0.12); c.scale.x = s; c.rotation.y = -s * 0.5;
        const l = mesh(flap, lm, s * 0.06, 0.06, -0.1); l.scale.set(s * 0.8, 0.8, 1); l.rotation.y = -s * 0.5;
      }
      const fm = basic('#ffffff');
      for (const s of [-1, 1]) { const f = mesh(cone, fm, s * 0.04, -0.1, 0.255); f.scale.set(0.018, 0.06, 0.018); f.rotation.x = Math.PI; }
    }
    if (crystal) {
      const sh = geo(T, 'shard', () => new T.OctahedronGeometry(0.05, 0));
      const sm = lam(shadeHex(L.wing, 0.3), { ei: 0.8, flat: true });
      for (const [x, y, z] of [[-0.2, 0.15, 0.18], [0.24, -0.08, 0.14]]) { const m = mesh(sh, sm, x, y, z); m.scale.set(0.6, 1.2, 0.6); m.rotation.z = x; }
    }

    // ears
    const innerMat = lam(mixHex(L.belly, L.body, 0.25), { ei: 0.3, base: bodyBase });
    const earMat = L.pattern === 'tips' ? lam(L.belly, { ei: 0.35, base: bodyBase }) : plainMat;
    const at = (gm, m, x, y, z, rz, sx, sy, sz) => { const o = mesh(gm, m, x, y, z); o.rotation.z = rz; o.scale.set(sx, sy, sz); return o; };
    for (const s of [-1, 1]) {
      switch (L.ears) {
        case 'round':
          at(sphere, plainMat, s * 0.17 * S.bx, 0.28, 0, -s * 0.45, 0.1, 0.12, 0.035);
          at(lowSphere, innerMat, s * 0.17 * S.bx, 0.28, 0.025, -s * 0.45, 0.06, 0.075, 0.02);
          break;
        case 'long':
          at(cone, earMat, s * 0.13 * S.bx, 0.43, 0, -s * 0.2, 0.075, 0.46, 0.04);
          at(cone, innerMat, s * 0.132 * S.bx, 0.41, 0.028, -s * 0.2, 0.045, 0.34, 0.018);
          break;
        case 'floppy':
          at(sphere, plainMat, s * 0.26 * S.bx, 0.24, 0, -s * 1.15, 0.07, 0.17, 0.035);
          at(lowSphere, innerMat, s * 0.26 * S.bx, 0.24, 0.022, -s * 1.15, 0.04, 0.12, 0.02);
          break;
        case 'tiny':
          at(cone, earMat, s * 0.12 * S.bx, 0.31, 0, -s * 0.3, 0.05, 0.11, 0.05);
          break;
        case 'wide':
          at(cone, earMat, s * 0.22 * S.bx, 0.3, 0, -s * 0.85, 0.11, 0.3, 0.05);
          at(cone, innerMat, s * 0.225 * S.bx, 0.3, 0.025, -s * 0.85, 0.065, 0.22, 0.02);
          break;
        default:
          at(cone, earMat, s * 0.15 * S.bx, 0.3, 0, -s * 0.35, 0.09, 0.22, 0.09);
          if (L.ears === 'tufted') at(cone, innerMat, s * (0.15 * S.bx + 0.04), 0.43, 0, -s * 0.6, 0.035, 0.11, 0.035);
      }
    }

    // wings: hinged at the shoulder so view3d can flap them
    const wingMat = lam(L.wing, { ei: glow ? 0.5 : 0.25, side: T.DoubleSide, base: ghost ? 0.6 : 1, map: wingTex(T, L) });
    const wingGeo = geo(T, `wing:${L.kind === 'crystal' || L.kind === 'vampire' ? L.kind : 'n'}:${L.wings}`, () => {
      const gm = wingShape3D(T, L.kind, L.wings);
      // texture coordinates matching wingTex: back from the hinge's frame to the 2D wing's x, y
      const p = gm.attributes.position, uv = gm.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const x2 = p.getX(i) / 0.42 + 0.5, y2 = -p.getY(i) / 0.42 - 0.05;
        uv.setXY(i, (x2 - 0.4) / 2.2, 1 - (y2 + 1.2) / 2.2);
      }
      return gm;
    });
    const wings = [-1, 1].map((s) => {
      const hinge = new T.Group();
      const w = new T.Mesh(wingGeo, wingMat);
      w.scale.x = s; hinge.add(w);
      hinge.position.set(s * 0.18, 0.04, -0.02);
      group.add(hinge);
      return hinge;
    });

    // eyes: one group so view3d can squash them when stunned
    const eyes = new T.Group();
    eyes.position.set(0, 0.05, 0.235);
    group.add(eyes);
    const white = basic('#ffffff'), dark = basic(INK);
    const eyeR = (L.eyes === 'sparkly' ? 0.088 : L.eyes === 'googly' ? 0.095 : 0.075) * S.eye, eyeX = 0.1 * Math.max(1, S.eye * 0.95);
    for (const s of [-1, 1]) {
      const happy = L.eyes === 'happy' || (L.eyes === 'wink' && s < 0);
      if (happy) {
        // a closed, smiling eye: half a ring
        const a = mesh(geo(T, 'arc', () => new T.TorusGeometry(1, 0.22, 5, 10, Math.PI)), dark, s * eyeX, -0.02, 0.06, eyes);
        a.scale.setScalar(eyeR * 0.75);
        continue;
      }
      const e = mesh(sphere, white, s * eyeX, 0, 0, eyes); e.scale.setScalar(eyeR);
      // children of a scaled sphere live in its unit space
      const pupCol = L.eyes === 'hearts' ? basic('#ff3a6a') : L.eyes === 'starry' ? basic('#2a1650') : dark;
      const off = L.eyes === 'googly' ? [s * 0.35, s * -0.3] : [0, L.eyes === 'sleepy' ? -0.3 : 0];
      const pup = mesh(L.eyes === 'starry' ? geo(T, 'star3', () => new T.OctahedronGeometry(1)) : lowSphere, pupCol, off[0], off[1], 0.75, e);
      pup.scale.setScalar(({ sparkly: 0.62, fierce: 0.42, googly: 0.36, hearts: 0.6, starry: 0.62 })[L.eyes] || 0.5);
      if (['sparkly', 'round', 'starry', 'hearts', 'wink'].includes(L.eyes)) { const h = mesh(lowSphere, white, -0.3, 0.3, 1.0, e); h.scale.setScalar(L.eyes === 'sparkly' ? 0.26 : 0.18); }
      if (L.eyes === 'sleepy') { const lid = mesh(hemi, plainMat, 0, 0, 0, e); lid.scale.setScalar(1.08); lid.rotation.x = 0.45; }
      if (L.eyes === 'fierce') { const b = mesh(box, dark, 0, 0.95, 0.5, e); b.scale.set(2.2, 0.28, 0.4); b.rotation.z = s * 0.45; }
    }

    // face extras (in front of the eyes, which sit at y 0.05, z ~0.27)
    const fy = 0.05, fz = 0.32, rim = Math.max(eyeR * 1.3, 0.09);
    const ring = (m, x, r, tube = 0.1) => { const o = mesh(geo(T, 'ring' + tube, () => new T.TorusGeometry(1, tube, 6, 22)), m, x, fy, fz); o.scale.setScalar(r); return o; };
    switch (L.face) {
      case 'glasses': { const m = basic('#2a2440'); ring(m, -eyeX, rim); ring(m, eyeX, rim); const br = mesh(box, m, 0, fy + 0.01, fz); br.scale.set(eyeX * 2 - rim * 2, 0.012, 0.012); break; }
      case 'monocle': ring(lam('#e0a800', { ei: 0.5 }), eyeX, rim, 0.13); break;
      case 'goggles': {
        const m = lam('#6a6480', { ei: 0.3 }), lens = lam('#78e6ff', { ei: 0.6, base: 0.45 });
        for (const s of [-1, 1]) { ring(m, s * eyeX, rim, 0.2); const l = mesh(cyl, lens, s * eyeX, fy, fz); l.scale.set(rim, 0.01, rim); l.rotation.x = Math.PI / 2; }
        const strap = mesh(torus, m, 0, fy, 0); strap.scale.set(0.305 * S.bx, 0.305, 0.3); strap.rotation.x = Math.PI / 2;
        break;
      }
      case 'shades': {
        const m = basic('#16121f');
        for (const s of [-1, 1]) { const l = mesh(box, m, s * eyeX, fy, fz); l.scale.set(rim * 2, rim * 1.5, 0.02); }
        const br = mesh(box, m, 0, fy + rim * 0.5, fz); br.scale.set(eyeX * 2.2, 0.02, 0.02);
        break;
      }
      case 'mask': {
        const m = lam(ACC.mask(L), { ei: 0.35, side: T.DoubleSide });
        const band = mesh(geo(T, 'mask', () => new T.CylinderGeometry(1, 1, 1, 18, 1, true, -1.2, 2.4)), m, 0, fy, 0);
        band.scale.set(0.29 * S.bx, 0.11, 0.29);
        break;
      }
      case 'bandana': {
        const m = lam(ACC.bandana(L), { ei: 0.35, side: T.DoubleSide });
        const band = mesh(geo(T, 'bandana', () => new T.ConeGeometry(1, 1, 18, 1, true, -1.3, 2.6)), m, 0, -0.12, 0.02);
        band.scale.set(0.33 * S.bx, -0.24, 0.32);
        break;
      }
      case 'mustache': {
        const m = lam('#4a2a1a', { ei: 0.2 });
        for (const s of [-1, 1]) { const o = mesh(lowSphere, m, s * 0.045, -0.05, 0.29); o.scale.set(0.055, 0.022, 0.02); o.rotation.z = s * 0.35; }
        break;
      }
      case 'blush': {
        const m = basic('#ff7aa0', 0.7);
        for (const s of [-1, 1]) { const o = mesh(lowSphere, m, s * 0.16, -0.05, 0.24); o.scale.set(0.045, 0.025, 0.012); o.rotation.y = s * 0.6; }
        break;
      }
      case 'eyepatch': {
        const m = basic('#16121f');
        const p = mesh(cyl, m, -eyeX, fy, fz - 0.01); p.scale.set(rim * 0.95, 0.015, rim * 0.85); p.rotation.x = Math.PI / 2;
        const st = mesh(torus, m, 0, fy + 0.02, 0); st.scale.set(0.3 * S.bx, 0.3, 0.3); st.rotation.set(Math.PI / 2, 0.5, 0);
        break;
      }
    }

    // hats sit on the top of the head at y ~0.27
    const hy = 0.27;
    const ac = (c, o) => lam(c, { ei: 0.4, ...o });
    const put = (gm, m, x, y, z, sx, sy, sz, rx = 0, rz = 0) => { const o = mesh(gm, m, x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(rx, 0, rz); return o; };
    switch (L.hat) {
      case 'crown': {
        const m = ac('#ffd23f', { side: T.DoubleSide });
        put(geo(T, 'crown', () => new T.CylinderGeometry(1, 0.92, 1, 10, 1, true)), m, 0, hy + 0.05, 0, 0.12, 0.07, 0.12);
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + Math.PI / 2; put(cone, m, Math.cos(a) * 0.115, hy + 0.12, Math.sin(a) * 0.115, 0.025, 0.07, 0.025); }
        put(lowSphere, basic('#ff5468'), 0, hy + 0.05, 0.12, 0.025, 0.025, 0.025);
        break;
      }
      case 'cap': case 'propeller': {
        const col = L.hat === 'cap' ? ACC.cap(L) : '#ffd23f', m = ac(col, { ei: 0.3 });
        put(hemi, m, 0, 0.18, 0, 0.2, 0.18, 0.2, -0.15);
        if (L.hat === 'cap') put(cyl, ac(shadeHex(col, -0.15), { ei: 0.3 }), 0, 0.2, 0.15, 0.13, 0.015, 0.12);
        else {
          put(cyl, ac('#6a6480'), 0, 0.4, -0.02, 0.008, 0.06, 0.008);
          const prop = new T.Group(); prop.position.set(0, 0.43, -0.02); group.add(prop);
          for (const [s, c] of [[-1, '#ff5468'], [1, '#3a7bff']]) { const b = mesh(box, ac(c), s * 0.07, 0, 0, prop); b.scale.set(0.13, 0.01, 0.04); }
          tickers.push((t) => { prop.rotation.y = t * 14; });
        }
        break;
      }
      case 'beanie': {
        const col = ACC.beanie(L);
        put(hemi, ac(col, { ei: 0.3 }), 0, 0.16, 0, 0.23, 0.22, 0.23, -0.1);
        put(torus, ac(shadeHex(col, -0.15), { ei: 0.3 }), 0, 0.17, 0.01, 0.225, 0.225, 0.3, Math.PI / 2 - 0.1);
        put(lowSphere, ac('#ffffff'), 0, 0.4, -0.02, 0.045, 0.045, 0.045);
        break;
      }
      case 'wizard': {
        const m = ac('#3b3fd8', { ei: 0.35 });
        put(cyl, m, 0, hy, 0, 0.22, 0.015, 0.22);
        put(cone, m, 0, hy + 0.2, -0.03, 0.13, 0.4, 0.13, -0.22);
        put(geo(T, 'star3', () => new T.OctahedronGeometry(1)), ac('#ffd23f', { ei: 0.7 }), 0, hy + 0.14, 0.1, 0.035, 0.035, 0.035);
        break;
      }
      case 'tophat': {
        const m = ac('#1e1a2a', { ei: 0.15 });
        put(cyl, m, 0, hy, 0, 0.21, 0.015, 0.21);
        put(cyl, m, 0, hy + 0.12, 0, 0.12, 0.24, 0.12);
        put(cyl, ac(ACC.ribbon(L)), 0, hy + 0.04, 0, 0.123, 0.04, 0.123);
        break;
      }
      case 'party': {
        put(cone, ac(ACC.party(L)), 0, hy + 0.14, 0, 0.1, 0.3, 0.1, -0.1);
        put(torus, ac('#ffd23f', { ei: 0.6 }), 0, hy + 0.08, 0.006, 0.08, 0.08, 0.2, Math.PI / 2 - 0.1);
        put(lowSphere, ac('#ff5fa8'), 0, hy + 0.3, -0.03, 0.04, 0.04, 0.04);
        break;
      }
      case 'pirate': {
        const m = ac('#1e1a2a', { ei: 0.15 });
        put(geo(T, 'tricorn', () => new T.CylinderGeometry(1, 1, 1, 3)), m, 0, hy + 0.04, -0.01, 0.3, 0.1, 0.24);
        put(hemi, m, 0, hy + 0.06, 0, 0.17, 0.12, 0.17);
        put(lowSphere, ac('#ffffff'), 0, hy + 0.09, 0.15, 0.03, 0.03, 0.015);
        break;
      }
      case 'halo':
        put(torus, ac('#ffe278', { ei: 0.9 }), 0, hy + 0.2, 0, 0.14, 0.14, 0.14, Math.PI / 2);
        break;
      case 'viking': {
        put(hemi, ac('#9aa3b8', { ei: 0.3 }), 0, 0.16, 0, 0.235, 0.22, 0.235);
        put(torus, ac('#b8860b'), 0, 0.17, 0, 0.233, 0.233, 0.3, Math.PI / 2);
        for (const s of [-1, 1]) put(cone, ac('#f3e6c8', { ei: 0.3 }), s * 0.25, 0.32, 0, 0.04, 0.18, 0.04, 0, -s * 0.7);
        break;
      }
      case 'chef': {
        const m = ac('#ffffff', { ei: 0.4 });
        put(cyl, m, 0, hy + 0.04, 0, 0.13, 0.1, 0.13);
        for (const [x, z, r] of [[-0.07, 0, 0.08], [0.07, 0, 0.08], [0, 0.04, 0.09], [0, -0.05, 0.08]]) put(lowSphere, m, x, hy + 0.14, z, r, r, r);
        break;
      }
      case 'bow': {
        const m = ac(ACC.bow(L));
        for (const s of [-1, 1]) put(cone, m, 0.12 + s * 0.06, hy + 0.03, 0.05, 0.06, 0.12, 0.03, 0, s * Math.PI / 2);
        put(lowSphere, m, 0.12, hy + 0.03, 0.06, 0.03, 0.03, 0.03);
        break;
      }
      case 'headphones': {
        const m = ac('#2a2440', { ei: 0.2 }), n = ac(ACC.neon(L), { ei: 0.8 });
        put(geo(T, 'band', () => new T.TorusGeometry(1, 0.07, 6, 18, Math.PI)), m, 0, 0.02, 0, 0.31 * S.bx, 0.31, 0.31);
        for (const s of [-1, 1]) put(cyl, n, s * 0.3 * S.bx, 0, 0, 0.075, 0.07, 0.075, 0, Math.PI / 2);
        break;
      }
      case 'flower': {
        const pm = ac(ACC.petal(L)), cm = ac('#ffd23f');
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; put(lowSphere, pm, 0.16 + Math.cos(a) * 0.04, hy + Math.sin(a) * 0.04, 0.1, 0.035, 0.035, 0.012); }
        put(lowSphere, cm, 0.16, hy, 0.11, 0.022, 0.022, 0.022);
        break;
      }
      case 'horns': {
        const m = ac('#e0405a');
        for (const s of [-1, 1]) put(cone, m, s * 0.09, hy + 0.05, 0.05, 0.04, 0.15, 0.04, 0, -s * 0.5);
        break;
      }
    }

    // a soft halo for glowing and ghostly bats
    if (glow || ghost) {
      const sm = new T.SpriteMaterial({ map: dotTex(T), color: new T.Color(glow ? L.wing : '#dfe8ff'), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.5 });
      sm.userData.base = glow ? 0.55 : 0.35;
      mats.push(sm);
      const sp = new T.Sprite(sm);
      sp.scale.setScalar(glow ? 1.5 : 1.2);
      group.add(sp);
    }

    // the trail streams out behind the bat (-z); tick(t, alpha) animates it
    if (L.trail !== 'none') {
      const N = L.trail === 'rainbow' ? 9 : 6, parts = [];
      for (let i = 0; i < N; i++) {
        const m = new T.SpriteMaterial({ map: trailTex(T, L, i), transparent: true, depthWrite: false });
        m.userData.trail = true;
        const sp = new T.Sprite(m);
        group.add(sp); parts.push(sp); mats.push(m);
      }
      tickers.push((t, alpha) => {
        parts.forEach((sp, i) => {
          const age = (t * 1.1 + i / N) % 1, k = i + Math.floor(t * 1.1 + i / N) * N;
          const wob = Math.sin(k * 2.3 + t * 4) * 0.14 * age;
          sp.position.set(wob, 0.02 + (L.trail === 'bubbles' || L.trail === 'flames' ? age * 0.25 : wob * 0.5), -0.28 - age * 1.0);
          sp.scale.setScalar((L.trail === 'rainbow' ? 0.3 : 0.22) * (1 - age * 0.45));
          sp.material.opacity = alpha * (1 - age) * 0.9;
        });
      });
    }
    for (const m of mats) m.opacity = m.userData.trail ? 0 : m.userData.base;
    const tick = (t, alpha = 1) => { for (const f of tickers) f(t, alpha); };
    tick(0);
    return { group, wings, eyes, mats, tick };
  }

  // ---- A spinnable 3D bat on any canvas -------------------------------------------
  // preview3D(canvas, getLook) -> { refresh(), pop(), dispose(), webgl }. getLook()
  // is read on refresh (and at the start); drag or swipe on the canvas to spin and
  // tumble the bat. Falls back to the 2D bat if WebGL or three.js is missing.
  // opts.zoom (default 1) below 1 shows the bat smaller with more room around it.
  function preview3D(canvas, getLook, opts) {
    const zoom = (opts && opts.zoom) || 1;
    const T = window.THREE;
    let renderer = null;
    if (T) {
      try { renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true }); } catch (e) { renderer = null; }
    }
    let raf = 0, last = performance.now(), t = 0, dead = false;
    let yaw = -0.35, pitch = -0.15, vy = 0, vp = 0, idle = 2, popT = 0, curKey = null, curLook = null, dragging = null;
    const onDown = (e) => {
      dragging = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() };
      vy = vp = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* fine */ }
      canvas.style.cursor = 'grabbing';
    };
    const onMove = (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y, now = performance.now(), dts = Math.max(8, now - dragging.t) / 1000;
      dragging.x = e.clientX; dragging.y = e.clientY; dragging.t = now;
      yaw += dx * 0.012; pitch = Math.max(-1.4, Math.min(1.4, pitch + dy * 0.01));
      vy = vy * 0.5 + ((dx * 0.012) / dts) * 0.5; vp = vp * 0.5 + ((dy * 0.01) / dts) * 0.5; idle = 0;
    };
    const onUp = (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      if (performance.now() - dragging.t > 80) vy = vp = 0; // held still before letting go
      dragging = null; idle = 0; canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';

    let scene, cam, pivot, rig = null, sparks = [], pedestal, pool;
    if (renderer) {
      T.ColorManagement.enabled = false; // the same hex colours as the 2D view, like view3d.js
      renderer.outputColorSpace = T.LinearSRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      scene = new T.Scene();
      cam = new T.PerspectiveCamera(30, 1, 0.1, 50);
      scene.add(new T.HemisphereLight(0xd8dcff, 0x2a2260, 1.15));
      const sun = new T.DirectionalLight(0xffffff, 1.1); sun.position.set(-1, 1.6, 2); scene.add(sun);
      const back = new T.DirectionalLight(0x9fb4ff, 0.7); back.position.set(1.5, 0.5, -2); scene.add(back);
      pivot = new T.Group(); scene.add(pivot);
      pedestal = new T.Mesh(new T.RingGeometry(0.62, 0.7, 48), new T.MeshBasicMaterial({ color: 0x8b6cff, transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
      pedestal.rotation.x = -Math.PI / 2; pedestal.position.y = -0.62;
      pool = new T.Mesh(new T.PlaneGeometry(1.8, 1.8), new T.MeshBasicMaterial({ color: 0x8b6cff, map: dotTex(T), transparent: true, opacity: 0.45, blending: T.AdditiveBlending, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2; pool.position.y = -0.63;
      scene.add(pedestal, pool);
      const sparkTex = canvasTex(T, 'spark', 64, 64, (g) => { g.fillStyle = '#ffffff'; sparkle(g, 32, 32, 28); });
      for (let i = 0; i < 10; i++) {
        const m = new T.SpriteMaterial({ map: sparkTex, color: i % 2 ? 0xfff3a3 : 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 });
        const s = new T.Sprite(m); s.visible = false; scene.add(s);
        sparks.push({ s, a: (i / 10) * Math.PI * 2 + (i % 3) * 0.2, e: 0.75 + (i % 3) * 0.2 });
      }
    }
    function build() {
      const look = ready(getLook() || preset(0));
      const k = key(look);
      if (k === curKey) return false;
      const first = curKey === null;
      curKey = k; curLook = look;
      if (renderer) {
        if (rig) { pivot.remove(rig.group); for (const m of rig.mats) m.dispose(); }
        rig = rig3D(T, look);
        pivot.add(rig.group);
        pedestal.material.color.set(look.body); pool.material.color.set(look.body);
      }
      if (!first) popT = 1;
      return true;
    }
    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      if (!canvas.isConnected) return;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      // momentum after a swipe, then a slow idle turn and a settle back upright
      if (!dragging) {
        yaw += vy * dt; pitch = Math.max(-1.4, Math.min(1.4, pitch + vp * dt));
        vy *= Math.pow(0.08, dt); vp *= Math.pow(0.03, dt);
        idle += dt;
        if (idle > 1.5) { yaw += dt * 0.45 * Math.min(1, (idle - 1.5) / 2); pitch += (-0.15 - pitch) * Math.min(1, dt * 1.2); }
      }
      popT = Math.max(0, popT - dt * 2.5);
      const pop = 1 + Math.sin(popT * Math.PI) * 0.18;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (renderer) {
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) renderer.setSize(w, h, false);
        cam.aspect = w / h;
        const half = Math.tan((15 * Math.PI) / 180);
        const dist = Math.max(0.95 / half, 1.12 / (half * cam.aspect)) / zoom;
        cam.position.set(0, 0.12, dist); cam.lookAt(0, 0.04, 0); cam.updateProjectionMatrix();
        pivot.rotation.order = 'XYZ';
        pivot.rotation.set(pitch, yaw, Math.sin(t * 1.1) * 0.05);
        pivot.position.y = Math.sin(t * 2.2) * 0.04 + Math.sin(popT * Math.PI) * 0.1;
        pivot.scale.setScalar(pop * 1.15);
        const flap = Math.sin(t * 7);
        rig.wings[0].rotation.z = -flap * 0.6; rig.wings[1].rotation.z = flap * 0.6;
        rig.eyes.scale.y = t % 3.7 < 0.12 ? 0.15 : 1; // blink now and then
        rig.tick(t, 1);
        for (const p of sparks) {
          p.s.visible = popT > 0;
          if (!p.s.visible) continue;
          const r = 0.25 + (1 - popT) * p.e;
          p.s.position.set(Math.cos(p.a) * r, pivot.position.y + 0.05 + Math.sin(p.a) * r * 0.8, 0.35);
          p.s.material.opacity = popT;
          p.s.scale.setScalar(0.05 + 0.12 * popT);
        }
        renderer.render(scene, cam);
      } else {
        // the 2D bat, turning as you swipe it
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
        const g = canvas.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
        const look = curLook, r = Math.min(w / 6, h / 5) * pop * zoom, c = Math.cos(yaw);
        g.save(); g.translate(w / 2, h * 0.5 + Math.sin(t * 2.2) * r * 0.1); g.scale(Math.max(0.15, Math.abs(c)), 1);
        drawTrail2D(g, look, 0, 0, r, { t, face: c < 0 ? -1 : 1 });
        draw2D(g, look, 0, 0, r, { face: c < 0 ? -1 : 1, flap: t * 1.4, eyesClosed: t % 3.7 < 0.12, angle: pitch * 0.3 });
        g.restore();
      }
    }
    build();
    raf = requestAnimationFrame(frame);
    return {
      get webgl() { return !!renderer; },
      refresh() { return build(); },
      pop() { popT = 1; },
      dispose() {
        if (dead) return;
        dead = true;
        cancelAnimationFrame(raf);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        if (renderer) {
          if (rig) for (const m of rig.mats) m.dispose();
          for (const p of sparks) p.s.material.dispose();
          for (const m of [pedestal, pool]) { m.material.dispose(); m.geometry.dispose(); }
          renderer.dispose();
          try { renderer.forceContextLoss(); } catch (e) { /* already gone */ }
          renderer = null;
        }
      },
    };
  }

  // ---- The bat creator ----------------------------------------------------------
  // A full-screen "Customize Your Bat" screen over the painted menu cave: category
  // cards on the left, the live 3D bat on a stone pedestal in the middle (drag to
  // tumble it, flick it or use the arrows to step through options) and a grid of
  // thumbnail tiles on the right showing your bat wearing each option.
  const GROUPS = [
    { id: 'body', name: 'Body', short: 'Body', icon: 'body', fields: [['kind', 'Bat'], ['scheme', 'Colours'], ['pattern', 'Pattern']] },
    { id: 'wings', name: 'Wings', short: 'Wings', icon: 'wings', fields: [['wings', 'Wings']] },
    { id: 'face', name: 'Face', short: 'Face', icon: 'face', fields: [['eyes', 'Eyes'], ['face', 'Extras'], ['ears', 'Ears']] },
    { id: 'acc', name: 'Accessories', short: 'Hats', icon: 'hat', fields: [['hat', 'Hats']] },
    { id: 'fx', name: 'Effects', short: 'Effects', icon: 'fx', fields: [['trail', 'Trails']] },
  ];
  // what part of the bat each field's thumbnails frame, in body radii: x0, y0, x1, y1
  const VIEWS = {
    full: [-2.5, -2.25, 2.5, 1.6],
    head: [-1.25, -1.2, 1.25, 0.8],
    top: [-1.5, -2.4, 1.5, 0.55],
    trail: [-3.9, -1.75, 1.9, 1.45],
  };
  const FIELD_VIEW = { eyes: 'head', face: 'head', hat: 'top', ears: 'top', trail: 'trail' };

  const CSS = `
.lk-overlay{position:fixed;inset:0;z-index:1000;box-sizing:border-box;overflow:hidden;
  --pad:10px;--gap:8px;--head:40px;--doneh:52px;--r:18px;--fs:1rem;
  padding:max(var(--pad),env(safe-area-inset-top,0px)) max(calc(var(--pad) + 4px),env(safe-area-inset-right,0px)) max(var(--pad),env(safe-area-inset-bottom,0px)) max(calc(var(--pad) + 4px),env(safe-area-inset-left,0px));
  background:radial-gradient(ellipse 60% 70% at 50% 60%,rgba(70,40,170,.22),rgba(5,6,22,.5) 75%,rgba(5,6,22,.72));
  font-family:"Fredoka","Nunito","Arial Rounded MT Bold",system-ui,sans-serif;color:#f2f0ff;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
  animation:lk-in .22s ease-out}
.lk-overlay.solid{background:radial-gradient(ellipse at 50% 55%,#3a2496,#1a1050 55%,#070814)}
@keyframes lk-in{from{opacity:0;transform:scale(1.03)}}
.lk-overlay *{box-sizing:border-box}
.lk-overlay button{font-family:inherit;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.lk-overlay svg{flex:none}
.lk-shell{position:relative;width:100%;height:100%;max-width:1320px;margin:0 auto;display:grid;
  grid-template-columns:clamp(70px,18%,250px) minmax(0,1fr) clamp(200px,38%,500px);
  grid-template-rows:var(--head) minmax(0,1fr) var(--doneh);
  grid-template-areas:"back stage dice" "cats stage panel" "cats stage done";gap:var(--gap) calc(var(--gap) + 4px)}
/* buttons */
.lk-pill{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:100%;max-height:44px;padding:0 16px 0 10px;border-radius:999px;cursor:pointer;
  border:2px solid rgba(160,150,255,.5);background:rgba(16,16,50,.62);color:#f2f0ff;font-size:calc(var(--fs)*1.02);font-weight:700;line-height:1;
  box-shadow:0 0 14px rgba(120,100,255,.22);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:transform .1s,box-shadow .2s}
.lk-pill:active,.lk-arrow:active,.lk-cat:active,.lk-tile:active,.lk-sub:active{transform:scale(.94)}
.lk-pill svg{width:1.15em;height:1.15em}
.lk-overlay button:focus-visible{outline:2px solid #4adeff;outline-offset:2px}
.lk-back{grid-area:back;justify-self:start;align-self:center}
.lk-dice{grid-area:dice;justify-self:end;align-self:center;padding:0 14px 0 10px;color:#ffe9a8;border-color:rgba(255,210,63,.55);box-shadow:0 0 14px rgba(255,190,70,.25)}
.lk-dice.spin svg{animation:lk-spin .45s ease-out}
@keyframes lk-spin{to{transform:rotate(360deg) scale(1.1)}}
.lk-done{grid-area:done;justify-self:end;align-self:stretch;width:min(100%,15rem);max-height:none;padding:0 18px;gap:10px;border-radius:999px;
  border:3px solid #7dff4a;background:linear-gradient(180deg,rgba(30,70,20,.88),rgba(10,30,10,.92));color:#f4ffe9;font-size:calc(var(--fs)*1.4);
  box-shadow:0 0 24px rgba(125,255,74,.5),inset 0 0 16px rgba(125,255,74,.25);text-shadow:0 0 10px rgba(125,255,74,.55)}
.lk-done svg{width:1em;height:1em;color:#b8ff8a}
/* left: category cards */
.lk-cats{grid-area:cats;display:flex;flex-direction:column;gap:calc(var(--gap) * .8);min-height:0}
.lk-cat{flex:1 1 0;min-height:0;max-height:66px;display:flex;align-items:center;gap:10px;padding:0 12px;border-radius:calc(var(--r) * .8);cursor:pointer;text-align:left;
  border:2px solid rgba(150,170,255,.24);background:linear-gradient(180deg,rgba(30,30,84,.7),rgba(12,12,40,.78));color:#e9e6ff;
  font-size:var(--fs);font-weight:600;box-shadow:inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:border-color .15s,box-shadow .15s,transform .1s}
.lk-cat svg{width:1.7em;height:1.7em;color:var(--ic);filter:drop-shadow(0 0 5px color-mix(in srgb,var(--ic) 60%,transparent))}
.lk-cat span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lk-cat .s{display:none}
.lk-cat.on{border-color:#4adeff;color:#fff;background:linear-gradient(180deg,rgba(40,70,140,.72),rgba(14,24,64,.82));
  box-shadow:0 0 16px rgba(74,222,255,.55),inset 0 0 14px rgba(74,222,255,.22)}
/* centre: the bat on its pedestal */
.lk-stage{grid-area:stage;position:relative;min-height:0;min-width:0;container-type:size}
.lk-stage canvas{position:absolute;left:0;width:100%;height:100%;top:0}
@supports (height:1cqw){.lk-stage canvas{height:min(100%,80cqw);top:clamp(0px,calc(50% - 36cqw),calc(100% - 80cqw))}}
.lk-ped{pointer-events:none}
.lk-big{z-index:1}
.lk-title{position:absolute;z-index:2;left:0;right:0;top:0;text-align:center;pointer-events:none;line-height:1.1}
.lk-title h2{display:inline-block;max-width:100%;margin:0;font-size:calc(var(--fs)*1.85);font-size:min(calc(var(--fs)*1.85),7.4cqw);font-weight:700;color:#fff;white-space:nowrap;text-shadow:0 2px 0 rgba(20,10,60,.6),0 0 18px rgba(170,150,255,.55)}
.lk-title p{display:block;margin:2px auto 0;width:max-content;max-width:100%;font-size:calc(var(--fs)*.9);font-weight:500;color:#d6d0ff;text-shadow:0 1px 4px #000}
.lk-arrow{position:absolute;z-index:3;top:50%;width:var(--arrow,42px);height:var(--arrow,42px);margin-top:calc(var(--arrow,42px) / -2);display:grid;place-items:center;padding:0;border-radius:50%;cursor:pointer;
  border:2px solid rgba(190,200,255,.55);background:rgba(16,16,50,.72);color:#fff;box-shadow:0 0 14px rgba(120,100,255,.35);transition:transform .1s}
.lk-arrow svg{width:50%;height:50%}
.lk-prev{left:2%}.lk-next{right:2%}
.lk-namebox{position:absolute;z-index:3;left:0;right:0;bottom:0;display:grid;justify-items:center;gap:5px;pointer-events:none}
.lk-name{min-width:9.5em;max-width:100%;padding:.42em 1.2em;border-radius:999px;text-align:center;font-size:calc(var(--fs)*1.12);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  background:rgba(14,14,44,.86);border:2px solid rgba(150,170,255,.3);box-shadow:0 4px 14px rgba(0,0,0,.4),0 0 12px rgba(120,100,255,.2)}
.lk-dots{display:flex;align-items:center;gap:6px;height:12px;padding:0 8px;border-radius:999px;background:rgba(10,10,34,.55)}
.lk-dots i{width:6px;height:6px;border-radius:50%;background:rgba(200,200,255,.45)}
.lk-dots i.on{width:9px;height:9px;background:#fff;box-shadow:0 0 6px #fff}
.lk-dots b{font-size:.72rem;font-weight:600;color:#cfd0ff;letter-spacing:.04em}
/* right: option tiles */
.lk-panel{grid-area:panel;display:flex;flex-direction:column;gap:calc(var(--gap) * .8);min-height:0;padding:calc(var(--gap) + 2px);border-radius:var(--r);
  background:linear-gradient(180deg,rgba(26,26,76,.62),rgba(10,10,36,.72));border:2px solid rgba(150,170,255,.26);
  box-shadow:0 0 22px rgba(90,80,255,.18),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.lk-subs{flex:none;display:flex;gap:5px;padding:3px;border-radius:999px;background:rgba(6,8,30,.55);border:1px solid rgba(150,170,255,.18)}
.lk-sub{flex:1 1 0;min-width:0;height:calc(var(--fs)*1.9);padding:0 6px;border-radius:999px;border:0;background:transparent;color:#a9b0e0;font-size:calc(var(--fs)*.86);font-weight:600;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lk-sub.on{color:#06202a;background:linear-gradient(95deg,#4adeff,#7fb8ff);box-shadow:0 0 12px rgba(74,222,255,.5)}
.lk-subs.one .lk-sub{cursor:default}
.lk-grid{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;display:grid;grid-template-columns:repeat(var(--cols,4),minmax(0,1fr));align-content:start;gap:calc(var(--gap) * .8);
  padding:2px;margin:-2px;scrollbar-width:thin;scrollbar-color:rgba(150,170,255,.4) transparent;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.lk-tile{position:relative;aspect-ratio:1/.86;min-width:0;padding:0;border-radius:calc(var(--r) * .7);cursor:pointer;
  border:2px solid rgba(150,170,255,.2);background:radial-gradient(ellipse at 50% 40%,rgba(70,60,150,.55),rgba(14,14,44,.9) 75%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.07);transition:border-color .15s,box-shadow .15s,transform .1s}
.lk-tile canvas{position:absolute;inset:2px;width:calc(100% - 4px);height:calc(100% - 4px);pointer-events:none}
.lk-tile.on{border-color:#4adeff;box-shadow:0 0 12px rgba(74,222,255,.65),inset 0 0 12px rgba(74,222,255,.25)}
.lk-tile .ck{position:absolute;right:3px;top:3px;width:clamp(15px,24%,26px);aspect-ratio:1;border-radius:50%;display:none;place-items:center;
  background:#2fb8ff;border:2px solid #fff;color:#fff;box-shadow:0 0 8px rgba(74,222,255,.8)}
.lk-tile .ck svg{width:62%;height:62%}
.lk-tile.on .ck{display:grid}
/* tall screens: the cards and tiles stop growing */
@media (min-height:560px){.lk-overlay{--pad:16px;--gap:12px;--head:46px;--doneh:62px;--r:20px;--fs:1.1rem}.lk-cat{max-height:72px}}
/* phones held sideways */
@media (max-height:460px){
  .lk-overlay{--pad:8px;--gap:7px;--head:36px;--doneh:44px;--r:16px;--fs:.92rem;--arrow:36px}
  .lk-title p{font-size:calc(var(--fs)*.8)}
}
@media (max-height:400px){
  .lk-overlay{--pad:6px;--gap:6px;--head:32px;--doneh:40px;--r:14px;--fs:.84rem;--arrow:32px}
  .lk-shell{grid-template-columns:clamp(64px,15%,150px) minmax(0,1fr) clamp(190px,40%,330px)}
  .lk-title p{display:none}
  .lk-title h2{font-size:calc(var(--fs)*1.6);font-size:min(calc(var(--fs)*1.6),7.4cqw)}
  .lk-cat{flex-direction:column;justify-content:center;gap:2px;padding:2px 4px;text-align:center;font-size:calc(var(--fs)*.84)}
  .lk-cat svg{width:1.75em;height:1.75em}
  .lk-cat .l{display:none}.lk-cat .s{display:block}
  .lk-pill{padding:0 12px 0 8px}
  .lk-dots{height:10px}
  .lk-name{padding:.36em 1em}
}
@media (max-height:400px) and (min-width:760px){.lk-cat{flex-direction:row;justify-content:flex-start;gap:7px;padding:0 9px;text-align:left;font-size:var(--fs)}.lk-cat svg{width:1.6em;height:1.6em}}
@media (max-height:400px) and (max-width:620px){.lk-shell{grid-template-columns:58px minmax(0,1fr) clamp(180px,42%,300px)}.lk-cat .s{font-size:.66rem}}
@media (max-aspect-ratio:1/1){
  .lk-shell{grid-template-columns:1fr 1fr;grid-template-rows:var(--head) auto minmax(0,1fr) minmax(0,1.1fr) var(--doneh);
    grid-template-areas:"back dice" "cats cats" "stage stage" "panel panel" "done done"}
  .lk-cats{flex-direction:row}.lk-cat{flex-direction:column;justify-content:center;gap:2px;padding:6px 2px;font-size:calc(var(--fs)*.78);text-align:center}
  .lk-cat .l{display:none}.lk-cat .s{display:block}
  .lk-done{justify-self:stretch;width:auto}
}
`;
  const ICONS = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6"/></svg>',
    dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><g fill="currentColor" stroke="none"><circle cx="8.3" cy="8.3" r="1.6"/><circle cx="15.7" cy="8.3" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="8.3" cy="15.7" r="1.6"/><circle cx="15.7" cy="15.7" r="1.6"/></g></svg>',
    body: '<svg viewBox="0 0 64 40"><path fill="currentColor" d="M32 9c-3 0-5 1-6 3l-2-6-2 8C16 8 8 7 1 12c5 1 9 4 10 9 3-2 7-2 10 0 1-2 3-3 5-2 1 5 3 9 6 9s5-4 6-9c2-1 4 0 5 2 3-2 7-2 10 0 1-5 5-8 10-9-7-5-15-4-21 2l-2-8-2 6c-1-2-3-3-6-3z"/></svg>',
    wings: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2.5 19.5C4 11 10 4.5 21.5 3.5c-1.2 3.4-1.1 6.6.2 9.8-2.3-1.1-4.4-.9-5.6 1.1-1.1-1.6-3.2-2.1-4.9-1.1-.9 2.6-4.5 5-8.7 6.2z"/><path d="M21.5 3.5L9 14" stroke="rgba(10,10,40,.45)" stroke-width="1.3"/></svg>',
    face: '<svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M1.5 9.2C1.5 7.4 2.7 6.3 4.4 6.3c2.8 0 4.6 1.6 7.6 1.6s4.8-1.6 7.6-1.6c1.7 0 2.9 1.1 2.9 2.9 0 4.4-2.6 7.6-6 7.6-2.1 0-3.4-1.3-4.5-2.9-1.1 1.6-2.4 2.9-4.5 2.9-3.4 0-6-3.2-6-7.6zM7.3 8.6a2.4 2.1 0 1 0 0 4.2 2.4 2.1 0 1 0 0-4.2zm9.4 0a2.4 2.1 0 1 0 0 4.2 2.4 2.1 0 1 0 0-4.2z"/></svg>',
    hat: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7.5 4.5c0-.8.7-1.5 1.5-1.5h6c.8 0 1.5.7 1.5 1.5v9h-9z"/><path fill="rgba(10,10,40,.5)" d="M7.5 10.5h9v2.2h-9z"/><path fill="currentColor" d="M2.5 16c0-1.1 1.6-2 3.5-2h12c1.9 0 3.5.9 3.5 2s-1.6 2.2-3.5 2.2H6c-1.9 0-3.5-1.1-3.5-2.2z"/></svg>',
    fx: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8z"/><path d="M18.5 13l.95 2.55L22 16.5l-2.55.95L18.5 20l-.95-2.55L15 16.5l2.55-.95z"/><circle cx="5" cy="19" r="1.6"/></svg>',
  };
  const ICON_COL = { body: '#6fe7ff', wings: '#ff7ad9', face: '#d08bff', hat: '#ff8ae0', fx: '#b9a8ff' };

  // a copy of look wearing option id of field f (a new kind brings its own parts and colours)
  function withOpt(look, f, id) {
    if (f === 'kind') {
      const d = defaults(id);
      return clean({ ...d, hat: look.hat === (KIND_HAT[look.kind] || 'none') ? d.hat : look.hat, face: look.face, trail: look.trail });
    }
    return clean({ ...look, [f]: id });
  }

  // thumbnails: drawn once per look, field and pixel size, kept for the visit
  const thumbs = new Map();
  function thumb(look, field, w, h) {
    const id = `${key(look)}@${field}@${w}x${h}`;
    let c = thumbs.get(id);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const [x0, y0, x1, y1] = VIEWS[FIELD_VIEW[field] || 'full'];
    const r = Math.min(w / (x1 - x0), h / (y1 - y0));
    const cx = w / 2 - ((x0 + x1) / 2) * r, cy = h / 2 - ((y0 + y1) / 2) * r;
    if (field === 'trail') drawTrail2D(g, look, cx, cy, r * 1.25, { t: 0.42, face: 1, vx: 1, vy: -0.12 });
    draw2D(g, look, cx, cy, r, { face: 1, flap: 0.12, noCache: true });
    thumbs.set(id, c);
    if (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value);
    return c;
  }

  // the stone pedestal under the 3D bat, matched to preview3D's camera and glow ring
  function paintPedestal(cv, look, zoom) {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const half = Math.tan((15 * Math.PI) / 180), a = w / h;
    const dist = Math.max(0.95 / half, 1.12 / (half * a)) / zoom;
    const cam = [0, 0.12, dist], f0 = [0, -0.08, -dist], fl = Math.hypot(f0[1], f0[2]);
    const F = [0, f0[1] / fl, f0[2] / fl], U = [0, -F[2], F[1]]; // up, at right angles to the view
    const up = U[1] < 0 ? [0, -U[1], -U[2]] : U;
    const P = (x, y, z) => {
      const v = [x - cam[0], y - cam[1], z - cam[2]];
      const zc = v[1] * F[1] + v[2] * F[2], yc = v[1] * up[1] + v[2] * up[2];
      return [w / 2 + (x / (zc * half * a)) * (w / 2), h / 2 - (yc / (zc * half)) * (h / 2)];
    };
    const R = 0.98, Y = -0.64, TH = 0.2;
    const [cx, cy] = P(0, Y, 0), rx = P(R, Y, 0)[0] - cx;
    const ry = Math.max(4, (P(0, Y, R)[1] - P(0, Y, -R)[1]) / 2);
    const depth = P(0, Y - TH, R)[1] - P(0, Y, R)[1];
    g.clearRect(0, 0, w, h);
    // soft purple glow behind and below
    let gr = g.createRadialGradient(cx, cy, rx * 0.2, cx, cy, rx * 1.5);
    gr.addColorStop(0, 'rgba(150,100,255,.5)'); gr.addColorStop(0.5, 'rgba(110,70,230,.2)'); gr.addColorStop(1, 'rgba(80,40,200,0)');
    g.fillStyle = gr; g.save(); g.translate(cx, cy); g.scale(1, 0.62); g.beginPath(); g.arc(0, 0, rx * 1.5, 0, Math.PI * 2); g.fill(); g.restore();
    // the side of the stone, a little lumpy
    const seg = 28, lump = (i) => 1 + Math.sin(i * 2.7) * 0.012 + Math.sin(i * 5.3) * 0.008;
    g.beginPath();
    for (let i = 0; i <= seg; i++) {
      const t = Math.PI * (i / seg), k = lump(i);
      g.lineTo(cx + Math.cos(t) * rx * k * -1, cy + Math.sin(t) * ry * k + depth * (0.92 + Math.sin(i * 3.1) * 0.08));
    }
    for (let i = seg; i >= 0; i--) { const t = Math.PI * (i / seg); g.lineTo(cx - Math.cos(t) * rx, cy + Math.sin(t) * ry); }
    g.closePath();
    gr = g.createLinearGradient(0, cy, 0, cy + ry + depth);
    gr.addColorStop(0, '#3b3170'); gr.addColorStop(0.5, '#251d4e'); gr.addColorStop(1, '#130e2c');
    g.fillStyle = gr; g.fill();
    // stone joints down the side
    g.strokeStyle = 'rgba(8,5,26,.55)'; g.lineWidth = Math.max(1, rx * 0.012);
    for (const u of [-0.72, -0.38, 0.05, 0.44, 0.78]) {
      const x = cx + u * rx, y = cy + Math.sqrt(Math.max(0, 1 - u * u)) * ry;
      g.beginPath(); g.moveTo(x, y + 1); g.lineTo(x + rx * 0.02, y + depth * 0.9); g.stroke();
    }
    // the flat top
    gr = g.createRadialGradient(cx - rx * 0.2, cy - ry * 0.4, rx * 0.05, cx, cy, rx * 1.05);
    gr.addColorStop(0, '#6a5cae'); gr.addColorStop(0.55, '#4a3e8c'); gr.addColorStop(1, '#2f2766');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(190,175,255,.5)'; g.lineWidth = Math.max(1, rx * 0.012);
    g.beginPath(); g.ellipse(cx, cy, rx * 0.995, ry * 0.99, 0, Math.PI * 1.02, Math.PI * 1.98); g.stroke();
    // cracks and an inner carved ring
    g.strokeStyle = 'rgba(20,14,50,.5)'; g.lineWidth = Math.max(1, rx * 0.01);
    g.beginPath(); g.ellipse(cx, cy, rx * 0.8, ry * 0.8, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    g.moveTo(cx - rx * 0.62, cy - ry * 0.2); g.lineTo(cx - rx * 0.45, cy - ry * 0.05); g.lineTo(cx - rx * 0.5, cy + ry * 0.3);
    g.moveTo(cx + rx * 0.5, cy - ry * 0.45); g.lineTo(cx + rx * 0.35, cy - ry * 0.2); g.lineTo(cx + rx * 0.42, cy + ry * 0.12);
    g.stroke();
    // a faint glow of the bat's own colour on top
    gr = g.createRadialGradient(cx, cy, 0, cx, cy, rx * 0.75);
    gr.addColorStop(0, shade(look.body, 0.2, 0.4)); gr.addColorStop(1, shade(look.body, 0, 0));
    g.fillStyle = gr; g.save(); g.translate(cx, cy); g.scale(1, ry / rx); g.beginPath(); g.arc(0, 0, rx * 0.75, 0, Math.PI * 2); g.fill(); g.restore();
    return { cx, cy, rx, ry, bottom: cy + ry + depth };
  }

  let ed = null; // the open editor, if any
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fieldName = (f) => { for (const G of GROUPS) for (const [id, n] of G.fields) if (id === f) return n; return f; };

  // onClose(look, { cancelled }): Done saves and passes the new look; Back passes the saved one
  function openEditor(onClose) {
    if (ed) ed.close(false);
    if (!document.getElementById('lk-style')) { const st = el('style'); st.id = 'lk-style'; st.textContent = CSS; document.head.appendChild(st); }
    const state = { look: mine(), group: 0, sub: GROUPS.map(() => 0) };
    const root = el('div', 'lk-overlay');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Customize your bat');
    root.innerHTML = `
      <div class="lk-shell">
        <button class="lk-pill lk-back" aria-label="Back without saving">${ICONS.prev}<span>Back</span></button>
        <button class="lk-pill lk-dice" aria-label="Random bat">${ICONS.dice}<span>Random</span></button>
        <nav class="lk-cats" role="tablist" aria-label="Parts">${GROUPS.map((G, i) => `<button class="lk-cat" role="tab" data-i="${i}" style="--ic:${ICON_COL[G.icon]}" aria-label="${G.name}">${ICONS[G.icon]}<span class="l">${G.name}</span><span class="s">${G.short}</span></button>`).join('')}</nav>
        <section class="lk-stage">
          <canvas class="lk-ped" aria-hidden="true"></canvas>
          <canvas class="lk-big" aria-label="Your bat. Drag to spin it, flick it sideways to change."></canvas>
          <div class="lk-title"><h2>Customize Your Bat</h2><p>Make it yours. Look fierce.</p></div>
          <button class="lk-arrow lk-prev" aria-label="Previous option">${ICONS.prev}</button>
          <button class="lk-arrow lk-next" aria-label="Next option">${ICONS.next}</button>
          <div class="lk-namebox"><div class="lk-name" aria-live="polite"></div><div class="lk-dots" aria-hidden="true"></div></div>
        </section>
        <section class="lk-panel">
          <div class="lk-subs" role="tablist"></div>
          <div class="lk-grid" role="listbox"></div>
        </section>
        <button class="lk-pill lk-done" aria-label="Done, save my bat">${ICONS.check}<span>Done</span></button>
      </div>`;
    document.body.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const big = $('.lk-big'), ped = $('.lk-ped'), stage = $('.lk-stage'), grid = $('.lk-grid'), subsEl = $('.lk-subs');
    const nameEl = $('.lk-name'), dotsEl = $('.lk-dots'), namebox = $('.lk-namebox');
    const cats = [...root.querySelectorAll('.lk-cat')];

    // the painted menu cave (backdrop.js) sits just under the creator while it is open
    const bd = document.getElementById('backdrop'), bdZ = bd ? bd.style.zIndex : '';
    if (bd) bd.style.zIndex = '999';
    const solid = () => root.classList.toggle('solid', !bd || bd.hidden);
    solid();

    // keep the game from reacting to touches and keys while the creator is open
    const stop = (e) => e.stopPropagation();
    for (const ty of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup', 'click', 'wheel']) root.addEventListener(ty, stop);
    const onKey = (e) => {
      if (!ed) return;
      e.stopPropagation();
      if (e.type !== 'keydown') return;
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); pickGroup((state.group + (e.key === 'ArrowUp' ? -1 : 1) + GROUPS.length) % GROUPS.length); }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);

    const ZOOM = 0.8;
    const preview = preview3D(big, () => state.look, { zoom: ZOOM });
    const field = () => GROUPS[state.group].fields[state.sub[state.group]][0];
    const list = () => OPTIONS[field()];

    function setField(f, id) {
      state.look = withOpt(state.look, f, id);
      preview.refresh();
      update();
    }
    function step(d) {
      const f = field(), L = list(), n = L.length;
      let i = L.findIndex((o) => o.id === state.look[f]);
      i = i < 0 ? (d > 0 ? 0 : n - 1) : (((i + d) % n) + n) % n;
      setField(f, L[i].id);
      const t = tiles[i];
      if (t) t.el.scrollIntoView({ block: 'nearest' });
    }

    // ---- tiles, drawn lazily: only the ones on screen, a few per frame
    let tiles = [], queue = new Set();
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
      for (const e of ents) { const t = e.target._lk; if (t) { t.seen = e.isIntersecting; if (t.seen && t.dirty) queue.add(t); } }
    }, { root: grid, rootMargin: '60px' }) : null;
    function paintTile(t) {
      const c = t.cv, w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.round(w * dpr), H = Math.round(h * dpr);
      const src = thumb(t.look, t.field, W, H);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const g = c.getContext('2d');
      g.clearRect(0, 0, W, H); g.drawImage(src, 0, 0);
      t.dirty = false; t.el.dataset.drawn = '1';
      return true;
    }
    function buildGrid() {
      if (io) io.disconnect();
      queue.clear();
      const f = field();
      grid.setAttribute('aria-label', fieldName(f));
      grid.innerHTML = '';
      tiles = list().map((o, i) => {
        const b = el('button', 'lk-tile', `<canvas aria-hidden="true"></canvas><span class="ck" aria-hidden="true">${ICONS.check}</span>`);
        b.setAttribute('role', 'option'); b.setAttribute('aria-label', o.name); b.title = o.name;
        b.addEventListener('click', () => setField(f, o.id));
        grid.appendChild(b);
        const t = { el: b, cv: b.firstChild, field: f, id: o.id, i, look: null, k: '', dirty: true, seen: !io };
        b._lk = t;
        if (io) io.observe(b);
        return t;
      });
      grid.scrollTop = 0;
      syncGrid();
      const on = tiles.find((t) => t.el.classList.contains('on'));
      if (on) requestAnimationFrame(() => on.el.scrollIntoView({ block: 'nearest' }));
    }
    function syncGrid() {
      const f = field();
      for (const t of tiles) {
        const on = state.look[f] === t.id;
        t.el.classList.toggle('on', on); t.el.setAttribute('aria-selected', String(on));
        const look = withOpt(state.look, f, t.id), k = key(look);
        if (k !== t.k) { t.look = look; t.k = k; t.dirty = true; }
        if (t.dirty && t.seen) queue.add(t);
      }
    }
    function pickGroup(i) {
      state.group = i;
      cats.forEach((c, k) => { c.classList.toggle('on', k === i); c.setAttribute('aria-selected', String(k === i)); });
      const G = GROUPS[i];
      subsEl.classList.toggle('one', G.fields.length < 2);
      subsEl.innerHTML = G.fields.map(([f, n], k) => `<button class="lk-sub${k === state.sub[i] ? ' on' : ''}" role="tab" data-k="${k}">${esc(n)}</button>`).join('');
      buildGrid();
      update();
    }
    cats.forEach((c, i) => c.addEventListener('click', () => pickGroup(i)));
    subsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.lk-sub');
      if (!b) return;
      const k = +b.dataset.k;
      if (k === state.sub[state.group]) return;
      state.sub[state.group] = k;
      [...subsEl.children].forEach((s, j) => s.classList.toggle('on', j === k));
      buildGrid();
      update();
    });

    let pedKey = '', pedSize = '';
    function update() {
      const f = field(), L = list(), i = L.findIndex((o) => o.id === state.look[f]);
      nameEl.textContent = i >= 0 ? L[i].name : f === 'scheme' ? 'Custom colours' : fieldName(f);
      if (L.length <= 7) dotsEl.innerHTML = L.map((o, k) => `<i${k === i ? ' class="on"' : ''}></i>`).join('');
      else dotsEl.innerHTML = `<b>${i >= 0 ? i + 1 : '–'} / ${L.length}</b>`;
      syncGrid();
      const pk = state.look.body;
      if (pk !== pedKey) { pedKey = pk; pedSize = ''; }
    }

    $('.lk-prev').addEventListener('click', () => step(-1));
    $('.lk-next').addEventListener('click', () => step(1));
    // a quick sideways flick on the bat changes the option; a slow drag just tumbles it
    let flick = null;
    big.addEventListener('pointerdown', (e) => { flick = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() }; });
    big.addEventListener('pointerup', (e) => {
      if (!flick || e.pointerId !== flick.id) return;
      const dx = e.clientX - flick.x, dy = e.clientY - flick.y, dt = performance.now() - flick.t;
      flick = null;
      if (dt < 380 && Math.abs(dx) > Math.max(40, big.clientWidth * 0.14) && Math.abs(dx) > Math.abs(dy) * 1.6) step(dx < 0 ? 1 : -1);
    });
    big.addEventListener('pointercancel', () => { flick = null; });

    $('.lk-dice').addEventListener('click', (e) => {
      state.look = random(null);
      preview.refresh();
      const d = e.currentTarget; d.classList.remove('spin'); void d.offsetWidth; d.classList.add('spin');
      update();
    });
    $('.lk-back').addEventListener('click', () => close(false));
    $('.lk-done').addEventListener('click', () => close(true));

    // one loop: draws waiting thumbnails (a few ms a frame) and keeps the pedestal fitted
    let raf = 0;
    function frame() {
      raf = requestAnimationFrame(frame);
      solid();
      const sz = stage.clientWidth + 'x' + stage.clientHeight;
      if (sz !== pedSize) {
        pedSize = sz;
        const p = paintPedestal(ped, state.look, ZOOM);
        if (p) {
          // the name sits on the front of the stone, but never off the bottom
          const nb = namebox.offsetHeight, top = Math.min(stage.clientHeight - nb, ped.offsetTop + p.cy + p.ry * 0.55);
          namebox.style.bottom = 'auto'; namebox.style.top = Math.max(0, top) + 'px';
        }
        for (const t of tiles) if (t.seen) { t.dirty = true; queue.add(t); }
      }
      const t0 = performance.now();
      for (const t of queue) {
        queue.delete(t);
        if (t.el.isConnected && t.dirty) paintTile(t);
        if (performance.now() - t0 > 6) break;
      }
    }
    raf = requestAnimationFrame(frame);

    function close(done) {
      if (!ed) return;
      ed = null;
      cancelAnimationFrame(raf);
      if (io) io.disconnect();
      preview.dispose();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      if (bd) bd.style.zIndex = bdZ;
      root.remove();
      const result = done ? save(state.look) : mine();
      if (typeof onClose === 'function') onClose(result, { cancelled: !done });
    }
    ed = { close, root };
    pickGroup(0);
    setTimeout(() => { const d = $('.lk-done'); if (d && ed && !matchMedia('(pointer: coarse)').matches) d.focus({ preventScroll: true }); }, 50);
    return ed;
  }

  window.EchoLooks = {
    mine, preset, random, clean, save, key, defaults,
    draw2D, drawTrail2D, rig3D, preview3D, openEditor,
    get isOpen() { return !!ed; },
    closeEditor() { if (ed) ed.close(false); },
    OPTIONS, CATEGORIES, KINDS,
  };
})();
