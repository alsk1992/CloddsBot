---
name: plugins
description: "Plugin management, installation, and lifecycle control"
emoji: "🧩"
---

# Plugins - Complete API Reference

Install, manage, and configure plugins to extend Clodds functionality.

---

## Chat Commands

### List Plugins

```
/plugins                                    List installed plugins
/plugins available                          Browse available plugins
/plugins search <query>                     Search plugin registry
```

### Install/Remove

```
/plugins install <name>                     Install from registry
/plugins install <url>                      Install from URL
/plugins uninstall <id>                     Remove plugin
/plugins update <id>                        Update plugin
/plugins update-all                         Update all plugins
```

### Enable/Disable

```
/plugins enable <id>                        Enable plugin
/plugins disable <id>                       Disable plugin
/plugins restart <id>                       Restart plugin
```

### Configuration

```
/plugins config <id>                        View plugin settings
/plugins set <id> <key> <value>             Update setting
/plugins reset <id>                         Reset to defaults
```

---

## TypeScript API Reference

### Create Plugin Manager

```typescript
import { createPluginManager } from 'clodds/plugins';

const plugins = createPluginManager({
  // Plugin directory
  pluginDir: './plugins',

  // Registry URL
  registry: 'https://plugins.clodds.ai',

  // Auto-update
  autoUpdate: true,
  updateCheckIntervalMs: 86400000,  // Daily
});
```

### List Plugins

```typescript
// Get installed plugins
const installed = plugins.list();

for (const plugin of installed) {
  console.log(`${plugin.id}: ${plugin.name} v${plugin.version}`);
  console.log(`  Status: ${plugin.status}`);  // 'enabled' | 'disabled' | 'error'
  console.log(`  Description: ${plugin.description}`);
}
```

### Install Plugin

```typescript
// Install from registry
await plugins.install('advanced-charts');

// Install from URL
await plugins.install('https://github.com/user/plugin/releases/latest/plugin.zip');

// Install from local path
await plugins.install('/path/to/plugin');
```

### Enable/Disable

```typescript
// Enable plugin
await plugins.enable('advanced-charts');

// Disable plugin
await plugins.disable('advanced-charts');

// Check status
const status = plugins.getStatus('advanced-charts');
console.log(`Enabled: ${status.enabled}`);
```

### Configure Plugin

```typescript
// Get plugin settings
const settings = plugins.getSettings('advanced-charts');
console.log(settings);

// Update settings
await plugins.setSettings('advanced-charts', {
  theme: 'dark',
  refreshInterval: 5000,
});

// Reset to defaults
await plugins.resetSettings('advanced-charts');
```

### Uninstall Plugin

```typescript
await plugins.uninstall('advanced-charts');
```

### Create Custom Plugin

```typescript
// plugins/my-plugin/index.ts
import { Plugin, PluginContext } from 'clodds/plugins';

export default class MyPlugin implements Plugin {
  id = 'my-plugin';
  name = 'My Custom Plugin';
  version = '1.0.0';
  description = 'Adds custom functionality';

  // Default settings
  defaultSettings = {
    enabled: true,
    threshold: 0.5,
  };

  async onLoad(ctx: PluginContext) {
    console.log('Plugin loaded!');

    // Register commands
    ctx.registerCommand({
      name: 'my-command',
      description: 'Does something cool',
      handler: async (args) => {
        return `Result: ${args.join(' ')}`;
      },
    });

    // Register tools
    ctx.registerTool({
      name: 'my-tool',
      description: 'A custom tool',
      execute: async (params) => {
        return { result: 'success' };
      },
    });

    // Subscribe to events
    ctx.on('message', async (msg) => {
      if (msg.content.includes('hello')) {
        await ctx.reply('Hello back!');
      }
    });
  }

  async onUnload(ctx: PluginContext) {
    console.log('Plugin unloaded!');
  }

  async onSettingsChange(settings: any, ctx: PluginContext) {
    console.log('Settings updated:', settings);
  }
}
```

### Plugin Lifecycle

```typescript
// Events
plugins.on('installed', (plugin) => {
  console.log(`Installed: ${plugin.name}`);
});

plugins.on('enabled', (plugin) => {
  console.log(`Enabled: ${plugin.name}`);
});

plugins.on('disabled', (plugin) => {
  console.log(`Disabled: ${plugin.name}`);
});

plugins.on('error', (plugin, error) => {
  console.error(`Plugin error: ${plugin.name}`, error);
});
```

---

## Plugin Structure

```
my-plugin/
├── index.ts          # Main plugin file
├── package.json      # Plugin metadata
├── settings.json     # Default settings
├── commands/         # Command handlers
├── tools/            # Tool definitions
└── assets/           # Static assets
```

### package.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My custom plugin",
  "main": "index.ts",
  "clodds": {
    "minVersion": "0.1.0",
    "permissions": ["network", "storage"],
    "commands": ["my-command"],
    "tools": ["my-tool"]
  }
}
```

---

## Plugin Permissions

| Permission | Access |
|------------|--------|
| `network` | HTTP/WebSocket requests |
| `storage` | Local file storage |
| `exec` | Shell command execution |
| `trading` | Trading APIs |
| `memory` | User memory access |

---

## Best Practices

1. **Minimal permissions** — Only request what you need
2. **Handle errors** — Don't crash on plugin errors
3. **Clean unload** — Release resources on unload
4. **Version compatibility** — Check minVersion
5. **Document settings** — Explain configuration options
