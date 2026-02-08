/**
 * Command palette for slash commands
 */

const CAT_ICONS = {
  'Core': '\u2699',
  'Market Data': '\uD83D\uDCCA',
  'Polymarket': '\uD83D\uDFE3',
  'Kalshi': '\uD83C\uDFAF',
  'Hyperliquid': '\uD83D\uDFE2',
  'CEX Futures': '\uD83D\uDCC8',
  'Sportsbooks': '\u26BD',
  'Manifold': '\uD83C\uDFB2',
  'Metaculus': '\uD83D\uDD2E',
  'PredictIt': '\uD83C\uDFDB\uFE0F',
  'Predict.fun': '\uD83C\uDFAE',
  'Opinion': '\uD83D\uDCAC',
  'Veil': '\uD83D\uDD12',
  'AgentBets': '\uD83E\uDD16',
  'Solana DeFi': '\uD83D\uDFE1',
  'EVM DeFi': '\uD83D\uDD37',
  'Virtuals & Agents': '\uD83E\uDD16',
  'Bots & Execution': '\u26A1',
  'Portfolio': '\uD83D\uDCBC',
  'Strategy': '\uD83E\uDDE0',
  'Wallet': '\uD83D\uDC5B',
  'Automation': '\uD83D\uDD04',
  'Config': '\uD83D\uDD27',
  'Tools': '\uD83E\uDDF0',
  'Bittensor': '\uD83E\uDDE0',
  'Other': '\uD83D\uDCE6',
};

// Display order for categories in the palette
const CAT_ORDER = [
  'Core',
  'Market Data',
  'Polymarket',
  'Kalshi',
  'Sportsbooks',
  'Manifold',
  'Metaculus',
  'PredictIt',
  'Predict.fun',
  'Opinion',
  'AgentBets',
  'Veil',
  'Hyperliquid',
  'CEX Futures',
  'Solana DeFi',
  'EVM DeFi',
  'Virtuals & Agents',
  'Portfolio',
  'Strategy',
  'Wallet',
  'Bots & Execution',
  'Automation',
  'Tools',
  'Bittensor',
  'Config',
  'Other',
];

// Super-categories group multiple categories under a section header
const SUPER_CATEGORIES = {
  'Prediction Markets': ['Polymarket', 'Kalshi', 'Sportsbooks', 'Manifold', 'Metaculus', 'PredictIt', 'Predict.fun', 'Opinion', 'AgentBets', 'Veil'],
  'Futures & Perps': ['Hyperliquid', 'CEX Futures'],
  'DeFi': ['Solana DeFi', 'EVM DeFi', 'Virtuals & Agents'],
};

// Reverse lookup: category → super-category
const CAT_TO_SUPER = {};
for (const [superCat, cats] of Object.entries(SUPER_CATEGORIES)) {
  for (const cat of cats) CAT_TO_SUPER[cat] = superCat;
}

export class CommandPalette {
  constructor(paletteEl, inputEl, sendBtnEl) {
    this.paletteEl = paletteEl;
    this.inputEl = inputEl;
    this.sendBtnEl = sendBtnEl;
    this.allCommands = [];
    this.filteredCommands = [];
    this.activeIndex = -1;
    this.visible = false;
    this.subcommandMode = false;
    this.onExecute = null;
    this._loadCommands();
  }

  async _loadCommands() {
    try {
      const r = await fetch('/api/commands');
      if (!r.ok) throw new Error('non-ok');
      const data = await r.json();
      this.allCommands = data.commands || [];
    } catch {
      // Retry once after 3s if initial load fails
      if (!this._retried) {
        this._retried = true;
        setTimeout(() => this._loadCommands(), 3000);
      }
    }
  }

  _esc(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  show(filter) {
    const text = filter.slice(1);
    const spaceIdx = text.indexOf(' ');

    if (spaceIdx > 0) {
      this._showSubcommands(text, spaceIdx);
      return;
    }

    this.subcommandMode = false;
    const query = text.toLowerCase();
    this.filteredCommands = query
      ? this.allCommands.filter(c =>
          c.name.toLowerCase().includes(query) ||
          c.description.toLowerCase().includes(query) ||
          c.category.toLowerCase().includes(query))
      : this.allCommands;

    if (!this.filteredCommands.length) { this.hide(); return; }

    const groups = {};
    for (const cmd of this.filteredCommands) {
      (groups[cmd.category] = groups[cmd.category] || []).push(cmd);
    }

    let html = '<div class="cmd-palette-header">'
      + '<span>Commands</span>'
      + '<span class="cmd-palette-hint"><kbd>\u2191\u2193</kbd> navigate <kbd>Tab</kbd> select <kbd>Esc</kbd> close</span>'
      + '</div>';

    let idx = 0;
    const sortedCategories = Object.keys(groups).sort((a, b) => {
      const ai = CAT_ORDER.indexOf(a);
      const bi = CAT_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    let lastSuperCat = null;
    for (const category of sortedCategories) {
      // Insert super-category header when entering a new group
      const superCat = CAT_TO_SUPER[category] || null;
      if (superCat && superCat !== lastSuperCat) {
        html += '<div class="cmd-super-header">' + this._esc(superCat) + '</div>';
      }
      lastSuperCat = superCat;

      const cmds = groups[category];
      const icon = CAT_ICONS[category] || '\uD83D\uDCE6';
      html += '<div class="cmd-category">'
        + '<div class="cmd-category-label">'
        + '<span class="cmd-category-icon">' + icon + '</span>'
        + '<span>' + this._esc(category) + '</span>'
        + '<span class="cmd-category-count">' + cmds.length + '</span>'
        + '</div>';
      for (const cmd of cmds) {
        const hasSubs = cmd.subcommands?.length > 0;
        html += '<div class="cmd-item' + (idx === this.activeIndex ? ' active' : '') + '" data-index="' + idx + '" data-name="' + this._esc(cmd.name) + '">'
          + '<span class="cmd-item-name">' + this._esc(cmd.name) + '</span>'
          + '<span class="cmd-item-desc">' + this._esc(cmd.description) + (hasSubs ? ' \u203A' : '') + '</span></div>';
        idx++;
      }
      html += '</div>';
    }

    this._render(html);
  }

  _showSubcommands(text, spaceIdx) {
    const parentCmd = '/' + text.slice(0, spaceIdx);
    const subQuery = text.slice(spaceIdx + 1).toLowerCase();
    const parent = this.allCommands.find(c => c.name === parentCmd);
    if (!parent?.subcommands?.length) { this.hide(); return; }

    const subs = subQuery
      ? parent.subcommands.filter(s =>
          s.name.toLowerCase().includes(subQuery) ||
          s.description.toLowerCase().includes(subQuery) ||
          (s.category || '').toLowerCase().includes(subQuery))
      : parent.subcommands;

    if (!subs.length) { this.hide(); return; }

    this.filteredCommands = subs.map(s => ({
      name: s.name,
      description: s.description,
      category: s.category || 'General',
      fullName: parentCmd + ' ' + s.name,
    }));
    this.subcommandMode = true;

    let html = '<div class="cmd-palette-header">'
      + '<span>' + this._esc(parentCmd) + '</span>'
      + '<span class="cmd-palette-hint"><kbd>\u2191\u2193</kbd> navigate <kbd>Tab</kbd> select <kbd>Esc</kbd> close</span>'
      + '</div>';
    html += '<div class="cmd-back" data-action="back">\u2190 All commands</div>';

    const subGroups = {};
    for (const cmd of this.filteredCommands) {
      (subGroups[cmd.category] = subGroups[cmd.category] || []).push(cmd);
    }

    let idx = 0;
    for (const [section, cmds] of Object.entries(subGroups)) {
      html += '<div class="cmd-category">'
        + '<div class="cmd-category-label">'
        + '<span>' + this._esc(section) + '</span>'
        + '<span class="cmd-category-count">' + cmds.length + '</span>'
        + '</div>';
      for (const cmd of cmds) {
        html += '<div class="cmd-item' + (idx === this.activeIndex ? ' active' : '') + '" data-index="' + idx + '" data-name="' + this._esc(cmd.fullName) + '">'
          + '<span class="cmd-item-name">' + this._esc(cmd.name) + '</span>'
          + '<span class="cmd-item-desc">' + this._esc(cmd.description) + '</span></div>';
        idx++;
      }
      html += '</div>';
    }

    this._render(html);

    const backBtn = this.paletteEl.querySelector('.cmd-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.inputEl.value = '/';
        this.show('/');
        this.inputEl.focus();
      });
    }
  }

  _render(html) {
    this.paletteEl.innerHTML = html;
    this.paletteEl.classList.add('visible');
    this.visible = true;

    this.paletteEl.querySelectorAll('.cmd-item').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.name;
        if (this.subcommandMode) {
          this.inputEl.value = name + ' ';
        } else {
          this.inputEl.value = name + ' ';
          const parent = this.allCommands.find(c => c.name === name);
          if (parent?.subcommands?.length) {
            this.activeIndex = -1;
            this.show(this.inputEl.value);
            this.sendBtnEl.classList.add('active');
            return;
          }
        }
        this.hide();
        this.inputEl.focus();
        this.sendBtnEl.classList.add('active');
      });
    });
  }

  hide() {
    this.paletteEl.classList.remove('visible');
    this.visible = false;
    this.activeIndex = -1;
  }

  handleInput(text) {
    if (text.startsWith('/')) {
      const afterSlash = text.slice(1);
      const spaceIdx = afterSlash.indexOf(' ');
      if (spaceIdx === -1) {
        this.activeIndex = -1;
        this.show(text);
      } else {
        const parentCmd = '/' + afterSlash.slice(0, spaceIdx);
        const parent = this.allCommands.find(c => c.name === parentCmd);
        if (parent?.subcommands?.length) {
          this.activeIndex = -1;
          this.show(text);
        } else {
          this.hide();
        }
      }
    } else {
      this.hide();
    }
  }

  handleKeydown(e) {
    if (!this.visible) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.activeIndex = Math.min(this.activeIndex + 1, this.filteredCommands.length - 1);
      this.show(this.inputEl.value.startsWith('/') ? this.inputEl.value : '/' + this.inputEl.value);
      const active = this.paletteEl.querySelector('.cmd-item.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.activeIndex = Math.max(this.activeIndex - 1, 0);
      this.show(this.inputEl.value.startsWith('/') ? this.inputEl.value : '/' + this.inputEl.value);
      const active = this.paletteEl.querySelector('.cmd-item.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (this.activeIndex >= 0 && this.activeIndex < this.filteredCommands.length) {
        const sel = this.filteredCommands[this.activeIndex];
        if (this.subcommandMode) {
          this.inputEl.value = sel.fullName + ' ';
        } else {
          this.inputEl.value = sel.name + ' ';
          const parent = this.allCommands.find(c => c.name === sel.name);
          if (parent?.subcommands?.length) {
            this.activeIndex = -1;
            this.show(this.inputEl.value);
            this.sendBtnEl.classList.add('active');
            return true;
          }
        }
        this.hide();
        this.sendBtnEl.classList.add('active');
      }
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (this.activeIndex >= 0 && this.activeIndex < this.filteredCommands.length) {
        e.preventDefault();
        const sel = this.filteredCommands[this.activeIndex];
        if (this.subcommandMode) {
          this.inputEl.value = sel.fullName + ' ';
        } else {
          this.inputEl.value = sel.name + ' ';
        }
        this.hide();
        this.sendBtnEl.classList.add('active');
        return true;
      }
      // Palette visible but no selection — close palette, let Enter send normally
      this.hide();
      return false;
    }
    if (e.key === 'Escape') {
      this.hide();
      return true;
    }
    return false;
  }
}
