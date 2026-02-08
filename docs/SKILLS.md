# Skills System

Clodds uses a SKILL.md-based skill system for extending the AI agent with new capabilities. Skills are markdown files with YAML frontmatter that define commands, documentation, and requirements.

**Full backwards compatibility with OpenClaw-format SKILL.md files.** Drop in any OpenClaw skill and it works out of the box.

## Quick Start

### 1. Create a skill folder

```
src/skills/bundled/my-skill/
  SKILL.md          # Required - skill definition
  index.ts          # Optional - TypeScript handler
  skill.json        # Optional - env overrides
  bins/             # Optional - bundled binaries
```

### 2. Write your SKILL.md

```markdown
---
name: my-skill
description: "Does something useful"
emoji: "🔧"
---

# My Skill

Instructions and documentation for the AI agent.

## Commands

| Command | Description |
|---------|-------------|
| `/my-skill run` | Run the thing |
| `/my-skill status` | Check status |
```

### 3. That's it

The skill loader picks up SKILL.md files automatically. No registration code needed.

---

## Skill Locations (Priority Order)

Skills are loaded from four directories. Higher priority overrides lower:

| Priority | Location | Use Case |
|----------|----------|----------|
| 1 (highest) | `<workspace>/skills/` | Project-specific skills |
| 2 | `.clodds/skills/` | User-managed skills |
| 3 | Config `extraDirs` | Custom directories |
| 4 (lowest) | `src/skills/bundled/` | Built-in skills |

If two skills share the same `name`, the higher-priority one wins.

---

## Frontmatter Reference

All fields are optional except the file must exist as `SKILL.md`.

### Core Fields

```yaml
---
name: my-skill              # Skill name (defaults to directory name)
description: "What it does"  # One-line description
emoji: "🔧"                 # Display emoji
homepage: "https://..."      # Project homepage
commands:                    # Slash commands this skill handles
  - /my-skill
  - /ms
---
```

### Dependency Gates

Gates control whether a skill is enabled. If any gate fails, the skill loads but is marked `enabled: false`.

```yaml
---
gates:
  envs:                      # Required environment variables (ALL must be set)
    - MY_API_KEY
    - MY_SECRET
  bins:                      # Required binaries on PATH (ALL must exist)
    - docker
    - kubectl
  anyBins:                   # At least ONE of these must exist
    - nvim
    - vim
    - nano
  os:                        # Restrict to platforms
    - darwin                 # macOS
    - linux
    - windows                # Alias for win32
    - macos                  # Alias for darwin
  config:                    # Required config keys (dot-notation supported)
    - browser.enabled
    - features.beta
---
```

### Invocation Policy

```yaml
---
user-invocable: false             # Hide from slash-command suggestions
disable-model-invocation: true    # Don't inject into AI system prompt
---
```

### Command Dispatch

Route a slash command directly to a tool, bypassing the LLM entirely:

```yaml
---
name: himalaya
command-dispatch: tool       # Enable direct dispatch
command-tool: Bash           # Which tool to route to
command-arg-mode: raw        # 'raw' = pass args as-is, 'parsed' = structured
---
```

When a user types `/himalaya list`, Clodds routes directly to the Bash tool with `himalaya list` instead of sending it through the AI.

---

## OpenClaw Compatibility

Clodds accepts OpenClaw-format SKILL.md files with zero changes. All OpenClaw features are supported:

### OpenClaw Metadata Block

OpenClaw stores extended metadata in a JSON/JSON5 `metadata` field under a manifest key (`openclaw`, `clodds`, or `clawdbot`):

```yaml
---
name: himalaya
description: "CLI email client"
emoji: "📧"
metadata: |
  {
    "openclaw": {
      "emoji": "📧",
      "homepage": "https://github.com/pstrber/himalaya",
      "primaryEnv": "HIMALAYA_CONFIG",
      "skillKey": "himalaya",
      "always": false,
      "os": ["darwin", "linux"],
      "install": {
        "darwin": { "command": "brew install himalaya" },
        "linux": { "command": "cargo install himalaya" }
      },
      "requires": {
        "bins": ["himalaya"],
        "env": ["HIMALAYA_CONFIG"]
      }
    }
  }
user-invocable: true
---
```

### What Gets Merged

| OpenClaw Field | Clodds Equivalent | Behavior |
|---------------|-------------------|----------|
| `requires.bins` | `gates.bins` | Combined (both checked) |
| `requires.env` | `gates.envs` | Combined |
| `requires.anyBins` | `gates.anyBins` | Combined |
| `requires.config` | `gates.config` | Combined |
| `os` | `gates.os` | OpenClaw or native (first wins) |
| `emoji` | `emoji` | Frontmatter wins, then metadata |
| `homepage` | `homepage` | Frontmatter wins, then metadata |
| `install` | `install` | Platform-specific install commands |
| `primaryEnv` | `primaryEnv` | Passed through |
| `skillKey` | `skillKey` | Passed through |
| `always` | `always` | Passed through |

If both Clodds-native `gates` and OpenClaw `requires` are present, they're merged (deduplicated).

### Compatibility Matrix

| Feature | Clodds Native | OpenClaw Format | Works? |
|---------|--------------|-----------------|--------|
| `name:` frontmatter | Yes | Yes | Both |
| `description:` (multi-line YAML) | Yes | Yes | Both |
| `emoji:` frontmatter | Yes | Via `metadata.openclaw.emoji` | Both |
| `gates.envs` | Yes | Via `requires.env` | Both |
| `gates.bins` | Yes | Via `requires.bins` | Both |
| `gates.anyBins` | Yes | Via `requires.anyBins` | Both |
| OS filtering | Yes | Via `metadata.openclaw.os` | Both |
| Install commands | N/A | Via `metadata.openclaw.install` | Yes |
| `user-invocable: false` | Yes | Yes | Both |
| `disable-model-invocation` | Yes | Yes | Both |
| No frontmatter at all | Yes | Yes | Graceful (uses dir name) |
| `{baseDir}` in body | Yes | Yes | Resolved |
| TypeScript `handle()` handler | Yes | N/A (prompt-only) | Unaffected |

---

## Dropping in an OpenClaw Skill

### Step 1: Copy the folder

```bash
# Copy an OpenClaw skill into any skill directory
cp -r ~/openclaw-skills/himalaya .clodds/skills/himalaya
```

The folder should contain at minimum a `SKILL.md` file:

```
.clodds/skills/himalaya/
  SKILL.md
```

### Step 2: Verify

```bash
clodds skills list --verbose
```

You should see the skill listed with its gates status (green check if requirements met, yellow warning if missing deps).

### Step 3: No step 3

That's it. The skill is loaded on next startup (or immediately if hot-reload is enabled).

---

## Advanced Features

### bins/ Directory

Place executables in a `bins/` subdirectory. They're automatically added to PATH when the skill is active:

```
my-skill/
  SKILL.md
  bins/
    my-tool         # Auto-added to PATH
    helper-script
```

Access in your SKILL.md:

```markdown
## Commands

Run `my-tool` to process data.
```

### Environment Overrides (skill.json)

A `skill.json` file alongside SKILL.md can inject environment variables:

```json
{
  "env": {
    "MY_TOOL_CONFIG": "/etc/my-tool.conf",
    "MY_TOOL_LOG_LEVEL": "info"
  }
}
```

These are injected at runtime via `applyEnvOverrides()` and restored when done.

### {baseDir} Template

Reference the skill's directory in the body:

```markdown
---
name: my-skill
---

Config file: `{baseDir}/config.yaml`
Run: `{baseDir}/bins/my-tool --config {baseDir}/config.yaml`
```

`{baseDir}` resolves to the absolute path of the skill folder.

### Snapshot Caching

The loader computes a SHA-256 hash of each skill directory (entry names + file mtimes). If the hash matches the previous load, skills are served from cache instead of re-parsing. This makes restarts fast even with 100+ skills.

### Hot-Reload (File Watching)

Enable via config:

```typescript
const manager = createSkillManager(workspacePath, {
  watch: true,
  watchDebounceMs: 500, // default
});
```

File changes in any skill directory trigger a debounced reload. The snapshot cache is cleared first so changes are picked up.

### Skill Whitelisting

Only load specific bundled skills:

```typescript
const manager = createSkillManager(workspacePath, {
  allowBundled: ['alerts', 'weather', 'feeds'],
});
```

Skills not in the whitelist are skipped entirely (not loaded, not gated).

### Config Key Gating

Skills can require specific config keys to be present:

```yaml
---
gates:
  config:
    - browser.enabled
    - features.experimental
---
```

Config keys are passed via `SkillManagerConfig.configKeys` and support dot-notation traversal.

---

## Two Skill Systems

Clodds has two complementary skill systems:

### 1. SKILL.md (Prompt Skills)

Loaded by `src/skills/loader.ts`. These are markdown files injected into the AI's system prompt. The AI reads the instructions and uses its tools accordingly.

- Lives in: `src/skills/bundled/<name>/SKILL.md`
- Format: YAML frontmatter + markdown body
- Loaded by: `SkillManager`
- 116 skills defined this way

### 2. TypeScript Handlers (Executor Skills)

Loaded by `src/skills/executor.ts`. These are TypeScript modules with a `handle(args)` function that executes logic directly.

- Lives in: `src/skills/bundled/<name>/index.ts`
- Format: TypeScript with `default export { name, commands, handle }`
- Loaded by: Dynamic `import()` in `initializeSkills()`
- 116 handlers in the manifest

A skill can have both: a SKILL.md for AI instructions and an index.ts for programmatic handling. The TypeScript handler takes precedence for registered commands.

---

## CLI Commands

```bash
clodds skills list              # List all installed skills
clodds skills list --verbose    # Show requirements and commands
clodds skills search <query>    # Search skill registry
clodds skills install <slug>    # Install from registry
clodds skills update [slug]     # Update skill(s)
clodds skills uninstall <slug>  # Remove a skill
clodds skills info <slug>       # Show skill details
```

---

## Creating a New Bundled Skill

1. Create the directory:
   ```bash
   mkdir src/skills/bundled/my-skill
   ```

2. Create `SKILL.md` with frontmatter and docs.

3. (Optional) Create `index.ts` with a TypeScript handler:
   ```typescript
   export default {
     name: 'my-skill',
     description: 'Does something',
     commands: ['/my-skill', '/ms'],
     async handle(args: string): Promise<string> {
       // Your logic here
       return `Result: ${args}`;
     },
   };
   ```

4. (Optional) Add the directory name to `SKILL_MANIFEST` in `src/skills/executor.ts` if you created an index.ts handler.

5. Verify:
   ```bash
   npx tsc --noEmit
   npm run build
   ```
