// Echo Caves: online rooms.
// One player creates a room and gets a 4-letter code; friends type the code to join.
// The host's browser runs the match and streams snapshots; guests send their stick and buttons.
// Transport: PeerJS (WebRTC, public broker). Add ?net=local to the URL to use a
// BroadcastChannel instead, so two tabs on one computer can test without a network.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const ID_PREFIX = 'mocaka-echo-';
  const MAX_PLAYERS = 4;
  const BATS = [
    { name: 'Mo', color: 'var(--mo)' },
    { name: 'Ka', color: 'var(--ka)' },
    { name: 'Ca', color: 'var(--ca)' },
    { name: 'Bo', color: 'var(--bo)' },
  ];
  const params = new URLSearchParams(location.search);
  const useLocal = params.get('net') === 'local';

  const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

  // ---- Transports ----------------------------------------------------------
  // Both expose the same shape:
  //   host(code, { onJoin(id), onData(id, msg), onLeave(id) }) -> Promise<{ send(id, msg), close() }>
  //   join(code, { onData(msg), onClose() })                   -> Promise<{ send(msg), close() }>

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
  function peerOptions() {
    const p = params.get('peer');
    if (!p) return { debug: 0 };
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
      return {
        send(id, msg) { const c = conns.get(id); if (c?.open) c.send(msg); },
        close() { for (const c of conns.values()) c.close(); peer.destroy(); },
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
      await withTimeout(new Promise((resolve, reject) => {
        conn.on('open', resolve);
        peer.on('error', (e) => reject(new Error(e.type === 'peer-unavailable' ? 'nobody' : 'broker')));
      }), 12000, 'nobody');
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
      return {
        send(id, msg) { ch.postMessage({ to: id, msg }); },
        close() { for (const id of ids) ch.postMessage({ to: id, bye: true }); ch.close(); },
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
      return {
        send(msg) { ch.postMessage({ to: 'host', from: me, msg }); },
        close() { closed = true; ch.postMessage({ to: 'host', from: me, bye: true }); ch.close(); },
      };
    },
  };

  const transport = useLocal ? localTransport : peerTransport;

  // ---- Room state ------------------------------------------------------------
  // role: null | 'host' | 'guest'
  let role = null, link = null, code = '', cpus = 1, playing = false;
  let guests = [];          // host: [{ id }] in join order; slot = index + 1
  let roster = [];          // guest: [{ slot, me }] from the host's lobby message
  let mySlot = -1;

  function status(text, bad = false) {
    const el = $('online-status');
    el.textContent = text;
    el.classList.toggle('bad', bad);
  }
  function errorText(e) {
    if (e.message === 'nobody') return `No room called ${code}. Check the code and try again.`;
    if (e.message === 'full') return 'That room is full.';
    if (e.message === 'started') return 'That match already started. Ask the host to come back to the lobby.';
    if (window.ECHO_PREVIEW) return "Online rooms can't connect from this preview. Open the game from its web address to play online.";
    if (e.message === 'load' || e.message === 'broker')
      return 'Could not reach the online service. Check your connection, or open the game from its web address.';
    return 'Something went wrong. Try again.';
  }

  function show(view) {
    $('online-home').hidden = view !== 'home';
    $('online-room').hidden = view !== 'room';
  }

  function renderRoom() {
    $('room-code').textContent = code;
    const host = role === 'host';
    const slots = host ? [{ slot: 0, me: true }, ...guests.map((g, k) => ({ slot: k + 1 }))] : roster;
    $('room-players').innerHTML = slots
      .map((p) => `<li><span class="dot ${BATS[p.slot].name.toLowerCase()}"></span><span style="color:${BATS[p.slot].color}">${BATS[p.slot].name}</span>${p.slot === 0 ? ' · host' : ''}${p.me ? ' · you' : ''}</li>`)
      .join('');
    const people = slots.length;
    cpus = Math.max(0, Math.min(cpus, MAX_PLAYERS - people));
    if (people + cpus < 2) cpus = 2 - people;
    document.querySelectorAll('[data-room-cpus]').forEach((b) => {
      const n = +b.dataset.roomCpus;
      b.disabled = !host || people + n > MAX_PLAYERS || people + n < 2;
      b.classList.toggle('on', n === cpus);
      b.setAttribute('aria-pressed', String(n === cpus));
    });
    $('room-start').hidden = !host;
    if (host) status(guests.length ? `${people} players in the room.` : 'Share the code with a friend. You can also start now against CPU bats.');
  }

  function lobbyMessage() {
    return { t: 'lobby', code, cpus, players: [0, ...guests.map((g, k) => k + 1)] };
  }
  function sendLobby() {
    guests.forEach((g, k) => link.send(g.id, { ...lobbyMessage(), you: k + 1 }));
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
        link = await transport.host(code, { onJoin, onData, onLeave });
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
    show('room');
    renderRoom();
  }

  function onJoin(id) {
    if (playing) { link.send(id, { t: 'nope', why: 'started' }); return; }
    if (guests.length + 1 >= MAX_PLAYERS) { link.send(id, { t: 'nope', why: 'full' }); return; }
    guests.push({ id });
    renderRoom();
    sendLobby();
  }

  function onData(id, msg) {
    const k = guests.findIndex((g) => g.id === id);
    if (k < 0 || !msg || typeof msg !== 'object') return;
    if (msg.t === 'bye') { onLeave(id); return; }
    if (playing && (msg.t === 'in' || msg.t === 'act')) window.EchoDuel.remote(guests[k].slot, msg);
  }

  function onLeave(id) {
    const k = guests.findIndex((g) => g.id === id);
    if (k < 0) return;
    const [g] = guests.splice(k, 1);
    if (playing && window.EchoDuel.active) {
      window.EchoDuel.dropRemote(g.slot);
      // keep the remaining guests' slots stable for the rest of the match
      return;
    }
    renderRoom();
    sendLobby();
  }

  // The host starts (or restarts) a match. Guests keep their bat for the whole match.
  function startMatch() {
    if (role !== 'host') return;
    playing = true;
    const total = 1 + guests.length + cpus;
    guests.forEach((g, k) => { g.slot = k + 1; link.send(g.id, { t: 'start', total, slot: g.slot }); });
    window.EchoGame.startDuel({
      mode: 'host', remotes: guests.length, cpus, online: true,
      net: { broadcast: (msg) => guests.forEach((g) => link.send(g.id, msg)) },
      onResult: (result) => guests.forEach((g) => link.send(g.id, { t: 'end', result })),
      rematch: startMatch,
      lobby: backToLobby,
      leave: () => leave(),
    });
  }

  // From the end screen: go back to the room so friends can come and go
  function backToLobby() {
    window.EchoDuel.stop();
    if (role === 'host') {
      playing = false;
      guests.forEach((g) => link.send(g.id, { t: 'lobbyback' }));
      sendLobby();
    }
    window.EchoGame.showOverlay('online');
    show('room');
    renderRoom();
  }

  // ---- Guest -------------------------------------------------------------------
  async function joinRoom(raw) {
    const c = cleanCode(raw);
    if (c.length !== 4) { status('Room codes have 4 letters or numbers.', true); return; }
    leave(true);
    role = 'guest';
    code = c;
    status(`Looking for room ${code}…`);
    $('join-go').disabled = true;
    let l;
    try {
      l = await transport.join(code, { onData: onHostData, onClose: hostGone });
    } catch (e) {
      $('join-go').disabled = false;
      if (role === 'guest' && code === c) { role = null; status(errorText(e), true); }
      return;
    }
    $('join-go').disabled = false;
    if (role !== 'guest' || code !== c) { l.close(); return; }
    link = l;
    roster = [];
    status('Joined! Waiting for the host…');
  }

  function onHostData(msg) {
    if (!msg || typeof msg !== 'object' || role !== 'guest') return;
    switch (msg.t) {
      case 'lobby':
        mySlot = msg.you;
        cpus = msg.cpus;
        roster = msg.players.map((slot) => ({ slot, me: slot === mySlot }));
        show('room');
        renderRoom();
        status('Waiting for the host to start…');
        break;
      case 'nope': {
        const why = msg.why;
        leave(true);
        status(errorText(new Error(why)), true);
        break;
      }
      case 'start':
        playing = true;
        mySlot = msg.slot;
        window.EchoGame.startDuel({
          mode: 'client', mySlot: msg.slot, total: msg.total, online: true,
          net: { send: (m) => link?.send(m) },
          lobby: backToLobby,
          leave: () => leave(),
        });
        break;
      case 's':
        if (playing) window.EchoDuel.applySnapshot(msg);
        break;
      case 'end':
        window.EchoGame.showEnd(msg.result, { guest: true });
        break;
      case 'lobbyback':
        playing = false;
        backToLobby();
        break;
      default:
        break;
    }
  }

  function hostGone() {
    if (role !== 'guest') return;
    const wasPlaying = playing;
    link = null;
    role = null;
    playing = false;
    window.EchoDuel.stop();
    window.EchoGame.showOverlay('online');
    show('home');
    status(wasPlaying ? 'The host left the match.' : 'The host closed the room.', true);
  }

  // ---- Shared ----------------------------------------------------------------
  function leave(quiet = false) {
    if (link) {
      if (role === 'guest') link.send({ t: 'bye' });
      link.close();
    }
    link = null;
    role = null;
    playing = false;
    guests = [];
    roster = [];
    show('home');
    if (!quiet) status('');
  }

  function openOnline() {
    window.EchoGame.showOverlay('online');
    if (!role) { show('home'); status(''); }
  }

  $('online-button').addEventListener('click', openOnline);
  $('room-create').addEventListener('click', createRoom);
  $('join-form').addEventListener('submit', (e) => { e.preventDefault(); joinRoom($('join-code').value); });
  $('join-code').addEventListener('input', (e) => { e.target.value = cleanCode(e.target.value); });
  $('room-start').addEventListener('click', startMatch);
  document.querySelectorAll('[data-room-cpus]').forEach((b) => b.addEventListener('click', () => {
    if (role !== 'host') return;
    cpus = +b.dataset.roomCpus;
    renderRoom();
    sendLobby();
  }));
  $('room-leave').addEventListener('click', () => leave());
  $('online-back').addEventListener('click', () => { leave(); window.EchoGame.showOverlay('title'); });
  addEventListener('pagehide', () => leave(true));

  // Link straight into a room: ...?room=ABCD
  const linked = cleanCode(params.get('room'));
  if (linked.length === 4) {
    $('join-code').value = linked;
    openOnline();
  }

  window.EchoNet = {
    get role() { return role; },
    get code() { return code; },
    get guests() { return guests.length; },
    createRoom, joinRoom, startMatch, leave,
  };
})();
