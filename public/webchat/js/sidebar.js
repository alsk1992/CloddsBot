/**
 * Sidebar — tabs (chats, projects, artifacts, code), session list,
 * search, profile popover
 */
import { Storage } from './storage.js';

export class Sidebar {
  constructor(sidebarEl) {
    this.sidebarEl = sidebarEl;
    this.listEl = sidebarEl.querySelector('.session-list');
    this.searchEl = sidebarEl.querySelector('.sidebar-search-input');
    this.sessions = [];
    this.activeSessionId = null;
    this.activeTab = 'chats';

    // Callbacks
    this.onSelect = null;
    this.onDelete = null;
    this.onRename = null;
    this.onArtifactClick = null;
    this.onCodeClick = null;

    // Projects data (localStorage)
    this._projects = JSON.parse(Storage.get('webchat_projects') || '[]');
    // Artifact/code cache keyed by sessionId
    this._artifactCache = {};
    this._allArtifacts = [];
    this._allCode = [];

    // Default expanded on desktop, collapsed on mobile
    const saved = Storage.get('sidebarExpanded');
    if (saved !== null) {
      this._expanded = saved === 'true';
    } else {
      this._expanded = window.innerWidth > 768;
    }
    if (this._expanded) {
      this.sidebarEl.classList.add('expanded');
    }

    // Search filters within active tab
    if (this.searchEl) {
      this.searchEl.addEventListener('input', () => {
        this._renderActiveTab();
      });
    }

    // Tab switching (rail icon buttons)
    this.sidebarEl.querySelectorAll('.rail-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (this.activeTab === tab && this._expanded) {
          // Clicking active tab again collapses panel
          this.toggle();
        } else {
          this.switchTab(tab);
          if (!this._expanded) this.toggle();
        }
      });
    });

    // New project button
    const newProjBtn = this.sidebarEl.querySelector('#new-project-btn');
    if (newProjBtn) {
      newProjBtn.addEventListener('click', () => this._createProject());
    }

    // Profile popover toggle
    const profileBar = this.sidebarEl.querySelector('#sidebar-profile');
    const popover = this.sidebarEl.querySelector('#profile-popover');
    if (profileBar && popover) {
      profileBar.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.toggle('visible');
      });
      // Close popover when clicking outside
      document.addEventListener('click', (e) => {
        if (!popover.contains(e.target) && !profileBar.contains(e.target)) {
          popover.classList.remove('visible');
        }
      });
    }

    // Rail profile button (bottom of icon rail)
    const railProfileBtn = this.sidebarEl.querySelector('#rail-profile-btn');
    if (railProfileBtn && popover) {
      railProfileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this._expanded) this.toggle();
        popover.classList.toggle('visible');
      });
    }

    // Help link
    const helpItem = this.sidebarEl.querySelector('#popover-help');
    if (helpItem) {
      helpItem.addEventListener('click', () => {
        window.open('https://docs.cloddsbot.com', '_blank');
        popover?.classList.remove('visible');
      });
    }

    // Settings panel
    const settingsItem = this.sidebarEl.querySelector('#popover-settings');
    if (settingsItem) {
      settingsItem.addEventListener('click', () => {
        popover?.classList.remove('visible');
        this._openSettings();
      });
    }
    const settingsBack = this.sidebarEl.querySelector('#settings-back');
    if (settingsBack) {
      settingsBack.addEventListener('click', () => this._closeSettings());
    }
    const settingsSave = this.sidebarEl.querySelector('#settings-save');
    if (settingsSave) {
      settingsSave.addEventListener('click', () => this._saveSettings());
    }
    this._settingsDirty = {};

    // Language select
    const langSelect = this.sidebarEl.querySelector('#language-select');
    if (langSelect) {
      const savedLang = Storage.get('webchat_language') || 'en-US';
      langSelect.value = savedLang;
      langSelect.addEventListener('change', () => {
        Storage.set('webchat_language', langSelect.value);
        this.onLanguageChange?.(langSelect.value);
      });
    }

    // Context menu (right-click on sessions)
    this._contextMenu = null;
    document.addEventListener('click', () => this._hideContextMenu());
    document.addEventListener('contextmenu', (e) => {
      // Only prevent default for session items (handled in _renderSessions)
    });
  }

  switchTab(tab) {
    if (tab === this.activeTab) return;
    this.activeTab = tab;

    // Update rail buttons
    this.sidebarEl.querySelectorAll('.rail-btn[data-tab]').forEach(btn => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Update panels
    this.sidebarEl.querySelectorAll('.sidebar-tab-content').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.panel === tab);
    });

    // Update search placeholder
    if (this.searchEl) {
      const placeholders = {
        chats: 'Search chats...',
        projects: 'Search projects...',
        artifacts: 'Search artifacts...',
        code: 'Search code...',
      };
      this.searchEl.placeholder = placeholders[tab] || 'Search...';
    }

    this._renderActiveTab();
  }

  _renderActiveTab() {
    const filter = this.searchEl?.value?.toLowerCase() || undefined;
    switch (this.activeTab) {
      case 'chats': this._renderSessions(filter); break;
      case 'projects': this._renderProjects(filter); break;
      case 'artifacts': this._renderArtifacts(filter); break;
      case 'code': this._renderCode(filter); break;
    }
  }

  async loadSessions() {
    if (!this.listEl) return;
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
    // Also remove from any projects
    for (const p of this._projects) {
      p.sessionIds = p.sessionIds.filter(sid => sid !== id);
    }
    this._saveProjects();
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
    this._expanded = !this._expanded;
    this.sidebarEl.classList.toggle('expanded', this._expanded);
    Storage.set('sidebarExpanded', this._expanded ? 'true' : 'false');
    // Hide popover when collapsing
    if (!this._expanded) {
      const popover = this.sidebarEl.querySelector('#profile-popover');
      popover?.classList.remove('visible');
    }
  }

  get collapsed() { return !this._expanded; }

  // ─── Feed session messages for artifact/code extraction ───
  feedMessages(sessionId, messages) {
    if (!messages?.length) return;
    const session = this.sessions.find(s => s.id === sessionId);
    const sessionTitle = session?.title || session?.lastMessage || 'Untitled';

    const artifacts = [];
    const codes = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'assistant' && msg.role !== 'bot') continue;
      const content = msg.content || '';

      // Extract code blocks
      const codeRegex = /```(\w*)\n([\s\S]*?)```/g;
      let match;
      while ((match = codeRegex.exec(content)) !== null) {
        const lang = match[1] || '';
        const code = match[2].trimEnd();
        const firstLine = code.split('\n')[0].slice(0, 60);
        const entry = {
          type: 'code',
          lang,
          content: code,
          preview: firstLine || '(empty)',
          sessionId,
          sessionTitle,
          messageIndex: i,
        };
        codes.push(entry);
        artifacts.push(entry);
      }

      // Extract tables (markdown tables)
      const tableRegex = /(\|.+\|\n\|[-:\s|]+\|\n(?:\|.+\|\n?)+)/g;
      while ((match = tableRegex.exec(content)) !== null) {
        artifacts.push({
          type: 'table',
          content: match[1],
          preview: match[1].split('\n')[0].slice(0, 60),
          sessionId,
          sessionTitle,
          messageIndex: i,
        });
      }

      // Extract images (markdown images)
      const imgRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
      while ((match = imgRegex.exec(content)) !== null) {
        artifacts.push({
          type: 'image',
          content: match[2],
          preview: match[1] || match[2].split('/').pop().slice(0, 40),
          sessionId,
          sessionTitle,
          messageIndex: i,
        });
      }
    }

    this._artifactCache[sessionId] = { artifacts, codes };
    this._rebuildGlobalLists();
  }

  _rebuildGlobalLists() {
    this._allArtifacts = [];
    this._allCode = [];
    for (const sessionId of Object.keys(this._artifactCache)) {
      const cache = this._artifactCache[sessionId];
      this._allArtifacts.push(...cache.artifacts);
      this._allCode.push(...cache.codes);
    }
    // Re-render if on artifacts or code tab
    if (this.activeTab === 'artifacts' || this.activeTab === 'code') {
      this._renderActiveTab();
    }
  }

  // ─── Sessions (Chats tab) ───

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
        item.setAttribute('role', 'listitem');

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

        // Right-click context menu for "Move to Project"
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this._showContextMenu(e.clientX, e.clientY, s.id);
        });

        group.appendChild(item);
      }

      frag.appendChild(group);
    }

    if (!hasItems) {
      const empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = filter ? 'No results for "' + filter + '"' : 'No conversations yet';
      frag.appendChild(empty);
    }

    const scrollTop = this.listEl.scrollTop;
    this.listEl.innerHTML = '';
    this.listEl.appendChild(frag);
    this.listEl.scrollTop = scrollTop;
  }

  // ─── Context Menu (Move to Project) ───

  _showContextMenu(x, y, sessionId) {
    this._hideContextMenu();
    if (!this._projects.length) return;

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const header = document.createElement('div');
    header.className = 'context-menu-item';
    header.style.cssText = 'font-size:11px;color:var(--text-dim);cursor:default;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;';
    header.textContent = 'Move to Project';
    menu.appendChild(header);

    const divider = document.createElement('div');
    divider.className = 'context-menu-divider';
    menu.appendChild(divider);

    for (const p of this._projects) {
      const item = document.createElement('div');
      item.className = 'context-menu-item context-menu-sub';

      // Folder icon
      item.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';

      const label = document.createElement('span');
      label.textContent = p.name;
      item.appendChild(label);

      const alreadyIn = p.sessionIds.includes(sessionId);
      if (alreadyIn) {
        const check = document.createElement('span');
        check.style.cssText = 'margin-left:auto;color:var(--green);font-size:11px;';
        check.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        item.appendChild(check);
      }

      item.addEventListener('click', () => {
        if (alreadyIn) {
          p.sessionIds = p.sessionIds.filter(id => id !== sessionId);
        } else {
          p.sessionIds.push(sessionId);
        }
        this._saveProjects();
        this._hideContextMenu();
      });

      menu.appendChild(item);
    }

    document.body.appendChild(menu);
    this._contextMenu = menu;

    // Adjust if off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
    }
  }

  _hideContextMenu() {
    if (this._contextMenu) {
      this._contextMenu.remove();
      this._contextMenu = null;
    }
  }

  // ─── Projects ───

  _saveProjects() {
    Storage.set('webchat_projects', JSON.stringify(this._projects));
  }

  _createProject() {
    const name = prompt('Project name:');
    if (!name?.trim()) return;
    const project = {
      id: 'proj-' + Date.now(),
      name: name.trim(),
      sessionIds: [],
    };
    this._projects.push(project);
    this._saveProjects();
    this._renderActiveTab();
  }

  _deleteProject(projectId) {
    if (!confirm('Delete this project? Chats will not be deleted.')) return;
    this._projects = this._projects.filter(p => p.id !== projectId);
    this._saveProjects();
    this._renderActiveTab();
  }

  _renameProject(projectId) {
    const project = this._projects.find(p => p.id === projectId);
    if (!project) return;
    const name = prompt('Rename project:', project.name);
    if (!name?.trim()) return;
    project.name = name.trim();
    this._saveProjects();
    this._renderActiveTab();
  }

  _renderProjects(filter) {
    const listEl = this.sidebarEl.querySelector('.project-list');
    if (!listEl) return;

    const frag = document.createDocumentFragment();
    const filtered = filter
      ? this._projects.filter(p => p.name.toLowerCase().includes(filter))
      : this._projects;

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = filter ? 'No projects match "' + filter + '"' : 'No projects yet';
      frag.appendChild(empty);
      listEl.innerHTML = '';
      listEl.appendChild(frag);
      return;
    }

    for (const project of filtered) {
      const item = document.createElement('div');
      item.className = 'project-item';
      item.dataset.id = project.id;

      const header = document.createElement('div');
      header.className = 'project-header';

      // Chevron
      const chevron = document.createElement('span');
      chevron.className = 'project-chevron';
      chevron.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
      header.appendChild(chevron);

      // Folder icon
      const icon = document.createElement('span');
      icon.className = 'project-icon';
      icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';
      header.appendChild(icon);

      // Name
      const name = document.createElement('span');
      name.className = 'project-name';
      name.textContent = project.name;
      header.appendChild(name);

      // Count badge
      const count = document.createElement('span');
      count.className = 'project-count';
      count.textContent = project.sessionIds.length;
      header.appendChild(count);

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'project-delete';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Delete project';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteProject(project.id);
      });
      header.appendChild(delBtn);

      // Toggle expand
      header.addEventListener('click', () => {
        item.classList.toggle('expanded');
      });

      // Double-click to rename
      name.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this._renameProject(project.id);
      });

      item.appendChild(header);

      // Session list inside project
      const sessionsDiv = document.createElement('div');
      sessionsDiv.className = 'project-sessions';

      for (const sid of project.sessionIds) {
        const session = this.sessions.find(s => s.id === sid);
        if (!session) continue;

        const sessionItem = document.createElement('div');
        sessionItem.className = 'session-item' + (sid === this.activeSessionId ? ' active' : '');
        sessionItem.dataset.id = sid;

        const title = document.createElement('span');
        title.className = 'session-title';
        title.textContent = session.title || session.lastMessage || 'New chat';
        sessionItem.appendChild(title);

        sessionItem.addEventListener('click', () => {
          this.onSelect?.(sid);
        });

        sessionsDiv.appendChild(sessionItem);
      }

      if (!project.sessionIds.length) {
        const empty = document.createElement('div');
        empty.className = 'session-empty';
        empty.style.padding = '8px 14px';
        empty.textContent = 'No chats assigned';
        sessionsDiv.appendChild(empty);
      }

      item.appendChild(sessionsDiv);
      frag.appendChild(item);
    }

    listEl.innerHTML = '';
    listEl.appendChild(frag);
  }

  // ─── Artifacts ───

  _renderArtifacts(filter) {
    const listEl = this.sidebarEl.querySelector('.artifact-list');
    if (!listEl) return;

    const frag = document.createDocumentFragment();
    const filtered = filter
      ? this._allArtifacts.filter(a => a.preview.toLowerCase().includes(filter) || a.sessionTitle.toLowerCase().includes(filter))
      : this._allArtifacts;

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = filter ? 'No artifacts match "' + filter + '"' : 'No artifacts found yet. Send some messages with code, tables, or images.';
      frag.appendChild(empty);
      listEl.innerHTML = '';
      listEl.appendChild(frag);
      return;
    }

    for (const artifact of filtered) {
      const item = document.createElement('div');
      item.className = 'artifact-item';

      // Type icon
      const iconWrap = document.createElement('div');
      iconWrap.className = 'artifact-type-icon type-' + artifact.type;
      if (artifact.type === 'code') {
        iconWrap.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
      } else if (artifact.type === 'table') {
        iconWrap.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>';
      } else if (artifact.type === 'image') {
        iconWrap.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
      }
      item.appendChild(iconWrap);

      // Info
      const info = document.createElement('div');
      info.className = 'artifact-info';

      const preview = document.createElement('div');
      preview.className = 'artifact-preview';
      preview.textContent = artifact.preview;
      info.appendChild(preview);

      const source = document.createElement('div');
      source.className = 'artifact-source';
      source.textContent = artifact.sessionTitle;
      if (artifact.lang) source.textContent += ' - ' + artifact.lang;
      info.appendChild(source);

      item.appendChild(info);

      // Click to navigate
      item.addEventListener('click', () => {
        this.onArtifactClick?.(artifact.sessionId, artifact.messageIndex);
      });

      frag.appendChild(item);
    }

    listEl.innerHTML = '';
    listEl.appendChild(frag);
  }

  // ─── Code ───

  _renderCode(filter) {
    const listEl = this.sidebarEl.querySelector('.code-list');
    if (!listEl) return;

    const frag = document.createDocumentFragment();
    const filtered = filter
      ? this._allCode.filter(c => c.preview.toLowerCase().includes(filter) || c.lang.toLowerCase().includes(filter) || c.sessionTitle.toLowerCase().includes(filter))
      : this._allCode;

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = filter ? 'No code matches "' + filter + '"' : 'No code blocks found yet.';
      frag.appendChild(empty);
      listEl.innerHTML = '';
      listEl.appendChild(frag);
      return;
    }

    const copySvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
    const checkSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

    for (const code of filtered) {
      const item = document.createElement('div');
      item.className = 'code-item';

      // Language badge
      const badge = document.createElement('span');
      badge.className = 'code-lang-badge';
      badge.textContent = code.lang || 'txt';
      item.appendChild(badge);

      // Info
      const info = document.createElement('div');
      info.className = 'code-item-info';

      const preview = document.createElement('div');
      preview.className = 'code-item-preview';
      preview.textContent = code.preview;
      info.appendChild(preview);

      const source = document.createElement('div');
      source.className = 'code-item-source';
      source.textContent = code.sessionTitle;
      info.appendChild(source);

      item.appendChild(info);

      // Copy button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-item-copy';
      copyBtn.title = 'Copy code';
      copyBtn.innerHTML = copySvg;
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = code.content;
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
        copyBtn.innerHTML = checkSvg;
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.innerHTML = copySvg;
          copyBtn.classList.remove('copied');
        }, 2000);
      });
      item.appendChild(copyBtn);

      // Click to navigate
      item.addEventListener('click', () => {
        this.onCodeClick?.(code.sessionId, code.messageIndex);
      });

      frag.appendChild(item);
    }

    listEl.innerHTML = '';
    listEl.appendChild(frag);
  }

  // ── Settings Panel ──

  async _openSettings() {
    const panel = this.sidebarEl.querySelector('#settings-panel');
    if (!panel) return;
    panel.classList.add('visible');

    const body = panel.querySelector('#settings-body');
    body.innerHTML = '<div class="settings-loading">Loading...</div>';

    try {
      const token = Storage.get('webchat_token') || '';
      const r = await fetch('/api/config/env', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error('Failed to load');
      const data = await r.json();
      this._renderSettings(data.schema);
    } catch (err) {
      body.innerHTML = '<div class="settings-error">Failed to load settings. Check authentication.</div>';
    }
  }

  _closeSettings() {
    const panel = this.sidebarEl.querySelector('#settings-panel');
    panel?.classList.remove('visible');
    this._settingsDirty = {};
    const banner = this.sidebarEl.querySelector('#settings-restart-banner');
    if (banner) banner.classList.remove('visible');
    const saveBtn = this.sidebarEl.querySelector('#settings-save');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Save Changes';
    }
  }

  _renderSettings(schema) {
    const body = this.sidebarEl.querySelector('#settings-body');
    if (!body) return;
    body.innerHTML = '';
    this._settingsDirty = {};

    const frag = document.createDocumentFragment();

    for (const cat of schema) {
      const section = document.createElement('div');
      section.className = 'settings-category';

      const label = document.createElement('div');
      label.className = 'settings-category-label';
      label.textContent = cat.category;
      section.appendChild(label);

      for (const v of cat.vars) {
        const field = document.createElement('div');
        field.className = 'settings-field';

        // Header: label + status badge
        const header = document.createElement('div');
        header.className = 'settings-field-header';

        const labelEl = document.createElement('label');
        labelEl.className = 'settings-field-label';
        labelEl.textContent = v.label;
        if (v.required) {
          const req = document.createElement('span');
          req.className = 'settings-required';
          req.textContent = ' *';
          labelEl.appendChild(req);
        }
        header.appendChild(labelEl);

        const status = document.createElement('span');
        status.className = 'settings-field-status ' + (v.set ? 'set' : 'unset');
        status.textContent = v.set ? 'Set' : 'Not set';
        header.appendChild(status);
        field.appendChild(header);

        // Env var name + help link
        const envName = document.createElement('div');
        envName.className = 'settings-env-name';
        envName.textContent = v.key;
        if (v.helpUrl) {
          const link = document.createElement('a');
          link.href = v.helpUrl;
          link.target = '_blank';
          link.rel = 'noopener';
          link.className = 'settings-help-link';
          link.textContent = 'Get key';
          envName.appendChild(document.createTextNode(' '));
          envName.appendChild(link);
        }
        field.appendChild(envName);

        // Input
        const input = document.createElement('input');
        input.className = 'settings-input';
        input.type = v.secret ? 'password' : 'text';
        input.placeholder = v.set ? v.masked : 'Not configured';
        input.dataset.key = v.key;
        input.addEventListener('input', () => {
          const val = input.value.trim();
          if (val) {
            this._settingsDirty[v.key] = val;
          } else {
            delete this._settingsDirty[v.key];
          }
          const saveBtn = this.sidebarEl.querySelector('#settings-save');
          if (saveBtn) {
            saveBtn.disabled = Object.keys(this._settingsDirty).length === 0;
            saveBtn.textContent = 'Save Changes';
          }
        });
        field.appendChild(input);

        section.appendChild(field);
      }

      frag.appendChild(section);
    }

    body.appendChild(frag);
  }

  async _saveSettings() {
    if (Object.keys(this._settingsDirty).length === 0) return;

    const saveBtn = this.sidebarEl.querySelector('#settings-save');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    try {
      const token = Storage.get('webchat_token') || '';
      const r = await fetch('/api/config/env', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ vars: this._settingsDirty }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }

      const data = await r.json();

      if (data.restartRequired) {
        const banner = this.sidebarEl.querySelector('#settings-restart-banner');
        if (banner) banner.classList.add('visible');
      }

      // Refresh panel to show updated statuses
      this._settingsDirty = {};
      await this._openSettings();

      if (saveBtn) saveBtn.textContent = 'Saved!';
      setTimeout(() => {
        if (saveBtn) {
          saveBtn.textContent = 'Save Changes';
          saveBtn.disabled = true;
        }
      }, 2000);
    } catch (err) {
      if (saveBtn) {
        saveBtn.textContent = 'Error - Try Again';
        saveBtn.disabled = false;
        setTimeout(() => {
          if (saveBtn) saveBtn.textContent = 'Save Changes';
        }, 3000);
      }
    }
  }
}
