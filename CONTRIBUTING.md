# Contributing to Clodds

Thanks for your interest in contributing! Clodds is open-source and welcomes contributions.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/clodds
   cd clodds
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a branch:
   ```bash
   git checkout -b feature/my-feature
   ```

## Development

```bash
# Run in dev mode (hot reload)
npm run dev

# Type check
npm run typecheck

# Build
npm run build
```

## Project Structure

```
src/
├── index.ts           # Entry point
├── types.ts           # TypeScript types
├── gateway/           # WebSocket server
├── channels/          # Telegram, Discord adapters
├── feeds/             # Market data (Polymarket, Kalshi, etc.)
├── agents/            # Claude AI integration
├── skills/            # Agent skills (SKILL.md)
├── sessions/          # Per-user state
├── cron/              # Scheduled tasks
├── db/                # SQLite persistence
└── cli/               # CLI commands
```

## Adding a New Market Feed

1. Create `src/feeds/your-platform/index.ts`
2. Implement the feed interface:
   ```typescript
   export interface YourPlatformFeed extends EventEmitter {
     start(): Promise<void>;
     stop(): void;
     searchMarkets(query: string): Promise<Market[]>;
     getMarket(id: string): Promise<Market | null>;
   }
   ```
3. Register in `src/feeds/index.ts`
4. Add to types in `src/types.ts`

## Adding a New Channel

1. Create `src/channels/your-channel/index.ts`
2. Implement message handling and sending
3. Register in `src/channels/index.ts`

## Adding a New Skill

### CLI Skill Handler (required)

1. Create `src/skills/bundled/your-skill/index.ts` with a default export:
   ```typescript
   export default {
     name: 'your-skill',
     description: 'What this skill does',
     commands: ['/your-skill'],
     // Optional: declare env vars needed before handler runs
     requires: { env: ['API_KEY'] },
     handle: async (args: string): Promise<string> => {
       // ...
     },
   };
   ```
2. Add the directory name to `SKILL_MANIFEST` in `src/skills/executor.ts`
3. Run `npx tsc --noEmit` to verify

Skills are lazy-loaded via `await import()` on first use. Each skill loads in its own try/catch, so a missing dependency only disables that one skill. If `requires.env` is set, the executor checks those vars before calling the handler and returns a clear message if any are missing.

### Agent Context (optional)

To also give the AI agent context about your skill, create `src/skills/bundled/your-skill/SKILL.md` with YAML frontmatter:
```yaml
---
name: your-skill
description: "What this skill does"
---

# Your Skill

Instructions for the AI...
```

## Pull Request Guidelines

1. Keep changes focused and atomic
2. Update types when needed
3. Add comments for complex logic
4. Test manually before submitting
5. Describe what changed and why

## Code Style

- Use TypeScript strict mode
- Prefer `async/await` over callbacks
- Use descriptive variable names
- Keep functions small and focused

## Security Guidelines

When contributing code that involves command execution:

1. **Never use string interpolation** with `execSync()`:
   ```typescript
   // BAD - vulnerable to command injection
   execSync(`which ${cmd}`);

   // GOOD - safe with array arguments
   execFileSync('which', [cmd]);
   ```

2. **Use `execFileSync` with array arguments** for all shell commands
3. **Validate and sanitize** user-provided paths and inputs
4. **Report vulnerabilities** via GitHub Security Advisories, not public issues
5. **Run security checks** before submitting:
   ```bash
   npm audit
   npm run typecheck
   ```

See [docs/SECURITY_AUDIT.md](./docs/SECURITY_AUDIT.md) for our security practices.

## Reporting Issues

Please include:
- Node.js version
- Steps to reproduce
- Expected vs actual behavior
- Error messages/logs

## Questions?

Open an issue or join our Discord.

## License

By contributing, you agree that your contributions will be licensed under MIT.
