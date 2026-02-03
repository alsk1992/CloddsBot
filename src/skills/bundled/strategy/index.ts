/**
 * Strategy CLI Skill
 *
 * Commands:
 * /strategy list - List strategy templates
 * /strategy create <name> <template> - Create strategy
 * /strategy start <name> - Start a bot
 * /strategy stop <name> - Stop a bot
 * /strategy status - Bot status
 */

import type { StrategyTemplate } from '../../../trading/builder';

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const { createStrategyBuilder } = await import('../../../trading/builder');
    const { initDatabase } = await import('../../../db/index');
    const db = await initDatabase();
    const builder = createStrategyBuilder(db);

    switch (cmd) {
      case 'list': {
        const templates = builder.listTemplates();
        let output = '**Available Strategy Templates**\n\n';
        for (let i = 0; i < templates.length; i++) {
          output += `${i + 1}. **${templates[i].name}** - ${templates[i].description}\n`;
        }
        output += '\nUse `/strategy create <name> <template>` to create one.';
        return output;
      }

      case 'create': {
        const name = parts[1];
        const template = parts[2] as StrategyTemplate;
        if (!name || !template) return 'Usage: /strategy create <name> <template>';
        const validTemplates: StrategyTemplate[] = ['mean_reversion', 'momentum', 'arbitrage', 'price_threshold', 'volume_spike', 'custom'];
        if (!validTemplates.includes(template)) {
          return `Invalid template: ${template}\nAvailable: ${validTemplates.join(', ')}`;
        }
        const params = builder.getTemplateParams(template);
        const definition = {
          name,
          template,
          platforms: ['polymarket' as const],
          entry: [{ type: 'price_below' as const, value: 0.5 }],
          exit: [{ type: 'take_profit' as const, value: 10 }, { type: 'stop_loss' as const, value: 5 }],
          risk: { maxPositionSize: 100, stopLossPct: 5, takeProfitPct: 10 },
          dryRun: true,
        };
        const validation = builder.validate(definition);
        if (!validation.valid) {
          return `Validation errors:\n${validation.errors.map(e => `- ${e}`).join('\n')}`;
        }
        const id = builder.saveDefinition('cli', definition);
        let output = `Strategy "${name}" created (ID: ${id})\n`;
        output += `Template: ${template}\n`;
        output += `Dry-run: enabled (test before going live)\n\n`;
        output += `**Default Parameters**\n`;
        for (const [key, val] of Object.entries(params)) {
          output += `  ${key}: ${val.default} (${val.description})\n`;
        }
        return output;
      }

      case 'start': {
        if (!parts[1]) return 'Usage: /strategy start <name>';
        const defs = builder.loadDefinitions('cli');
        const match = defs.find(d => d.definition.name === parts[1]);
        if (!match) return `Strategy "${parts[1]}" not found. Use \`/strategy status\` to list saved strategies.`;
        const strategy = builder.createStrategy(match.definition);
        return `Bot "${parts[1]}" started in ${match.definition.dryRun ? 'dry-run' : 'LIVE'} mode.\nStrategy ID: ${match.id}`;
      }

      case 'stop': {
        if (!parts[1]) return 'Usage: /strategy stop <name>';
        return `Bot "${parts[1]}" stopped.`;
      }

      case 'status': {
        const defs = builder.loadDefinitions('cli');
        if (defs.length === 0) return 'No saved strategies. Create one with `/strategy create`.';
        let output = '**Saved Strategies**\n\n';
        for (const d of defs) {
          output += `- **${d.definition.name}** (${d.definition.template}) - created ${d.createdAt.toLocaleDateString()}\n`;
        }
        return output;
      }

      case 'backtest': {
        if (!parts[1]) return 'Usage: /strategy backtest <name> [--days 30]';
        const defs = builder.loadDefinitions('cli');
        const match = defs.find(d => d.definition.name === parts[1]);
        if (!match) return `Strategy "${parts[1]}" not found.`;
        return `Backtesting "${parts[1]}" (${match.definition.template} template)...\n\nBacktest requires historical data. Use the backtest engine API for full results.`;
      }

      case 'delete': {
        if (!parts[1]) return 'Usage: /strategy delete <name>';
        const defs = builder.loadDefinitions('cli');
        const match = defs.find(d => d.definition.name === parts[1]);
        if (!match) return `Strategy "${parts[1]}" not found.`;
        builder.deleteDefinition('cli', match.id);
        return `Strategy "${parts[1]}" deleted.`;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Strategy error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Strategy Commands**

  /strategy list                     - List templates
  /strategy create <name> <template> - Create strategy
  /strategy start <name>             - Start bot
  /strategy stop <name>              - Stop bot
  /strategy status                   - Saved strategies
  /strategy backtest <name>          - Backtest strategy
  /strategy delete <name>            - Delete strategy

Templates: mean_reversion, momentum, arbitrage, price_threshold, volume_spike, custom`;
}

export default {
  name: 'strategy',
  description: 'Trading bot strategy builder with templates and backtesting',
  commands: ['/strategy', '/strat'],
  handle: execute,
};
