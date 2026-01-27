/**
 * TUI Module - Clawdbot-style Terminal User Interface
 *
 * Features:
 * - Rich terminal output with colors
 * - Spinners and progress bars
 * - Interactive prompts
 * - Box drawing
 * - Tables
 * - Tree views
 */

import * as readline from 'readline';
import { EventEmitter } from 'events';

// =============================================================================
// TYPES
// =============================================================================

export interface SpinnerOptions {
  text?: string;
  frames?: string[];
  interval?: number;
  color?: Color;
}

export interface ProgressOptions {
  total: number;
  width?: number;
  complete?: string;
  incomplete?: string;
  showPercent?: boolean;
  showEta?: boolean;
}

export interface BoxOptions {
  title?: string;
  padding?: number;
  borderStyle?: 'single' | 'double' | 'rounded' | 'bold' | 'none';
  borderColor?: Color;
  titleColor?: Color;
}

export interface TableOptions {
  headers?: string[];
  border?: boolean;
  align?: Array<'left' | 'center' | 'right'>;
  maxWidth?: number;
}

export interface TreeNode {
  label: string;
  children?: TreeNode[];
}

export type Color = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray';

// =============================================================================
// CONSTANTS
// =============================================================================

const COLORS: Record<Color, string> = {
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

const BG_COLORS: Record<Color, string> = {
  black: '\x1b[40m',
  red: '\x1b[41m',
  green: '\x1b[42m',
  yellow: '\x1b[43m',
  blue: '\x1b[44m',
  magenta: '\x1b[45m',
  cyan: '\x1b[46m',
  white: '\x1b[47m',
  gray: '\x1b[100m',
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const UNDERLINE = '\x1b[4m';
const BLINK = '\x1b[5m';
const INVERSE = '\x1b[7m';
const HIDDEN = '\x1b[8m';
const STRIKETHROUGH = '\x1b[9m';

const SPINNER_FRAMES = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line: ['-', '\\', '|', '/'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  circle: ['◐', '◓', '◑', '◒'],
  square: ['◰', '◳', '◲', '◱'],
  arrow: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  bounce: ['⠁', '⠂', '⠄', '⠂'],
  clock: ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'],
};

const BORDERS = {
  single: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
  rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  bold: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
  none: { tl: ' ', tr: ' ', bl: ' ', br: ' ', h: ' ', v: ' ' },
};

// =============================================================================
// COLOR UTILITIES
// =============================================================================

/** Apply foreground color */
export function color(text: string, fg: Color): string {
  return `${COLORS[fg]}${text}${RESET}`;
}

/** Apply background color */
export function bg(text: string, bgColor: Color): string {
  return `${BG_COLORS[bgColor]}${text}${RESET}`;
}

/** Apply bold */
export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

/** Apply dim */
export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

/** Apply italic */
export function italic(text: string): string {
  return `${ITALIC}${text}${RESET}`;
}

/** Apply underline */
export function underline(text: string): string {
  return `${UNDERLINE}${text}${RESET}`;
}

/** Apply strikethrough */
export function strikethrough(text: string): string {
  return `${STRIKETHROUGH}${text}${RESET}`;
}

/** Apply inverse colors */
export function inverse(text: string): string {
  return `${INVERSE}${text}${RESET}`;
}

/** Strip ANSI codes */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Get visible length (excluding ANSI codes) */
export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

// =============================================================================
// SPINNER
// =============================================================================

export class Spinner {
  private frameIndex = 0;
  private interval: NodeJS.Timeout | null = null;
  private text: string;
  private frames: string[];
  private speed: number;
  private textColor: Color;
  private stream: NodeJS.WriteStream;

  constructor(options: SpinnerOptions = {}) {
    this.text = options.text || '';
    this.frames = options.frames || SPINNER_FRAMES.dots;
    this.speed = options.interval || 80;
    this.textColor = options.color || 'cyan';
    this.stream = process.stderr;
  }

  start(text?: string): this {
    if (text) this.text = text;
    if (this.interval) return this;

    this.hideCursor();
    this.interval = setInterval(() => {
      this.render();
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    }, this.speed);

    return this;
  }

  stop(finalText?: string): this {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.clearLine();
    if (finalText) {
      this.stream.write(finalText + '\n');
    }
    this.showCursor();

    return this;
  }

  success(text?: string): this {
    return this.stop(color('✓ ', 'green') + (text || this.text));
  }

  fail(text?: string): this {
    return this.stop(color('✗ ', 'red') + (text || this.text));
  }

  warn(text?: string): this {
    return this.stop(color('⚠ ', 'yellow') + (text || this.text));
  }

  info(text?: string): this {
    return this.stop(color('ℹ ', 'blue') + (text || this.text));
  }

  setText(text: string): this {
    this.text = text;
    return this;
  }

  private render(): void {
    this.clearLine();
    const frame = color(this.frames[this.frameIndex], this.textColor);
    this.stream.write(`${frame} ${this.text}`);
  }

  private clearLine(): void {
    this.stream.write('\r\x1b[K');
  }

  private hideCursor(): void {
    this.stream.write('\x1b[?25l');
  }

  private showCursor(): void {
    this.stream.write('\x1b[?25h');
  }
}

/** Create and start a spinner */
export function spinner(text?: string, options?: SpinnerOptions): Spinner {
  return new Spinner({ ...options, text }).start();
}

// =============================================================================
// PROGRESS BAR
// =============================================================================

export class ProgressBar {
  private current = 0;
  private total: number;
  private width: number;
  private complete: string;
  private incomplete: string;
  private showPercent: boolean;
  private showEta: boolean;
  private startTime: number;
  private stream: NodeJS.WriteStream;

  constructor(options: ProgressOptions) {
    this.total = options.total;
    this.width = options.width || 40;
    this.complete = options.complete || '█';
    this.incomplete = options.incomplete || '░';
    this.showPercent = options.showPercent ?? true;
    this.showEta = options.showEta ?? true;
    this.startTime = Date.now();
    this.stream = process.stderr;
  }

  tick(amount = 1): this {
    this.current = Math.min(this.current + amount, this.total);
    this.render();
    return this;
  }

  update(current: number): this {
    this.current = Math.min(current, this.total);
    this.render();
    return this;
  }

  finish(): this {
    this.current = this.total;
    this.render();
    this.stream.write('\n');
    return this;
  }

  private render(): void {
    const percent = this.current / this.total;
    const filled = Math.round(this.width * percent);
    const empty = this.width - filled;

    let bar = this.complete.repeat(filled) + this.incomplete.repeat(empty);
    let suffix = '';

    if (this.showPercent) {
      suffix += ` ${(percent * 100).toFixed(1)}%`;
    }

    if (this.showEta && this.current > 0) {
      const elapsed = Date.now() - this.startTime;
      const eta = (elapsed / this.current) * (this.total - this.current);
      suffix += ` ETA: ${formatTime(eta)}`;
    }

    suffix += ` (${this.current}/${this.total})`;

    this.stream.write(`\r[${bar}]${suffix}`);
  }
}

/** Create a progress bar */
export function progress(options: ProgressOptions): ProgressBar {
  return new ProgressBar(options);
}

function formatTime(ms: number): string {
  if (ms < 1000) return '< 1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// =============================================================================
// BOX
// =============================================================================

/** Draw a box around content */
export function box(content: string, options: BoxOptions = {}): string {
  const lines = content.split('\n');
  const padding = options.padding ?? 1;
  const border = BORDERS[options.borderStyle || 'rounded'];
  const borderColor = options.borderColor || 'white';

  // Calculate max width
  const maxLineWidth = Math.max(...lines.map(l => visibleLength(l)));
  const innerWidth = maxLineWidth + padding * 2;

  const result: string[] = [];

  // Top border
  let top = border.tl + border.h.repeat(innerWidth) + border.tr;
  if (options.title) {
    const title = ` ${options.title} `;
    const titlePos = Math.floor((innerWidth - title.length) / 2);
    top = border.tl +
      border.h.repeat(titlePos) +
      (options.titleColor ? color(title, options.titleColor) : title) +
      border.h.repeat(innerWidth - titlePos - visibleLength(title)) +
      border.tr;
  }
  result.push(color(top, borderColor));

  // Padding top
  for (let i = 0; i < padding; i++) {
    result.push(color(border.v, borderColor) + ' '.repeat(innerWidth) + color(border.v, borderColor));
  }

  // Content lines
  for (const line of lines) {
    const paddingLeft = ' '.repeat(padding);
    const paddingRight = ' '.repeat(innerWidth - padding - visibleLength(line));
    result.push(
      color(border.v, borderColor) +
      paddingLeft + line + paddingRight +
      color(border.v, borderColor)
    );
  }

  // Padding bottom
  for (let i = 0; i < padding; i++) {
    result.push(color(border.v, borderColor) + ' '.repeat(innerWidth) + color(border.v, borderColor));
  }

  // Bottom border
  result.push(color(border.bl + border.h.repeat(innerWidth) + border.br, borderColor));

  return result.join('\n');
}

// =============================================================================
// TABLE
// =============================================================================

/** Render a table */
export function table(data: string[][], options: TableOptions = {}): string {
  if (data.length === 0) return '';

  const hasHeaders = options.headers !== undefined;
  const rows = hasHeaders ? [options.headers!, ...data] : data;
  const colCount = Math.max(...rows.map(r => r.length));

  // Calculate column widths
  const colWidths: number[] = new Array(colCount).fill(0);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      colWidths[i] = Math.max(colWidths[i], visibleLength(row[i] || ''));
    }
  }

  // Apply max width limit
  if (options.maxWidth) {
    const totalWidth = colWidths.reduce((a, b) => a + b, 0) + colCount * 3 + 1;
    if (totalWidth > options.maxWidth) {
      const scale = options.maxWidth / totalWidth;
      colWidths.forEach((w, i) => colWidths[i] = Math.floor(w * scale));
    }
  }

  const align = options.align || [];
  const lines: string[] = [];

  // Helper to pad cell
  function padCell(text: string, width: number, alignment: 'left' | 'center' | 'right'): string {
    const len = visibleLength(text);
    const diff = width - len;
    if (diff <= 0) return text.slice(0, width);

    switch (alignment) {
      case 'right':
        return ' '.repeat(diff) + text;
      case 'center':
        const left = Math.floor(diff / 2);
        return ' '.repeat(left) + text + ' '.repeat(diff - left);
      default:
        return text + ' '.repeat(diff);
    }
  }

  // Horizontal line
  function hline(start: string, mid: string, end: string, char: string): string {
    return start + colWidths.map(w => char.repeat(w + 2)).join(mid) + end;
  }

  if (options.border) {
    lines.push(hline('┌', '┬', '┐', '─'));
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let line = options.border ? '│ ' : '';

    for (let j = 0; j < colCount; j++) {
      const cell = row[j] || '';
      const padded = padCell(cell, colWidths[j], align[j] || 'left');
      line += padded;
      if (j < colCount - 1) {
        line += options.border ? ' │ ' : '  ';
      }
    }

    if (options.border) line += ' │';
    lines.push(line);

    // Header separator
    if (hasHeaders && i === 0) {
      if (options.border) {
        lines.push(hline('├', '┼', '┤', '─'));
      } else {
        lines.push(colWidths.map(w => '─'.repeat(w)).join('  '));
      }
    }
  }

  if (options.border) {
    lines.push(hline('└', '┴', '┘', '─'));
  }

  return lines.join('\n');
}

// =============================================================================
// TREE
// =============================================================================

/** Render a tree view */
export function tree(nodes: TreeNode[], prefix = ''): string {
  const lines: string[] = [];

  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    lines.push(prefix + branch + node.label);

    if (node.children && node.children.length > 0) {
      lines.push(tree(node.children, prefix + childPrefix));
    }
  });

  return lines.join('\n');
}

// =============================================================================
// PROMPTS
// =============================================================================

export interface PromptOptions {
  message: string;
  default?: string;
  validate?: (input: string) => boolean | string;
}

export interface ConfirmOptions {
  message: string;
  default?: boolean;
}

export interface SelectOptions {
  message: string;
  choices: Array<string | { label: string; value: string }>;
  default?: number;
}

/** Prompt for text input */
export function prompt(options: PromptOptions): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const defaultText = options.default ? ` (${options.default})` : '';

    rl.question(`${options.message}${defaultText}: `, (answer) => {
      rl.close();
      const value = answer || options.default || '';

      if (options.validate) {
        const result = options.validate(value);
        if (result !== true) {
          console.error(color(typeof result === 'string' ? result : 'Invalid input', 'red'));
          resolve(prompt(options));
          return;
        }
      }

      resolve(value);
    });
  });
}

/** Prompt for yes/no confirmation */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const defaultText = options.default === undefined ? '(y/n)' :
      options.default ? '(Y/n)' : '(y/N)';

    rl.question(`${options.message} ${defaultText}: `, (answer) => {
      rl.close();
      const lower = answer.toLowerCase();

      if (lower === '' && options.default !== undefined) {
        resolve(options.default);
      } else if (lower === 'y' || lower === 'yes') {
        resolve(true);
      } else if (lower === 'n' || lower === 'no') {
        resolve(false);
      } else {
        console.error(color('Please enter y or n', 'red'));
        resolve(confirm(options));
      }
    });
  });
}

/** Prompt for selection from list */
export function select(options: SelectOptions): Promise<string> {
  return new Promise((resolve) => {
    const choices = options.choices.map(c =>
      typeof c === 'string' ? { label: c, value: c } : c
    );

    console.log(options.message);
    choices.forEach((choice, i) => {
      const selected = i === options.default ? color('>', 'cyan') : ' ';
      console.log(`${selected} ${i + 1}. ${choice.label}`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('Enter number: ', (answer) => {
      rl.close();
      const num = parseInt(answer, 10);

      if (isNaN(num) || num < 1 || num > choices.length) {
        console.error(color(`Please enter a number between 1 and ${choices.length}`, 'red'));
        resolve(select(options));
        return;
      }

      resolve(choices[num - 1].value);
    });
  });
}

// =============================================================================
// CURSOR CONTROL
// =============================================================================

export const cursor = {
  hide: () => process.stdout.write('\x1b[?25l'),
  show: () => process.stdout.write('\x1b[?25h'),
  up: (n = 1) => process.stdout.write(`\x1b[${n}A`),
  down: (n = 1) => process.stdout.write(`\x1b[${n}B`),
  forward: (n = 1) => process.stdout.write(`\x1b[${n}C`),
  back: (n = 1) => process.stdout.write(`\x1b[${n}D`),
  moveTo: (x: number, y: number) => process.stdout.write(`\x1b[${y};${x}H`),
  save: () => process.stdout.write('\x1b[s'),
  restore: () => process.stdout.write('\x1b[u'),
};

// =============================================================================
// SCREEN CONTROL
// =============================================================================

export const screen = {
  clear: () => process.stdout.write('\x1b[2J\x1b[H'),
  clearLine: () => process.stdout.write('\x1b[2K'),
  clearDown: () => process.stdout.write('\x1b[J'),
  clearUp: () => process.stdout.write('\x1b[1J'),
  size: () => ({
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  }),
};

// =============================================================================
// LOGGING HELPERS
// =============================================================================

export function success(message: string): void {
  console.log(color('✓', 'green'), message);
}

export function error(message: string): void {
  console.error(color('✗', 'red'), message);
}

export function warn(message: string): void {
  console.warn(color('⚠', 'yellow'), message);
}

export function info(message: string): void {
  console.log(color('ℹ', 'blue'), message);
}

export function debug(message: string): void {
  console.log(color('●', 'gray'), dim(message));
}
