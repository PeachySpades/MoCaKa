// Echo music: a synthesized jazz band, built on the fly with Web Audio (no
// sound files). Upright bass, piano, guitar, vibraphone, a horn section
// (trumpets, saxes, trombone), a lead horn and a full drum kit play 32-bar
// AABA tunes. Each pass through the form is a different chorus: the head
// (composed melody), a horn solo with backgrounds, a vibes or piano solo, then
// a shout chorus where the whole section plays the melody in harmony.
//
//   const music = window.makeEchoMusic({ ctx, bus, noise });
//   music.set('battle' | 'explore' | 'run' | 'lobby' | false);   // every frame
//
// ctx() returns the AudioContext (or null before audio is unlocked), bus()
// the GainNode the music plays into. noise() is accepted for compatibility;
// the drums are rendered here into their own buffers.
(() => {
  'use strict';
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  const rnd = Math.random;
  const chance = (p) => rnd() < p;
  const pick = (a) => a[(rnd() * a.length) | 0];

  // ---- Harmony ------------------------------------------------------------
  // sc: chord scale, ct: chord tones (root 3 5 7), va/vb: rootless piano voicings
  const Q = {
    maj7: { sc: [0, 2, 4, 6, 7, 9, 11], ct: [0, 4, 7, 11], va: [4, 7, 11, 14], vb: [11, 14, 16, 19] },
    6: { sc: [0, 2, 4, 5, 7, 9, 11], ct: [0, 4, 7, 9], va: [4, 7, 9, 14], vb: [9, 14, 16, 19] },
    m7: { sc: [0, 2, 3, 5, 7, 9, 10], ct: [0, 3, 7, 10], va: [3, 7, 10, 14], vb: [10, 14, 15, 19] },
    m6: { sc: [0, 2, 3, 5, 7, 9, 11], ct: [0, 3, 7, 9], va: [3, 7, 9, 14], vb: [9, 14, 15, 19] },
    7: { sc: [0, 2, 4, 5, 7, 9, 10], ct: [0, 4, 7, 10], va: [4, 9, 10, 14], vb: [10, 14, 16, 21] },
    '7b9': { sc: [0, 1, 4, 5, 7, 8, 10], ct: [0, 4, 7, 10], va: [4, 8, 10, 13], vb: [10, 13, 16, 20] },
    '7#11': { sc: [0, 2, 4, 6, 7, 9, 10], ct: [0, 4, 7, 10], va: [4, 6, 10, 14], vb: [10, 14, 16, 18] },
    alt: { sc: [0, 1, 3, 4, 6, 8, 10], ct: [0, 4, 8, 10], va: [4, 8, 10, 15], vb: [10, 13, 16, 20] },
    m7b5: { sc: [0, 2, 3, 5, 6, 8, 10], ct: [0, 3, 6, 10], va: [3, 6, 10, 14], vb: [10, 14, 15, 18] },
  };
  const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function chord(sym) {
    let r = LETTER[sym[0]], i = 1;
    if (sym[1] === 'b') { r--; i++; } else if (sym[1] === '#') { r++; i++; }
    let q = sym.slice(i) || 'maj7';
    if (q === '7alt') q = 'alt';
    const d = Q[q];
    if (!d) throw new Error('music: unknown chord ' + sym);
    return { sym, root: (r + 12) % 12, ...d, set: new Set(d.sc), cts: new Set(d.ct) };
  }
  const bars = (s) => s.split('|').map((b) => b.trim().split(/\s+/).map(chord));
  // melody: "pos:len:degree" per note (pos/len in eighths), bars split by "|".
  // The degree is relative to the chord under the note (1 root, 3 third,
  // 9 ninth...); "^"/"v" forces the note above/below the previous one.
  const mel = (s) => s.split('|').map((b) => (b.trim() ? b.split(',').map((tok) => {
    const [p, d, g] = tok.trim().split(':');
    return { p: +p, d: +d, deg: parseInt(g, 10), dir: g.endsWith('^') ? 1 : g.endsWith('v') ? -1 : 0 };
  }) : []));
  const pcOf = (m) => ((m % 12) + 12) % 12;
  const rel = (m, ch) => pcOf(m - ch.root);
  const inScale = (m, ch) => ch.set.has(rel(m, ch));
  const isCT = (m, ch) => ch.cts.has(rel(m, ch));
  const degPc = (ch, deg) => { const i = deg - 1; return pcOf(ch.root + ch.sc[i % 7] + 12 * Math.floor(i / 7)); };
  // the pitch with pitch class pc closest to prev (or forced up/down), folded into [lo, hi]
  function place(pc, prev, dir = 0, lo = -99, hi = 999) {
    let m = prev + ((pc - prev) % 12 + 18) % 12 - 6;
    if (dir > 0 && m <= prev) m += 12;
    if (dir < 0 && m >= prev) m -= 12;
    while (m > hi) m -= 12;
    while (m < lo) m += 12;
    return m;
  }
  function scaleStep(m, ch, dir) { do m += dir; while (!inScale(m, ch)); return m; }
  function voicing(ch, ref, lo, n = 4) {
    let best = null, bestScore = 1e9;
    for (const form of [ch.va, ch.vb]) {
      let v = form.map((i) => ch.root + i);
      while (v[0] < lo) v = v.map((x) => x + 12);
      while (v[0] >= lo + 12) v = v.map((x) => x - 12);
      v = v.slice(0, n);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      const score = Math.abs(mean - ref) + rnd() * 2;
      if (score < bestScore) { bestScore = score; best = v; }
    }
    return best;
  }
  // horn-section voicing under a top note: four-way close, second voice
  // dropped an octave (drop 2), plus the trombone on the root
  function section(top, ch, bone = true) {
    const pcs = new Set(ch.va.map((i) => pcOf(ch.root + i)));
    const v = [top];
    for (let x = top - 1; v.length < 4 && x > top - 14; x--) {
      const d = top - x;
      if (pcs.has(pcOf(x)) && pcOf(x) !== pcOf(top) && d !== 1) v.push(x);
    }
    if (v.length >= 3) v[1] -= 12;
    const notes = v.map((m, i) => [m, i === 0 ? 2 : 1]);
    if (bone) notes.push([place(ch.root, 45, 0, 38, 50), 1]);
    return notes;
  }

  // ---- The tunes ----------------------------------------------------------
  // Each is a 32-bar AABA chart with a composed head for A and B.
  const TUNES = {
    // hard-bop minor burner in D minor
    battle: {
      bpm: 192, swing: 0.58, drive: 1.15, comp: 0.85, fillP: 0.6, dbl: 0.12,
      head: ['tp', 'ts'], solo: ['ts', 'tp'], solo2: ['vibes', 'piano'], guitar: true,
      feel: { A: 'swing', B: 'swing' }, headHorns: { A: 3, B: 0 },
      A: {
        ch: 'Dm7 | Em7b5 A7alt | Dm7 | Am7b5 D7alt | Gm7 | C7 | Fmaj7 Bb7 | Em7b5 A7alt',
        mel: '0:1:5,1:1:7,2:1:8,3:2:9^,5:1:8,6:2:7 | 0:2:5,2:1:3,3:1:1,4:1:6,5:1:4,6:2:2 | 0:3:3,3:1:5,4:1:7,5:3:9^ | 0:2:8,2:1:7,3:1:5,4:2:4,6:2:7 | 0:1:3,1:1:5,2:1:7,3:1:9^,4:2:8,6:2:7 | 0:2:3,2:1:9,3:3:7,6:2:5 | 0:3:3,3:1:5,4:1:7,5:1:6,6:2:5 | 0:2:7,2:2:5,4:2:4,6:2:2',
      },
      B: {
        ch: 'Bbmaj7 | Bbmaj7 | Gm7 | C7 | Fmaj7 | Bb7 | Em7b5 | A7alt',
        mel: '0:6:7,6:1:5,7:1:3 | 0:2:3,2:2:5,4:4:9^ | 0:6:3,6:2:5 | 0:2:7,2:2:9,4:2:3,6:2:5 | 0:6:3,6:1:5,7:1:6 | 0:2:7,2:2:5,4:4:3 | 0:2:5,2:1:7,3:1:8,4:4:3^ | 0:1:4,1:1:6,2:1:7,3:1:9^,4:4:8',
      },
    },
    // medium-up minor swing with a modal, slightly spooky colour (C minor)
    explore: {
      bpm: 136, swing: 0.64, drive: 0.85, comp: 0.6, fillP: 0.75, dbl: 0.06, brush: true,
      head: ['harmon'], solo: ['harmon', 'ts'], solo2: ['vibes', 'piano'], guitar: false,
      feel: { A: 'swing', B: 'swing' }, headHorns: { A: 'pad', B: 2 },
      A: {
        ch: 'Cm7 | Cm7 | Ab7#11 | Ab7#11 | Cm7 | Cm7 | Dm7b5 | G7alt',
        mel: '0:3:5,3:1:9^,4:4:8 | 0:2:7,2:2:5,4:2:4,6:2:3 | 0:4:11,4:2:9,6:2:7 | 0:6:5,6:2:3 | 0:2:3,2:1:5,3:1:7,4:4:9^ | 0:4:8,4:2:11v,6:2:7 | 0:2:3,2:2:5,4:4:7 | 0:4:4,4:2:6,6:2:2',
      },
      B: {
        ch: 'Ebmaj7 | Abmaj7 | Dm7b5 | G7alt | Cm7 | F7 | Dm7b5 | G7alt',
        mel: '0:2:3,2:2:5,4:4:7^ | 0:6:4,6:2:3 | 0:2:7,2:2:5,4:4:3 | 0:2:4,2:2:6,4:4:2 | 0:6:9^,6:2:8 | 0:2:7,2:2:5,4:2:3,6:2:13 | 0:4:3,4:4:5 | 0:2:3,2:2:4,4:4:1',
      },
    },
    // samba-jazz A sections, hard-swinging bridge (F major)
    run: {
      bpm: 172, swing: 0.58, drive: 1.05, comp: 0.75, fillP: 0.5, dbl: 0.1, dblVibes: true,
      head: ['as'], solo: ['as', 'tp'], solo2: ['vibes', 'piano'], guitar: true,
      feel: { A: 'latin', B: 'swing' }, headHorns: { A: 1, B: 'pad' },
      A: {
        ch: 'Gm7 | C7 | Fmaj7 | Fmaj7 | Gm7 | C7 | Am7 D7b9 | Gm7 C7',
        mel: '0:1:5,1:2:7,3:2:8,5:3:9^ | 1:1:9,2:1:7,3:3:5,6:2:3 | 0:5:3,5:1:5,6:2:9 | 0:6:7,6:2:5 | 0:1:3,1:2:5,3:2:7,5:3:9^ | 1:1:13,2:1:9,3:3:7,6:2:5 | 0:2:3,2:2:5,4:2:3,6:2:2 | 0:3:3,3:1:5,4:4:3',
      },
      B: {
        ch: 'Cm7 | F7 | Bbmaj7 | Bbmaj7 | Am7b5 | D7alt | Gm7 | C7alt',
        mel: '0:1:1,1:1:3,2:1:5,3:1:7,4:2:9^,6:1:8,7:1:7 | 0:1:5,1:1:3,2:1:4,3:1:5,4:4:7 | 0:6:3,6:2:5 | 0:2:6,2:2:5,4:4:3 | 0:1:1,1:1:3,2:1:5,3:1:7,4:4:8 | 0:2:7,2:2:6,4:4:4 | 0:1:5,1:1:7,2:2:8,4:4:9^ | 0:2:7,2:2:6,4:2:4,6:2:2',
      },
    },
    // bouncy rhythm changes in Bb, two-beat feel on the first head
    lobby: {
      bpm: 116, swing: 0.66, drive: 0.75, comp: 0.55, fillP: 0.7, dbl: 0.05, twoFeel: true,
      head: ['ts'], solo: ['ts', 'harmon'], solo2: ['piano', 'vibes'], guitar: true,
      feel: { A: 'swing', B: 'swing' }, headHorns: { A: 'pad', B: 1 },
      A: {
        ch: 'Bb6 G7b9 | Cm7 F7 | Bb6 G7b9 | Cm7 F7 | Fm7 Bb7 | Ebmaj7 Ab7 | Bb6 G7b9 | Cm7 F7',
        mel: '0:1:5,1:1:6,2:2:8^,4:2:3,6:2:5 | 0:1:3,1:1:5,2:2:3,4:2:7,6:2:6 | 1:1:5,2:1:6,3:3:8^,6:2:3 | 0:2:5,2:2:3,4:4:9^ | 0:1:1,1:1:3,2:2:5,4:2:7,6:2:9 | 0:3:3,3:1:5,4:2:7,6:2:5 | 0:2:3,2:2:5,4:2:3,6:2:2 | 0:2:8,2:2:7,4:4:1',
      },
      B: {
        ch: 'D7 | D7 | G7 | G7 | C7 | C7 | F7 | F7',
        mel: '0:6:3,6:2:5 | 0:2:7,2:2:9,4:4:13 | 0:6:3,6:2:5 | 0:2:7,2:2:9,4:4:13 | 0:6:3,6:2:5 | 0:2:7,2:2:9,4:4:13 | 0:2:3,2:2:5,4:2:7,6:2:9 | 0:6:3',
      },
    },
  };
  const FORM = ['A', 'A', 'B', 'A'];
  const CHORUS = ['head', 'solo', 'solo2', 'shout'];
  const INTRO = 2;   // bars of rhythm-section intro (the last two bars of the form, a drum fill)
  const RANGE = { tp: [63, 82], harmon: [62, 79], as: [60, 80], ts: [50, 72], vibes: [65, 88], piano: [62, 84] };
  // horn background riffs: [bar parity, eighth, length in eighths]
  const STABS = [
    [[0, 0, 2], [0, 3, 1], [1, 2, 1], [1, 4, 3]],
    [[0, 3, 1], [0, 7, 2], [1, 3, 1], [1, 6, 2]],
    [[0, 1, 1], [0, 3, 1], [0, 7, 2], [1, 5, 1]],
    [[1, 3, 1], [1, 7, 2]],
  ];
  const SWING_COMP = [[0, 3], [3, 7], [2, 5], [0, 5], [3], [1, 4], [3, 6], [0], [5, 7], [], [0, 3, 7]];
  const LATIN_COMP = [[0, 3, 6], [2, 5, 7], [0, 3, 5], [1, 3, 6]];
  function prep(def) {
    if (def.bars) return def;
    const secs = {};
    for (const k of ['A', 'B']) {
      secs[k] = { ch: bars(def[k].ch), mel: mel(def[k].mel) };
      if (secs[k].ch.length !== 8) throw new Error('music: section needs 8 bars');
    }
    def.bars = [];
    FORM.forEach((sec, sIdx) => {
      for (let i = 0; i < 8; i++) {
        const notes = secs[sec].mel[i] || [], at = [];
        for (const n of notes) (at[n.p] = at[n.p] || []).push(n);
        // where the melody leaves room in this bar for the vibes to answer
        const freeFrom = notes.reduce((a, n) => Math.max(a, n.p + n.d), 0);
        def.bars.push({ sec, sIdx, inSec: i, ch: secs[sec].ch[i], at, freeFrom });
      }
    });
    return def;
  }
  const chordAt = (bar, pos) => (pos >= 4 && bar.ch[1] ? bar.ch[1] : bar.ch[0]);

  // ---- Sampled instruments, rendered once per AudioContext ----------------
  function render(ac) {
    const sr = ac.sampleRate;
    const buf = (len, fn, peak = 0.9) => {
      const n = Math.ceil(len * sr), b = ac.createBuffer(1, n, sr), d = b.getChannelData(0);
      fn(d, n);
      let mx = 0;
      for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(d[i]));
      if (mx > 0) for (let i = 0; i < n; i++) d[i] *= peak / mx;
      // tiny fade-out so a buffer never ends on a click
      const f = Math.min(n, (sr * 0.01) | 0);
      for (let i = 0; i < f; i++) d[n - 1 - i] *= i / f;
      return b;
    };
    // sum of decaying partials, each via a rotating phasor (cheap sine)
    const additive = (d, n, f0, parts, attack = 0.002) => {
      for (const p of parts) {
        const f = f0 * p.r;
        if (f > sr * 0.42) continue;
        const w = 2 * Math.PI * f / sr, c = Math.cos(w), s = Math.sin(w), k = Math.exp(-p.d / sr);
        const ph = rnd() * 6.283;
        let x = Math.cos(ph), y = Math.sin(ph), a = p.a;
        for (let i = 0; i < n && a > 1e-5; i++) {
          const nx = x * c - y * s; y = x * s + y * c; x = nx;
          d[i] += y * a; a *= k;
        }
      }
      const at = Math.max(1, (attack * sr) | 0);
      for (let i = 0; i < at && i < n; i++) d[i] *= i / at;
    };
    const lp = (fc) => { const a = 1 - Math.exp(-2 * Math.PI * fc / sr); let y = 0; return (x) => (y += a * (x - y)); };
    const bq = (type, f0, q) => {
      const w = 2 * Math.PI * f0 / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
      let b0, b1, b2;
      if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; } else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; } else { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
      const a0 = 1 + al, a1 = -2 * cw / a0, a2 = (1 - al) / a0;
      b0 /= a0; b1 /= a0; b2 /= a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      return (x) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
    };
    const wn = () => rnd() * 2 - 1;
    const metal = (d, n, freqs, amp, decay) => {
      freqs.forEach((f, k) => additive(d, n, f, [{ r: 1, a: amp * (0.6 + rnd() * 0.4), d: decay * (1 + k * 0.15) }], 0.0005));
    };
    const C = {};
    // acoustic piano: inharmonic partials, two-stage decay, a little hammer thump
    C.piano = [55, 70].map((root) => [root, buf(2.6, (d, n) => {
      const f0 = hz(root), parts = [];
      for (let k = 1; k <= 16; k++) {
        const r = k * Math.sqrt(1 + 0.0004 * k * k), a = Math.abs(Math.sin(Math.PI * k * 0.13)) / k ** 0.9;
        parts.push({ r, a: a * 0.55, d: 2.2 + 0.9 * k }, { r: r * 1.0007, a: a * 0.45, d: 0.45 + 0.2 * k });
      }
      additive(d, n, f0, parts, 0.0015);
      const l = lp(1200);
      for (let i = 0; i < sr * 0.03; i++) d[i] += l(wn()) * 0.25 * Math.exp(-i / sr * 120);
    })]);
    // upright bass: plucked, the upper partials die fast like a closing filter
    C.bass = [33, 45].map((root) => [root, buf(2.0, (d, n) => {
      const parts = [];
      for (let k = 1; k <= 12; k++) parts.push({ r: k, a: Math.abs(Math.sin(Math.PI * k * 0.2)) / k ** 1.25, d: 1.2 + 0.28 * k * k });
      additive(d, n, hz(root), parts, 0.006);
      const l = lp(300);
      for (let i = 0; i < sr * 0.05; i++) d[i] += l(wn()) * 0.6 * Math.exp(-i / sr * 60);
    })]);
    // archtop guitar
    C.guitar = [[52, buf(1.4, (d, n) => {
      const parts = [];
      for (let k = 1; k <= 14; k++) parts.push({ r: k, a: Math.abs(Math.sin(Math.PI * k * 0.23)) / k ** 0.95, d: 2.5 + 0.9 * k });
      additive(d, n, hz(52), parts, 0.003);
    })]];
    // vibraphone: mallet on a bar (1 : 4 : 10 partials) with the motor's tremolo
    C.vibes = [[77, buf(2.8, (d, n) => {
      additive(d, n, hz(77), [{ r: 1, a: 1, d: 0.75 }, { r: 3.99, a: 0.28, d: 4.5 }, { r: 9.9, a: 0.05, d: 16 }], 0.001);
      const b = bq('bp', 2500, 1);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        if (t < 0.01) d[i] += b(wn()) * 0.4 * (1 - t / 0.01);
        d[i] *= 1 - 0.28 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 5.2 * t));
      }
    })]];
    // ---- drum kit
    const D = {};
    D.kick = buf(0.4, (d, n) => {
      let ph = 0; const l = lp(900);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += 2 * Math.PI * (48 + 70 * Math.exp(-t * 28)) / sr;
        d[i] = Math.sin(ph) * Math.exp(-t * 9) * Math.min(1, t / 0.002) + l(wn()) * 0.3 * Math.exp(-t * 200);
      }
    });
    D.snare = buf(0.35, (d, n) => {
      const b = bq('bp', 3200, 0.7), h = bq('hp', 4200, 0.7);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = Math.sin(2 * Math.PI * 182 * t) * Math.exp(-t * 24) * 0.45 + Math.sin(2 * Math.PI * 331 * t) * Math.exp(-t * 32) * 0.2 +
          b(wn()) * Math.exp(-t * 14) * 0.9 + h(wn()) * Math.exp(-t * 9) * 0.25;
        d[i] *= Math.min(1, t / 0.001);
      }
    });
    D.ride = buf(1.6, (d, n) => {
      metal(d, n, [2960, 3730, 4470, 5250, 6210, 7340, 8670], 0.05, 2.2);
      const h = bq('hp', 4500, 0.7), p = bq('bp', 6500, 2);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] += h(wn()) * 0.22 * Math.exp(-t * 3.2) + p(wn()) * 0.9 * Math.exp(-t * 45);
      }
    }, 0.8);
    D.crash = buf(2.4, (d, n) => {
      metal(d, n, [2510, 3170, 3990, 4810, 5730, 6890], 0.04, 1.6);
      const h = bq('hp', 2800, 0.6), b = bq('bp', 5000, 1);
      for (let i = 0; i < n; i++) {
        const t = i / sr, e = Math.min(1, t / 0.003);
        d[i] += (h(wn()) * 0.5 * Math.exp(-t * 1.7) + b(wn()) * 0.5 * Math.exp(-t * 4)) * e;
      }
    }, 0.8);
    D.hat = buf(0.15, (d, n) => {
      metal(d, n, [3400, 5530, 7900, 10400], 0.15, 40);
      const b = bq('bp', 8500, 1.2);
      for (let i = 0; i < n; i++) { const t = i / sr; d[i] = (d[i] + b(wn()) * 0.8 * Math.exp(-t * 50)) * Math.min(1, t / 0.003); }
    });
    D.brush = buf(0.4, (d, n) => {
      const b = bq('bp', 3000, 0.6);
      for (let i = 0; i < n; i++) { const t = i / sr; d[i] = b(wn()) * (t < 0.04 ? t / 0.04 : Math.exp(-(t - 0.04) * 10)); }
    }, 0.6);
    for (const [name, base] of [['tomHi', 150], ['tomLo', 100]]) {
      D[name] = buf(0.5, (d, n) => {
        let ph = 0; const b = bq('bp', 600, 1);
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          ph += 2 * Math.PI * (base + base * 0.3 * Math.exp(-t * 20)) / sr;
          d[i] = (Math.sin(ph) * Math.exp(-t * 7) + b(wn()) * 0.25 * Math.exp(-t * 30)) * Math.min(1, t / 0.002);
        }
      });
    }
    D.rim = buf(0.08, (d, n) => {
      const h = bq('hp', 3000, 0.7);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = Math.sin(2 * Math.PI * 1750 * t) * Math.exp(-t * 80) + Math.sin(2 * Math.PI * 460 * t) * 0.5 * Math.exp(-t * 60) + h(wn()) * 0.4 * Math.exp(-t * 150);
      }
    }, 0.7);
    D.shaker = buf(0.1, (d, n) => {
      const h = bq('hp', 5500, 0.7);
      for (let i = 0; i < n; i++) { const t = i / sr; d[i] = h(wn()) * (t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) * 45)); }
    }, 0.6);
    C.drums = D;
    // a warm room: decaying, darkening stereo noise
    const len = Math.ceil(sr * 1.7), ir = ac.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c), l1 = lp(5000), l2 = lp(1500);
      for (let i = (sr * 0.012) | 0; i < len; i++) {
        const t = i / sr, x = wn(), mix = Math.min(1, t / 0.9);
        d[i] = (l1(x) * (1 - mix) + l2(x) * mix * 1.6) * Math.exp(-t * 3.4);
      }
    }
    C.ir = ir;
    return C;
  }

  // ---- The engine ---------------------------------------------------------
  window.makeEchoMusic = ({ ctx, bus /* , noise */ }) => {
    let ac = null, C = null, comp = null, out = null, conv = null, S = null, style = null;

    function setup(a) {
      if (ac === a && C) return;
      ac = a;
      C = render(ac);
      comp = ac.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 4;
      comp.attack.value = 0.006; comp.release.value = 0.2;
      out = ac.createGain(); out.gain.value = 0.6;
      comp.connect(out);
      conv = ac.createConvolver(); conv.buffer = C.ir; conv.connect(comp);
    }

    // ---- voices
    function playBuf(set, m, t, vol, dest, dur, rel = 0.06) {
      let best = set[0];
      for (const s of set) if (Math.abs(s[0] - m) < Math.abs(best[0] - m)) best = s;
      const rate = 2 ** ((m - best[0]) / 12), b = best[1];
      const src = ac.createBufferSource(), g = ac.createGain();
      src.buffer = b; src.playbackRate.value = rate;
      g.gain.setValueAtTime(vol, t);
      let end = t + b.duration / rate;
      if (dur != null && t + dur + rel * 5 < end) { g.gain.setTargetAtTime(0, t + dur, rel); end = t + dur + rel * 6; }
      src.connect(g); g.connect(dest);
      src.onended = () => g.disconnect();
      src.start(Math.max(t, ac.currentTime)); src.stop(end);
    }
    function hit(name, t, vol) {
      const src = ac.createBufferSource(), g = ac.createGain();
      src.buffer = C.drums[name];
      if (name === 'ride' || name === 'crash' || name === 'hat') src.playbackRate.value = 0.97 + rnd() * 0.06;
      g.gain.value = vol * (0.9 + rnd() * 0.2);
      src.connect(g); g.connect(name === 'ride' || name === 'crash' || name === 'shaker' ? S.ch.cym : S.ch.kit);
      src.onended = () => g.disconnect();
      src.start(Math.max(t + (rnd() - 0.5) * 0.004, ac.currentTime));
    }
    const LEAD = {
      tp: { osc: ['sawtooth', 'sawtooth'], mix: 0.7, det: 7, f: 'lowpass', lo: 500, hi: 2600, q: 1, att: 0.018, vib: 10, vol: 0.9 },
      harmon: { osc: ['sawtooth', 'square'], mix: 0.3, det: 5, f: 'bandpass', lo: 900, hi: 1600, q: 1.8, att: 0.02, vib: 8, vol: 1.7 },
      as: { osc: ['sawtooth', 'square'], mix: 0.35, det: 4, f: 'lowpass', lo: 450, hi: 1900, q: 2.2, att: 0.025, vib: 16, vol: 1, scoop: 45 },
      ts: { osc: ['sawtooth', 'triangle'], mix: 0.6, det: 5, f: 'lowpass', lo: 350, hi: 1300, q: 2.5, att: 0.03, vib: 18, vol: 1.15, scoop: 55 },
    };
    // a lead horn note: filtered saw with a breathy swell, scoop and late vibrato
    function horn(kind, m, t, dur, vol) {
      const P = LEAD[kind], f = hz(m), end = t + dur;
      const g = ac.createGain(), flt = ac.createBiquadFilter();
      flt.type = P.f; flt.Q.value = P.q;
      const peak = Math.min(P.hi + f * 1.2, 6000);
      flt.frequency.setValueAtTime(P.lo, t);
      flt.frequency.linearRampToValueAtTime(peak, t + P.att + 0.03);
      flt.frequency.setTargetAtTime(peak * 0.72, t + P.att + 0.03, 0.18);
      vol *= P.vol;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + P.att);
      g.gain.setTargetAtTime(vol * 0.78, t + P.att, 0.25);
      g.gain.setTargetAtTime(0, end, 0.035);
      let lg = null;
      if (dur > 0.3 && P.vib) {
        const lfo = ac.createOscillator(); lg = ac.createGain();
        lfo.frequency.value = 5 + rnd() * 0.8;
        lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + 0.15); lg.gain.linearRampToValueAtTime(P.vib, end);
        lfo.connect(lg); lfo.start(t); lfo.stop(end + 0.25);
      }
      const scoop = P.scoop && chance(0.3) ? P.scoop : 0;
      let last = null;
      P.osc.forEach((type, i) => {
        const o = ac.createOscillator();
        o.type = type; o.frequency.value = f;
        const base = (i ? P.det : -P.det * 0.4) + (rnd() - 0.5) * 4;
        o.detune.setValueAtTime(base - scoop, t);
        if (scoop) o.detune.linearRampToValueAtTime(base, t + 0.07);
        if (lg) lg.connect(o.detune);
        if (i) { const mg = ac.createGain(); mg.gain.value = P.mix; o.connect(mg); mg.connect(flt); } else o.connect(flt);
        o.start(t); o.stop(end + 0.25);
        last = o;
      });
      flt.connect(g); g.connect(S.ch.lead);
      last.onended = () => g.disconnect();
    }
    // the horn section: one shared swell filter + envelope over all the voices
    function brass(notes, t, dur, vol, o = {}) {
      const g = ac.createGain(), f = ac.createBiquadFilter(), end = t + dur;
      f.type = 'lowpass'; f.Q.value = 0.8;
      const att = o.pad ? 0.22 : 0.022, pk = o.pad ? 1000 : 1700 + 1300 * (o.acc || 0), rel = o.pad ? 0.15 : 0.045;
      f.frequency.setValueAtTime(o.pad ? 350 : 450, t);
      f.frequency.linearRampToValueAtTime(pk, t + att + 0.02);
      f.frequency.setTargetAtTime(pk * (o.pad ? 0.9 : 0.6), t + att + 0.02, o.pad ? 0.5 : 0.12);
      const v = vol / Math.sqrt(notes.length + 1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + att);
      if (!o.pad) g.gain.setTargetAtTime(v * 0.6, t + att, Math.max(0.06, dur * 0.6));
      g.gain.setTargetAtTime(0, o.fall ? end + 0.12 : end, o.fall ? 0.1 : rel);
      const stopAt = end + rel * 6 + (o.fall ? 0.45 : 0);
      let lg = null;
      if (dur > 0.45) {
        const lfo = ac.createOscillator(); lg = ac.createGain();
        lfo.frequency.value = 4.8 + rnd() * 0.6;
        lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(o.pad ? 6 : 9, end);
        lfo.connect(lg); lfo.start(t); lfo.stop(stopAt);
      }
      let last = null;
      for (const [m, n] of notes) {
        for (let k = 0; k < n; k++) {
          const os = ac.createOscillator();
          os.type = 'sawtooth'; os.frequency.value = hz(m);
          const base = (rnd() - 0.5) * 12 + (k ? 8 : 0);
          os.detune.setValueAtTime(base - (o.pad ? 0 : 25), t);
          os.detune.linearRampToValueAtTime(base, t + 0.05);
          if (o.fall) {
            os.detune.setValueAtTime(base, Math.max(t + 0.06, end - 0.02));
            os.detune.linearRampToValueAtTime(base - 900, end + 0.4);
          }
          if (lg) lg.connect(os.detune);
          os.connect(f); os.start(t); os.stop(stopAt);
          last = os;
        }
      }
      f.connect(g); g.connect(S.ch.horns);
      last.onended = () => g.disconnect();
    }
    const piano = (m, t, vol, dur) => playBuf(C.piano, m, t, vol, S.ch.piano, dur, 0.07);
    const vibes = (m, t, vol, dur) => playBuf(C.vibes, m, t, vol, S.ch.vibes, Math.max(dur, 0.5), 0.25);
    const bass = (m, t, vol, dur) => playBuf(C.bass, m, t, vol, S.ch.bass, dur, 0.04);
    const guitar = (m, t, vol, dur) => playBuf(C.guitar, m, t, vol, S.ch.guitar, dur, 0.03);
    function solo(kind, m, t, dur, vol) {
      if (kind === 'vibes') vibes(m, t, vol * 0.75, dur);
      else if (kind === 'piano') piano(m, t, vol * 0.55, dur);
      else horn(kind, m, t, dur, vol * 0.13);
    }

    // ---- an improviser: bebop-ish eighth lines that target chord tones,
    // with chromatic approaches into chord changes, phrases and breaths
    function line(V, ch, nx, pos, lo, hi, dblP) {
      if (V.hold > 0) { V.hold--; return null; }
      if (V.rest > 0) { V.rest--; if (!V.rest) { V.len = V.nextLen || 6 + ((rnd() * 14) | 0); V.nextLen = 0; } return null; }
      let m;
      if (nx !== ch && (pos === 3 || pos === 7) && chance(0.55)) {
        const tgt = place(pcOf(nx.root + pick(nx.ct.slice(1))), V.prev, 0, lo + 1, hi - 1);
        m = tgt === V.prev ? tgt + 1 : tgt + (V.prev > tgt ? 1 : -1);
        V.dir = V.prev > tgt ? -1 : 1;
      } else if (pos % 2 === 0 && chance(0.4)) {
        m = V.prev;
        for (let i = 0; i < 4; i++) { m = scaleStep(m, ch, V.dir); if (isCT(m, ch)) break; }
      } else {
        m = scaleStep(V.prev, ch, V.dir);
        if (chance(0.2)) m = scaleStep(m, ch, V.dir);
      }
      if (m > hi) { V.dir = -1; m = scaleStep(scaleStep(V.prev, ch, -1), ch, -1); }
      if (m < lo) { V.dir = 1; m = scaleStep(scaleStep(V.prev, ch, 1), ch, 1); }
      if (chance(0.14)) V.dir = -V.dir;
      let d = 1;
      const r = rnd();
      if (r < 0.1) d = 2; else if (r < 0.14) d = 3;
      V.len -= d;
      if (V.len <= 0) { d = 2 + ((rnd() * 3) | 0); V.rest = 1 + ((rnd() * 5) | 0); }
      V.hold = d - 1; V.prev = m;
      return { m, d, v: pos % 2 ? 1 : 0.82, dbl: d === 1 && V.len > 2 && chance(dblP) };
    }
    const newLine = (lo, hi, rest) => ({ prev: ((lo + hi) / 2) | 0, dir: 1, rest, len: 8, hold: 0 });

    // ---- one eighth note of the band
    function info(s) {
      const T = S.T, gb = Math.floor(s / 8) - INTRO, intro = gb < 0;
      const fb = intro ? 32 + gb : gb % 32, chorus = intro ? -1 : Math.floor(gb / 32), bar = T.bars[fb];
      const kind = intro ? 'intro' : CHORUS[chorus % 4];
      let feel = T.feel[bar.sec];
      if (T.twoFeel && (intro || (chorus === 0 && bar.sec === 'A'))) feel = 'two';
      return { fb, bar, chorus, kind, feel, sec: bar.sec, sIdx: bar.sIdx, inSec: bar.inSec, next: T.bars[(fb + 1) % 32], intro };
    }
    const chordAfter = (I, pos) => (pos + 1 >= 8 ? I.next.ch[0] : chordAt(I.bar, pos + 1));

    function drums(I, pos, t, e) {
      const T = S.T, solo = I.kind === 'solo' || I.kind === 'solo2';
      const k = T.drive * (I.kind === 'shout' ? 1.15 : 1) * (I.intro ? 0.85 : 1);
      if (pos === 0) S.fill = I.inSec === 7 ? (I.sIdx === 3 ? 'big' : 'small') : I.inSec === 3 && chance(0.45) ? 'tiny' : null;
      if (pos === 0 && I.inSec === 0 && !(I.intro && I.fb === 32 - INTRO)) {
        hit('crash', t, (I.sIdx === 0 ? 0.8 : 0.5) * k); hit('kick', t, 0.7 * k);
      }
      const from = { big: 2, small: 4, tiny: 6 }[S.fill] ?? 9;
      if (pos >= from) {
        const F = S.fill === 'big'
          ? [null, null, ['snare', 0.4, 1], ['snare', 0.5], ['tomHi', 0.55, 1], ['tomHi', 0.6], ['tomLo', 0.65, 1], ['snare', 0.8]]
          : S.fill === 'small' ? [null, null, null, null, ['snare', 0.45], ['snare', 0.55, 1], ['tomHi', 0.6], ['tomLo', 0.7]]
            : [null, null, null, null, null, null, ['snare', 0.5], ['snare', 0.65]];
        const [name, v, dbl] = F[pos];
        const alt = chance(0.25) ? pick(['snare', 'tomHi', 'tomLo']) : name;
        hit(alt, t, v * k);
        if (dbl || chance(0.15)) hit(alt, t + e * 0.5, v * 0.7 * k);
        if (pos === 7) hit('kick', t, 0.55 * k);
        return;
      }
      if (I.feel === 'latin') {
        hit('ride', t, (pos % 2 ? 0.26 : 0.38) * k);
        hit('shaker', t, 0.3 * k); hit('shaker', t + e * 0.5, 0.18 * k);
        if ((I.inSec % 2 === 0 ? [0, 3, 6] : [2, 4]).includes(pos)) hit('rim', t, 0.45 * k);
        const kv = [0.55, 0, 0, 0.32, 0.55, 0, 0, 0.32][pos];
        if (kv) hit('kick', t, kv * k);
        if (pos === 2 || pos === 6) hit('hat', t, 0.3 * k);
        return;
      }
      const brush = T.brush && I.sec === 'A' && I.kind !== 'shout';
      const rv = brush ? 0.6 : 1;
      if (pos % 2 === 0) hit('ride', t, (pos === 2 || pos === 6 ? 0.55 : 0.45) * k * rv);
      else if (pos === 3 || pos === 7) hit('ride', t, 0.32 * k * rv);
      if (brush && pos % 2 === 0) hit('brush', t, pos === 2 || pos === 6 ? 0.5 : 0.25);
      if (pos === 2 || pos === 6) hit('hat', t, 0.45 * k);
      if (pos % 2 === 0) hit('kick', t, (I.feel === 'two' && pos % 4 === 0 ? 0.35 : 0.13) * k);
      if ((pos % 2 || chance(0.3)) && chance(0.11 * T.drive * (solo ? 1.6 : 1))) hit('snare', t, chance(0.7) ? 0.17 : 0.42);
      if ((pos === 3 || pos === 7) && chance(0.035 * k * (solo ? 1.7 : 1))) {
        hit('kick', t, 0.65 * k);
        if (chance(0.3)) hit('crash', t, 0.35 * k);
      }
    }

    function walk(I, pos, t, e) {
      const ch = chordAt(I.bar, pos), b = S.bp;
      const fold = (m) => { while (m > 50) m -= 12; while (m < 28) m += 12; return m; };
      const fifth = (c, ref) => place(pcOf(c.root + c.ct[2]), ref);
      let m = null, len = 2;
      if (I.feel === 'latin') {
        const nx = pos >= 4 ? I.next.ch[0] : chordAt(I.bar, 4);
        if (pos === 0) { m = place(ch.root, b); len = 3; }
        else if (pos === 3) { m = fifth(ch, b); len = 1; }
        else if (pos === 4) { m = I.bar.ch[1] ? place(ch.root, b) : fifth(ch, b); len = 3; }
        else if (pos === 7) { m = place(nx.root, b) + (chance(0.5) ? 1 : -1); len = 1; }
      } else if (I.feel === 'two') {
        if (pos === 0) { m = place(ch.root, b); len = 4; }
        else if (pos === 4) { m = I.bar.ch[1] ? place(ch.root, b) : chance(0.5) ? fifth(ch, b) : place(I.next.ch[0].root, b) + (chance(0.5) ? 1 : -1); len = 4; }
        else if (pos === 6 && chance(0.2)) { m = place(I.next.ch[0].root, b) + 1; len = 1; }
      } else if (pos % 2 === 0) {
        const nb = pos + 2 >= 8 ? I.next.ch[0] : chordAt(I.bar, pos + 2);
        if (pos === 0 || (pos === 4 && I.bar.ch[1])) {
          m = S.lastRoot === ch && chance(0.3) ? place(pcOf(ch.root + pick([ch.ct[1], ch.ct[2]])), b) : place(ch.root, b);
          S.lastRoot = ch;
        } else if (nb !== ch || pos === 6) {
          const tgt = place(nb.root, b);
          m = chance(0.65) ? tgt + (chance(0.5) ? 1 : -1) : chance(0.5) ? fifth(nb, b) : scaleStep(b, ch, tgt > b ? 1 : -1);
        } else {
          const opts = [ch.ct[1], ch.ct[2], ch.ct[3]].map((i) => place(pcOf(ch.root + i), b)).filter((x) => x !== b);
          opts.sort((x, y) => Math.abs(x - b) - Math.abs(y - b));
          m = chance(0.7) ? opts[chance(0.6) ? 0 : 1] : scaleStep(b, ch, chance(0.5) ? 1 : -1);
        }
        if (pos === 6 && chance(0.1)) bass(fold(m + 1), t + e * 1.33, 0.35, e * 0.4);   // a ghosted rake
      }
      if (m == null) return;
      m = fold(m);
      bass(m, t, (pos === 0 ? 1 : 0.88) * (0.92 + rnd() * 0.12), len * e * 0.92);
      S.bp = m;
    }

    function piaComp(I, pos, t, e, kind) {
      const T = S.T;
      if (pos === 0) {
        S.cp = I.feel === 'latin' ? LATIN_COMP[(I.inSec % 2) * 2 + (chance(0.5) ? 0 : 1)] : pick(SWING_COMP);
        if (S.antic && S.cp[0] === 0) S.cp = S.cp.slice(1);
        S.antic = false;
      }
      if (!S.cp.includes(pos)) return;
      let p = T.comp;
      if (kind === 'shout' || kind === 'solo2') p *= 0.6;
      if (!chance(p)) return;
      const ch = pos % 2 ? chordAfter(I, pos) : chordAt(I.bar, pos);
      if (pos === 7) S.antic = true;
      const v = voicing(ch, S.pv, 50);
      S.pv = (v[0] + v[3]) / 2;
      const long = pos === 0 || pos === 7 ? chance(0.5) : chance(0.15);
      const vol = (pos % 2 ? 0.2 : 0.17) * (0.85 + rnd() * 0.3);
      if (long && chance(0.4)) v.push(v[0] + 12);   // fatter voicing: double the bottom on top
      v.forEach((m, i) => piano(m, t + i * 0.005, vol, (long ? 3 : 1.1) * e));
    }

    function guit(I, pos, t, e) {
      if (!S.T.guitar) return;
      const ch = chordAt(I.bar, pos);
      let on = false, vol = 0.22;
      if (I.feel === 'latin') { on = [0, 2, 3, 5, 6].includes(pos); vol = pos % 2 ? 0.18 : 0.13; }
      else { on = pos % 2 === 0; vol = pos === 2 || pos === 6 ? 0.2 : 0.16; }
      if (!on) return;
      const v = voicing(ch, 58, 51, 3);
      v.forEach((m, i) => guitar(m, t + i * 0.008, vol, e * (I.feel === 'latin' ? 0.8 : 1.1)));
    }

    function hornsAt(I, pos, t, e) {
      const T = S.T, k = I.kind;
      let mode = null;
      if (k === 'head') mode = T.headHorns[I.sec];
      else if (k === 'solo' || k === 'solo2') mode = [null, 'pad', (I.chorus + 2) % 4, (I.chorus + 1) % 3][I.sIdx];
      else if (k === 'shout') mode = I.sec === 'A' ? 'shout' : (I.chorus % 3);
      if (mode == null) return;
      if (mode === 'pad') {
        if (pos === 0 || (pos === 4 && I.bar.ch[1])) {
          const ch = chordAt(I.bar, pos), top = place(pcOf(ch.root + ch.va[2]), S.pt || 66, 0, 61, 70);
          S.pt = top;
          brass(section(top, ch).map(([m]) => [m, 1]), t, (I.bar.ch[1] ? 4 : 8) * e * 0.97, 0.22, { pad: true });
        }
      } else if (mode === 'shout') {
        for (const n of I.bar.at[pos] || []) {
          const ch = chordAt(I.bar, pos);
          const top = place(degPc(ch, n.deg), S.st, n.dir, 69, 82);
          S.st = top;
          const last = I.inSec === 7 && !(I.bar.at.slice(pos + 1).some(Boolean));
          brass(section(top, ch), t, n.d * e * 0.9, n.d >= 2 ? 0.5 : 0.42, { acc: n.d >= 2 ? 1 : 0.6, fall: last && I.sIdx === 3 });
          if (n.d >= 2 && chance(0.6)) hit(chance(0.5) ? 'snare' : 'kick', t, 0.5);
        }
      } else {
        for (const [par, p, len] of STABS[mode]) {
          if (p !== pos || I.inSec % 2 !== par) continue;
          const ch = pos % 2 ? chordAfter(I, pos) : chordAt(I.bar, pos);
          const pcs = ch.va.map((i) => pcOf(ch.root + i));
          let top = 0, bd = 99;
          for (const pc of pcs) { const c = place(pc, S.ht, 0, 68, 78); if (Math.abs(c - S.ht) < bd) { bd = Math.abs(c - S.ht); top = c; } }
          S.ht = top;
          brass(section(top, ch), t, len * e * 0.85, len >= 2 ? 0.42 : 0.34, { acc: len >= 2 ? 0.8 : 0.4 });
          if (chance(0.6)) hit(len >= 2 ? 'kick' : 'snare', t, len >= 2 ? 0.55 : 0.4);
        }
      }
    }

    function leads(I, pos, t, e) {
      const T = S.T, k = I.kind;
      if (pos === 0 && I.fb === 0) {   // a new chorus: pick who solos
        S.L = newLine(...(RANGE[T.solo[(I.chorus >> 2) % T.solo.length]]), 1);
        const vs = T.solo2[(I.chorus >> 2) % T.solo2.length];
        S.V = newLine(...RANGE[vs], k === 'solo2' ? 1 : Infinity);
        S.V.who = vs;
      }
      const ch = chordAt(I.bar, pos), nx = chordAfter(I, pos);
      if (k === 'head') {
        const [main, dbl] = T.head, [lo, hi] = RANGE[main];
        const vary = I.chorus > 0 || I.sIdx > 0;
        let notes = I.bar.at[pos] || [];
        if (pos === 0 && S.skip0) { notes = notes.slice(1); }
        S.skip0 = false;
        // a varied head pushes the next bar's downbeat note an eighth early
        if (pos === 7 && vary && I.fb !== 31 && chance(0.3)) {
          const n0 = (I.next.at[0] || [])[0];
          if (n0) { notes = notes.concat({ ...n0, d: n0.d + 1, ch: I.next.ch[0] }); S.skip0 = true; }
        }
        for (const n of notes) {
          const c = n.ch || ch;
          const m = place(degPc(c, n.deg), S.lp, n.dir, lo, hi);
          S.lp = m;
          const dur = n.d * e * (n.d === 1 ? 0.85 : 0.95), vol = (n.d >= 2 ? 1 : 0.88) * (pos % 2 ? 1 : 0.9);
          if (vary && n.d >= 2 && chance(0.2)) solo(main, m - 1, t - e * 0.3, e * 0.28, vol * 0.7);   // grace note
          solo(main, m, t, dur, vol);
          if (dbl) solo(dbl, m - 12, t + 0.004, dur, vol * 0.8);
          if (T.dblVibes && I.feel === 'latin') vibes(m, t, 0.22, dur);
        }
        // vibes answer the melody when it leaves room
        // (after the bar's last note, or under a long held note)
        const held = notes.find((n) => n.d >= 4 && pos + n.d <= 8);
        if (!S.V.fill && ((pos === I.bar.freeFrom && pos <= 6) || held) && chance(T.fillP)) {
          S.V.rest = held ? 1 : 0; S.V.len = S.V.nextLen = held ? held.d - 2 : 8 - pos; S.V.prev = S.lp + (chance(0.5) ? 3 : 8); S.V.fill = true;
        }
        if (S.V.fill) {
          const r = line(S.V, ch, nx, pos, ...RANGE.vibes, 0);
          if (r) vibes(r.m, t, 0.3 * r.v, r.d * e);
          if (S.V.rest > 0) { S.V.rest = Infinity; S.V.fill = false; }
        }
        return;
      }
      if (k === 'solo' || (k === 'shout' && I.sec === 'B')) {
        const who = T.solo[(I.chorus >> 2) % T.solo.length], [lo, hi] = RANGE[who];
        const r = line(S.L, ch, nx, pos, lo, hi, T.dbl);
        if (r) {
          solo(who, r.m, t, r.d * e * (r.d === 1 ? 0.9 : 0.96), r.v * (r.d > 1 ? 1 : 0.92));
          if (r.dbl) {
            const m2 = scaleStep(r.m, ch, S.L.dir);
            solo(who, m2, t + e * 0.5, e * 0.45, r.v * 0.85);
            S.L.prev = m2;
          }
        }
      } else if (k === 'solo2') {
        const who = S.V.who, [lo, hi] = RANGE[who];
        const r = line(S.V, ch, nx, pos, lo, hi, T.dbl);
        if (r) {
          solo(who, r.m, t, r.d * e, r.v);
          if (r.dbl) solo(who, scaleStep(r.m, ch, S.V.dir), t + e * 0.5, e * 0.45, r.v * 0.8);
        }
      }
    }

    function play(I, pos, t, e) {
      drums(I, pos, t, e);
      walk(I, pos, t + 0.003, e);
      piaComp(I, pos, t + (rnd() - 0.3) * 0.008, e, I.kind);
      guit(I, pos, t, e);
      if (!I.intro) { hornsAt(I, pos, t, e); leads(I, pos, t + 0.004, e); }
    }

    function schedule() {
      if (!S) return;
      const e = 60 / S.T.bpm / 2, now = ac.currentTime;
      if (S.next < now - 0.05) {   // timers were throttled (background tab): skip ahead quietly
        const n = Math.ceil((now - S.next) / e);
        S.next += n * e; S.step += n;
      }
      while (S.next < now + 0.2) {
        const I = info(S.step), pos = S.step % 8;
        const sw = S.step % 2 && I.feel !== 'latin' ? e * 2 * (S.T.swing - 0.5) : 0;
        play(I, pos, S.next + sw, e);
        S.next += e; S.step++;
      }
    }

    function start(name) {
      const T = prep(TUNES[name]), now = ac.currentTime;
      out.disconnect(); out.connect(bus());
      const tg = ac.createGain(), rv = ac.createGain();
      tg.gain.setValueAtTime(0.0001, now); tg.gain.exponentialRampToValueAtTime(1, now + 0.3);
      tg.connect(comp); rv.connect(conv);
      const chan = (lvl, pan, send, lpf) => {
        const g = ac.createGain(); g.gain.value = lvl;
        let n = g;
        if (lpf) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lpf; n.connect(f); n = f; }
        if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; n.connect(p); n = p; }
        n.connect(tg);
        if (send) { const s = ac.createGain(); s.gain.value = send; n.connect(s); s.connect(rv); }
        return g;
      };
      S = {
        T, tg, rv, step: 0, next: now + 0.1, timer: null,
        ch: {
          bass: chan(0.22, 0, 0.04, 1400), piano: chan(0.45, -0.3, 0.18, 5200), guitar: chan(0.22, 0.35, 0.12, 3000),
          vibes: chan(0.5, 0.4, 0.28, 7000), horns: chan(0.47, 0.15, 0.22, 6000), lead: chan(0.52, -0.05, 0.22, 7000),
          kit: chan(0.33, 0, 0.1, 9000), cym: chan(0.3, 0.25, 0.1, 11000),
        },
        bp: 40, pv: 58, pt: 66, ht: 73, st: 74, lp: 70, cp: [], antic: false, skip0: false, fill: null, lastRoot: null,
        L: newLine(60, 78, 1), V: newLine(65, 86, Infinity),
      };
      S.lp = ((RANGE[T.head[0]][0] + RANGE[T.head[0]][1]) / 2) | 0;
      S.timer = setInterval(schedule, 40);
      schedule();
    }

    function stop() {
      if (!S) return;
      clearInterval(S.timer);
      const { tg, rv } = S, now = ac.currentTime;
      for (const g of [tg, rv]) { g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.setTargetAtTime(0.0001, now, 0.15); }
      setTimeout(() => { tg.disconnect(); rv.disconnect(); }, 1500);
      S = null; style = null;
    }

    return {
      // idempotent: call every frame with the tune that should be playing, or false
      set(want) {
        if (!want || !TUNES[want]) { stop(); return; }
        const a = ctx();
        if (want === style && S && a === ac) return;
        if (!a || a.state !== 'running') return;
        stop();
        setup(a);
        style = want;
        start(want);
      },
    };
  };
})();
