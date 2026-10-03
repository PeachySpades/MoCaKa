// Echo Caves room server (Cloudflare Worker + Durable Object).
// Each 4-letter room code gets its own Durable Object that relays messages between the
// host's browser (which runs the match) and up to three guests, over WebSockets.
// The same Worker also serves the game files, so the whole game lives at one address.
//
//   GET /room/CODE?role=host  -> WebSocket for the host (409-style error if the code is taken)
//   GET /room/CODE?role=join  -> WebSocket for a guest (error if there's no host)
//
// Host -> server: {to: id, msg}        Server -> host: {ev: 'join'|'data'|'leave', id, msg?}
// Guest -> server: msg                 Server -> guest: msg, or {ev: 'gone'} when the host leaves

const CODE = /^[A-Z0-9]{4}$/;
const MAX_GUESTS = 8;     // the game itself turns away extras with a friendly message

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
      server.send(JSON.stringify({ ev: 'ready' }));
    } else {
      const n = ((await this.state.storage.get('n')) || 0) + 1;
      await this.state.storage.put('n', n);
      const id = 'g' + n;
      this.state.acceptWebSocket(server, ['guest', id]);
      server.serializeAttachment({ role: 'guest', id });
      server.send(JSON.stringify({ ev: 'ready' }));
      this.toHost({ ev: 'join', id });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  toHost(obj) {
    const h = this.host();
    if (h) try { h.send(JSON.stringify(obj)); } catch { /* host just left */ }
  }

  webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data === 'ping') { if (data === 'ping') ws.send('pong'); return; }
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
      this.toHost({ ev: 'leave', id: me.id });
    }
  }
}
