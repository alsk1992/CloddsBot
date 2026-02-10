/**
 * Chat area — messages, typing, welcome screen, markdown rendering
 */

export class Chat {
  constructor(messagesEl, typingEl, welcomeEl) {
    this.messagesEl = messagesEl;
    this.typingEl = typingEl;
    this.welcomeEl = welcomeEl;
    this.hasMessages = false;

    // Delegated click handlers for copy buttons
    this.messagesEl.addEventListener('click', (e) => {
      // Code block copy
      const codeCopy = e.target.closest('.code-copy');
      if (codeCopy) {
        const block = codeCopy.closest('.code-block');
        const code = block?.querySelector('code');
        if (code) {
          this._copyText(code.textContent).then(() => {
            if (!codeCopy._origHtml) codeCopy._origHtml = codeCopy.innerHTML;
            clearTimeout(codeCopy._copyTimer);
            codeCopy.innerHTML = this._checkSvg + ' Copied!';
            codeCopy.classList.add('copied');
            codeCopy._copyTimer = setTimeout(() => { codeCopy.innerHTML = codeCopy._origHtml; codeCopy.classList.remove('copied'); codeCopy._origHtml = null; }, 2000);
          });
        }
        return;
      }

      // Message copy
      const msgCopy = e.target.closest('.msg-copy');
      if (msgCopy) {
        const row = msgCopy.closest('.msg-row');
        const bubble = row?.querySelector('.bot-bubble');
        if (bubble) {
          this._copyText(bubble.innerText).then(() => {
            if (!msgCopy._origHtml) msgCopy._origHtml = msgCopy.innerHTML;
            clearTimeout(msgCopy._copyTimer);
            msgCopy.innerHTML = this._checkSvg + '<span>Copied!</span>';
            msgCopy.classList.add('copied');
            msgCopy._copyTimer = setTimeout(() => { msgCopy.innerHTML = msgCopy._origHtml; msgCopy.classList.remove('copied'); msgCopy._origHtml = null; }, 2000);
          });
        }
        return;
      }

      // User message edit
      const editBtn = e.target.closest('.msg-edit');
      if (editBtn) {
        const row = editBtn.closest('.msg-row');
        const bubble = row?.querySelector('.user-bubble');
        if (bubble && this.onEdit) {
          this.onEdit(bubble.textContent);
        }
      }
    });
  }

  get _copySvg() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
  }

  get _checkSvg() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  get _editSvg() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
  }

  _createTimestamp(date) {
    const ts = document.createElement('div');
    ts.className = 'msg-time';
    const d = date || new Date();
    ts.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return ts;
  }

  hideWelcome() {
    if (this.welcomeEl && !this.hasMessages) {
      this.welcomeEl.style.display = 'none';
      this.hasMessages = true;
    }
  }

  showWelcome() {
    if (this.welcomeEl) {
      this.welcomeEl.style.display = '';
      this.hasMessages = false;
    }
  }

  clear() {
    const children = Array.from(this.messagesEl.children);
    for (const child of children) {
      if (child !== this.welcomeEl) child.remove();
    }
    this.hasMessages = false;
  }

  addMessage(text, role, messageId, timestamp) {
    this.hideWelcome();

    if (role === 'system') {
      const row = document.createElement('div');
      row.className = 'msg-system';
      if (messageId) row.dataset.messageId = messageId;
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = text;
      row.appendChild(pill);
      this.messagesEl.appendChild(row);
    } else if (role === 'user') {
      const row = document.createElement('div');
      row.className = 'msg-row user-row';
      if (messageId) row.dataset.messageId = messageId;
      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar user-avatar';
      avatar.textContent = 'U';
      const content = document.createElement('div');
      content.className = 'msg-content';
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble user-bubble';
      bubble.textContent = text;
      content.appendChild(bubble);
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'msg-edit';
      editBtn.title = 'Edit';
      editBtn.innerHTML = this._editSvg;
      actions.appendChild(editBtn);
      content.appendChild(actions);
      content.appendChild(this._createTimestamp(timestamp));
      row.appendChild(avatar);
      row.appendChild(content);
      this.messagesEl.appendChild(row);
    } else {
      const row = document.createElement('div');
      row.className = 'msg-row';
      if (messageId) row.dataset.messageId = messageId;
      const avatar = this._createBotAvatar();
      const content = document.createElement('div');
      content.className = 'msg-content';
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble bot-bubble';
      bubble.innerHTML = this.renderMarkdown(text);
      content.appendChild(bubble);
      content.appendChild(this._createActions());
      content.appendChild(this._createTimestamp(timestamp));
      row.appendChild(avatar);
      row.appendChild(content);
      this.messagesEl.appendChild(row);
    }
    this._scrollToBottom();
  }

  addBotMessage(text, messageId, attachments) {
    this.hideWelcome();
    const row = document.createElement('div');
    row.className = 'msg-row';
    if (messageId) row.dataset.messageId = messageId;

    const avatar = this._createBotAvatar();
    const content = document.createElement('div');
    content.className = 'msg-content';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble bot-bubble';
    bubble.innerHTML = this.renderMarkdown(text || '');
    this._appendAttachments(bubble, attachments);
    content.appendChild(bubble);
    content.appendChild(this._createActions());
    content.appendChild(this._createTimestamp());

    row.appendChild(avatar);
    row.appendChild(content);
    this.messagesEl.appendChild(row);
    this._scrollToBottom();
  }

  _createActions() {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-copy';
    copyBtn.title = 'Copy';
    copyBtn.innerHTML = this._copySvg + '<span>Copy</span>';
    actions.appendChild(copyBtn);

    return actions;
  }

  _createBotAvatar() {
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar bot-avatar';
    const img = document.createElement('img');
    img.src = 'logo.png';
    img.alt = 'C';
    img.className = 'avatar-img';
    img.onerror = () => { img.remove(); avatar.textContent = 'C'; };
    avatar.appendChild(img);
    return avatar;
  }

  editMessage(messageId, newText) {
    const row = Array.from(this.messagesEl.children)
      .find(el => el.dataset?.messageId === messageId);
    if (row) {
      const bubble = row.querySelector('.msg-bubble') || row;
      if (bubble.classList.contains('bot-bubble')) {
        bubble.innerHTML = this.renderMarkdown(newText);
      } else {
        bubble.textContent = newText;
      }
    }
  }

  deleteMessage(messageId) {
    const row = Array.from(this.messagesEl.children)
      .find(el => el.dataset?.messageId === messageId);
    if (row) row.remove();
  }

  loadHistory(messages) {
    this.clear();
    if (!messages?.length) {
      this.showWelcome();
      return;
    }
    this.hideWelcome();
    for (const msg of messages) {
      this.addMessage(msg.content, msg.role, undefined, msg.timestamp ? new Date(msg.timestamp) : undefined);
    }
  }

  showLoading() {
    const el = document.createElement('div');
    el.className = 'msg-system msg-loading';
    el.innerHTML = '<span class="pill">Loading messages...</span>';
    this.messagesEl.appendChild(el);
  }

  hideLoading() {
    const el = this.messagesEl.querySelector('.msg-loading');
    if (el) el.remove();
  }

  _appendAttachments(bubble, attachments) {
    if (!Array.isArray(attachments) || !attachments.length) return;
    for (const att of attachments) {
      const url = att.url || (att.data && att.mimeType
        ? 'data:' + att.mimeType + ';base64,' + att.data
        : null);
      if (url && !/^(https?:|data:)/i.test(url)) continue;
      if (att.type === 'image' && url) {
        const img = document.createElement('img');
        img.src = url;
        img.style.cssText = 'max-width:100%;display:block;margin-top:8px;border-radius:10px;';
        bubble.appendChild(img);
      } else if ((att.type === 'video' || att.type === 'audio') && url) {
        const media = document.createElement(att.type === 'video' ? 'video' : 'audio');
        media.src = url;
        media.controls = true;
        media.style.cssText = 'width:100%;margin-top:8px;border-radius:10px;';
        bubble.appendChild(media);
      } else if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.textContent = att.filename || att.mimeType || 'attachment';
        link.style.cssText = 'display:block;margin-top:8px;';
        link.target = '_blank';
        link.rel = 'noopener';
        bubble.appendChild(link);
      }
    }
  }

  showTyping() {
    this.typingEl.classList.add('visible');
    this._typingStart = Date.now();
    this._updateTypingElapsed();
    this._typingTimer = setInterval(() => this._updateTypingElapsed(), 1000);
    this._scrollToBottom();
  }

  hideTyping() {
    this.typingEl.classList.remove('visible');
    clearInterval(this._typingTimer);
    this._typingTimer = null;
    const elapsed = document.getElementById('typing-elapsed');
    if (elapsed) elapsed.textContent = '';
  }

  _updateTypingElapsed() {
    const elapsed = document.getElementById('typing-elapsed');
    if (!elapsed || !this._typingStart) return;
    const secs = Math.floor((Date.now() - this._typingStart) / 1000);
    if (secs < 1) {
      elapsed.textContent = '';
    } else if (secs < 60) {
      elapsed.textContent = `${secs}s`;
    } else {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      elapsed.textContent = `${m}m ${s}s`;
    }
  }

  renderMarkdown(text) {
    if (!text) return '';

    // Extract code blocks first to protect their content
    const codeBlocks = [];
    let processed = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang, code: code.trimEnd() });
      return `\x00CB${idx}\x00`;
    });

    // Extract inline code
    const inlineCodes = [];
    processed = processed.replace(/`([^`\n]+)`/g, (_, code) => {
      const idx = inlineCodes.length;
      inlineCodes.push(code);
      return `\x00IC${idx}\x00`;
    });

    // Now escape HTML on the remaining text
    processed = this._escapeHtml(processed);

    // Headers (must be at start of line)
    processed = processed.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    processed = processed.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    processed = processed.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    processed = processed.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Horizontal rules
    processed = processed.replace(/^---$/gm, '<hr>');

    // Bold+Italic (must come before bold/italic)
    processed = processed.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');

    // Bold
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    processed = processed.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

    // Images (before links so ![alt](url) doesn't get caught by [text](url))
    // Allow one level of balanced parens in URL for Wikipedia-style links
    processed = processed.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^)]*\))+)\)/g, (_, alt, url) => {
      if (!/^https?:\/\//i.test(url.replace(/&amp;/g, '&'))) return '';
      return '<img src="' + url + '" alt="' + alt + '" style="max-width:100%;border-radius:10px;margin:8px 0;display:block;" />';
    });

    // Links (allow one level of balanced parens in URL)
    processed = processed.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^)]*\))+)\)/g, (_, text, url) => {
      if (!/^https?:\/\//i.test(url.replace(/&amp;/g, '&'))) return text;
      return '<a href="' + url + '" target="_blank" rel="noopener">' + text + '</a>';
    });

    // Bare URLs (not already in tags) — strip trailing punctuation like ) . , ; :
    processed = processed.replace(/(?<!="|'>|>)(https?:\/\/[^\s<]+)/g, (_, raw) => {
      let url = raw;
      // Strip trailing ) only if unbalanced (more closing than opening in URL)
      let opens = 0, closes = 0;
      for (const ch of url) { if (ch === '(') opens++; else if (ch === ')') closes++; }
      while (url.endsWith(')') && closes > opens) { url = url.slice(0, -1); closes--; }
      url = url.replace(/[.,;:!?]+$/, '');
      const trailing = raw.slice(url.length);
      return '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>' + trailing;
    });

    // Tables
    processed = processed.replace(/^(\|.+\|)\n(\|[-:\s|]+\|)\n((?:\|.+\|\n?)+)/gm, (_, headerRow, _sep, bodyRows) => {
      const headers = headerRow.split('|').slice(1, -1);
      const rows = bodyRows.trim().split('\n').map(r => r.split('|').slice(1, -1));
      let table = '<table><thead><tr>' + headers.map(h => '<th>' + h.trim() + '</th>').join('') + '</tr></thead><tbody>';
      for (const row of rows) {
        table += '<tr>' + row.map(c => '<td>' + c.trim() + '</td>').join('') + '</tr>';
      }
      return '<div class="table-wrap">' + table + '</tbody></table></div>';
    });

    // Unordered lists (consecutive lines starting with - or *)
    processed = processed.replace(/^(?:[*-] .+\n?)+/gm, (block) => {
      const items = block.trim().split('\n').map(line => {
        const content = line.replace(/^[*-] /, '');
        return '<li>' + content + '</li>';
      });
      return '<ul>' + items.join('') + '</ul>';
    });

    // Ordered lists (consecutive lines starting with number.)
    processed = processed.replace(/^(?:\d+\. .+\n?)+/gm, (block) => {
      const items = block.trim().split('\n').map(line => {
        const content = line.replace(/^\d+\. /, '');
        return '<li>' + content + '</li>';
      });
      return '<ol>' + items.join('') + '</ol>';
    });

    // Blockquotes (merge consecutive lines)
    processed = processed.replace(/^(?:&gt; .+\n?)+/gm, (block) => {
      const lines = block.trim().split('\n').map(line => line.replace(/^&gt; /, ''));
      return '<blockquote>' + lines.join('<br>') + '</blockquote>';
    });

    // Line breaks (but not inside block elements)
    processed = processed.replace(/\n/g, '<br>');

    // Clean up excessive <br> around block elements
    processed = processed.replace(/<br>\s*(<(?:ul|ol|table|h[1-4]|hr|blockquote|div|pre))/g, '$1');
    processed = processed.replace(/(<\/(?:ul|ol|table|h[1-4]|blockquote|div|pre)>)\s*<br>/g, '$1');
    processed = processed.replace(/(<hr>)\s*<br>/g, '$1');

    // Restore inline codes
    processed = processed.replace(/\x00IC(\d+)\x00/g, (_, idx) => {
      return '<code>' + this._escapeHtml(inlineCodes[parseInt(idx)]) + '</code>';
    });

    // Restore code blocks with header + copy button
    processed = processed.replace(/\x00CB(\d+)\x00/g, (_, idx) => {
      const block = codeBlocks[parseInt(idx)];
      if (!block) return '';
      const langAttr = block.lang ? ` class="lang-${block.lang}"` : '';
      const langLabel = block.lang ? `<span class="code-lang">${this._escapeHtml(block.lang)}</span>` : '';
      const copyBtn = `<button class="code-copy">${this._copySvg} Copy</button>`;
      return `<div class="code-block"><div class="code-header">${langLabel}${copyBtn}</div><pre><code${langAttr}>${this._escapeHtml(block.code)}</code></pre></div>`;
    });

    return processed;
  }

  _escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _copyText(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).catch(() => this._copyFallback(text));
    }
    return this._copyFallback(text);
  }

  _copyFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return Promise.resolve();
  }

  _scrollToBottom() {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }
}
