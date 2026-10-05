// Echo Caves: voice chat for online rooms (lobby and matches, Battle and Co-op).
//
// Opt-in: the microphone is only opened after the player turns voice on (a "Turn on voice
// chat?" step the first time). Modes: Off, Push to talk (hold a key, default V, or hold the
// mic button) and Open mic (sends while your voice is over the gate line). PCs start on Push
// to talk, phones and tablets on Open mic. Settings live in localStorage ('echo-voice').
//
// Audio takes two roads at once:
//  - WebRTC: a direct peer-to-peer link between every two people with voice on (a mesh,
//    up to 8), set up with tiny signalling messages through the room (net.js passes them on).
//  - Relay: while a pair has no working direct link (phone networks often block them, and
//    there is no TURN server), the sender also streams its voice through the room itself:
//    16 kHz mono, 4-bit IMA ADPCM, 60 ms frames (486 bytes), only while actually talking.
//    The Cloudflare room server copies those binary frames to everyone listening (rate-limited);
//    other transports pass them through the host. Listeners play them through a small jitter buffer.
// ?voice=relay skips WebRTC (relay only), ?voice=rtc never relays (both are for testing).
//
// net.js calls attach(net) / detach() / room(myId, peers) / signal(from, d) / frame(from, bytes).
// For the HUD: EchoVoice.speaking(slot), EchoVoice.onSpeaking = (slot, on) => {}, EchoVoice.info(slot).
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const FORCE = params.get('voice');           // 'relay' | 'rtc' | null
  const SEATS = [['Mo', '--mo'], ['Ka', '--ka'], ['Ca', '--ca'], ['Bo', '--bo'], ['Zu', '--zu'], ['Ri', '--ri'], ['Pi', '--pi'], ['Lu', '--lu']];
  const mm = (q) => { try { return matchMedia(q).matches; } catch { return false; } };
  const TOUCH = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const IS_PC = mm('(pointer: fine)') && !TOUCH;
  const KEYBOARD = IS_PC || mm('(any-pointer: fine)');
  const UA = navigator.userAgent;
  const IOS = /iP(hone|ad|od)/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  const SAFARI = /Safari/.test(UA) && !/Chrome|Chromium|Edg|Android/.test(UA);
  // Direct (WebRTC) voices play through an audio element on iPhone and Safari, the surest way there
  // (Web Audio then only measures who is talking); elsewhere through Web Audio, for per-player volume.
  const ELEMENT_OUT = params.get('voiceout') === 'element' || (params.get('voiceout') !== 'webaudio' && (IOS || SAFARI));
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  // keys the game already uses (game.js, duel.js, coop.js); the talk key can't be one of these
  const RESERVED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'NumpadEnter',
    'Escape', 'KeyP', 'KeyF', 'KeyG', 'KeyH', 'KeyX', 'KeyE', 'KeyQ', 'KeyR', 'KeyC', 'KeyM', 'KeyI', 'KeyK', 'KeyJ', 'KeyL', 'KeyU', 'KeyY', 'KeyO',
    'ShiftLeft', 'ShiftRight', 'ControlRight', 'Slash', 'Period', 'Comma', 'Quote', 'Tab', 'MetaLeft', 'MetaRight', 'ContextMenu']);
  const reserved = (code) => RESERVED.has(code) || /^Numpad/.test(code);   // the numpad flies a fourth bat

  // ---- Settings ----------------------------------------------------------------
  const STORE = 'echo-voice';
  const DEFAULTS = {
    on: false,            // the player turned voice on (opt-in); remembered for the next room
    asked: false,         // has seen and accepted the "Turn on voice chat?" step
    mode: IS_PC ? 'ptt' : 'open',
    key: 'KeyV',
    device: '',
    gain: 1,              // mic volume 0..2
    out: 1,               // everyone's voices 0..2
    gate: 0.4,            // open-mic line on the 0..1 level meter (about -42 dB)
    ns: true, ec: true, agc: true,
    muted: false,
  };
  const cfg = (() => {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE)); } catch { s = null; }
    const c = { ...DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
    if (c.mode !== 'ptt' && c.mode !== 'open') c.mode = DEFAULTS.mode;
    if (typeof c.key !== 'string' || reserved(c.key)) c.key = 'KeyV';
    for (const [k, lo, hi] of [['gain', 0, 2], ['out', 0, 2], ['gate', 0.05, 0.95]]) c[k] = Math.min(hi, Math.max(lo, +c[k] || DEFAULTS[k]));
    return c;
  })();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch { /* private mode */ } };

  // ---- State -----------------------------------------------------------------------
  let net = null;                 // net.js voice link while in a room
  let me = '', mySlot = -1;
  const peers = new Map();        // voice id -> peer
  let ac = null, outGain = null;
  let mic = null, src = null, micGain = null, gate = null, dest = null, cap = null, capSink = null;
  let running = false, starting = false, problem = '';
  const pttDown = new Set();      // 'key' | 'btn' | 'mouse'
  let pttUntil = 0, gateUntil = 0, level = 0, meter = 0, tx = false, txWas = false, trail = 0, selfLoudAt = 0;
  let seq = 0, preroll = null, sent = 0, dropped = 0;
  let devices = [], rebinding = false, rebindNote = '';
  const support = navigator.mediaDevices?.getSupportedConstraints?.() || {};
  const now = () => performance.now();

  function peer(id) {
    let p = peers.get(id);
    if (!p) {
      p = { id, slot: -1, listed: false, on: false, pc: null, rtc: false, rtcFailed: false, iceQ: [], timer: 0,
        input: null, vol: null, an: null, el: null, rsrc: null, next: 0, frames: 0, muted: false, volume: 1, loudAt: 0, speaking: false, lvl: 0 };
      peers.set(id, p);
    }
    return p;
  }
  const seatName = (slot) => SEATS[slot]?.[0] || 'Bat';
  const seatColor = (slot) => (SEATS[slot] ? `var(${SEATS[slot][1]})` : 'var(--echo)');

  // ---- Audio engine ------------------------------------------------------------------
  function ensureCtx() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC({ latencyHint: 'interactive' }); } catch { ac = new AC(); }
      outGain = ac.createGain();
      outGain.gain.value = cfg.out;
      outGain.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }
  // playback needs a tap or key on iPhones; any one will do
  const wake = () => { if (ac && ac.state !== 'running') ac.resume().catch(() => {}); for (const p of peers.values()) p.el?.paused && p.el.play().catch(() => {}); };
  addEventListener('pointerdown', wake, { passive: true, capture: true });
  addEventListener('keydown', wake, { capture: true });

  function peerNodes(p) {
    if (p.input || !ensureCtx()) return;
    p.input = ac.createGain();
    p.an = ac.createAnalyser();
    p.an.fftSize = 512;
    p.vol = ac.createGain();
    p.input.connect(p.an);
    p.input.connect(p.vol);
    p.vol.connect(outGain);
    applyVol(p);
  }
  function applyVol(p) {
    if (p.vol) p.vol.gain.value = p.muted ? 0 : p.volume;
    if (p.el && ELEMENT_OUT && p.got) { p.el.muted = p.muted; p.el.volume = Math.min(1, p.volume * cfg.out); }
  }

  const CAPTURE = `class EchoVoiceCap extends AudioWorkletProcessor {
    constructor() { super(); this.b = new Float32Array(1024); this.n = 0; }
    process(inputs) {
      const ch = inputs[0] && inputs[0][0];
      if (ch) for (let i = 0; i < ch.length; i++) { this.b[this.n++] = ch[i]; if (this.n === 1024) { this.port.postMessage(this.b.slice(0)); this.n = 0; } }
      return true;
    }
  }
  registerProcessor('echo-voice-cap', EchoVoiceCap);`;
  let workletReady = null;
  async function makeCapture() {
    if (ac.audioWorklet && window.AudioWorkletNode) {
      try {
        if (!workletReady) {
          const url = URL.createObjectURL(new Blob([CAPTURE], { type: 'application/javascript' }));
          workletReady = ac.audioWorklet.addModule(url);
        }
        await workletReady;
        const node = new AudioWorkletNode(ac, 'echo-voice-cap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
        node.port.onmessage = (e) => onChunk(e.data);
        return node;
      } catch { workletReady = null; /* fall through */ }
    }
    const node = ac.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = (e) => onChunk(e.inputBuffer.getChannelData(0).slice(0));
    return node;
  }

  async function openMic() {
    const want = { channelCount: 1 };
    if (support.echoCancellation) want.echoCancellation = cfg.ec;
    if (support.noiseSuppression) want.noiseSuppression = cfg.ns;
    if (support.autoGainControl) want.autoGainControl = cfg.agc;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: cfg.device ? { ...want, deviceId: { exact: cfg.device } } : want });
    } catch (e) {
      if (!cfg.device || e.name === 'NotAllowedError') throw e;
      cfg.device = ''; save();     // that microphone is gone: use the default one
      stream = await navigator.mediaDevices.getUserMedia({ audio: want });
    }
    if (!running && !starting) { stream.getTracks().forEach((t) => t.stop()); return; }
    const old = mic;
    mic = stream;
    src?.disconnect();
    src = ac.createMediaStreamSource(mic);
    src.connect(micGain);
    old?.getTracks().forEach((t) => t.stop());
    const track = mic.getAudioTracks()[0];
    if (track) track.onended = () => { if (running && mic === stream) { cfg.device = ''; openMic().catch(() => {}); } };
    listDevices();
  }

  async function startVoice() {
    if (running || starting || !net) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) { problem = 'nomic'; render(); return; }
    starting = true;
    problem = '';
    render();
    if (!ensureCtx()) { starting = false; problem = 'nomic'; render(); return; }
    micGain = ac.createGain();
    micGain.gain.value = cfg.gain;
    gate = ac.createGain();
    gate.gain.value = 0;
    dest = ac.createMediaStreamDestination();
    micGain.connect(gate);
    gate.connect(dest);
    try {
      await openMic();
      cap = await makeCapture();
    } catch (e) {
      starting = false;
      teardownMic();
      problem = e && e.name === 'NotAllowedError' ? 'blocked' : 'nomic';
      cfg.on = false; save();
      render();
      return;
    }
    if (!starting || !net) { starting = false; teardownMic(); render(); return; }   // turned off or left meanwhile
    micGain.connect(cap);
    capSink = ac.createGain();
    capSink.gain.value = 0;
    cap.connect(capSink);
    capSink.connect(ac.destination);
    starting = false;
    running = true;
    cfg.on = true; cfg.asked = true; save();
    net.listen(true);
    net.send('*', { k: 'st', on: true, req: true });
    for (const p of peers.values()) { peerNodes(p); connect(p); }
    render();
  }

  function teardownMic() {
    mic?.getTracks().forEach((t) => t.stop());
    for (const n of [src, micGain, gate, dest, cap, capSink]) { try { n?.disconnect(); } catch { /* gone */ } }
    if (cap) { cap.onaudioprocess = null; if (cap.port) cap.port.onmessage = null; }
    mic = src = micGain = gate = dest = cap = capSink = null;
  }

  function stopVoice(announce = true) {
    const was = running || starting;
    running = starting = false;
    pttDown.clear();
    teardownMic();
    for (const p of peers.values()) { closePc(p); p.rtcFailed = false; p.next = 0; }
    if (was && net) { net.listen(false); if (announce) net.send('*', { k: 'st', on: false }); }
    tx = txWas = false; level = meter = 0; preroll = null;
    // let iPhones go back to plain playback (music at full volume) once the mic is closed
    try { if (navigator.audioSession && navigator.audioSession.type === 'play-and-record') navigator.audioSession.type = 'auto'; } catch { /* older Safari */ }
    render();
  }

  // ---- Transmitting ------------------------------------------------------------------
  function updateTx() {
    const t = now();
    const want = running && !cfg.muted && !document.hidden && (cfg.mode === 'ptt' ? (pttDown.size > 0 || t < pttUntil) : t < gateUntil);
    if (want === tx) return;
    tx = want;
    if (gate) gate.gain.setTargetAtTime(tx ? 1 : 0, ac.currentTime, tx ? 0.005 : 0.03);
    renderButton();
  }
  function pttStart(how) {
    if (!running || cfg.mode !== 'ptt') return;
    pttDown.add(how);
    updateTx();
  }
  function pttEnd(how) {
    if (!pttDown.delete(how)) return;
    if (!pttDown.size) pttUntil = now() + 160;   // keep the end of the last word
    updateTx();
    setTimeout(updateTx, 200);
  }

  // mic audio in (about every 21 ms): meter, open-mic gate, then 16 kHz frames for the relay
  let rsBuf = new Float32Array(0), rsPos = 0, f16n = 0;
  const f16 = new Float32Array(960);
  function onChunk(ch) {
    if (!running) return;
    let s = 0;
    for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
    const db = 10 * Math.log10(s / ch.length + 1e-10);
    level = Math.max(0, Math.min(1, (db + 70) / 70));
    meter = Math.max(level, meter * 0.8);
    const t = now();
    if (cfg.mode === 'open' && level >= cfg.gate) gateUntil = t + 450;
    if (level >= Math.min(cfg.gate, 0.42)) selfLoudAt = t;
    updateTx();
    // resample to 16 kHz (box filter), 960 samples = one 60 ms frame
    const ratio = ac.sampleRate / 16000;
    const b = new Float32Array(rsBuf.length + ch.length);
    b.set(rsBuf); b.set(ch, rsBuf.length);
    let pos = rsPos;
    while (pos + ratio <= b.length) {
      const a = Math.floor(pos), z = Math.max(a + 1, Math.floor(pos + ratio));
      let sum = 0;
      for (let i = a; i < z; i++) sum += b[i];
      f16[f16n++] = sum / (z - a);
      if (f16n === 960) { onFrame(); f16n = 0; }
      pos += ratio;
    }
    const k = Math.floor(pos);
    rsBuf = b.slice(k);
    rsPos = pos - k;
  }

  const needRelay = () => {
    if (FORCE === 'rtc') return false;
    for (const p of peers.values()) if (p.on && !p.rtc && p.id !== me) return true;
    return false;
  };
  function onFrame() {
    const bytes = encode(f16, seq++ & 255, !txWas && tx);
    const send = (b) => { if (net.frame(b)) sent++; else dropped++; };
    if (tx) {
      if (needRelay()) {
        if (!txWas && preroll) send(preroll);     // the frame just before the gate opened
        send(bytes);
      }
      trail = 2;
    } else if (trail > 0) {
      trail--;
      if (needRelay()) send(bytes);
    }
    txWas = tx;
    preroll = bytes;
  }

  // ---- IMA ADPCM (4 bits a sample), one self-contained frame ----------------------------
  // [0] 0xA1  [1] seq  [2,3] predictor (int16 LE)  [4] step index  [5] flags (1 = starts talking)  [6..] samples
  const STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
  const IDX = [-1, -1, -1, -1, 2, 4, 6, 8];
  const enc = { pred: 0, idx: 0 };
  function encode(f, sq, start) {
    const n = f.length, out = new Uint8Array(6 + (n >> 1));
    out[0] = 0xa1; out[1] = sq;
    out[2] = enc.pred & 255; out[3] = (enc.pred >> 8) & 255; out[4] = enc.idx; out[5] = start ? 1 : 0;
    let { pred, idx } = enc;
    for (let i = 0; i < n; i++) {
      const v = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
      let diff = v - pred, code = 0, step = STEPS[idx];
      if (diff < 0) { code = 8; diff = -diff; }
      let delta = step >> 3;
      if (diff >= step) { code |= 4; diff -= step; delta += step; }
      step >>= 1;
      if (diff >= step) { code |= 2; diff -= step; delta += step; }
      step >>= 1;
      if (diff >= step) { code |= 1; delta += step; }
      pred = Math.max(-32768, Math.min(32767, code & 8 ? pred - delta : pred + delta));
      idx = Math.max(0, Math.min(88, idx + IDX[code & 7]));
      if (i & 1) out[6 + (i >> 1)] |= code << 4; else out[6 + (i >> 1)] = code;
    }
    enc.pred = pred; enc.idx = idx;
    return out;
  }
  function decode(b) {
    if (b.length < 8 || b[0] !== 0xa1) return null;
    let pred = (b[2] | (b[3] << 8)) << 16 >> 16, idx = Math.min(88, b[4]);
    const n = (b.length - 6) * 2, out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const code = (b[6 + (i >> 1)] >> ((i & 1) * 4)) & 15;
      const step = STEPS[idx];
      let delta = step >> 3;
      if (code & 4) delta += step;
      if (code & 2) delta += step >> 1;
      if (code & 1) delta += step >> 2;
      pred = Math.max(-32768, Math.min(32767, code & 8 ? pred - delta : pred + delta));
      idx = Math.max(0, Math.min(88, idx + IDX[code & 7]));
      out[i] = pred / 32768;
    }
    return out;
  }

  // ---- Relay playback (jitter buffer) -------------------------------------------------
  const JITTER = 0.1;
  function frame(from, bytes) {
    if (!running || !ac || typeof from !== 'string' || from === me || !bytes) return;
    const p = peers.get(from);
    if (!p) return;
    if (p.rtc && FORCE !== 'relay') return;        // already hearing them directly
    const pcm = decode(bytes);
    if (!pcm) return;
    peerNodes(p);
    p.on = true;
    const sr = ac.sampleRate, n = Math.round(pcm.length * sr / 16000);
    const buf = ac.createBuffer(1, n, sr), d = buf.getChannelData(0), r = (pcm.length - 1) / Math.max(1, n - 1);
    for (let i = 0; i < n; i++) { const x = i * r, a = Math.floor(x), f = x - a; d[i] = pcm[a] + ((pcm[a + 1] ?? pcm[a]) - pcm[a]) * f; }
    const t = ac.currentTime;
    if (p.next < t + 0.02 || p.next > t + 0.6) p.next = t + JITTER;   // start of talking, a gap, or too far behind
    const s = ac.createBufferSource();
    s.buffer = buf;
    s.connect(p.input);
    s.start(p.next);
    p.next += buf.duration;
    p.frames++;
  }

  // ---- WebRTC mesh -------------------------------------------------------------------
  function connect(p) {
    if (FORCE === 'relay' || !running || !p.on || p.pc || p.rtcFailed || !net || p.id === me || !window.RTCPeerConnection) return;
    if (me < p.id) makePc(p, true);     // the lower id calls; the other answers
  }
  function makePc(p, offer) {
    closePc(p);
    let pc;
    try { pc = new RTCPeerConnection({ iceServers: ICE }); } catch { p.rtcFailed = true; return null; }
    p.pc = pc;
    p.iceQ = [];
    const track = dest?.stream.getAudioTracks()[0];
    if (track) pc.addTrack(track, dest.stream);
    pc.onicecandidate = (e) => { if (e.candidate && p.pc === pc) net?.send(p.id, { k: 'ice', c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.ontrack = (e) => {
      if (p.pc !== pc) return;
      const stream = e.streams[0] || new MediaStream([e.track]);
      peerNodes(p);
      // Chrome only lets a remote stream into Web Audio while a media element plays it too
      try {
        p.el = p.el || new Audio();
        p.el.muted = true;
        p.el.setAttribute('playsinline', '');
        p.el.srcObject = stream;
        p.el.play().catch(() => {});
      } catch { /* no element needed */ }
      p.got = true;
      try {
        try { p.rsrc?.disconnect(); } catch { /* gone */ }
        p.rsrc = ac.createMediaStreamSource(stream);
        p.rsrc.connect(ELEMENT_OUT ? p.an : p.input);
      } catch { p.rsrc = null; }
      applyVol(p);
      check();
    };
    const check = () => {
      if (p.pc !== pc) return;
      const st = pc.connectionState || pc.iceConnectionState;
      const up = (st === 'connected' || st === 'completed') && !!p.got;
      if (up !== p.rtc) { p.rtc = up; if (up) clearTimeout(p.timer); render(); }
      if (st === 'failed' || st === 'closed') { closePc(p); p.rtcFailed = true; render(); }
    };
    pc.onconnectionstatechange = check;
    pc.oniceconnectionstatechange = check;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => { if (p.pc === pc && !p.rtc) { closePc(p); p.rtcFailed = true; render(); } }, 12000);
    if (offer) {
      pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => {
        if (p.pc === pc) net?.send(p.id, { k: 'sdp', sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }).catch(() => { closePc(p); p.rtcFailed = true; });
    }
    return pc;
  }
  function closePc(p) {
    clearTimeout(p.timer);
    if (p.pc) { const pc = p.pc; p.pc = null; try { pc.close(); } catch { /* closed */ } }
    try { p.rsrc?.disconnect(); } catch { /* gone */ }
    p.rsrc = null;
    p.got = false;
    if (p.el) { try { p.el.pause(); p.el.srcObject = null; } catch { /* gone */ } }
    p.rtc = false;
  }
  async function onSdp(p, sdp) {
    if (!sdp || typeof sdp.sdp !== 'string') return;
    if (sdp.type === 'offer') {
      if (!running || FORCE === 'relay') return;
      const pc = makePc(p, false);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(sdp);
        await flushIce(p, pc);
        const a = await pc.createAnswer();
        await pc.setLocalDescription(a);
        if (p.pc === pc) net?.send(p.id, { k: 'sdp', sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      } catch { closePc(p); p.rtcFailed = true; }
    } else if (sdp.type === 'answer' && p.pc && p.pc.signalingState === 'have-local-offer') {
      const pc = p.pc;
      try { await pc.setRemoteDescription(sdp); await flushIce(p, pc); } catch { closePc(p); p.rtcFailed = true; }
    }
  }
  async function flushIce(p, pc) {
    const q = p.iceQ; p.iceQ = [];
    for (const c of q) { try { await pc.addIceCandidate(c); } catch { /* stale */ } }
  }

  // ---- Messages from net.js ------------------------------------------------------------
  function signal(from, d) {
    if (!d || typeof d !== 'object' || typeof from !== 'string' || from === me || from.length > 40) return;
    const p = peer(from);
    if (d.k === 'st') {
      const was = p.on;
      p.on = !!d.on;
      if (!p.on) { closePc(p); p.rtcFailed = false; }
      else if (!was || !p.pc) connect(p);
      if (d.req && running) net?.send(from, { k: 'st', on: true });
      render();
    } else if (d.k === 'sdp') onSdp(p, d.sdp);
    else if (d.k === 'ice' && d.c) {
      if (p.pc?.remoteDescription) p.pc.addIceCandidate(d.c).catch(() => {});
      else if (p.iceQ.length < 60) p.iceQ.push(d.c);
    }
  }
  function room(myId, list) {
    if (typeof myId === 'string' && myId) me = myId;
    const seen = new Set();
    for (const e of list || []) {
      if (!e || typeof e.id !== 'string') continue;
      seen.add(e.id);
      if (e.id === me) { mySlot = e.slot; continue; }
      const fresh = !peers.has(e.id) || !peers.get(e.id).listed;
      const p = peer(e.id);
      p.slot = e.slot;
      p.listed = true;
      if (fresh && running) net?.send(e.id, { k: 'st', on: true });   // tell newcomers I'm on
    }
    for (const [id, p] of peers) if (p.listed && !seen.has(id)) dropPeer(p);
    render();
  }
  function dropPeer(p) {
    closePc(p);
    try { p.vol?.disconnect(); } catch { /* gone */ }
    if (p.speaking) { p.speaking = false; fire(p.slot, false); }
    peers.delete(p.id);
  }
  function attach(n) {
    net = n;
    me = n.me || me;
    mySlot = -1;
    ui();
    place();
    clearInterval(placeTimer);
    placeTimer = setInterval(place, 300);
    // turned on last time: come back on by itself only if the browser already allows the mic
    if (cfg.on) {
      const go = () => { if (net === n && cfg.on && !running) startVoice(); };
      try {
        navigator.permissions.query({ name: 'microphone' }).then((r) => { if (r.state === 'granted') go(); }, () => {});
      } catch { /* ask on the next tap instead */ }
    }
    render();
  }
  function detach() {
    if (!net) return;
    stopVoice(true);
    for (const p of [...peers.values()]) dropPeer(p);
    net = null; me = ''; mySlot = -1;
    clearInterval(placeTimer);
    closePanel();
    if (btn) btn.hidden = true;
    if (talkers) talkers.hidden = true;
  }

  // ---- Speaking -------------------------------------------------------------------------
  const listeners = new Set();
  function fire(slot, on) {
    if (slot < 0) return;
    try { api.onSpeaking?.(slot, on); } catch { /* HUD hook */ }
    for (const f of listeners) { try { f(slot, on); } catch { /* HUD hook */ } }
  }
  const tdata = new Float32Array(512);
  let selfSpeaking = false;
  function tick() {
    const t = now();
    if (cfg.mode === 'open') updateTx();
    for (const p of peers.values()) {
      let lv = 0;
      if (p.an && running) {
        p.an.getFloatTimeDomainData(tdata);
        let s = 0;
        for (let i = 0; i < tdata.length; i++) s += tdata[i] * tdata[i];
        lv = Math.max(0, Math.min(1, (10 * Math.log10(s / tdata.length + 1e-10) + 70) / 70));
      }
      p.lvl = lv;
      if (lv > 0.3) p.loudAt = t;
      const sp = running && t - p.loudAt < 350;
      if (sp !== p.speaking) { p.speaking = sp; fire(p.slot, sp); }
    }
    const ss = tx && t - selfLoudAt < 350;
    if (ss !== selfSpeaking) { selfSpeaking = ss; fire(mySlot, ss); }
    renderLive();
  }
  setInterval(() => { if (net && (running || panelOpen)) tick(); }, 80);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pttDown.clear(); updateTx(); });

  // ---- Keys and mouse buttons ---------------------------------------------------------------
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && !(el.type === 'range' || el.type === 'checkbox');
  function keyName(code) {
    if (!code) return '?';
    if (/^Mouse\d$/.test(code)) return `Mouse ${+code.slice(5) + 1}`;
    const named = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', CapsLock: 'Caps Lock',
      AltLeft: 'Left Alt', AltRight: 'Right Alt', ControlLeft: 'Left Ctrl', Backspace: 'Backspace', IntlBackslash: '\\' };
    if (named[code]) return named[code];
    return code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ').replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  function finishRebind(code) {
    if (code === 'Escape') { rebinding = false; rebindNote = ''; render(); return; }
    if (reserved(code)) { rebindNote = `${keyName(code)} already controls your bat. Try V, B, T, N, Z or a mouse side button.`; render(); return; }
    cfg.key = code; save();
    rebinding = false; rebindNote = '';
    render();
  }
  addEventListener('keydown', (e) => {
    if (rebinding) { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) finishRebind(e.code); return; }
    if (panelOpen && e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closePanel(); return; }
    if (!net || e.code !== cfg.key || typing(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();     // the talk key never reaches the game
    if (!e.repeat) pttStart('key');
  }, true);
  addEventListener('keyup', (e) => {
    if (!net || e.code !== cfg.key) return;
    e.stopImmediatePropagation();
    pttEnd('key');
  }, true);
  addEventListener('blur', () => { pttDown.clear(); updateTx(); });
  // mouse side buttons as a talk key (buttons 3 and 4 are Back and Forward)
  const mouseCode = (e) => (e.button >= 3 && e.button <= 4 ? `Mouse${e.button}` : '');
  addEventListener('pointerdown', (e) => {
    const c = mouseCode(e);
    if (!c) return;
    if (rebinding) { e.preventDefault(); finishRebind(c); return; }
    if (net && c === cfg.key) { e.preventDefault(); pttStart('mouse'); }
  }, true);
  addEventListener('pointerup', (e) => { const c = mouseCode(e); if (c && c === cfg.key) { e.preventDefault(); pttEnd('mouse'); } }, true);
  for (const ev of ['mouseup', 'auxclick']) addEventListener(ev, (e) => { if (net && mouseCode(e) === cfg.key) e.preventDefault(); }, true);

  // ---- UI: the mic button ------------------------------------------------------------------
  const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const SPK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  let btn = null, panel = null, card = null, body = null, talkers = null, panelOpen = false, placeTimer = 0;

  function ui() {
    if (btn) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'round sm vc-mic';
    btn.setAttribute('aria-label', 'Voice chat');
    btn.innerHTML = `${MIC_SVG}<span class="vc-badge" hidden></span>`;
    btn.hidden = true;
    let downAt = 0, held = false;
    btn.addEventListener('mousedown', (e) => e.preventDefault());   // keep focus off it so Space stays a squeak
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      try { btn.setPointerCapture(e.pointerId); } catch { /* fine */ }
      downAt = now();
      held = running && cfg.mode === 'ptt';
      if (held) pttStart('btn');
    });
    const up = (e, tap) => {
      if (!downAt) return;
      e.stopPropagation();
      const quick = now() - downAt < 300;
      downAt = 0;
      if (held) pttEnd('btn');
      if (tap && (quick || !held)) togglePanel();
    };
    btn.addEventListener('pointerup', (e) => up(e, true));
    btn.addEventListener('pointercancel', (e) => up(e, false));
    btn.addEventListener('click', (e) => { e.preventDefault(); if (e.detail === 0) togglePanel(); });   // keyboard
    document.body.appendChild(btn);

    talkers = document.createElement('div');
    talkers.className = 'vc-talkers';
    talkers.hidden = true;
    talkers.setAttribute('aria-live', 'polite');
    document.body.appendChild(talkers);

    panel = document.createElement('div');
    panel.className = 'vc-panel';
    panel.hidden = true;
    panel.innerHTML = `<div class="vc-card" role="dialog" aria-modal="true" aria-label="Voice chat">
      <header class="vc-head"><span class="vc-hicon">${MIC_SVG}</span><b>Voice chat</b><span class="vc-sub"></span><button type="button" class="vc-x" data-act="close" aria-label="Close">✕</button></header>
      <div class="vc-body"></div></div>`;
    card = panel.querySelector('.vc-card');
    body = panel.querySelector('.vc-body');
    // the panel is its own little world: taps and keys in it never reach the game
    for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'keydown', 'keyup']) panel.addEventListener(ev, (e) => e.stopPropagation());
    panel.addEventListener('pointerdown', (e) => { if (e.target === panel) closePanel(); });
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('input', onPanelInput);
    panel.addEventListener('change', onPanelInput);
    document.body.appendChild(panel);
  }

  // in the lobby the button sits in the room row; in a match it floats next to the ♪ button
  function place() {
    if (!btn) return;
    btn.hidden = !net;
    if (!net) return;
    const box = $('room-box'), lobby = $('battle-screen');
    const inBar = !!(box && lobby && !lobby.hidden && !box.hidden);
    if (inBar && btn.parentNode !== box) box.appendChild(btn);
    else if (!inBar && btn.parentNode !== document.body) document.body.appendChild(btn);
    btn.classList.toggle('in-bar', inBar);
    btn.classList.toggle('floating', !inBar);
    renderTalkers(inBar);
  }

  function renderButton() {
    if (!btn) return;
    const anyone = [...peers.values()].filter((p) => p.on).length;
    btn.classList.toggle('off', !running);
    btn.classList.toggle('muted', running && cfg.muted);
    btn.classList.toggle('live', tx);
    btn.classList.toggle('waiting', !running && cfg.on);
    btn.classList.toggle('hear', running && [...peers.values()].some((p) => p.speaking));
    const badge = btn.querySelector('.vc-badge');
    badge.hidden = running || !anyone;
    badge.textContent = anyone;
    btn.setAttribute('aria-label', !running ? `Voice chat (off${anyone ? `, ${anyone} talking in this room` : ''})`
      : cfg.muted ? 'Voice chat (muted)' : cfg.mode === 'ptt' ? `Voice chat (hold ${keyName(cfg.key)} or this button to talk)` : 'Voice chat (open mic)');
    btn.title = running && cfg.mode === 'ptt' && !cfg.muted ? `Hold ${KEYBOARD ? keyName(cfg.key) + ' or ' : ''}here to talk · tap for settings` : 'Voice chat';
  }

  function renderTalkers(inBar = btn?.classList.contains('in-bar')) {
    if (!talkers) return;
    const list = [...peers.values()].filter((p) => p.speaking && p.slot >= 0);
    talkers.hidden = !net || inBar || panelOpen || !list.length;
    const html = list.map((p) => `<span style="--c:${seatColor(p.slot)}">${SPK_SVG}${seatName(p.slot)}</span>`).join('');
    if (talkers.innerHTML !== html) talkers.innerHTML = html;
  }

  // ---- UI: the settings panel ------------------------------------------------------------------
  function openPanel() {
    if (!net) return;
    ui();
    panelOpen = true;
    panel.hidden = false;
    rebinding = false;
    rebindNote = '';
    listDevices();
    render();
    renderTalkers();
  }
  function closePanel() {
    panelOpen = false;
    rebinding = false;
    if (panel) panel.hidden = true;
    renderTalkers();
  }
  function togglePanel() { if (panelOpen) closePanel(); else openPanel(); }

  async function listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const ins = all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.label);
      const key = ins.map((d) => d.deviceId + d.label).join('|');
      if (key !== devices.map((d) => d.deviceId + d.label).join('|')) { devices = ins; render(); }
    } catch { /* no device list */ }
  }
  try { navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (running) listDevices(); }); } catch { /* old browser */ }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (v) => Math.round(v * 100);
  function peerStatus(p) {
    if (!p.on) return 'Voice off';
    if (!running) return 'Voice on';
    if (p.rtc) return 'Direct';
    if (FORCE === 'rtc') return 'Connecting…';
    return p.pc ? 'Relay · connecting' : 'Relay';
  }
  function modeHint() {
    if (!running) return cfg.on ? 'Starting your mic…' : 'Off: you can’t hear or be heard.';
    if (cfg.muted) return 'Your mic is muted.';
    if (cfg.mode === 'ptt') return KEYBOARD ? `Hold ${keyName(cfg.key)}${TOUCH ? ' or the mic button' : ' (or the mic button)'} to talk.` : 'Hold the mic button to talk. A quick tap opens this panel.';
    return 'Sends while your voice is over the line.';
  }

  function render() {
    renderButton();
    if (!panel || !panelOpen) return;
    const sub = panel.querySelector('.vc-sub');
    // first time: ask before touching the mic
    if (!cfg.asked && !running) {
      sub.textContent = '';
      body.innerHTML = `<div class="vc-ask">
        <p class="vc-q">Turn on voice chat?</p>
        <p class="vc-note">Talk with the friends in this room. Your browser will ask to use your microphone. Only people in this room hear you, and you can turn it off any time.</p>
        <div class="vc-modes" role="group" aria-label="How to talk">
          <button type="button" data-pick="ptt" class="${cfg.mode === 'ptt' ? 'on' : ''}"><b>Push to talk</b><small>${KEYBOARD ? `Hold ${esc(keyName(cfg.key))}` : 'Hold the mic button'}</small></button>
          <button type="button" data-pick="open" class="${cfg.mode === 'open' ? 'on' : ''}"><b>Open mic</b><small>Talk freely</small></button>
        </div>
        ${problemHtml()}
        <div class="vc-actions"><button type="button" class="btn ghost sm" data-act="close">Not now</button><button type="button" class="btn primary sm" data-act="go">${starting ? 'Starting…' : 'Turn on'}</button></div>
      </div>`;
      return;
    }
    const mode = running || starting || cfg.on ? cfg.mode : 'off';
    sub.textContent = running ? (cfg.muted ? 'Muted' : cfg.mode === 'ptt' ? 'Push to talk' : 'Open mic') : 'Off';
    const others = [...peers.values()].filter((p) => p.slot >= 0 || p.on).sort((a, b) => a.slot - b.slot);
    const meRow = `<li class="vc-p me" data-slot="${mySlot}" style="--c:${seatColor(mySlot)}"><i class="vc-ring"></i><span class="vc-name"><b>${seatName(mySlot)}</b><small>You · ${!running ? 'Voice off' : cfg.muted ? 'Muted' : cfg.mode === 'ptt' ? 'Push to talk' : 'Open mic'}</small></span></li>`;
    const rows = others.map((p) => `<li class="vc-p" data-id="${esc(p.id)}" style="--c:${seatColor(p.slot)}"><i class="vc-ring"></i>
      <span class="vc-name"><b>${seatName(p.slot)}</b><small>${p.id === 'host' ? 'Host · ' : ''}${peerStatus(p)}</small></span>
      <input type="range" class="vc-pvol" min="0" max="200" step="5" value="${pct(p.volume)}" aria-label="${seatName(p.slot)} volume" ${running && p.on ? '' : 'disabled'}>
      <button type="button" class="vc-pm${p.muted ? ' on' : ''}" data-mute="${esc(p.id)}" aria-pressed="${p.muted}" aria-label="Mute ${seatName(p.slot)}" ${running && p.on ? '' : 'disabled'}>${SPK_SVG}</button></li>`).join('');
    const live = running;
    const chips = [['ns', 'Noise filter', support.noiseSuppression], ['ec', 'Echo cancel', support.echoCancellation], ['agc', 'Auto level', support.autoGainControl]]
      .filter((c) => c[2]).map(([k, label]) => `<button type="button" class="vc-chip${cfg[k] ? ' on' : ''}" data-flag="${k}" aria-pressed="${cfg[k]}">${label}</button>`).join('');
    body.innerHTML = `<div class="vc-cols">
      <section class="vc-me">
        <div class="vc-modes three" role="group" aria-label="Voice mode">
          <button type="button" data-mode="off" class="${mode === 'off' ? 'on' : ''}"><b>Off</b></button>
          <button type="button" data-mode="ptt" class="${mode === 'ptt' ? 'on' : ''}"><b>Push to talk</b></button>
          <button type="button" data-mode="open" class="${mode === 'open' ? 'on' : ''}"><b>Open mic</b></button>
        </div>
        <p class="vc-hint">${esc(modeHint())}</p>
        ${problemHtml()}
        ${cfg.on && !running && !starting ? '<button type="button" class="btn primary sm vc-start" data-act="go">Start voice chat</button>' : ''}
        ${live ? `
        <div class="vc-row vc-levelrow"><span>Level</span>
          <div class="vc-meter${cfg.mode === 'open' ? ' gated' : ''}"><i class="vc-fill"></i>${cfg.mode === 'open' ? `<input type="range" class="vc-gate" min="5" max="95" value="${pct(cfg.gate)}" aria-label="Open mic line">` : ''}</div>
          <button type="button" class="vc-chip vc-mute${cfg.muted ? ' on' : ''}" data-act="mute" aria-pressed="${cfg.muted}">${cfg.muted ? 'Unmute' : 'Mute me'}</button></div>
        ${KEYBOARD && cfg.mode === 'ptt' ? `<div class="vc-row"><span>Talk key</span><kbd>${rebinding ? 'Press a key…' : esc(keyName(cfg.key))}</kbd>
          <button type="button" class="vc-chip" data-act="rebind">${rebinding ? 'Cancel' : 'Change'}</button></div>${rebindNote ? `<p class="vc-hint warn">${esc(rebindNote)}</p>` : ''}` : ''}
        ${devices.length > 1 ? `<div class="vc-row"><span>Mic</span><select class="vc-dev" aria-label="Microphone">
          <option value="">Default microphone</option>${devices.filter((d) => d.deviceId !== 'default').map((d) => `<option value="${esc(d.deviceId)}"${d.deviceId === cfg.device ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}</select></div>` : ''}
        <div class="vc-row"><span>Mic volume</span><input type="range" class="vc-gain" min="0" max="200" step="5" value="${pct(cfg.gain)}" aria-label="Mic volume"><output>${pct(cfg.gain)}%</output></div>
        ${chips ? `<div class="vc-chips">${chips}</div>` : ''}` : ''}
        <div class="vc-row"><span>Voices</span><input type="range" class="vc-out" min="0" max="200" step="5" value="${pct(cfg.out)}" aria-label="Voices volume"><output>${pct(cfg.out)}%</output></div>
      </section>
      <section class="vc-ppl"><h4>In this room</h4><ul class="${others.length > 3 ? 'many' : ''}">${meRow}${rows || ''}</ul>${others.length ? '' : '<p class="vc-hint">Nobody else yet.</p>'}</section>
    </div>`;
    renderLive();
  }
  function problemHtml() {
    if (problem === 'blocked') return '<p class="vc-hint warn">The microphone is blocked. Allow it for this site in your browser settings, then try again.</p>';
    if (problem === 'nomic') return '<p class="vc-hint warn">No microphone found, or this browser can’t use it here.</p>';
    return '';
  }
  // the bits that move: meter and speaking rings (no rebuild, so sliders keep working)
  function renderLive() {
    renderButton();
    renderTalkers();
    if (!panelOpen || !body) return;
    const fill = body.querySelector('.vc-fill');
    if (fill) { fill.style.width = `${pct(meter)}%`; fill.classList.toggle('over', tx); }
    meter *= 0.9;
    for (const li of body.querySelectorAll('.vc-p')) {
      const p = li.dataset.id ? peers.get(li.dataset.id) : null;
      li.classList.toggle('talking', p ? p.speaking : selfSpeaking || tx);
    }
  }

  async function setMode(m) {
    if (m === 'off') { cfg.on = false; save(); stopVoice(true); return; }
    cfg.mode = m;
    cfg.on = true;
    save();
    gateUntil = 0;
    updateTx();
    if (!running) await startVoice();
    render();
  }
  function onPanelClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.act === 'close') closePanel();
    else if (t.dataset.act === 'go') { cfg.asked = true; setMode(cfg.mode); }
    else if (t.dataset.pick) { cfg.mode = t.dataset.pick; save(); render(); }
    else if (t.dataset.mode) setMode(t.dataset.mode);
    else if (t.dataset.act === 'mute') { cfg.muted = !cfg.muted; save(); updateTx(); render(); }
    else if (t.dataset.act === 'rebind') { rebinding = !rebinding; rebindNote = ''; render(); }
    else if (t.dataset.flag) { cfg[t.dataset.flag] = !cfg[t.dataset.flag]; save(); render(); if (running) openMic().catch(() => {}); }
    else if (t.dataset.mute) {
      const p = peers.get(t.dataset.mute);
      if (p) { p.muted = !p.muted; applyVol(p); render(); }
    }
  }
  function onPanelInput(e) {
    const t = e.target, v = +t.value / 100;
    const show = () => { const o = t.parentNode.querySelector('output'); if (o) o.textContent = `${t.value}%`; };
    if (t.classList.contains('vc-gain')) { cfg.gain = v; if (micGain) micGain.gain.value = v; show(); save(); }
    else if (t.classList.contains('vc-out')) { cfg.out = v; if (outGain) outGain.gain.value = v; for (const p of peers.values()) applyVol(p); show(); save(); }
    else if (t.classList.contains('vc-gate')) { cfg.gate = v; save(); }
    else if (t.classList.contains('vc-pvol')) {
      const p = peers.get(t.closest('.vc-p')?.dataset.id);
      if (p) { p.volume = v; if (p.muted && v > 0) p.muted = false; applyVol(p); }
    } else if (t.classList.contains('vc-dev') && e.type === 'change') { cfg.device = t.value; save(); if (running) openMic().catch(() => {}); }
  }

  // ---- API ---------------------------------------------------------------------------------
  const bySlot = (slot) => { for (const p of peers.values()) if (p.slot === slot) return p; return null; };
  const api = {
    // net.js
    attach, detach, room, signal, frame,
    // HUD: is the bat in this seat talking right now? (your own seat too)
    speaking(slot) { if (slot === mySlot) return selfSpeaking; return !!bySlot(slot)?.speaking; },
    // HUD: called as (slot, on) whenever someone starts or stops talking
    onSpeaking: null,
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
    // { on: voice on, speaking, muted: you muted them (or yourself), you }
    info(slot) {
      if (slot === mySlot) return { you: true, on: running, speaking: selfSpeaking, muted: cfg.muted };
      const p = bySlot(slot);
      return p ? { you: false, on: p.on, speaking: p.speaking, muted: p.muted } : null;
    },
    get active() { return running; },
    get talking() { return tx; },
    get inRoom() { return !!net; },
    open: openPanel, close: closePanel, toggle: togglePanel,
    // tests: hold the talk button from code, and see what's flowing
    ptt(on) { if (on) pttStart('btn'); else pttEnd('btn'); },
    stats() {
      return {
        running, tx, sent, dropped, me, mySlot, mode: cfg.mode, muted: cfg.muted, force: FORCE, level, ctx: ac?.state, direct: !!net?.direct,
        peers: [...peers.values()].map((p) => ({ id: p.id, slot: p.slot, on: p.on, rtc: p.rtc, pc: p.pc?.connectionState || null, rtcFailed: p.rtcFailed, frames: p.frames, lvl: p.lvl, speaking: p.speaking, muted: p.muted, volume: p.volume })),
      };
    },
    settings: cfg,
    codec: { encode: (f) => encode(f, 0, false), decode },
  };
  window.EchoVoice = api;
})();
