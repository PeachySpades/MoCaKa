// Echo Caves room server (Cloudflare Worker + Durable Object).
// Each 4-letter room code gets its own Durable Object that relays messages between the
// host's browser (which runs the match) and up to seven guests, over WebSockets.
// The same Worker also serves the game files, so the whole game lives at one address.
//
//   GET /room/CODE?role=host  -> WebSocket for the host (409-style error if the code is taken)
//   GET /room/CODE?role=join  -> WebSocket for a guest (error if there's no host)
//
// Host -> server: {to: id, msg}        Server -> host: {ev: 'join'|'data'|'leave', id, msg?}
// Guest -> server: msg                 Server -> guest: msg, or {ev: 'gone'} when the host leaves
//
// Voice chat (src/voice.js): anyone may send 'v1' / 'v0' to start / stop hearing voice, and
// binary messages (small audio frames, at most VOICE_MAX bytes). A binary frame goes straight to
// everyone else who has voice on, with the sender's number in front (2 bytes, little-endian:
// 0 = host, n = guest 'g<n>'). Each sender is held to VOICE_RATE frames a second, and a frame is
// skipped for a listener whose socket is backed up, so voice never holds up game messages.

const CODE = /^[A-Z0-9]{4}$/;
const MAX_GUESTS = 9;
const VOICE_MAX = 1024;   // bytes per frame (a 60 ms frame is about 490)
const VOICE_RATE = 30;    // frames per second per sender (about 17 are needed)
const VOICE_BACKLOG = 64 * 1024;     // 7 guests for 8-bat battles plus slack for a socket still closing; the game itself turns away extras (and a 5th co-op bat) with a friendly message

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{4})$/);
    if (!m) return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const code = m[1].toUpperCase();
    if (!CODE.test(code)) return new Response('Bad code', { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    this.budget = new Map();   // sender -> { s: second, n: frames left }
  }

  sockets(tag) { return this.state.getWebSockets(tag).filter((ws) => ws.readyState === 1); }
  host() { return this.sockets('host')[0]; }

  async fetch(req) {
    const role = new URL(req.url).searchParams.get('role');
    const [client, server] = Object.values(new WebSocketPair());
    let error = null;
    if (role === 'host' && this.host()) error = 'taken';
    else if (role !== 'host' && !this.host()) error = 'nobody';
    else if (role !== 'host' && this.sockets('guest').length >= MAX_GUESTS) error = 'full';

    if (error) {
      // accept just long enough to say why, so the browser gets a readable reason
      server.accept();
      server.send(JSON.stringify({ ev: 'error', why: error }));
      server.close(4000, error);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (role === 'host') {
      this.state.acceptWebSocket(server, ['host']);
      server.serializeAttachment({ role: 'host' });
      server.send(JSON.stringify({ ev: 'ready', voice: 1, id: 'host' }));
    } else {
      const n = ((await this.state.storage.get('n')) || 0) + 1;
      await this.state.storage.put('n', n);
      const id = 'g' + n;
      this.state.acceptWebSocket(server, ['guest', id]);
      server.serializeAttachment({ role: 'guest', id });
      server.send(JSON.stringify({ ev: 'ready', voice: 1, id }));
      this.toHost({ ev: 'join', id });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  toHost(obj) {
    const h = this.host();
    if (h) try { h.send(JSON.stringify(obj)); } catch { /* host just left */ }
  }

  webSocketMessage(ws, data) {
    if (typeof data !== 'string') { this.voice(ws, data); return; }
    if (data === 'ping') { ws.send('pong'); return; }
    if (data === 'v1' || data === 'v0') {
      const me = ws.deserializeAttachment() || {};
      ws.serializeAttachment({ ...me, voice: data === 'v1' });
      return;
    }
    const me = ws.deserializeAttachment() || {};
    if (me.role === 'host') {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      const to = this.sockets(m.to)[0];
      if (to) try { to.send(JSON.stringify(m.msg)); } catch { /* guest just left */ }
    } else {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      this.toHost({ ev: 'data', id: me.id, msg });
    }
  }

  // a voice frame: copy it to everyone else listening, stamped with the sender's number
  voice(ws, data) {
    const len = data.byteLength || 0;
    if (len < 4 || len > VOICE_MAX) return;
    const me = ws.deserializeAttachment() || {};
    const who = me.role === 'host' ? 'host' : me.id;
    if (!who) return;
    const sec = Math.floor(Date.now() / 1000);
    let b = this.budget.get(who);
    if (!b || b.s !== sec) this.budget.set(who, (b = { s: sec, n: VOICE_RATE }));
    if (b.n <= 0) return;
    b.n--;
    const num = who === 'host' ? 0 : Math.min(65535, parseInt(who.slice(1), 10) || 0);
    const out = new Uint8Array(len + 2);
    out[0] = num & 255; out[1] = num >> 8;
    out.set(new Uint8Array(data), 2);
    for (const s of this.state.getWebSockets()) {
      if (s === ws || s.readyState !== 1) continue;
      if (!(s.deserializeAttachment() || {}).voice) continue;
      if (typeof s.bufferedAmount === 'number' && s.bufferedAmount > VOICE_BACKLOG) continue;
      try { s.send(out); } catch { /* just left */ }
    }
  }

  webSocketClose(ws) { this.gone(ws); }
  webSocketError(ws) { this.gone(ws); }

  gone(ws) {
    const me = ws.deserializeAttachment() || {};
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
    if (me.role === 'host') {
      for (const g of this.sockets('guest')) {
        try { g.send(JSON.stringify({ ev: 'gone' })); g.close(1000, 'host left'); } catch { /* already closed */ }
      }
      this.state.storage.deleteAll();
    } else if (me.id) {
      this.budget.delete(me.id);
      this.toHost({ ev: 'leave', id: me.id });
    }
  }
}
