/**
 * WebSocket client with auto-reconnect and clean teardown
 */
export class WSClient {
  constructor() {
    this.ws = null;
    this.handlers = { message: [], open: [], close: [], error: [] };
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.currentDelay = this.reconnectDelay;
    this.shouldReconnect = true;
    this.sessionId = null;
    this.authenticated = false;
    this._reconnectTimer = null;
  }

  connect(token, userId, sessionId) {
    this.shouldReconnect = true;
    this.sessionId = sessionId || null;
    this._token = token;
    this._userId = userId;
    this._teardown();
    this._doConnect();
  }

  _teardown() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      // Detach handlers to prevent reconnect cycle
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.authenticated = false;
  }

  _doConnect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${proto}//${location.host}/chat`;
    if (this.sessionId) url += `?sessionId=${encodeURIComponent(this.sessionId)}`;

    this.ws = new WebSocket(url);
    this.authenticated = false;

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        type: 'auth',
        token: this._token || '',
        userId: this._userId || 'web-' + Date.now(),
      }));
      this._emit('open');
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'authenticated') {
          this.authenticated = true;
          this.currentDelay = this.reconnectDelay;
        }
        this._emit('message', msg);
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = () => {
      this.authenticated = false;
      this._emit('close');
      if (this.shouldReconnect) {
        this._reconnectTimer = setTimeout(() => this._doConnect(), this.currentDelay);
        this.currentDelay = Math.min(this.currentDelay * 1.5, this.maxReconnectDelay);
      }
    };

    this.ws.onerror = () => {
      this._emit('error');
    };
  }

  send(text, attachments) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg = { type: 'message', text };
      if (attachments?.length) msg.attachments = attachments;
      this.ws.send(JSON.stringify(msg));
    }
  }

  switchSession(sessionId) {
    this.sessionId = sessionId;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'switch', sessionId }));
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this._teardown();
  }

  on(event, fn) {
    if (this.handlers[event]) this.handlers[event].push(fn);
  }

  off(event, fn) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter(f => f !== fn);
    }
  }

  _emit(event, data) {
    for (const fn of (this.handlers[event] || [])) {
      try { fn(data); } catch { /* ignore */ }
    }
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated;
  }
}
