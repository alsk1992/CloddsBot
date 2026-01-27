/**
 * Terminal Module - Clawdbot-style rich CLI
 *
 * Features:
 * - Command parsing
 * - Rich output formatting
 * - Interactive REPL
 * - Keyboard shortcuts
 * - Command history
 * - Autocomplete
 */

import * as readline from 'readline';
import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { color, bold, dim, box, spinner, Spinner, success, error as errorLog, info as infoLog } from '../tui';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  args?: ArgDefinition[];
  options?: OptionDefinition[];
  handler: (ctx: CommandContext) => Promise<void> | void;
}

export interface ArgDefinition {
  name: string;
  description: string;
  required?: boolean;
  default?: string;
}

export interface OptionDefinition {
  name: string;
  short?: string;
  description: string;
  type?: 'string' | 'boolean' | 'number';
  default?: unknown;
}

export interface CommandContext {
  args: Record<string, string>;
  options: Record<string, unknown>;
  raw: string[];
  print: (message: string) => void;
  error: (message: string) => void;
  prompt: (question: string) => Promise<string>;
  confirm: (question: string) => Promise<boolean>;
  spinner: (text: string) => Spinner;
  exit: (code?: number) => void;
}

export interface ReplOptions {
  prompt?: string;
  historyFile?: string;
  historySize?: number;
  autocomplete?: (line: string) => string[];
}

export interface ParsedInput {
  command: string;
  args: string[];
  options: Record<string, unknown>;
}

// =============================================================================
// COMMAND PARSER
// =============================================================================

export function parseInput(input: string): ParsedInput {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const char of input) {
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === ' ' || char === '\t') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  const command = parts[0] || '';
  const args: string[] = [];
  const options: Record<string, unknown> = {};

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];

    if (part.startsWith('--')) {
      // Long option
      const eq = part.indexOf('=');
      if (eq !== -1) {
        options[part.slice(2, eq)] = part.slice(eq + 1);
      } else if (parts[i + 1] && !parts[i + 1].startsWith('-')) {
        options[part.slice(2)] = parts[++i];
      } else {
        options[part.slice(2)] = true;
      }
    } else if (part.startsWith('-') && part.length === 2) {
      // Short option
      if (parts[i + 1] && !parts[i + 1].startsWith('-')) {
        options[part.slice(1)] = parts[++i];
      } else {
        options[part.slice(1)] = true;
      }
    } else {
      args.push(part);
    }
  }

  return { command, args, options };
}

// =============================================================================
// COMMAND REGISTRY
// =============================================================================

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private aliases: Map<string, string> = new Map();

  /** Register a command */
  register(command: Command): this {
    this.commands.set(command.name, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias, command.name);
      }
    }

    return this;
  }

  /** Get a command by name or alias */
  get(name: string): Command | undefined {
    return this.commands.get(name) || this.commands.get(this.aliases.get(name) || '');
  }

  /** Get all commands */
  all(): Command[] {
    return Array.from(this.commands.values());
  }

  /** Check if command exists */
  has(name: string): boolean {
    return this.commands.has(name) || this.aliases.has(name);
  }

  /** Get command names for autocomplete */
  getNames(): string[] {
    return [...this.commands.keys(), ...this.aliases.keys()];
  }
}

// =============================================================================
// HISTORY MANAGER
// =============================================================================

export class HistoryManager {
  private history: string[] = [];
  private index = -1;
  private filePath: string | null;
  private maxSize: number;

  constructor(filePath?: string, maxSize = 1000) {
    this.filePath = filePath || null;
    this.maxSize = maxSize;
    this.load();
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;

    try {
      const content = readFileSync(this.filePath, 'utf-8');
      this.history = content.trim().split('\n').filter(Boolean).slice(-this.maxSize);
    } catch {}
  }

  private save(): void {
    if (!this.filePath) return;

    try {
      const dir = join(this.filePath, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, this.history.join('\n') + '\n');
    } catch {}
  }

  add(entry: string): void {
    // Don't add duplicates
    if (this.history[this.history.length - 1] === entry) return;

    this.history.push(entry);

    // Trim to max size
    if (this.history.length > this.maxSize) {
      this.history = this.history.slice(-this.maxSize);
    }

    this.index = this.history.length;
    this.save();
  }

  prev(): string | null {
    if (this.index > 0) {
      this.index--;
      return this.history[this.index];
    }
    return null;
  }

  next(): string | null {
    if (this.index < this.history.length - 1) {
      this.index++;
      return this.history[this.index];
    }
    this.index = this.history.length;
    return null;
  }

  search(query: string): string[] {
    return this.history.filter(h => h.includes(query)).reverse();
  }

  reset(): void {
    this.index = this.history.length;
  }

  getAll(): string[] {
    return [...this.history];
  }
}

// =============================================================================
// REPL
// =============================================================================

export class Repl extends EventEmitter {
  private rl: readline.Interface | null = null;
  private commands: CommandRegistry;
  private history: HistoryManager;
  private promptString: string;
  private running = false;
  private autocomplete?: (line: string) => string[];

  constructor(commands: CommandRegistry, options: ReplOptions = {}) {
    super();
    this.commands = commands;
    this.promptString = options.prompt || color('> ', 'cyan');
    this.history = new HistoryManager(
      options.historyFile || join(homedir(), '.clodds', 'history'),
      options.historySize || 1000
    );
    this.autocomplete = options.autocomplete;
  }

  /** Start the REPL */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.promptString,
      completer: this.autocomplete ? (line: string) => {
        const completions = this.autocomplete!(line);
        const hits = completions.filter(c => c.startsWith(line));
        return [hits.length ? hits : completions, line];
      } : undefined,
    });

    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (trimmed) {
        this.history.add(trimmed);
        await this.execute(trimmed);
      }
      this.rl?.prompt();
    });

    this.rl.on('close', () => {
      this.running = false;
      this.emit('exit');
    });

    // Handle Ctrl+C
    this.rl.on('SIGINT', () => {
      console.log('\n' + dim('(Use Ctrl+D or "exit" to quit)'));
      this.rl?.prompt();
    });

    console.log(box(bold('Welcome to Clodds'), {
      borderStyle: 'rounded',
      borderColor: 'cyan',
      padding: 1,
    }));
    console.log(dim('Type "help" for available commands\n'));

    this.rl.prompt();
  }

  /** Stop the REPL */
  stop(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    this.running = false;
  }

  /** Execute a command */
  async execute(input: string): Promise<void> {
    const parsed = parseInput(input);

    // Built-in commands
    if (parsed.command === 'exit' || parsed.command === 'quit') {
      this.stop();
      process.exit(0);
    }

    if (parsed.command === 'help') {
      this.showHelp(parsed.args[0]);
      return;
    }

    if (parsed.command === 'history') {
      const recent = this.history.getAll().slice(-20);
      recent.forEach((h, i) => {
        console.log(dim(`${(recent.length - i).toString().padStart(3)}  `) + h);
      });
      return;
    }

    if (parsed.command === 'clear') {
      console.clear();
      return;
    }

    // Find command
    const command = this.commands.get(parsed.command);
    if (!command) {
      errorLog(`Unknown command: ${parsed.command}`);
      console.log(dim('Type "help" for available commands'));
      return;
    }

    // Build context
    const ctx = this.createContext(command, parsed);

    try {
      await command.handler(ctx);
    } catch (err) {
      errorLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
      logger.error({ command: parsed.command, error: err }, 'Command error');
    }
  }

  private createContext(command: Command, parsed: ParsedInput): CommandContext {
    // Map args
    const args: Record<string, string> = {};
    if (command.args) {
      command.args.forEach((arg, i) => {
        args[arg.name] = parsed.args[i] || arg.default || '';
      });
    }

    // Map options
    const options: Record<string, unknown> = {};
    if (command.options) {
      for (const opt of command.options) {
        const value = parsed.options[opt.name] ??
          (opt.short ? parsed.options[opt.short] : undefined) ??
          opt.default;

        if (opt.type === 'number' && typeof value === 'string') {
          options[opt.name] = parseFloat(value);
        } else if (opt.type === 'boolean') {
          options[opt.name] = value === true || value === 'true';
        } else {
          options[opt.name] = value;
        }
      }
    }

    return {
      args,
      options,
      raw: parsed.args,
      print: (message) => console.log(message),
      error: (message) => errorLog(message),
      prompt: (question) => this.prompt(question),
      confirm: (question) => this.confirm(question),
      spinner: (text) => spinner(text),
      exit: (code = 0) => process.exit(code),
    };
  }

  private showHelp(commandName?: string): void {
    if (commandName) {
      const command = this.commands.get(commandName);
      if (!command) {
        errorLog(`Unknown command: ${commandName}`);
        return;
      }

      console.log('\n' + bold(command.name));
      console.log(dim(command.description));

      if (command.aliases?.length) {
        console.log('\n' + bold('Aliases:') + ' ' + command.aliases.join(', '));
      }

      if (command.args?.length) {
        console.log('\n' + bold('Arguments:'));
        for (const arg of command.args) {
          const req = arg.required ? '' : dim(' (optional)');
          console.log(`  ${arg.name}${req} - ${arg.description}`);
        }
      }

      if (command.options?.length) {
        console.log('\n' + bold('Options:'));
        for (const opt of command.options) {
          const short = opt.short ? `-${opt.short}, ` : '    ';
          console.log(`  ${short}--${opt.name} - ${opt.description}`);
        }
      }

      console.log('');
      return;
    }

    console.log('\n' + bold('Available Commands:') + '\n');

    const commands = this.commands.all();
    const maxLen = Math.max(...commands.map(c => c.name.length));

    for (const cmd of commands) {
      const padding = ' '.repeat(maxLen - cmd.name.length + 2);
      console.log(`  ${color(cmd.name, 'cyan')}${padding}${dim(cmd.description)}`);
    }

    console.log('\n' + dim('Type "help <command>" for more details\n'));
  }

  private prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      const tempRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      tempRl.question(question + ' ', (answer) => {
        tempRl.close();
        resolve(answer);
      });
    });
  }

  private confirm(question: string): Promise<boolean> {
    return new Promise((resolve) => {
      const tempRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      tempRl.question(question + ' (y/n) ', (answer) => {
        tempRl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }
}

// =============================================================================
// CLI BUILDER
// =============================================================================

export class CLI {
  private commands: CommandRegistry = new CommandRegistry();
  private name: string;
  private version: string;
  private description: string;

  constructor(name: string, version: string, description: string) {
    this.name = name;
    this.version = version;
    this.description = description;
  }

  /** Add a command */
  command(cmd: Command): this {
    this.commands.register(cmd);
    return this;
  }

  /** Run the CLI */
  async run(args: string[] = process.argv.slice(2)): Promise<void> {
    if (args.length === 0) {
      // Start REPL
      const repl = new Repl(this.commands, {
        prompt: color(`${this.name}> `, 'cyan'),
        autocomplete: (line) => {
          return this.commands.getNames().filter(n => n.startsWith(line));
        },
      });

      repl.start();
      return;
    }

    // Parse and run single command
    const input = args.join(' ');
    const parsed = parseInput(input);

    if (parsed.command === '--version' || parsed.command === '-v') {
      console.log(this.version);
      return;
    }

    if (parsed.command === '--help' || parsed.command === '-h') {
      this.showHelp();
      return;
    }

    const command = this.commands.get(parsed.command);
    if (!command) {
      errorLog(`Unknown command: ${parsed.command}`);
      this.showHelp();
      process.exit(1);
    }

    // Build args
    const cmdArgs: Record<string, string> = {};
    if (command.args) {
      command.args.forEach((arg, i) => {
        cmdArgs[arg.name] = parsed.args[i] || arg.default || '';
        if (arg.required && !cmdArgs[arg.name]) {
          errorLog(`Missing required argument: ${arg.name}`);
          process.exit(1);
        }
      });
    }

    // Build options
    const cmdOptions: Record<string, unknown> = {};
    if (command.options) {
      for (const opt of command.options) {
        cmdOptions[opt.name] = parsed.options[opt.name] ??
          (opt.short ? parsed.options[opt.short] : undefined) ??
          opt.default;
      }
    }

    const ctx: CommandContext = {
      args: cmdArgs,
      options: cmdOptions,
      raw: parsed.args,
      print: console.log,
      error: errorLog,
      prompt: () => Promise.resolve(''),
      confirm: () => Promise.resolve(false),
      spinner,
      exit: process.exit,
    };

    try {
      await command.handler(ctx);
    } catch (err) {
      errorLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  private showHelp(): void {
    console.log(`\n${bold(this.name)} v${this.version}`);
    console.log(dim(this.description) + '\n');
    console.log(bold('Usage:') + ` ${this.name} <command> [options]\n`);
    console.log(bold('Commands:'));

    for (const cmd of this.commands.all()) {
      console.log(`  ${color(cmd.name, 'cyan').padEnd(20)} ${dim(cmd.description)}`);
    }

    console.log('\n' + dim(`Run "${this.name} <command> --help" for command details\n`));
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/** Create a new CLI */
export function createCLI(name: string, version: string, description: string): CLI {
  return new CLI(name, version, description);
}

/** Create a new REPL */
export function createRepl(commands?: CommandRegistry, options?: ReplOptions): Repl {
  return new Repl(commands || new CommandRegistry(), options);
}
