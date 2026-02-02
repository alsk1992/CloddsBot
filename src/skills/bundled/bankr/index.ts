/**
 * Bankr Skill - AI-powered crypto trading via natural language
 *
 * Commands:
 * /bankr <prompt>           Execute any trading command
 * /bankr status <jobId>     Check job status
 * /bankr cancel <jobId>     Cancel pending job
 */

import { BankrClient, getBankrClient, type JobResult, type StatusUpdate } from '../../../bankr';

// =============================================================================
// Execute
// =============================================================================

export async function execute(args: string): Promise<string> {
  const trimmed = args.trim();

  if (!trimmed) {
    return getHelp();
  }

  // Parse subcommands
  if (trimmed.startsWith('status ')) {
    const jobId = trimmed.slice(7).trim();
    return handleStatus(jobId);
  }

  if (trimmed.startsWith('cancel ')) {
    const jobId = trimmed.slice(7).trim();
    return handleCancel(jobId);
  }

  if (trimmed === 'help' || trimmed === '--help') {
    return getHelp();
  }

  // Execute prompt
  return handlePrompt(trimmed);
}

// =============================================================================
// Handlers
// =============================================================================

async function handlePrompt(prompt: string): Promise<string> {
  const client = getBankrClient();
  const updates: string[] = [];

  try {
    const result = await client.execute(prompt, {
      onStatusUpdate: (update: StatusUpdate) => {
        updates.push(`⏳ ${update.message}`);
      },
    });

    return formatResult(result, updates);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `❌ Bankr error: ${msg}`;
  }
}

async function handleStatus(jobId: string): Promise<string> {
  if (!jobId) {
    return '❌ Usage: /bankr status <jobId>';
  }

  const client = getBankrClient();

  try {
    const result = await client.getJobStatus(jobId);
    return formatResult(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `❌ Failed to get status: ${msg}`;
  }
}

async function handleCancel(jobId: string): Promise<string> {
  if (!jobId) {
    return '❌ Usage: /bankr cancel <jobId>';
  }

  const client = getBankrClient();

  try {
    const result = await client.cancelJob(jobId);
    return `✅ Job cancelled: ${result.jobId}`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `❌ Failed to cancel: ${msg}`;
  }
}

// =============================================================================
// Formatting
// =============================================================================

function formatResult(result: JobResult, updates?: string[]): string {
  const lines: string[] = [];

  // Show progress updates if any
  if (updates && updates.length > 0) {
    lines.push(...updates);
    lines.push('');
  }

  // Status emoji
  const statusEmoji = {
    pending: '⏳',
    processing: '🔄',
    completed: '✅',
    failed: '❌',
    cancelled: '🚫',
  }[result.status] || '❓';

  lines.push(`${statusEmoji} **Status**: ${result.status}`);

  // Response
  if (result.response) {
    lines.push('');
    lines.push(result.response);
  }

  // Error
  if (result.error) {
    lines.push('');
    lines.push(`**Error**: ${result.error}`);
  }

  // Rich data summary
  if (result.richData && result.richData.length > 0) {
    lines.push('');
    lines.push(`📊 ${result.richData.length} data object(s) returned`);
  }

  // Timing
  if (result.processingTime) {
    lines.push('');
    lines.push(`⏱️ Completed in ${(result.processingTime / 1000).toFixed(1)}s`);
  }

  // Job ID for reference
  lines.push('');
  lines.push(`🆔 Job: \`${result.jobId}\``);

  return lines.join('\n');
}

function getHelp(): string {
  return `**Bankr** - AI Crypto Trading

**Commands:**
\`/bankr <prompt>\` - Execute any trading command
\`/bankr status <jobId>\` - Check job status
\`/bankr cancel <jobId>\` - Cancel pending job

**Examples:**
\`/bankr Buy $50 of ETH on Base\`
\`/bankr Show my portfolio\`
\`/bankr Swap 0.1 ETH for USDC\`
\`/bankr What's the price of Bitcoin?\`
\`/bankr DCA $100 into ETH weekly\`

**Chains:** Base, Ethereum, Polygon, Solana, Unichain

**Setup:** Set BANKR_API_KEY from bankr.bot/api`;
}

// =============================================================================
// Agent Tools
// =============================================================================

export const tools = [
  {
    name: 'bankr_execute',
    description: 'Execute a crypto trading command via Bankr AI agent. Supports trading, swaps, portfolio, NFTs, Polymarket, leverage, automation.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Natural language trading command (e.g., "Buy $50 of ETH on Base")',
        },
      },
      required: ['prompt'],
    },
    execute: async ({ prompt }: { prompt: string }) => {
      return handlePrompt(prompt);
    },
  },
  {
    name: 'bankr_portfolio',
    description: 'Get wallet portfolio and balances via Bankr',
    parameters: {
      type: 'object',
      properties: {
        chain: {
          type: 'string',
          description: 'Optional chain filter (base, ethereum, polygon, solana)',
        },
      },
    },
    execute: async ({ chain }: { chain?: string }) => {
      const prompt = chain
        ? `Show my portfolio on ${chain}`
        : 'Show my complete portfolio';
      return handlePrompt(prompt);
    },
  },
  {
    name: 'bankr_price',
    description: 'Get token price via Bankr',
    parameters: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'Token symbol (e.g., ETH, BTC, SOL)',
        },
      },
      required: ['token'],
    },
    execute: async ({ token }: { token: string }) => {
      return handlePrompt(`What is the price of ${token}?`);
    },
  },
  {
    name: 'bankr_swap',
    description: 'Swap tokens via Bankr',
    parameters: {
      type: 'object',
      properties: {
        amount: {
          type: 'string',
          description: 'Amount to swap (e.g., "0.1", "$50")',
        },
        from: {
          type: 'string',
          description: 'Token to swap from',
        },
        to: {
          type: 'string',
          description: 'Token to swap to',
        },
        chain: {
          type: 'string',
          description: 'Chain (default: base)',
        },
      },
      required: ['amount', 'from', 'to'],
    },
    execute: async ({ amount, from, to, chain }: { amount: string; from: string; to: string; chain?: string }) => {
      const chainStr = chain ? ` on ${chain}` : '';
      return handlePrompt(`Swap ${amount} ${from} for ${to}${chainStr}`);
    },
  },
  {
    name: 'bankr_transaction',
    description: 'Submit a raw transaction via Bankr',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Target address',
        },
        data: {
          type: 'string',
          description: 'Calldata (hex)',
        },
        value: {
          type: 'string',
          description: 'Value in wei (default: 0)',
        },
        chainId: {
          type: 'number',
          description: 'Chain ID (e.g., 8453 for Base)',
        },
      },
      required: ['to', 'data', 'chainId'],
    },
    execute: async ({ to, data, value, chainId }: { to: string; data: string; value?: string; chainId: number }) => {
      const tx = { to, data, value: value || '0', chainId };
      return handlePrompt(`Submit this transaction: ${JSON.stringify(tx)}`);
    },
  },
];
