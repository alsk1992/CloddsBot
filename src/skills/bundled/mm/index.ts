/**
 * Market Making CLI Skill
 *
 * Commands:
 * /mm start <platform> <marketId> <tokenId> [--spread 2] [--size 50] [--max-inventory 500]
 * /mm stop <id>
 * /mm status [id]
 * /mm config <id> --spread 3
 * /mm list
 */

import { logger } from '../../../utils/logger';
import type { MMConfig, MMState } from '../../../trading/market-making/types';
import type { Strategy } from '../../../trading/bots/index';

// Track active MM instances
const activeMMs = new Map<string, { strategy: Strategy; config: MMConfig }>();

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}

async function handleStart(args: string): Promise<string> {
  const parts = args.split(/\s+/);
  if (parts.length < 3) {
    return 'Usage: /mm start <platform> <marketId> <tokenId> [--spread 2] [--size 50] [--max-inventory 500]\n\nExample: /mm start polymarket 0x1234... 12345 --spread 2 --size 50';
  }

  const platform = parts[0] as 'polymarket' | 'kalshi';
  if (platform !== 'polymarket' && platform !== 'kalshi') {
    return 'Platform must be "polymarket" or "kalshi"';
  }

  const marketId = parts[1];
  const tokenId = parts[2];
  const flags = parseFlags(parts.slice(3));

  const id = `${platform}_${tokenId.slice(0, 8)}`;
  if (activeMMs.has(id)) {
    return `MM "${id}" is already running. Stop it first with: /mm stop ${id}`;
  }

  const mmConfig: MMConfig = {
    id,
    platform,
    marketId,
    tokenId,
    outcomeName: flags['name'] || `${platform}:${tokenId.slice(0, 12)}`,
    negRisk: flags['neg-risk'] === 'true',
    baseSpreadCents: Number(flags['spread'] || 2),
    minSpreadCents: Number(flags['min-spread'] || 1),
    maxSpreadCents: Number(flags['max-spread'] || 10),
    orderSize: Number(flags['size'] || 50),
    maxInventory: Number(flags['max-inventory'] || 500),
    skewFactor: Number(flags['skew'] || 0.5),
    volatilityMultiplier: Number(flags['vol-mult'] || 10),
    fairValueAlpha: Number(flags['alpha'] || 0.3),
    fairValueMethod: (flags['fv-method'] as MMConfig['fairValueMethod']) || 'weighted_mid',
    requoteIntervalMs: Number(flags['interval'] || 5000),
    requoteThresholdCents: Number(flags['threshold'] || 1),
    maxPositionValueUsd: Number(flags['max-pos'] || 1000),
    maxLossUsd: Number(flags['max-loss'] || 100),
    maxOrdersPerSide: Number(flags['max-orders'] || 1),
    levelSpacingCents: flags['level-spacing'] ? Number(flags['level-spacing']) : undefined,
    levelSizeDecay: flags['level-decay'] ? Number(flags['level-decay']) : undefined,
  };

  try {
    const { createMMStrategy } = await import('../../../trading/market-making/strategy');
    const { createFeedManager } = await import('../../../feeds/index');
    const { createExecutionService } = await import('../../../execution/index');

    const feeds = await createFeedManager({} as any);
    const execution = createExecutionService({});

    const strategy = createMMStrategy(mmConfig, { execution, feeds });
    activeMMs.set(id, { strategy, config: mmConfig });

    if (strategy.init) {
      await strategy.init({} as any);
    }

    const lines = [
      `**Market Maker Started: ${id}**`,
      '',
      `| Parameter | Value |`,
      `|-----------|-------|`,
      `| Platform | ${mmConfig.platform} |`,
      `| Market | ${mmConfig.marketId.slice(0, 20)}... |`,
      `| Token | ${mmConfig.tokenId.slice(0, 20)}... |`,
      `| Spread | ${mmConfig.baseSpreadCents}c (${mmConfig.minSpreadCents}-${mmConfig.maxSpreadCents}c) |`,
      `| Size | ${mmConfig.orderSize} shares/side |`,
      `| Max Inventory | ${mmConfig.maxInventory} shares |`,
      `| Skew Factor | ${mmConfig.skewFactor} |`,
      `| Levels/Side | ${mmConfig.maxOrdersPerSide} (spacing: ${mmConfig.levelSpacingCents ?? mmConfig.baseSpreadCents}c, decay: ${mmConfig.levelSizeDecay ?? 0.5}) |`,
      `| FV Method | ${mmConfig.fairValueMethod} |`,
      `| Requote | every ${mmConfig.requoteIntervalMs}ms |`,
      `| Max Loss | $${mmConfig.maxLossUsd} |`,
      '',
      'Use `/mm status ' + id + '` to check state, `/mm stop ' + id + '` to halt.',
    ];
    return lines.join('\n');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, 'Failed to start MM');
    return `Failed to start market maker: ${msg}`;
  }
}

async function handleStop(args: string): Promise<string> {
  const id = args.trim();
  if (!id) return 'Usage: /mm stop <id>\n\nUse `/mm list` to see active MMs.';

  const mm = activeMMs.get(id);
  if (!mm) return `No active MM with id "${id}". Use \`/mm list\` to see active MMs.`;

  if (mm.strategy.cleanup) {
    await mm.strategy.cleanup();
  }
  activeMMs.delete(id);
  return `Market maker "${id}" stopped and all orders cancelled.`;
}

async function handleStatus(args: string): Promise<string> {
  const id = args.trim();
  if (!id) {
    if (activeMMs.size === 0) return 'No active market makers.';
    const lines = ['**Active Market Makers**\n'];
    for (const [mmId, mm] of activeMMs) {
      const { getMMState } = await import('../../../trading/market-making/strategy');
      const state = getMMState(mm.strategy);
      const status = state?.haltReason ? `HALTED: ${state.haltReason}` : state?.isQuoting ? 'QUOTING' : 'IDLE';
      lines.push(`- **${mmId}**: ${status} | inv=${state?.inventory ?? 0} | pnl=$${(state?.realizedPnL ?? 0).toFixed(2)} | fills=${state?.fillCount ?? 0}`);
    }
    return lines.join('\n');
  }

  const mm = activeMMs.get(id);
  if (!mm) return `No active MM with id "${id}".`;

  const { getMMState } = await import('../../../trading/market-making/strategy');
  const state = getMMState(mm.strategy);
  if (!state) return `Could not read state for "${id}".`;

  const lines = [
    `**MM Status: ${id}**`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Status | ${state.haltReason ? `HALTED: ${state.haltReason}` : state.isQuoting ? 'QUOTING' : 'IDLE'} |`,
    `| Fair Value | ${state.fairValue.toFixed(4)} |`,
    `| EMA FV | ${state.emaFairValue.toFixed(4)} |`,
    `| Inventory | ${state.inventory} shares |`,
    `| Realized PnL | $${state.realizedPnL.toFixed(2)} |`,
    `| Fill Count | ${state.fillCount} |`,
    `| Active Bids | ${state.activeBids.length} |`,
    `| Active Asks | ${state.activeAsks.length} |`,
    `| Price History | ${state.priceHistory.length} samples |`,
  ];
  return lines.join('\n');
}

async function handleConfig(args: string): Promise<string> {
  const parts = args.split(/\s+/);
  const id = parts[0];
  if (!id) return 'Usage: /mm config <id> --spread 3 --size 100 ...';

  const mm = activeMMs.get(id);
  if (!mm) return `No active MM with id "${id}".`;

  const flags = parseFlags(parts.slice(1));
  if (Object.keys(flags).length === 0) {
    const c = mm.config;
    return [
      `**Config: ${id}**`,
      '',
      `\`\`\`json`,
      JSON.stringify(c, null, 2),
      `\`\`\``,
    ].join('\n');
  }

  if (flags['spread']) mm.config.baseSpreadCents = Number(flags['spread']);
  if (flags['min-spread']) mm.config.minSpreadCents = Number(flags['min-spread']);
  if (flags['max-spread']) mm.config.maxSpreadCents = Number(flags['max-spread']);
  if (flags['size']) mm.config.orderSize = Number(flags['size']);
  if (flags['max-inventory']) mm.config.maxInventory = Number(flags['max-inventory']);
  if (flags['skew']) mm.config.skewFactor = Number(flags['skew']);
  if (flags['alpha']) mm.config.fairValueAlpha = Number(flags['alpha']);
  if (flags['interval']) mm.config.requoteIntervalMs = Number(flags['interval']);
  if (flags['max-loss']) mm.config.maxLossUsd = Number(flags['max-loss']);
  if (flags['max-orders']) mm.config.maxOrdersPerSide = Number(flags['max-orders']);
  if (flags['level-spacing']) mm.config.levelSpacingCents = Number(flags['level-spacing']);
  if (flags['level-decay']) mm.config.levelSizeDecay = Number(flags['level-decay']);

  return `Config updated for "${id}". Changes take effect on next requote.`;
}

function handleList(): string {
  if (activeMMs.size === 0) return 'No active market makers. Start one with `/mm start`.';

  const lines = ['**Active Market Makers**\n'];
  lines.push(`| ID | Platform | Spread | Size | Status |`);
  lines.push(`|----|----------|--------|------|--------|`);

  for (const [id, mm] of activeMMs) {
    const c = mm.config;
    lines.push(`| ${id} | ${c.platform} | ${c.baseSpreadCents}c | ${c.orderSize} | active |`);
  }
  return lines.join('\n');
}

function helpText(): string {
  return [
    '**Market Making Commands**',
    '',
    '```',
    '/mm start <platform> <marketId> <tokenId> [flags]  Start market making',
    '/mm stop <id>                                       Stop market maker',
    '/mm status [id]                                     View status',
    '/mm config <id> [--spread N] [--size N] ...         View/update config',
    '/mm list                                            List active MMs',
    '```',
    '',
    '**Start Flags:**',
    '```',
    '--spread N          Base half-spread in cents (default: 2)',
    '--size N            Order size per side (default: 50)',
    '--max-inventory N   Max inventory before aggressive skew (default: 500)',
    '--skew N            Skew factor 0-1 (default: 0.5)',
    '--fv-method M       Fair value: mid_price|weighted_mid|vwap|ema (default: weighted_mid)',
    '--interval N        Requote interval ms (default: 5000)',
    '--max-loss N        Max loss before halt USD (default: 100)',
    '--max-orders N      Orders per side / levels (default: 1)',
    '--level-spacing N   Cents between price levels (default: same as spread)',
    '--level-decay N     Size decay per level 0-1 (default: 0.5)',
    '--neg-risk true     Enable negative risk mode',
    '--name "Name"       Display name for the outcome',
    '```',
    '',
    '**Example:**',
    '```',
    '/mm start polymarket 0xabc123 98765 --spread 3 --size 100 --max-inventory 1000',
    '```',
  ].join('\n');
}

async function execute(args: string): Promise<string> {
  const trimmed = args.trim();
  if (!trimmed) return helpText();

  const spaceIdx = trimmed.indexOf(' ');
  const command = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  try {
    switch (command) {
      case 'start':
        return await handleStart(rest);
      case 'stop':
        return await handleStop(rest);
      case 'status':
        return await handleStatus(rest);
      case 'config':
        return await handleConfig(rest);
      case 'list':
        return handleList();
      case 'help':
      default:
        return helpText();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, args }, 'MM command failed');
    return `Error: ${message}`;
  }
}

export default {
  name: 'mm',
  description: 'Market making - two-sided quoting with inventory management',
  commands: ['/mm', '/market-making'],
  handle: execute,
};
