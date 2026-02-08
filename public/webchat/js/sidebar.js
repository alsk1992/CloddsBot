/**
 * Sidebar — session list, search, new chat, grouped by date
 */
import { Storage } from './storage.js';

export class Sidebar {
  constructor(sidebarEl) {
    this.sidebarEl = sidebarEl;
    this.listEl = sidebarEl.querySelector('.session-list');
    this.searchEl = sidebarEl.querySelector('.sidebar-search-input');
    this.sessions = [];
    this.activeSessionId = null;
    this.onSelect = null;
    this.onDelete = null;
    this.onRename = null;

    // Default collapsed on mobile, open on desktop
    const saved = Storage.get('sidebarCollapsed');
    if (saved !== null) {
      this._collapsed = saved === 'true';
    } else {
      this._collapsed = window.innerWidth <= 768;
    }

    if (this._collapsed) {
      this.sidebarEl.classList.add('collapsed');
    }

    if (this.searchEl) {
      this.searchEl.addEventListener('input', () => {
        this._renderSessions(this.searchEl.value.toLowerCase());
      });
    }
  }

  async loadSessions() {
    if (!this.listEl) return;
    // Show skeleton while loading
    this.listEl.innerHTML = '<div class="session-loading"><div class="skeleton-line"></div><div class="skeleton-line short"></div><div class="skeleton-line"></div></div>';
    try {
      const userId = Storage.get('userId') || '';
      const r = await fetch(`/api/chat/sessions?userId=${encodeURIComponent(userId)}`);
      if (!r.ok) { this.listEl.innerHTML = ''; return; }
      const data = await r.json();
      this.sessions = data.sessions || [];
      this._renderWithCurrentFilter();
    } catch {
      this.listEl.innerHTML = '';
    }
  }

  addSession(session) {
    this.sessions = [session, ...this.sessions.filter(s => s.id !== session.id)];
    this._renderWithCurrentFilter();
  }

  updateSession(id, updates) {
    const s = this.sessions.find(s => s.id === id);
    if (s) Object.assign(s, updates);
    this._renderWithCurrentFilter();
  }

  removeSession(id) {
    this.sessions = this.sessions.filter(s => s.id !== id);
    this._renderWithCurrentFilter();
  }

  _renderWithCurrentFilter() {
    const filter = this.searchEl?.value?.toLowerCase() || undefined;
    this._renderSessions(filter);
  }

  setActive(sessionId) {
    this.activeSessionId = sessionId;
    if (this.listEl) {
      this.listEl.querySelectorAll('.session-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === sessionId);
      });
    }
  }

  toggle() {
    this._collapsed = !this._collapsed;
    this.sidebarEl.classList.toggle('collapsed', this._collapsed);
    Storage.set('sidebarCollapsed', this._collapsed ? 'true' : 'false');
  }

  get collapsed() { return this._collapsed; }

  _startRename(item, titleSpan, session) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'session-rename-input';
    input.value = session.title || session.lastMessage || 'New chat';
    titleSpan.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const newTitle = input.value.trim();
      if (save && newTitle && newTitle !== (session.title || session.lastMessage || 'New chat')) {
        session.title = newTitle;
        this.onRename?.(session.id, newTitle);
      }
      const newSpan = document.createElement('span');
      newSpan.className = 'session-title';
      newSpan.textContent = session.title || session.lastMessage || 'New chat';
      input.replaceWith(newSpan);
      item.title = newSpan.textContent;
      newSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this._startRename(item, newSpan, session);
      });
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  _renderSessions(filter) {
    if (!this.listEl) return;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const lastWeek = new Date(today.getTime() - 7 * 86400000);

    const groups = [
      ['Today', []],
      ['Yesterday', []],
      ['Last 7 days', []],
      ['Older', []],
    ];

    for (const s of this.sessions) {
      const title = s.title || s.lastMessage || 'New chat';
      if (filter && !title.toLowerCase().includes(filter)) continue;

      const d = new Date(s.updatedAt);
      if (d >= today) groups[0][1].push(s);
      else if (d >= yesterday) groups[1][1].push(s);
      else if (d >= lastWeek) groups[2][1].push(s);
      else groups[3][1].push(s);
    }

    // Build DOM properly (no innerHTML with user data)
    const frag = document.createDocumentFragment();
    let hasItems = false;

    for (const [label, items] of groups) {
      if (!items.length) continue;
      hasItems = true;

      const group = document.createElement('div');
      group.className = 'session-group';

      const groupLabel = document.createElement('div');
      groupLabel.className = 'session-group-label';
      groupLabel.textContent = label;
      group.appendChild(groupLabel);

      for (const s of items) {
        const title = s.title || s.lastMessage || 'New chat';
        const isActive = s.id === this.activeSessionId;

        const item = document.createElement('div');
        item.className = 'session-item' + (isActive ? ' active' : '');
        item.dataset.id = s.id;
        item.title = title;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'session-title';
        titleSpan.textContent = title;
        item.appendChild(titleSpan);

        const delBtn = document.createElement('button');
        delBtn.className = 'session-delete';
        delBtn.dataset.id = s.id;
        delBtn.title = 'Delete';
        delBtn.innerHTML = '&times;';
        item.appendChild(delBtn);

        // Click handlers
        item.addEventListener('click', (e) => {
          if (e.target.closest('.session-delete')) return;
          if (e.target.closest('.session-rename-input')) return;
          this.onSelect?.(s.id);
        });
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onDelete?.(s.id);
        });
        titleSpan.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this._startRename(item, titleSpan, s);
        });

        group.appendChild(item);
      }

      frag.appendChild(group);
    }

    if (!hasItems) {
      const empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = 'No conversations yet';
      frag.appendChild(empty);
    }

    const scrollTop = this.listEl.scrollTop;
    this.listEl.innerHTML = '';
    this.listEl.appendChild(frag);
    this.listEl.scrollTop = scrollTop;
  }
}
