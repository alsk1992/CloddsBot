/**
 * Main controller — wires sidebar, chat, WS, commands
 */
import { Storage } from './storage.js';
import { WSClient } from './ws.js?v=4';
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

    // Sidebar toggle (shared logic for desktop + mobile buttons)
    const toggleSidebar = () => {
      this.sidebar.toggle();
      backdropEl?.classList.toggle('visible', !this.sidebar.collapsed);
      if (!this.sidebar.collapsed) this.commands.hide();
    };
    sidebarToggle?.addEventListener('click', toggleSidebar);
    const sidebarToggleMobile = document.getElementById('sidebar-toggle-mobile');
    sidebarToggleMobile?.addEventListener('click', toggleSidebar);

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
      sendBtnEl.classList.toggle('active', inputEl.value.trim().length > 0 || !!this._pendingAttachment);
      this.commands.handleInput(inputEl.value);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (this.commands.handleKeydown(e)) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._send();
      }
    });

    sendBtnEl.addEventListener('click', () => {
      if (this._generating) {
        this.chat.hideTyping();
        this._setGenerating(false);
        return;
      }
      this._send();
    });

    // Attachment button + file preview
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input');
    const filePreview = document.getElementById('file-preview');
    const filePreviewIcon = filePreview?.querySelector('.file-preview-icon');
    const filePreviewName = filePreview?.querySelector('.file-preview-name');
    const filePreviewRemove = filePreview?.querySelector('.file-preview-remove');

    const showFilePreview = (name, mime) => {
      if (!filePreview) return;
      const icon = mime?.startsWith('image/') ? '\uD83D\uDDBC\uFE0F' :
                   mime === 'application/pdf' ? '\uD83D\uDCC4' :
                   mime?.includes('json') ? '\uD83D\uDCCB' : '\uD83D\uDCCE';
      filePreviewIcon.textContent = icon;
      filePreviewName.textContent = name;
      filePreview.style.display = 'flex';
      attachBtn?.classList.add('has-file');
      sendBtnEl.classList.add('active');
    };

    this._clearFilePreview = () => {
      this._pendingAttachment = null;
      if (filePreview) filePreview.style.display = 'none';
      if (attachBtn) { attachBtn.classList.remove('has-file'); attachBtn.title = 'Attach file'; }
    };

    attachBtn?.addEventListener('click', () => {
      if (fileInput) fileInput.value = '';
      fileInput?.click();
    });
    filePreviewRemove?.addEventListener('click', () => {
      this._clearFilePreview();
      if (!inputEl.value.trim()) sendBtnEl.classList.remove('active');
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
        showFilePreview(file.name, file.type);
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

    // Paste image support (Cmd+V / Ctrl+V)
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob || !fileInput) return;
          const dt = new DataTransfer();
          dt.items.add(new File([blob], `pasted-image-${Date.now()}.png`, { type: blob.type }));
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('change'));
          return;
        }
      }
    });

    // Voice input (Web Speech API)
    const micBtn = document.getElementById('mic-btn');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition && micBtn) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      let listening = false;
      let textBeforeVoice = '';

      micBtn.addEventListener('click', () => {
        if (listening) {
          recognition.abort();
          return;
        }
        textBeforeVoice = inputEl.value;
        listening = true;
        micBtn.classList.add('listening');
        micBtn.title = 'Stop listening';
        recognition.start();
      });

      recognition.onresult = (e) => {
        let interim = '';
        let final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const transcript = e.results[i][0].transcript;
          if (e.results[i].isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }
        const separator = textBeforeVoice && !textBeforeVoice.endsWith(' ') ? ' ' : '';
        inputEl.value = textBeforeVoice + separator + (final || interim);
        autoResize();
        sendBtnEl.classList.toggle('active', inputEl.value.trim().length > 0);
      };

      const stopListening = () => {
        listening = false;
        micBtn.classList.remove('listening');
        micBtn.title = 'Voice input';
      };

      recognition.onend = stopListening;
      recognition.onerror = (e) => {
        stopListening();
        if (e.error !== 'aborted' && e.error !== 'no-speech') {
          console.warn('Speech recognition error:', e.error);
        }
      };
    } else if (micBtn) {
      micBtn.classList.add('unsupported');
    }

    document.addEventListener('click', (e) => {
      if (!paletteEl.contains(e.target) && e.target !== inputEl) {
        this.commands.hide();
      }
    });

    // Welcome chip clicks
    document.querySelectorAll('.welcome-card').forEach(chip => {
      chip.addEventListener('click', () => {
        inputEl.value = chip.dataset.msg;
        this._send();
      });
    });

    // Reconnect banner
    const reconnectBanner = document.getElementById('reconnect-banner');

    // Tab notification state
    this._unreadCount = 0;
    this._originalTitle = document.title;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this._unreadCount > 0) {
        this._unreadCount = 0;
        document.title = this._originalTitle;
      }
    });

    // Time-based greeting
    const greetingEl = document.getElementById('welcome-greeting');
    if (greetingEl) {
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      greetingEl.textContent = greeting;
    }

    // Main element ref for welcome-mode
    this._mainEl = document.querySelector('.main');

    // Stop generation
    this._generating = false;
    this._stopSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    this._sendSvg = sendBtnEl.innerHTML;
    this._sendBtn = sendBtnEl;

    // WS handlers
    this.ws.on('open', () => {
      statusDot.className = 'status-dot';
      statusDot.title = 'Authenticating...';
    });

    this.ws.on('close', () => {
      statusDot.className = 'status-dot error';
      statusDot.title = 'Reconnecting...';
      reconnectBanner?.classList.add('visible');
      this.chat.hideTyping();
      this._setGenerating(false);
    });

    this.ws.on('message', (msg) => {
      this.chat.hideTyping();
      this._setGenerating(false);

      if (msg.type === 'authenticated') {
        statusDot.className = 'status-dot connected';
        statusDot.title = 'Connected';
        reconnectBanner?.classList.remove('visible');
        // Re-fetch messages after reconnect to recover any missed responses
        // Skip if switchSession already loaded history (flag cleared after use)
        if (this.activeSessionId && !this._skipNextRefresh) {
          this._refreshHistory(this.activeSessionId);
        }
        this._skipNextRefresh = false;
      } else if (msg.type === 'switched') {
        // Session switch confirmed
      } else if (msg.type === 'message') {
        this._setWelcomeMode(false);
        this.chat.addBotMessage(msg.text, msg.messageId, msg.attachments);
        if (document.hidden) {
          this._unreadCount++;
          document.title = `(${this._unreadCount}) New message - Clodds`;
        }
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
      this._showGreeting();
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
        const msgs = data.messages || [];
        this.chat.loadHistory(msgs);
        this._setWelcomeMode(!msgs.length);
      } else {
        this.chat.clear();
        this.chat.showWelcome();
        this._setWelcomeMode(true);
      }
    } catch {
      if (this.activeSessionId !== sessionId) return;
      this.chat.clear();
      this.chat.showWelcome();
      this._setWelcomeMode(true);
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
        this._setWelcomeMode(true);
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

    this._setWelcomeMode(false);
    const displayText = text || (this._pendingAttachment ? '\uD83D\uDCCE ' + this._pendingAttachment.filename : '');
    if (displayText) this.chat.addMessage(displayText, 'user');
    if (this._pendingAttachment) {
      this.ws.send(text, [this._pendingAttachment]);
      this._clearFilePreview();
    } else {
      this.ws.send(text);
    }
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtnEl.classList.remove('active');
    this.chat.showTyping();
    this._setGenerating(true);
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

  _setWelcomeMode(on) {
    if (this._mainEl) {
      this._mainEl.classList.toggle('welcome-mode', on);
    }
  }

  _showGreeting() {
    this._setWelcomeMode(true);
  }

  _setGenerating(on) {
    this._generating = on;
    clearTimeout(this._genTimeout);
    const btn = this._sendBtn;
    if (!btn) return;
    if (on) {
      btn.classList.add('stop-mode');
      btn.innerHTML = this._stopSvg;
      btn.title = 'Stop generating';
      btn.classList.add('active');
      // Auto-reset after 90s to prevent stuck state
      this._genTimeout = setTimeout(() => {
        this.chat.hideTyping();
        this._setGenerating(false);
      }, 90000);
    } else {
      btn.classList.remove('stop-mode');
      btn.innerHTML = this._sendSvg;
      btn.title = 'Send';
    }
  }
}

// Boot
const app = new App();
app.init().catch(console.error);
