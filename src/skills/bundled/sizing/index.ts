/**
 * Sizing CLI Skill
 *
 * Commands:
 * /sizing <edge%> <winrate%> - Calculate Kelly position size
 * /sizing config - Show sizing config
 * /sizing set <param> <value> - Update config
 */

import type { KellyConfig } from '../../../trading/kelly';

let calcConfig: KellyConfig = {
  baseMultiplier: 0.25,
  maxKelly: 0.25,
  minKelly: 0.01,
  lookbackTrades: 20,
  maxDrawdown: 0.15,
  drawdownReduction: 0.5,
};

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const { simpleKelly, createDynamicKellyCalculator } = await import('../../../trading/kelly');

    switch (cmd) {
      case 'config': {
        const calculator = createDynamicKellyCalculator(1000, calcConfig);
        const state = calculator.getState();
        let output = '**Position Sizing Config**\n\n';
        output += `Method: Dynamic Kelly\n`;
        output += `Base multiplier: ${calcConfig.baseMultiplier}\n`;
        output += `Max Kelly fraction: ${calcConfig.maxKelly}\n`;
        output += `Min Kelly fraction: ${calcConfig.minKelly}\n`;
        output += `Lookback trades: ${calcConfig.lookbackTrades}\n`;
        output += `Max drawdown: ${((calcConfig.maxDrawdown ?? 0.15) * 100).toFixed(0)}%\n`;
        output += `Drawdown reduction: ${calcConfig.drawdownReduction}x\n`;
        output += `\n**Current State**\n`;
        output += `Bankroll: $${state.bankroll.toFixed(2)}\n`;
        output += `Peak: $${state.peakBankroll.toFixed(2)}\n`;
        output += `Drawdown: ${(state.currentDrawdown * 100).toFixed(1)}%\n`;
        output += `Win rate (recent): ${(state.recentWinRate * 100).toFixed(0)}%\n`;
        output += `Win streak: ${state.winStreak} | Loss streak: ${state.lossStreak}`;
        return output;
      }

      case 'set': {
        const param = parts[1];
        const value = parts[2];
        if (!param || !value) return 'Usage: /sizing set <multiplier|max-kelly|min-kelly|lookback|max-drawdown> <value>';
        const num = parseFloat(value);
        if (isNaN(num)) return 'Value must be a number.';

        switch (param) {
          case 'multiplier':
            calcConfig.baseMultiplier = num;
            break;
          case 'max-kelly':
            calcConfig.maxKelly = num;
            break;
          case 'min-kelly':
            calcConfig.minKelly = num;
            break;
          case 'lookback':
            calcConfig.lookbackTrades = Math.round(num);
            break;
          case 'max-drawdown':
            calcConfig.maxDrawdown = num / 100;
            break;
          default:
            return `Unknown param: ${param}\nAvailable: multiplier, max-kelly, min-kelly, lookback, max-drawdown`;
        }
        return `Sizing ${param} set to ${value}.`;
      }

      case 'help':
        return helpText();

      default: {
        const edge = parseFloat(parts[0]);
        const winRate = parseFloat(parts[1]);
        const bankroll = parseFloat(parts[2]) || 1000;

        if (isNaN(edge) || isNaN(winRate)) {
          return 'Usage: /sizing <edge%> <winrate%> [bankroll]\n\nExample: /sizing 5 60 10000';
        }

        const edgeFraction = edge / 100;
        const kelly = simpleKelly(edgeFraction, winRate / 100, calcConfig.baseMultiplier);
        const size = kelly * bankroll;

        // Also get dynamic recommendation
        const calculator = createDynamicKellyCalculator(bankroll, calcConfig);
        const dynamic = calculator.calculate(edgeFraction, winRate / 100);

        let output = '**Position Sizing**\n\n';
        output += `Edge: ${edge}%\n`;
        output += `Win rate: ${winRate}%\n`;
        output += `Bankroll: $${bankroll.toLocaleString()}\n\n`;
        output += `**Simple Kelly**\n`;
        output += `  Fraction: ${(kelly * 100).toFixed(2)}%\n`;
        output += `  Size: **$${size.toFixed(2)}**\n\n`;
        output += `**Dynamic Kelly**\n`;
        output += `  Fraction: ${(dynamic.kelly * 100).toFixed(2)}%\n`;
        output += `  Size: **$${dynamic.positionSize.toFixed(2)}**\n`;
        output += `  Confidence: ${(dynamic.confidence * 100).toFixed(0)}%\n`;
        if (dynamic.adjustments.length > 0) {
          output += `  Adjustments:\n`;
          for (const adj of dynamic.adjustments) {
            output += `    - ${adj.reason} (${adj.multiplier.toFixed(2)}x)\n`;
          }
        }
        if (dynamic.warnings.length > 0) {
          output += `  Warnings: ${dynamic.warnings.join(', ')}`;
        }
        return output;
      }
    }
  } catch (error) {
    return `Sizing error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Sizing Commands**

  /sizing <edge%> <winrate%>         - Calculate Kelly size
  /sizing <edge%> <winrate%> <bank>  - With specific bankroll
  /sizing config                     - Show sizing config + state
  /sizing set <param> <value>        - Update config

Params: multiplier, max-kelly, min-kelly, lookback, max-drawdown

Example: /sizing 5 60           (5% edge, 60% win rate)
Example: /sizing 3 55 10000    (with $10k bankroll)`;
}

export default {
  name: 'sizing',
  description: 'Dynamic Kelly criterion position sizing with drawdown adjustments',
  commands: ['/sizing', '/kelly-size'],
  handle: execute,
};
