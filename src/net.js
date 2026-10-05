// Echo Caves: online rooms.
// One player creates a room and gets a 4-letter code; friends type the code to join.
// The host's browser runs the match and streams snapshots; guests send their stick and buttons.
// Transport: our Cloudflare room server (server/rooms.js) when one is set up, which works on
// any network; otherwise PeerJS (WebRTC, public broker). ?relay=https://… points at another
// room server. Add ?net=local to use a BroadcastChannel instead, so two tabs on one
// computer can test without a network.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const ID_PREFIX = 'mocaka-echo-';
  // Battle rooms take up to 8 players (the host and 7 guests); Co-op Run up to 4
  const MAX_PLAYERS = 8, MAX_COOP = 4;
  const params = new URLSearchParams(location.search);
  const useLocal = params.get('net') === 'local';

  const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

  // ---- Transports ----------------------------------------------------------
  // Both expose the same shape:
  //   host(code, { onJoin(id), onData(id, msg), onLeave(id), onVoice? }) -> Promise<{ send(id, msg), close(), voice? }>
  //   join(code, { onData(msg), onClose(), onVoice? })                   -> Promise<{ send(msg), close(), voice? }>
  // voice (optional): a direct path for voice-chat audio frames (voice.js) that skips the host:
  //   voice.send(bytes) -> bool (false = dropped), voice.listen(on); frames arrive as onVoice(fromId, bytes).
  //   Without it, frames go through the host as {t:'vf'} messages instead.

  let peerLib = null;
  function loadPeer() {
    if (window.Peer) return Promise.resolve(window.Peer);
    if (peerLib) return peerLib;
    peerLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'src/vendor/peerjs.min.js';
      s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('no peer')));
      s.onerror = () => { peerLib = null; reject(new Error('load')); };
      document.head.appendChild(s);
    });
    return peerLib;
  }
  // ?peer=host:port points at a self-hosted PeerJS server (used by the tests)
  // Several STUN servers to find a route between phones, plus PeerJS's free
  // relays (UDP, TCP and TLS) for networks that block direct connections.
  const ICE = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
      {
        urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478',
          'turn:eu-0.turn.peerjs.com:3478?transport=tcp', 'turn:us-0.turn.peerjs.com:3478?transport=tcp',
          'turns:eu-0.turn.peerjs.com:443', 'turns:us-0.turn.peerjs.com:443'],
        username: 'peerjs', credential: 'peerjsp',
      },
    ],
  };
  function peerOptions() {
    const p = params.get('peer');
    if (!p) return { debug: 0, config: ICE };
    const [host, port] = p.split(':');
    return { host, port: +port || 9000, path: '/', secure: location.protocol === 'https:', debug: 0 };
  }
  function withTimeout(promise, ms, what) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(what)), ms))]);
  }

  const peerTransport = {
    async host(code, h) {
      const Peer = await loadPeer();
      const peer = new Peer(ID_PREFIX + code, peerOptions());
      await withTimeout(new Promise((resolve, reject) => {
        peer.on('open', resolve);
        peer.on('error', (e) => reject(new Error(e.type === 'unavailable-id' ? 'taken' : 'broker')));
      }), 10000, 'broker');
      const conns = new Map();
      let n = 0;
      peer.on('connection', (conn) => {
        const id = 'p' + ++n;
        conn.on('open', () => { conns.set(id, conn); h.onJoin(id); });
        conn.on('data', (msg) => h.onData(id, msg));
        const gone = () => { if (conns.delete(id)) h.onLeave(id); };
        conn.on('close', gone);
        conn.on('error', gone);
      });
      // lost contact with the broker: open connections still work, new guests can't find us
      peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* gone for good */ } });
      // phones drop the broker connection when the screen locks or the app switches; rejoin on return
      const wake = () => { if (!document.hidden && peer.disconnected && !peer.destroyed) { try { peer.reconnect(); } catch { /* gone for good */ } } };
      document.addEventListener('visibilitychange', wake);
      return {
        send(id, msg) { const c = conns.get(id); if (c?.open) c.send(msg); },
        close() { document.removeEventListener('visibilitychange', wake); for (const c of conns.values()) c.close(); peer.destroy(); },
      };
    },
    async join(code, h) {
      const Peer = await loadPeer();
      const peer = new Peer(peerOptions());
      await withTimeout(new Promise((resolve, reject) => {
        peer.on('open', resolve);
        peer.on('error', () => reject(new Error('broker')));
      }), 10000, 'broker');
      const conn = peer.connect(ID_PREFIX + code, { reliable: true });
      // no reply at all means the room exists but the two devices couldn't find a route to each other
      try {
        await withTimeout(new Promise((resolve, reject) => {
          conn.on('open', resolve);
          peer.on('error', (e) => reject(new Error(e.type === 'peer-unavailable' ? 'nobody' : 'broker')));
        }), 20000, 'noroute');
      } catch (e) { peer.destroy(); throw e; }
      let closed = false;
      const end = () => { if (!closed) { closed = true; h.onClose(); } };
      conn.on('data', h.onData);
      conn.on('close', end);
      conn.on('error', end);
      return {
        send(msg) { if (conn.open) conn.send(msg); },
        close() { closed = true; conn.close(); peer.destroy(); },
      };
    },
  };

  // Same API over a BroadcastChannel, for testing in two tabs
  const localTransport = {
    async host(code, h) {
      const ch = new BroadcastChannel(ID_PREFIX + code);
      const ids = new Set();
      ch.onmessage = ({ data: m }) => {
        if (m.to !== 'host') return;
        if (m.ping) { ch.postMessage({ to: m.from, pong: true }); return; }
        if (m.hello && !ids.has(m.from)) { ids.add(m.from); h.onJoin(m.from); return; }
        if (m.bye) { if (ids.delete(m.from)) h.onLeave(m.from); return; }
        if (ids.has(m.from)) h.onData(m.from, m.msg);
      };
      const voice = localVoice(code, 'host', h);
      return {
        send(id, msg) { ch.postMessage({ to: id, msg }); },
        close() { for (const id of ids) ch.postMessage({ to: id, bye: true }); ch.close(); voice.close(); },
        voice,
      };
    },
    async join(code, h) {
      const ch = new BroadcastChannel(ID_PREFIX + code);
      const me = 'l' + Math.random().toString(36).slice(2, 8);
      await withTimeout(new Promise((resolve) => {
        ch.onmessage = ({ data: m }) => { if (m.to === me && m.pong) resolve(); };
        ch.postMessage({ to: 'host', from: me, ping: true });
      }), 1500, 'nobody');
      let closed = false;
      ch.onmessage = ({ data: m }) => {
        if (m.to !== me) return;
        if (m.bye) { if (!closed) { closed = true; h.onClose(); } return; }
        if (m.msg) h.onData(m.msg);
      };
      ch.postMessage({ to: 'host', from: me, hello: true });
      const voice = localVoice(code, me, h);
      return {
        send(msg) { ch.postMessage({ to: 'host', from: me, msg }); },
        close() { closed = true; ch.postMessage({ to: 'host', from: me, bye: true }); ch.close(); voice.close(); },
        voice, me,
      };
    },
  };
  // voice frames between test tabs: their own channel, so they never queue behind game messages
  function localVoice(code, me, h) {
    const ch = new BroadcastChannel(ID_PREFIX + code + '-voice');
    let on = false;
    ch.onmessage = ({ data: m }) => { if (on && m && m.from !== me && m.data) h.onVoice?.(m.from, new Uint8Array(m.data)); };
    return {
      send(bytes) { ch.postMessage({ from: me, data: bytes }); return true; },
      listen(v) { on = !!v; },
      close() { ch.close(); },
    };
  }

  // Cloudflare room server: relays every message, so it works on mobile data and strict Wi-Fi.
  // Set ROOM_SERVER once the Worker is deployed; the game also uses it automatically when it
  // is itself served by that Worker.
  const ROOM_SERVER = 'https://mocaka.mocakaechocaves.workers.dev';
  const relayBase = (() => {
    if (params.get('peer')) return '';   // tests with a local PeerJS server
    const r = params.get('relay') || (/\.workers\.dev$/.test(location.hostname) ? location.origin : ROOM_SERVER);
    return r ? r.replace(/^http/, 'ws').replace(/\/$/, '') : '';
  })();

  function openRoomSocket(code, role) {
    return withTimeout(new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(`${relayBase}/room/${code}?role=${role}`); } catch { reject(new Error('broker')); return; }
      ws.binaryType = 'arraybuffer';
      ws.onmessage = ({ data }) => {
        let m;
        try { m = JSON.parse(data); } catch { return; }
        if (m.ev === 'ready') { ws.voiceOk = !!m.voice; ws.myId = m.id || ''; resolve(ws); }
        else if (m.ev === 'error') reject(new Error(m.why || 'broker'));
      };
      ws.onerror = () => reject(new Error('broker'));
      ws.onclose = () => reject(new Error('broker'));
    }), 10000, 'broker');
  }
  // keeps phone networks and proxies from dropping a quiet socket
  const keepAlive = (ws) => setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 20000);
  // Voice frames are binary WebSocket messages the room server copies straight to everyone else
  // who has voice on (it puts the sender's number in front: 0 = host, n = guest 'g<n>').
  // A frame is dropped rather than queued when the socket is backed up, so game messages never wait.
  function relayVoice(ws, h) {
    if (!ws.voiceOk) return null;   // an older room server: voice.js falls back to the host path
    return {
      send(bytes) {
        if (ws.readyState !== 1 || ws.bufferedAmount > 24000) return false;
        ws.send(bytes);
        return true;
      },
      listen(on) { if (ws.readyState === 1) ws.send(on ? 'v1' : 'v0'); },
      take(data) {
        if (!(data instanceof ArrayBuffer) || data.byteLength < 3) return;
        const b = new Uint8Array(data), n = b[0] | (b[1] << 8);
        h.onVoice?.(n ? 'g' + n : 'host', b.subarray(2));
      },
    };
  }

  const relayTransport = {
    async host(code, h) {
      const ws = await openRoomSocket(code, 'host');
      const beat = keepAlive(ws);
      const voice = relayVoice(ws, h);
      ws.onmessage = ({ data }) => {
        if (data === 'pong') return;
        if (typeof data !== 'string') { voice?.take(data); return; }
        let m;
        try { m = JSON.parse(data); } catch { return; }
        if (m.ev === 'join') h.onJoin(m.id);
        else if (m.ev === 'data') h.onData(m.id, m.msg);
        else if (m.ev === 'leave') h.onLeave(m.id);
      };
      ws.onerror = ws.onclose = () => clearInterval(beat);
      return {
        send(id, msg) { if (ws.readyState === 1) ws.send(JSON.stringify({ to: id, msg })); },
        close() { clearInterval(beat); ws.close(); },
        voice,
      };
    },
    async join(code, h) {
      const ws = await openRoomSocket(code, 'join');
      const beat = keepAlive(ws);
      let closed = false;
      const end = () => { clearInterval(beat); if (!closed) { closed = true; h.onClose(); } };
      const voice = relayVoice(ws, h);
      ws.onmessage = ({ data }) => {
        if (data === 'pong') return;
        if (typeof data !== 'string') { voice?.take(data); return; }
        let m;
        try { m = JSON.parse(data); } catch { return; }
        if (m && m.ev === 'gone') end();
        else h.onData(m);
      };
      ws.onerror = ws.onclose = end;
      return {
        send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); },
        close() { closed = true; clearInterval(beat); ws.close(); },
        voice, me: ws.myId,
      };
    },
  };

  const transport = useLocal ? localTransport : relayBase ? relayTransport : peerTransport;

  // ---- Room state ------------------------------------------------------------
  // The room lives on the Battle screen: game.js draws it (window.EchoLobby) and
  // owns the settings; this file handles codes, players and the connection.
  // role: null | 'host' | 'guest'
  let role = null, link = null, code = '', playing = false;
  let guests = [];          // host: [{ id, look }] in join order; slot = index + 1
  let roster = [];          // guest: [{ slot, me, look }] from the host's lobby message
  let mySlot = -1;
  // guest: stepped out of the running match (or its end screen) to wait in the room's lobby;
  // the host's snapshots and results are ignored until the next start
  let away = false, awayLive = false;
  let coopOn = false;       // the running match is a co-op run rather than a battle
  const eng = () => (coopOn ? window.EchoCoop : window.EchoDuel);
  const stopAll = () => { window.EchoDuel.stop(); window.EchoCoop?.stop(); };
  const lobby = window.EchoLobby;
  const settings = () => lobby.pick;

  function status(text, bad = false) {
    const el = $('online-status');
    el.textContent = text;
    el.classList.toggle('bad', bad);
  }
  function errorText(e) {
    if (e.message === 'nobody') return `No room called ${code}. Check the code and try again.`;
    if (e.message === 'noroute') return `Found room ${code} but couldn't connect to it. Make sure the host still has the game open on screen, then try again. Joining from the same Wi-Fi helps.`;
    if (e.message === 'full') return 'That room is full.';
    if (e.message === 'started') return 'That match already started. Ask the host to come back to the lobby.';
    if (window.ECHO_PREVIEW) return "Online rooms can't connect from this preview. Open the game from its web address to play online.";
    if (e.message === 'load' || e.message === 'broker')
      return 'Could not reach the online service. Check your connection, or open the game from its web address.';
    return 'Something went wrong. Try again.';
  }

  function renderRoom() {
    if (!role || (role === 'guest' && !roster.length)) { lobby.setRoom(null); return; }
    const host = role === 'host';
    const people = host ? [{ slot: 0, me: true }, ...guests.map((g, k) => ({ slot: k + 1, look: g.look }))] : roster;
    lobby.setRoom({ role, code, people });
    if (host) status(guests.length ? '' : 'Share the code! Keep this screen open while friends join.');   // the seats show who's in
  }

  function lobbyMessage() {
    const { cpus, level, cpuLevels, arenaId, rule, firstTo, variant, coopMap, powers } = settings();
    const looks = [lobby.myLook(), ...guests.map((g) => g.look || null)];
    return { t: 'lobby', code, cpus, level, cpuLevels, arenaId, rule, firstTo, variant, coopMap, powers, cpuSeed: lobby.cpuSeed, looks, players: [0, ...guests.map((g, k) => k + 1)] };
  }
  function sendLobby() {
    if (role !== 'host' || !link) return;
    guests.forEach((g, k) => link.send(g.id, { ...lobbyMessage(), you: k + 1 }));
  }
  lobby.onChange = () => { if (role === 'host' && !playing) sendLobby(); };
  // your bat's look: the host shares it with everyone, a guest tells the host
  lobby.onLook = (look) => {
    if (role === 'host' && !playing) sendLobby();
    else if (role === 'guest' && link) link.send({ t: 'look', look });
  };

  // ---- Voice chat (src/voice.js) -------------------------------------------------
  // Everyone in a room has a voice id: 'host' for the host, the transport's id for a guest.
  // The host tells everyone who sits where ({t:'vr'}) and passes voice signalling ({t:'vx'},
  // tiny JSON: on/off and WebRTC offers) between guests. Audio frames take the transport's
  // direct voice path (room server / test channel); without one they go through the host as
  // {t:'vf'} messages. Voice never touches the game messages ('s', 'in', 'act').
  const V = () => window.EchoVoice;
  let myVid = '';
  const toB64 = (u8) => { let t = ''; for (let i = 0; i < u8.length; i++) t += String.fromCharCode(u8[i]); return btoa(t); };
  const fromB64 = (t) => {
    try { const d = atob(t), u = new Uint8Array(d.length); for (let i = 0; i < d.length; i++) u[i] = d.charCodeAt(i); return u; } catch { return null; }
  };
  const vfBudget = new Map();   // host: guest id -> frames left this second (relayed voice is rate-limited)
  function vfAllowed(id) {
    const now = Math.floor(performance.now() / 1000), b = vfBudget.get(id);
    if (!b || b.s !== now) { vfBudget.set(id, { s: now, n: 29 }); return true; }
    return b.n-- > 0;
  }
  const voiceNet = {
    get me() { return myVid; },
    get direct() { return !!link?.voice; },
    // d is a small JSON object; to is a voice id or '*' for everyone else
    send(to, d) {
      if (!link) return;
      if (role === 'host') {
        for (const g of guests) if (to === '*' || to === g.id) link.send(g.id, { t: 'vx', from: 'host', d });
      } else link.send({ t: 'vx', to, d });
    },
    frame(bytes) {
      if (!link) return false;
      if (link.voice) return link.voice.send(bytes);
      const b = toB64(bytes);
      if (role === 'host') guests.forEach((g) => link.send(g.id, { t: 'vf', from: 'host', b }));
      else link.send({ t: 'vf', b });
      return true;
    },
    listen(on) { link?.voice?.listen(on); },
  };
  const onVoice = (from, bytes) => V()?.frame(from, bytes);
  function voiceRoster() {
    if (role !== 'host') return;
    const peers = [{ id: 'host', slot: 0 }, ...guests.map((g, k) => ({ id: g.id, slot: playing && g.slot != null ? g.slot : k + 1 }))];
    guests.forEach((g) => link.send(g.id, { t: 'vr', you: g.id, peers }));
    V()?.room(myVid, peers);
  }
  function hostVoiceData(id, msg) {
    if (msg.t === 'vx') {
      if (msg.to === 'host' || msg.to === '*') V()?.signal(id, msg.d);
      for (const g of guests) if (g.id !== id && (msg.to === '*' || msg.to === g.id)) link.send(g.id, { t: 'vx', from: id, d: msg.d });
      return true;
    }
    if (msg.t === 'vf') {
      if (typeof msg.b !== 'string' || msg.b.length > 1400 || !vfAllowed(id)) return true;
      const bytes = fromB64(msg.b);
      if (bytes) V()?.frame(id, bytes);
      for (const g of guests) if (g.id !== id) link.send(g.id, { t: 'vf', from: id, b: msg.b });
      return true;
    }
    return false;
  }

  // ---- Host --------------------------------------------------------------------
  async function createRoom() {
    leave(true);
    role = 'host';
    status('Making a room…');
    $('room-create').disabled = true;
    for (let tries = 0; tries < 3; tries++) {
      code = newCode();
      try {
        link = await transport.host(code, { onJoin, onData, onLeave, onVoice });
        break;
      } catch (e) {
        if (e.message !== 'taken' || tries === 2) {
          role = null;
          $('room-create').disabled = false;
          status(errorText(e), true);
          return;
        }
      }
    }
    $('room-create').disabled = false;
    if (role !== 'host') { link?.close(); link = null; return; }  // left while connecting
    guests = [];
    renderRoom();
    myVid = 'host';
    V()?.attach(voiceNet);
    voiceRoster();
  }

  function onJoin(id) {
    if (playing) { link.send(id, { t: 'nope', why: 'started' }); return; }
    const max = settings().rule === 'coop' ? MAX_COOP : MAX_PLAYERS;
    if (guests.length + 1 >= max) { link.send(id, { t: 'nope', why: 'full' }); return; }
    guests.push({ id });
    renderRoom();     // may drop a CPU to make a seat
    sendLobby();
    voiceRoster();
  }

  function onData(id, msg) {
    const k = guests.findIndex((g) => g.id === id);
    if (k < 0 || !msg || typeof msg !== 'object') return;
    if (msg.t === 'bye') { onLeave(id); return; }
    if (hostVoiceData(id, msg)) return;
    if (msg.t === 'look') {
      guests[k].look = window.EchoLooks?.clean?.(msg.look) || null;
      if (!playing) { renderRoom(); sendLobby(); }
      return;
    }
    // a guest went back to the lobby mid-match: a CPU flies their bat until the match ends
    if (msg.t === 'out') { if (playing && eng().active && !eng().over) eng().dropRemote(guests[k].slot); return; }
    if (playing && (msg.t === 'in' || msg.t === 'act')) eng().remote(guests[k].slot, msg);
  }

  function onLeave(id) {
    const k = guests.findIndex((g) => g.id === id);
    if (k < 0) return;
    const [g] = guests.splice(k, 1);
    vfBudget.delete(id);
    if (playing && eng().active) {
      eng().dropRemote(g.slot);
      voiceRoster();
      // keep the remaining guests' slots stable for the rest of the match
      return;
    }
    renderRoom();
    sendLobby();
    voiceRoster();
  }

  // The host starts (or restarts) a match. Guests keep their bat for the whole match.
  function startMatch() {
    if (role !== 'host') return;
    const { cpus, level, rule } = settings();
    const opts = lobby.matchOpts();
    const { looks } = opts;
    const total = 1 + guests.length + cpus;
    if (rule === 'coop') {
      coopOn = true;
      playing = true;
      const seed = Math.floor(Math.random() * 1e9);
      guests.forEach((g, k) => { g.slot = k + 1; link.send(g.id, { t: 'start', mode: 'coop', total, slot: g.slot, level, seed, variant: opts.variant, map: opts.map, looks }); });
      voiceRoster();
      window.EchoGame.startCoop({
        ...opts, mode: 'host', remotes: guests.length, seed, online: true,
        net: { broadcast: (msg) => guests.forEach((g) => link.send(g.id, msg)) },
        rematch: startMatch,
        lobby: backToLobby,
        leave: () => leave(),
      });
      return;
    }
    if (total < 2) return;
    coopOn = false;
    playing = true;
    const { arenaMode, arena, firstTo, powerups } = opts;
    guests.forEach((g, k) => { g.slot = k + 1; link.send(g.id, { t: 'start', total, slot: g.slot, arenaMode, arena, rule, firstTo, powerups, looks }); });
    voiceRoster();
    window.EchoGame.startDuel({
      ...opts, mode: 'host', remotes: guests.length, online: true,
      net: { broadcast: (msg) => guests.forEach((g) => link.send(g.id, msg)) },
      onResult: (result) => guests.forEach((g) => link.send(g.id, { t: 'end', result })),
      rematch: startMatch,
      lobby: backToLobby,
      leave: () => leave(),
    });
  }

  // "Back to lobby" (end screen) or "Back to multiplayer" (pause menu): the room stays open.
  // The host ends the match and brings everyone back to the lobby, seats and all. A guest steps
  // out on their own: mid-match a CPU takes over their bat (they tell the host), and they wait in
  // the lobby until the host comes back to it (or starts a rematch, which they join).
  function backToLobby() {
    if (role === 'host') {
      stopAll();
      playing = false;
      guests.forEach((g) => link.send(g.id, { t: 'lobbyback' }));
      sendLobby();
      voiceRoster();
      toLobbyView();
      status('');
      return;
    }
    if (role === 'guest') {
      const live = playing && eng().active && !eng().over;
      if (live) link?.send({ t: 'out' });
      away = playing;
      awayLive = live;
      stopAll();
      toLobbyView();
      status('');
      return;
    }
    stopAll();
    toLobbyView();
  }
  function toLobbyView() {
    if (window.EchoGame.toLobby) window.EchoGame.toLobby();
    else window.EchoGame.showOverlay('battle');
    renderRoom();
  }

  // ---- Guest -------------------------------------------------------------------
  async function joinRoom(raw) {
    const c = cleanCode(raw);
    if (c.length !== 4) { status('Room codes have 4 letters or numbers.', true); return; }
    leave(true);
    role = 'guest';
    code = c;
    mySlot = -1;
    status(`Looking for room ${code}…`);
    $('join-go').disabled = true;
    let l;
    try {
      l = await transport.join(code, { onData: onHostData, onClose: hostGone, onVoice });
    } catch (e) {
      $('join-go').disabled = false;
      if (role === 'guest' && code === c) { role = null; status(errorText(e), true); }
      return;
    }
    $('join-go').disabled = false;
    if (role !== 'guest' || code !== c) { l.close(); return; }
    link = l;
    roster = [];
    myVid = l.me || '';
    V()?.attach(voiceNet);
    status('Joined! Waiting for the host…');
  }

  function onHostData(msg) {
    if (!msg || typeof msg !== 'object' || role !== 'guest') return;
    switch (msg.t) {
      case 'lobby':
        if (mySlot !== msg.you && msg.you != null) link?.send({ t: 'look', look: lobby.myLook() });   // just joined: show the host my bat
        mySlot = msg.you;
        roster = msg.players.map((slot) => ({ slot, me: slot === mySlot, look: Array.isArray(msg.looks) ? msg.looks[slot] || null : null }));
        renderRoom();
        lobby.applyHost(msg);
        status('');
        break;
      case 'nope': {
        const why = msg.why;
        leave(true);
        status(errorText(new Error(why)), true);
        break;
      }
      case 'start':
        playing = true;
        away = false;
        mySlot = msg.slot;
        coopOn = msg.mode === 'coop';
        if (coopOn) {
          window.EchoGame.startCoop({
            mode: 'client', mySlot: msg.slot, total: msg.total, level: msg.level, seed: msg.seed, variant: msg.variant, map: msg.map, looks: msg.looks, online: true,
            net: { send: (m) => link?.send(m) },
            lobby: backToLobby,
            leave: () => leave(),
          });
          break;
        }
        window.EchoGame.startDuel({
          mode: 'client', mySlot: msg.slot, total: msg.total, arenaMode: msg.arenaMode, arena: msg.arena, rule: msg.rule, firstTo: msg.firstTo, powerups: msg.powerups, looks: msg.looks, online: true,
          net: { send: (m) => link?.send(m) },
          lobby: backToLobby,
          leave: () => leave(),
        });
        break;
      case 's':
        if (playing && !away) eng().applySnapshot(msg);
        break;
      case 'end':
        if (!away) window.EchoGame.showEnd(msg.result, { guest: true });
        break;
      case 'lobbyback':
        // the host is back in the lobby: everyone still on the match (or its results) follows
        playing = false;
        away = false;
        stopAll();
        if (window.EchoGame.inMatchView !== false) toLobbyView();
        else renderRoom();
        status('');
        break;
      case 'vr':
        if (typeof msg.you === 'string') myVid = msg.you;
        if (Array.isArray(msg.peers)) V()?.room(myVid, msg.peers);
        break;
      case 'vx':
        V()?.signal(msg.from, msg.d);
        break;
      case 'vf': {
        const bytes = typeof msg.b === 'string' && msg.b.length <= 1400 ? fromB64(msg.b) : null;
        if (bytes) V()?.frame(msg.from, bytes);
        break;
      }
      default:
        break;
    }
  }

  function hostGone() {
    if (role !== 'guest') return;
    const wasPlaying = playing;
    V()?.detach();
    link = null;
    role = null;
    playing = false;
    away = false;
    roster = [];
    stopAll();
    toLobbyView();
    status(wasPlaying ? 'The host left the match.' : 'The host closed the room.', true);
  }

  // ---- Shared ----------------------------------------------------------------
  function leave(quiet = false) {
    V()?.detach();
    myVid = '';
    if (link) {
      if (role === 'guest') link.send({ t: 'bye' });
      link.close();
    }
    link = null;
    role = null;
    playing = false;
    away = false;
    guests = [];
    roster = [];
    renderRoom();
    if (!quiet) status('');
  }

  const roomUrl = () => `${location.origin}${location.pathname}?room=${code}`;
  function copyLink() {
    const url = roomUrl();
    const done = () => status('Link copied. Send it to a friend!');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => status(url));
    else status(url);
  }
  // the phone's share sheet when there is one, else copy the link
  function invite() {
    if (!code || !role) return;
    if (navigator.share) navigator.share({ title: 'Echo Caves', text: `Join my Echo Caves room: ${code}`, url: roomUrl() }).catch(() => {});
    else copyLink();
  }

  $('room-create').addEventListener('click', createRoom);
  $('room-copy').addEventListener('click', copyLink);
  $('room-invite').addEventListener('click', invite);
  $('join-form').addEventListener('submit', (e) => { e.preventDefault(); joinRoom($('join-code').value); });
  $('join-code').addEventListener('input', (e) => { e.target.value = cleanCode(e.target.value); });
  addEventListener('pagehide', () => leave(true));

  // Link straight into a room: ...?room=ABCD opens Battle and joins
  const linked = cleanCode(params.get('room'));
  if (linked.length === 4) {
    $('join-code').value = linked;
    window.EchoGame.showOverlay('battle');
    joinRoom(linked);
  }

  window.EchoNet = {
    get role() { return role; },
    get code() { return code; },
    get guests() { return guests.length; },
    get playing() { return playing; },
    get away() { return away; },
    // the guest lobby's waiting line while away from a match the host is still on
    get waitNote() {
      if (role !== 'guest' || !away) return '';
      return awayLive ? 'A CPU flies your bat till the match ends' : 'The host is still on the results…';
    },
    createRoom, joinRoom, startMatch, leave, invite,
    clearStatus: () => status(''),
  };
})();
