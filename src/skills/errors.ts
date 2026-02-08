/**
 * Skill Error Wrapper
 *
 * Provides contextual error messages with guidance for users.
 * Skills call skillError() or wrapSkillError() to produce helpful output.
 */

// =============================================================================
// ERROR CONTEXT HINTS
// =============================================================================

const ERROR_HINTS: Array<{ pattern: RegExp; hint: string }> = [
  // Network errors
  { pattern: /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i, hint: 'Check your internet connection or the service may be down. Try again in a moment.' },
  { pattern: /rate limit|429|too many requests/i, hint: 'You\'re being rate-limited. Wait a moment before retrying.' },
  { pattern: /503|502|500|service unavailable|internal server/i, hint: 'The service is temporarily unavailable. Try again shortly.' },

  // Auth errors
  { pattern: /unauthorized|401|403|forbidden|invalid.*key|invalid.*token/i, hint: 'Check that your API key/credentials are correct and not expired.' },
  { pattern: /insufficient.*balance|insufficient.*funds/i, hint: 'Your wallet balance is too low for this transaction.' },

  // Input errors
  { pattern: /invalid.*address|invalid.*token|not.*found.*token/i, hint: 'Double-check the token symbol or address. Use the full contract address if the symbol isn\'t recognized.' },
  { pattern: /slippage|price.*impact|price.*moved/i, hint: 'Price moved during execution. Try a smaller amount or increase slippage tolerance.' },
  { pattern: /gas.*estimation|gas.*required|out of gas/i, hint: 'Transaction would fail on-chain. You may need more native tokens for gas or the trade parameters are invalid.' },

  // Config errors
  { pattern: /private.*key|EVM_PRIVATE_KEY|SOLANA_PRIVATE_KEY/i, hint: 'Set the required private key in your environment: export EVM_PRIVATE_KEY="0x..."' },
  { pattern: /HYPERLIQUID_PRIVATE_KEY/i, hint: 'Set HYPERLIQUID_PRIVATE_KEY in your environment or .env file.' },

  // Chain errors
  { pattern: /chain.*id|wrong.*chain|unsupported.*chain|unknown.*chain/i, hint: 'Check that you\'re using a supported chain. Common options: bsc, eth, arb, base, polygon.' },
  { pattern: /nonce|replacement.*underpriced/i, hint: 'A previous transaction may be pending. Wait for it to confirm or speed it up.' },
];

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Wrap an error with contextual hints and the skill name.
 */
export function wrapSkillError(skillName: string, action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const hint = getHint(message);

  const lines = [`**${skillName}** — ${action} failed`];
  lines.push('');
  lines.push(`Error: ${truncate(message, 200)}`);

  if (hint) {
    lines.push('');
    lines.push(`Tip: ${hint}`);
  }

  return lines.join('\n');
}

/**
 * Create a formatted error for a skill with optional suggestions.
 */
export function skillError(opts: {
  skill: string;
  action: string;
  message: string;
  tip?: string;
  seeAlso?: string[];
}): string {
  const lines = [`**${opts.skill}** — ${opts.action} failed`];
  lines.push('');
  lines.push(`Error: ${opts.message}`);

  const hint = opts.tip || getHint(opts.message);
  if (hint) {
    lines.push('');
    lines.push(`Tip: ${hint}`);
  }

  if (opts.seeAlso && opts.seeAlso.length > 0) {
    lines.push('');
    lines.push(`See also: ${opts.seeAlso.join(', ')}`);
  }

  return lines.join('\n');
}

// =============================================================================
// INTERNALS
// =============================================================================

function getHint(message: string): string | null {
  for (const { pattern, hint } of ERROR_HINTS) {
    if (pattern.test(message)) return hint;
  }
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}
