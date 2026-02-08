/**
 * Main controller — wires sidebar, chat, WS, commands
 */
import { Storage } from './storage.js';
import { WSClient } from './ws.js';
import { Sidebar } from './sidebar.js';
import { Chat } from './chat.js';
import { CommandPalette } from './commands.js';

class App {
  constructor() {
    this.ws = new WSClient();
    this.activeSessionId = null;
    this.userId = null;
  }

  async init() {
    // Resolve userId & token
    const params = new URLSearchParams(location.search);
    const queryToken = params.get('token');
    if (queryToken) {
      Storage.set('webchat_token', queryToken);
      // Strip token from URL to prevent leaking via bookmarks/history
      params.delete('token');
      const clean = params.toString();
      history.replaceState(null, '', location.pathname + (clean ? '?' + clean : ''));
    }
    const token = Storage.get('webchat_token') || '';

    this.userId = Storage.get('userId') || 'web-' + Date.now();
    Storage.set('userId', this.userId);

    // DOM refs
    const sidebarEl = document.querySelector('.sidebar');
    const messagesEl = document.getElementById('messages');
    const typingEl = document.getElementById('typing');
    const welcomeEl = document.getElementById('welcome');
    const inputEl = document.getElementById('input');
    const sendBtnEl = document.getElementById('send-btn');
    const paletteEl = document.getElementById('cmd-palette');
    const statusDot = document.getElementById('status-dot');
    const headerTitle = document.getElementById('header-title');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const newChatBtn = document.getElementById('new-chat-btn');
    const backdropEl = document.querySelector('.sidebar-backdrop');

    // Init components
    this.sidebar = new Sidebar(sidebarEl);
    this.chat = new Chat(messagesEl, typingEl, welcomeEl);
    this.commands = new CommandPalette(paletteEl, inputEl, sendBtnEl);

    // Scroll-to-bottom button
    const scrollBtn = document.getElementById('scroll-bottom');
    messagesEl.addEventListener('scroll', () => {
      const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;
      scrollBtn.classList.toggle('visible', !atBottom);
    });
    scrollBtn.addEventListener('click', () => {
      messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
    });

    // Sidebar callbacks
    this.sidebar.onSelect = (id) => this.switchSession(id);
    this.sidebar.onDelete = (id) => this.deleteSession(id);
    this.sidebar.onRename = (id, title) => {
      const headerTitle = document.getElementById('header-title');
      if (this.activeSessionId === id && headerTitle) {
        headerTitle.textContent = title;
      }
      fetch(`/api/chat/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, userId: this.userId }),
      }).catch(() => {});
    };
    // Chat edit callback — put text back into input
    this.chat.onEdit = (text) => {
      inputEl.value = text;
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
      sendBtnEl.classList.toggle('active', text.trim().length > 0);
      inputEl.focus();
    };

    newChatBtn?.addEventListener('click', () => this.newChat());
    sidebarToggle?.addEventListener('click', () => {
      this.sidebar.toggle();
      backdropEl?.classList.toggle('visible', !this.sidebar.collapsed);
      if (!this.sidebar.collapsed) this.commands.hide();
    });
    backdropEl?.addEventListener('click', () => {
      if (!this.sidebar.collapsed) {
        this.sidebar.toggle();
        backdropEl.classList.remove('visible');
      }
    });

    // Input handling (textarea auto-resize)
    const autoResize = () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
    };

    inputEl.addEventListener('input', () => {
      autoResize();
      sendBtnEl.classList.toggle('active', inputEl.value.trim().length > 0);
      this.commands.handleInput(inputEl.value);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (this.commands.handleKeydown(e)) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._send();
      }
    });

    sendBtnEl.addEventListener('click', () => this._send());

    // Attachment button
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input');
    attachBtn?.addEventListener('click', () => {
      if (fileInput) fileInput.value = ''; // allow re-selecting same file
      fileInput?.click();
    });
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        this._pendingAttachment = {
          filename: file.name,
          mimeType: file.type,
          data: reader.result?.split(',')[1] || '', // base64
        };
        attachBtn.classList.add('has-file');
        attachBtn.title = file.name;
      };
      reader.onerror = () => {
        this.chat.addMessage('Failed to read file.', 'system');
      };
      reader.readAsDataURL(file);
      fileInput.value = '';
    });

    // Handle drag-and-drop files (prevent browser navigation + attach file)
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && fileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change'));
      }
    });

    document.addEventListener('click', (e) => {
      if (!paletteEl.contains(e.target) && e.target !== inputEl) {
        this.commands.hide();
      }
    });

    // Welcome chip clicks
    document.querySelectorAll('.welcome-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        inputEl.value = chip.dataset.msg;
        this._send();
      });
    });

    // WS handlers
    this.ws.on('open', () => {
      statusDot.className = 'status-dot';
      statusDot.title = 'Authenticating...';
    });

    this.ws.on('close', () => {
      statusDot.className = 'status-dot error';
      statusDot.title = 'Reconnecting...';
      this.chat.hideTyping();
    });

    this.ws.on('message', (msg) => {
      this.chat.hideTyping();

      if (msg.type === 'authenticated') {
        statusDot.className = 'status-dot connected';
        statusDot.title = 'Connected';
        // Re-fetch messages after reconnect to recover any missed responses
        // Skip if switchSession already loaded history (flag cleared after use)
        if (this.activeSessionId && !this._skipNextRefresh) {
          this._refreshHistory(this.activeSessionId);
        }
        this._skipNextRefresh = false;
      } else if (msg.type === 'switched') {
        // Session switch confirmed
      } else if (msg.type === 'message') {
        this.chat.addBotMessage(msg.text, msg.messageId, msg.attachments);
      } else if (msg.type === 'edit') {
        this.chat.editMessage(msg.messageId, msg.text);
      } else if (msg.type === 'delete') {
        this.chat.deleteMessage(msg.messageId);
      } else if (msg.type === 'error') {
        if (msg.message === 'Invalid token') {
          const retry = prompt('Authentication required. Enter WebChat token:');
          if (retry) {
            Storage.set('webchat_token', retry);
            location.reload();
          } else {
            this.chat.addMessage('Authentication failed. Set token or pass ?token= in URL.', 'system');
          }
        } else {
          this.chat.addMessage(msg.message, 'system');
        }
      }
    });

    // Load sessions, then connect
    await this.sidebar.loadSessions();

    const lastSessionId = Storage.get('lastSessionId');
    const hasExisting = this.sidebar.sessions.length > 0;

    if (lastSessionId && this.sidebar.sessions.find(s => s.id === lastSessionId)) {
      await this.switchSession(lastSessionId);
    } else if (hasExisting) {
      await this.switchSession(this.sidebar.sessions[0].id);
    } else {
      // Connect WS without a session — will create one on first message
      this.ws.connect(token, this.userId);
    }

    inputEl.focus();
  }

  async switchSession(sessionId) {
    if (this.activeSessionId === sessionId && this.ws.connected) return;

    this.chat.hideTyping();
    this.activeSessionId = sessionId;
    this.sidebar.setActive(sessionId);
    Storage.set('lastSessionId', sessionId);

    // Update header title
    const session = this.sidebar.sessions.find(s => s.id === sessionId);
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) {
      headerTitle.textContent = session?.title || 'Clodds';
    }

    // Load messages from API (guard against race if user switched again)
    try {
      const r = await fetch(`/api/chat/sessions/${sessionId}?userId=${encodeURIComponent(this.userId)}`);
      if (this.activeSessionId !== sessionId) return; // stale response
      if (r.ok) {
        const data = await r.json();
        this.chat.loadHistory(data.messages || []);
      } else {
        this.chat.clear();
        this.chat.showWelcome();
      }
    } catch {
      if (this.activeSessionId !== sessionId) return;
      this.chat.clear();
      this.chat.showWelcome();
    }

    // Connect or switch WS (skip refresh since we just loaded history above)
    const token = Storage.get('webchat_token') || '';
    if (!this.ws.connected) {
      this._skipNextRefresh = true;
      this.ws.connect(token, this.userId, sessionId);
    } else {
      this.ws.switchSession(sessionId);
    }

    // Close mobile sidebar
    const backdropEl = document.querySelector('.sidebar-backdrop');
    if (backdropEl?.classList.contains('visible')) {
      this.sidebar.toggle();
      backdropEl.classList.remove('visible');
    }
  }

  async _refreshHistory(sessionId) {
    // Deduplicate concurrent calls for the same session
    const seq = (this._refreshSeq = (this._refreshSeq || 0) + 1);
    try {
      const r = await fetch(`/api/chat/sessions/${sessionId}?userId=${encodeURIComponent(this.userId)}`);
      if (this.activeSessionId !== sessionId || this._refreshSeq !== seq) return;
      if (r.ok) {
        const data = await r.json();
        if (this.activeSessionId !== sessionId || this._refreshSeq !== seq) return;
        this.chat.loadHistory(data.messages || []);
      }
    } catch { /* ignore */ }
  }

  async newChat() {
    try {
      const r = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.userId }),
      });
      if (!r.ok) return;
      const data = await r.json();
      this.sidebar.addSession(data.session);
      await this.switchSession(data.session.id);
    } catch { /* ignore */ }
  }

  async deleteSession(sessionId) {
    if (!confirm('Delete this conversation?')) return;
    try {
      await fetch(`/api/chat/sessions/${sessionId}?userId=${encodeURIComponent(this.userId)}`, {
        method: 'DELETE',
      });
    } catch { /* ignore */ }

    this.sidebar.removeSession(sessionId);

    if (this.activeSessionId === sessionId) {
      this.chat.hideTyping();
      if (this.sidebar.sessions.length > 0) {
        await this.switchSession(this.sidebar.sessions[0].id);
      } else {
        this.activeSessionId = null;
        this.chat.clear();
        this.chat.showWelcome();
        Storage.remove('lastSessionId');
        const headerTitle = document.getElementById('header-title');
        if (headerTitle) headerTitle.textContent = 'Clodds';
      }
    }
  }

  async _send() {
    if (this._sending) return;
    const inputEl = document.getElementById('input');
    const sendBtnEl = document.getElementById('send-btn');
    const text = inputEl.value.trim();
    if (!text && !this._pendingAttachment) return;
    this._sending = true;

    // If no active session, create one first
    if (!this.activeSessionId) {
      try {
        const r = await fetch('/api/chat/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: this.userId }),
        });
        if (r.ok) {
          const data = await r.json();
          this.sidebar.addSession(data.session);
          this.activeSessionId = data.session.id;
          this.sidebar.setActive(data.session.id);
          Storage.set('lastSessionId', data.session.id);

          const token = Storage.get('webchat_token') || '';
          this.ws.connect(token, this.userId, data.session.id);
          // Wait for auth with timeout
          await new Promise((resolve) => {
            let elapsed = 0;
            const check = () => {
              if (this.ws.authenticated || elapsed >= 5000) return resolve();
              elapsed += 50;
              setTimeout(check, 50);
            };
            setTimeout(check, 50);
          });
        } else {
          this.chat.addMessage('Failed to create session. Please try again.', 'system');
          this._sending = false;
          return;
        }
      } catch {
        this.chat.addMessage('Failed to create session. Please try again.', 'system');
        this._sending = false;
        return;
      }
    }

    // Check if WS is actually ready before sending
    if (!this.ws.connected) {
      this.chat.addMessage('Connection lost. Please wait and try again.', 'system');
      this._sending = false;
      return;
    }

    const displayText = text || (this._pendingAttachment ? '\uD83D\uDCCE ' + this._pendingAttachment.filename : '');
    if (displayText) this.chat.addMessage(displayText, 'user');
    if (this._pendingAttachment) {
      this.ws.send(text, [this._pendingAttachment]);
      this._pendingAttachment = null;
      const attachBtn = document.getElementById('attach-btn');
      if (attachBtn) { attachBtn.classList.remove('has-file'); attachBtn.title = 'Attach file'; }
    } else {
      this.ws.send(text);
    }
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtnEl.classList.remove('active');
    this.chat.showTyping();
    this.commands.hide();

    // Auto-title: if session has no title, set from first message
    if (this.activeSessionId) {
      const session = this.sidebar.sessions.find(s => s.id === this.activeSessionId);
      if (session && !session.title) {
        const titleSrc = text || displayText;
        const title = titleSrc.slice(0, 50) + (titleSrc.length > 50 ? '...' : '');
        session.title = title;
        this.sidebar.updateSession(session.id, { title });
        const headerTitle = document.getElementById('header-title');
        if (headerTitle) headerTitle.textContent = title;

        // Persist title
        fetch(`/api/chat/sessions/${this.activeSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, userId: this.userId }),
        }).catch(() => {});
      }
    }
    this._sending = false;
  }
}

// Boot
const app = new App();
app.init().catch(console.error);
