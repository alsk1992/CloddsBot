/**
 * Token Security Audit Skill
 *
 * Commands:
 * /audit <address>              — Auto-detect chain, full security audit
 * /audit <address> --chain eth  — Specify chain explicitly
 * /audit help                   — Show usage
 */

const HELP = `Token Security Audit — GoPlus-powered risk scanner

Usage:
  /audit <address>                  Auto-detect chain (EVM or Solana)
  /audit <address> --chain <name>   Specify chain (eth, bsc, polygon, arb, base, solana...)
  /audit help                       Show this help

Chains: ethereum, bsc, polygon, arbitrum, optimism, avalanche, fantom, base, linea, scroll, zksync, mantle, blast, solana

Examples:
  /audit So11111111111111111111111111111111
  /audit 0xdAC17F958D2ee523a2206206994597C13D831ec7 --chain eth
  /audit 0x...abc --chain base`;

function detectChain(address: string): string {
  if (address.startsWith('0x') && address.length === 42) return 'ethereum';
  if (!address.startsWith('0x') && address.length >= 32 && address.length <= 44) return 'solana';
  return 'ethereum';
}

function riskBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
}

function formatResult(r: any): string {
  const lines: string[] = [];
  lines.push(`Token Security Audit`);
  lines.push('='.repeat(40));
  if (r.name || r.symbol) {
    lines.push(`Token: ${r.name || '?'} (${r.symbol || '?'})`);
  }
  lines.push(`Address: ${r.address}`);
  lines.push(`Chain: ${r.chain}`);
  lines.push('');
  lines.push(`Risk Score: ${r.riskScore}/100 ${riskBar(r.riskScore)} ${r.riskLevel.toUpperCase()}`);
  lines.push('');

  lines.push('Security Checks:');
  lines.push(`  Honeypot:       ${r.isHoneypot ? 'YES' : 'No'}`);
  lines.push(`  Open Source:    ${r.isOpenSource ? 'Yes' : 'NO'}`);
  lines.push(`  Proxy Contract: ${r.hasProxyContract ? 'YES' : 'No'}`);
  lines.push(`  Mint Function:  ${r.hasMintFunction ? 'YES' : 'No'}`);
  lines.push(`  Blacklist:      ${r.hasBlacklist ? 'YES' : 'No'}`);
  lines.push('');

  if (r.buyTax > 0 || r.sellTax > 0) {
    lines.push('Tax:');
    lines.push(`  Buy Tax:  ${r.buyTax.toFixed(1)}%`);
    lines.push(`  Sell Tax: ${r.sellTax.toFixed(1)}%`);
    lines.push('');
  }

  lines.push('Holders:');
  lines.push(`  Total Holders:    ${r.holderCount.toLocaleString()}`);
  lines.push(`  Top 10 Own:       ${r.top10HolderPct.toFixed(1)}%`);
  lines.push(`  Creator Holds:    ${r.creatorHolderPct.toFixed(1)}%`);
  lines.push('');

  lines.push('Liquidity:');
  lines.push(`  Total:  $${r.totalLiquidity.toLocaleString()}`);
  lines.push(`  Locked: ${r.liquidityLocked ? 'Yes' : 'No'}`);

  if (r.riskFlags.length > 0) {
    lines.push('');
    lines.push('Risk Flags:');
    for (const flag of r.riskFlags) {
      lines.push(`  - ${flag}`);
    }
  }

  return lines.join('\n');
}

export default {
  name: 'token-security',
  description: 'Token security audit via GoPlus API — honeypot detection, rug-pull analysis, risk scoring',
  commands: [
    { name: 'audit', description: 'Audit a token for security risks', usage: '/audit <address> [--chain <name>]' },
  ],
  async handle(args: string): Promise<string> {
    const trimmed = args.trim();
    if (!trimmed || trimmed === 'help') return HELP;

    try {
      const { createTokenSecurityService } = await import('../../../token-security/index.js');
      const service = createTokenSecurityService();

      // Parse --chain flag
      const chainMatch = trimmed.match(/--chain\s+(\S+)/i);
      const address = trimmed.replace(/--chain\s+\S+/i, '').trim();

      if (!address) return 'Please provide a token address. Run /audit help for usage.';

      const chain = chainMatch?.[1] || detectChain(address);
      const result = await service.auditToken(address, chain);
      return formatResult(result);
    } catch (err: any) {
      return `Audit failed: ${err.message || err}`;
    }
  },
};
