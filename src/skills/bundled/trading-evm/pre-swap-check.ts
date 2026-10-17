/**
 * Pre-swap token check for /trading-evm swap.
 *
 * The swap buys whatever address it is given, and the GoPlus scanner in src/token-security was
 * never consulted on that path. This runs it before the buy:
 *
 * - BLOCK only on hard signals: GoPlus reports a honeypot, or a sell tax of 50% or more. The
 *   composite risk score is shown as a warning, not used to block — its liquidity figure is a rough
 *   estimate, so blocking on it would refuse legitimate tokens.
 * - FAIL OPEN with a visible warning when the check itself fails (GoPlus down, rate-limited, no
 *   record): an outage must not stop every swap, but the user should know the token went unchecked.
 * - `--force` skips the check for a user who has decided anyway.
 *
 * Kept free of imports beyond types so it can be unit-tested with a stub audit function.
 */
import type { TokenSecurityResult } from '../../../token-security/index.js';

export type AuditFn = (address: string, chain: string) => Promise<TokenSecurityResult>;

export interface PreSwapVerdict {
  /** Set when the swap must not run. */
  block?: string;
  /** Lines to show alongside a swap that does run. */
  warnings: string[];
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
export const BLOCKING_SELL_TAX_PCT = 50;

export async function preSwapCheck(token: string, chain: string, audit: AuditFn, force = false): Promise<PreSwapVerdict> {
  // Symbols resolve to the chain's well-known tokens; only a raw contract address is unvetted.
  if (force || !ADDRESS.test(token) || token.toLowerCase() === NATIVE) return { warnings: [] };

  let r: TokenSecurityResult;
  try {
    r = await audit(token, chain);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { warnings: [`Token security check unavailable (${why}); this token was NOT checked before buying.`] };
  }

  const label = r.symbol ? `${r.symbol} (${token})` : token;
  if (r.isHoneypot) {
    return { block: `Swap refused: GoPlus flags ${label} as a honeypot — you would likely be unable to sell it. Re-run with --force to buy anyway.`, warnings: [] };
  }
  if (r.sellTax >= BLOCKING_SELL_TAX_PCT) {
    return { block: `Swap refused: ${label} has a ${r.sellTax.toFixed(0)}% sell tax. Re-run with --force to buy anyway.`, warnings: [] };
  }
  if (r.riskLevel === 'high' || r.riskLevel === 'critical') {
    return { warnings: [`Token risk ${r.riskLevel} (score ${r.riskScore}/100): ${r.riskFlags.join(', ')}`] };
  }
  return { warnings: [] };
}
