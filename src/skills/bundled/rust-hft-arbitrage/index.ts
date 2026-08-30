import {
  scanVenueArbitrage,
  formatVenueArbitrageScanResult,
  type EvmScanVenue,
  type SolanaScanVenue,
  type VenueArbitrageLiveScanRequest,
} from '../../../trading/venue-arbitrage-scanner';
import type { EvmChain } from '../../../evm/uniswap';
import type { VenueArbitrageExecutionStyle } from '../../../trading/venue-arbitrage';

const REPORT_DATE = '2026-08-30';

const EVM_CHAINS: EvmChain[] = ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon'];
const SOLANA_VENUES: SolanaScanVenue[] = ['jupiter', 'raydium', 'orca', 'meteora'];
const EVM_VENUES: EvmScanVenue[] = ['uniswap', 'oneinch', 'pancakeswap', 'lighter'];
const EXECUTION_STYLES: VenueArbitrageExecutionStyle[] = ['taker_taker', 'maker_taker', 'maker_maker'];

function scanHelpText(): string {
  return [
    'Usage: /hft-arb scan <solana|evm|cross> <base> <quote> <size> [options]',
    '',
    'Options (key=value):',
    '  chain=arbitrum            - EVM chain (required for evm/cross): ethereum, arbitrum, optimism, base, polygon',
    '  venues=jupiter,raydium    - Venues to quote (solana or evm scan only)',
    '  solanaVenues=jupiter,...  - Solana venues for a cross-chain scan',
    '  evmVenues=uniswap,...     - EVM venues for a cross-chain scan',
    '  minNetEdgeBps=15          - Minimum net edge to keep a plan',
    '  maxNotionalUsd=500        - Notional cap per plan',
    '  style=taker_taker         - taker_taker | maker_taker | maker_maker',
    '  slippageBps=50            - Slippage tolerance sent to each venue quote',
    '  rpcUrl=...                - Override Solana RPC endpoint',
    '  lighterMarket=...         - Explicit Lighter market id/name',
    '  onlyDirect=true           - Solana: restrict Jupiter to direct routes',
    '  limit=5                   - Max plans to return',
    '',
    'Examples:',
    '  /hft-arb scan solana SOL USDC 1000 venues=jupiter,raydium minNetEdgeBps=20',
    '  /hft-arb scan evm WETH USDC 2000 chain=arbitrum venues=uniswap,lighter',
    '  /hft-arb scan cross SOL USDC 500 chain=base',
  ].join('\n');
}

function parseScanOptions(parts: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (const part of parts) {
    const [rawKey, rawValue] = part.split('=', 2);
    const key = rawKey?.toLowerCase();
    const value = rawValue?.trim();
    if (key && value !== undefined) options[key] = value;
  }
  return options;
}

function parseVenueList<T extends string>(value: string | undefined, allowed: T[]): T[] | undefined {
  if (!value) return undefined;
  const list = value.split(',').map((v) => v.trim()).filter(Boolean) as T[];
  const valid = list.filter((v) => (allowed as string[]).includes(v));
  return valid.length > 0 ? valid : undefined;
}

async function runScan(rest: string[]): Promise<string> {
  const family = rest[0]?.toLowerCase();
  const baseToken = rest[1];
  const quoteToken = rest[2];
  const quoteSize = rest[3] ? Number(rest[3]) : NaN;

  if (family !== 'solana' && family !== 'evm' && family !== 'cross') {
    return scanHelpText();
  }
  if (!baseToken || !quoteToken || !Number.isFinite(quoteSize) || quoteSize <= 0) {
    return scanHelpText();
  }

  const options = parseScanOptions(rest.slice(4));
  const chain = (options.chain?.toLowerCase() as EvmChain | undefined);
  if ((family === 'evm' || family === 'cross') && (!chain || !EVM_CHAINS.includes(chain))) {
    return `Missing or invalid chain=... (must be one of: ${EVM_CHAINS.join(', ')})\n\n${scanHelpText()}`;
  }

  const executionStyle = options.style && EXECUTION_STYLES.includes(options.style as VenueArbitrageExecutionStyle)
    ? (options.style as VenueArbitrageExecutionStyle)
    : undefined;

  const base = {
    baseToken,
    quoteToken,
    quoteSize,
    slippageBps: options.slippagebps ? Number(options.slippagebps) : undefined,
    minNetEdgeBps: options.minnetedgebps ? Number(options.minnetedgebps) : undefined,
    minTargetProfitUsd: options.mintargetprofitusd ? Number(options.mintargetprofitusd) : undefined,
    executionStyle,
    requireCrossedMarket: options.crossed ? options.crossed.toLowerCase() !== 'false' : undefined,
    maxQuoteAgeMs: options.maxquoteagems ? Number(options.maxquoteagems) : undefined,
    maxLatencyMs: options.maxlatencyms ? Number(options.maxlatencyms) : undefined,
    latencyPenaltyBpsPerSecond: options.latencypenaltybpspersecond ? Number(options.latencypenaltybpspersecond) : undefined,
    stalePenaltyBps: options.stalepenaltybps ? Number(options.stalepenaltybps) : undefined,
    onlyDirectRoutes: options.onlydirect ? options.onlydirect.toLowerCase() !== 'false' : undefined,
    limitPlans: options.limit ? Number(options.limit) : undefined,
  };

  let request: VenueArbitrageLiveScanRequest;
  if (family === 'solana') {
    request = {
      ...base,
      family: 'solana',
      rpcUrl: options.rpcurl,
      venues: parseVenueList(options.venues, SOLANA_VENUES),
    };
  } else if (family === 'evm') {
    request = {
      ...base,
      family: 'evm',
      chain: chain!,
      venues: parseVenueList(options.venues, EVM_VENUES),
      lighterMarket: options.lightermarket,
    };
  } else {
    request = {
      ...base,
      family: 'cross',
      chain: chain!,
      rpcUrl: options.rpcurl,
      solanaVenues: parseVenueList(options.solanavenues, SOLANA_VENUES),
      evmVenues: parseVenueList(options.evmvenues, EVM_VENUES),
      lighterMarket: options.lightermarket,
    };
  }

  try {
    const result = await scanVenueArbitrage(request);
    return formatVenueArbitrageScanResult(result);
  } catch (error) {
    return `Venue arbitrage scan failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const VENUE_LINES = [
  '- Solana AMM and routing venues: Jupiter, Raydium, Orca, Meteora.',
  '- Solana orderbook and perp venues already in-repo: Drift and Percolator.',
  '- EVM spot routing venues already in-repo: Uniswap, 1inch, PancakeSwap.',
  '- EVM orderbook venue already in-repo: Lighter on Arbitrum.',
  '- Cross-chain arb only makes sense with pre-positioned inventory, not live bridge-in-the-loop execution.',
];

const REUSE_LINES = [
  '- CloddsBot: existing connectors, skills, risk guards, feed manager, and the new `venue-arbitrage` planner become the control plane.',
  '- p27: reuse Solana blockhash caching, priority-fee tracking, WebSocket state monitors, Jito bundle builder, sell engine, and multi-wallet orchestration.',
  '- op: reuse EVM nonce ledger, atomic state persistence, pre-signed transaction fanout patterns, exact-hash confirmation, and timing discipline.',
  '- Recommended split: keep chat, orchestration, and portfolio UX in TypeScript; move latency-sensitive opportunity scoring and execution into Rust workers.',
];

const STACK_LINES = [
  '- Data plane: one Rust worker per chain family normalizes quotes, depth, and inventory into a shared venue quote schema.',
  '- Scoring plane: compute net edge after fees, latency, stale-quote penalties, and inventory skew before any order is armed.',
  '- Execution plane: treat Solana and EVM as independent executors with chain-native fast paths, never a generic send abstraction.',
  '- Control plane: Clodds remains the operator-facing brain, subagent coordinator, and risk/config interface.',
  '- Evidence plane: every fired arb should emit an exact report with quote snapshot, route, expected edge, realized fills, and cancel reason.',
];

const SWARM_LINES = [
  '- Market-structure swarm: define instrument normalization across spot, perp, AMM, and CLOB venues; publish a canonical `instrumentId` and hedge class.',
  '- Execution swarm: isolate Solana Jito/priority-fee logic from EVM nonce, gas, and relay logic; both feed a common planner contract but not a common sender.',
  '- Risk swarm: own edge thresholds, inventory caps, stale-quote guards, kill switches, and venue-health gating.',
  '- Integration swarm: map Clodds skills and commands to the Rust workers so one operator can inspect routes, override venues, and replay decisions.',
];

const NEXT_LINES = [
  '- Phase 1: normalize real Solana and EVM venue quotes into the current `venue-arbitrage` planner.',
  '- Phase 2: add Rust sidecars for Solana and EVM execution with JSON or stdio RPC into Clodds.',
  '- Phase 3: backtest and replay quote streams with realized fee and latency calibration from your infra.',
  '- Phase 4: let a single Clodds session dispatch focused subagent tasks and merge their outputs into one operator report.',
];

function formatSection(title: string, lines: string[]): string {
  return [`**${title}**`, ...lines].join('\n');
}

function helpText(): string {
  return [
    '**Rust HFT Arbitrage Commands**',
    '',
    '  /hft-arb report      - Consolidated swarm report',
    '  /hft-arb venues      - Solana and EVM venue map',
    '  /hft-arb reuse       - Reusable building blocks from CloddsBot, p27, and op',
    '  /hft-arb stack       - Recommended control-plane and executor split',
    '  /hft-arb agents      - Focused swarm roles for deeper study',
    '  /hft-arb next        - Concrete implementation phases',
    '  /hft-arb scan ...    - Run a live cross-venue quote scan (see: /hft-arb scan help)',
    '',
    `Full blueprint: docs/RUST_HFT_ARBITRAGE_SWARM_REPORT.md (snapshot ${REPORT_DATE})`,
  ].join('\n');
}

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const cmd = parts[0]?.toLowerCase() || 'report';

  switch (cmd) {
    case 'report':
      return [
        '**Rust HFT Arbitrage Swarm Report**',
        `Snapshot: ${REPORT_DATE}`,
        '',
        'Objective: make Clodds a specialist in Rust-driven cross-venue price arbitrage across Solana and EVM without forcing the TypeScript control plane to sit on the execution hot path.',
        '',
        formatSection('Venue Map', VENUE_LINES),
        '',
        formatSection('Swarm Reports', SWARM_LINES),
        '',
        formatSection('Reuse Map', REUSE_LINES),
        '',
        formatSection('Target Stack', STACK_LINES),
        '',
        formatSection('Next Phases', NEXT_LINES),
      ].join('\n');

    case 'venues':
      return formatSection('Venue Map', VENUE_LINES);

    case 'reuse':
      return formatSection('Reuse Map', REUSE_LINES);

    case 'stack':
      return formatSection('Target Stack', STACK_LINES);

    case 'agents':
    case 'swarms':
      return formatSection('Swarm Reports', SWARM_LINES);

    case 'next':
      return formatSection('Next Phases', NEXT_LINES);

    case 'scan': {
      const rest = parts.slice(1);
      if (rest[0]?.toLowerCase() === 'help') return scanHelpText();
      return runScan(rest);
    }

    case 'help':
    default:
      return helpText();
  }
}

export default {
  name: 'rust-hft-arbitrage',
  description: 'Rust-first cross-venue HFT arbitrage specialist for Solana and EVM',
  commands: ['/hft-arb', '/venue-arb', '/rust-arb'],
  handle: execute,
};
