/**
 * Agent Kiosk Skill (x402 & MCP Intelligence)
 *
 * Pre-trade Base token safety gate, Polymarket/Kalshi cross-venue arbitrage,
 * Hyperliquid/dYdX perp funding spreads, AML/OFAC counterparty screening,
 * and zero-paywall executable EVM swap calldata.
 */

const DEFAULT_BASE_URL = 'https://agent-kiosk.vercel.app';
const REQUEST_TIMEOUT_MS = 12_000;

export interface KioskFetchOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function resolveBaseUrl(override?: string): string {
  return (override || process.env.AGENT_KIOSK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function resolveApiKey(override?: string): string {
  return (override ?? process.env.AGENT_KIOSK_API_KEY ?? '').trim();
}

async function callKioskMcpTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  opts: KioskFetchOptions = {},
): Promise<Record<string, any>> {
  const fetchFn = opts.fetchImpl || fetch;
  const baseUrl = resolveBaseUrl(opts.baseUrl);
  const apiKey = resolveApiKey(opts.apiKey);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'clodds-agent-kiosk-skill/1.0',
  };
  if (apiKey) {
    headers['X-API-KEY'] = apiKey;
  }

  const res = await fetchFn(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: apiKey ? { ...toolArgs, x_api_key: apiKey } : toolArgs,
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Agent Kiosk MCP returned HTTP ${res.status}`);
  }

  const rpc = (await res.json()) as {
    error?: { message?: string };
    result?: { content?: Array<{ text?: string }> };
  };
  if (rpc.error) {
    throw new Error(rpc.error.message || 'MCP RPC error');
  }

  const text = rpc.result?.content?.[0]?.text;
  if (!text) {
    throw new Error('Empty MCP tool response');
  }

  const parsed = JSON.parse(text) as Record<string, any>;
  if (parsed.tier === 'LOCKED_X402_PAYWALL_PREVIEW') {
    return {
      _locked: true,
      notice:
        parsed.notice ||
        `Free daily MCP quota reached. Set AGENT_KIOSK_API_KEY or unlock at ${baseUrl}/buy.`,
      preview: parsed.preview_data,
    };
  }

  return parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
}

async function handleSwap(rest: string, opts: KioskFetchOptions = {}): Promise<string> {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) {
    return 'Usage: /kiosk swap <amount> <fromToken> <toToken> [chain]\nExample: /kiosk swap 100 USDC WETH base';
  }

  const [amount, fromToken, toToken, chain = 'base'] = tokens;
  const fetchFn = opts.fetchImpl || fetch;
  const baseUrl = resolveBaseUrl(opts.baseUrl);

  try {
    const res = await fetchFn(`${baseUrl}/v1/free-swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'clodds-agent-kiosk-skill/1.0',
      },
      body: JSON.stringify({
        amount,
        from_token: fromToken,
        to_token: toToken,
        from_chain: chain.toLowerCase(),
        to_chain: chain.toLowerCase(),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const json = (await res.json()) as Record<string, any>;
    if (!res.ok || !json.ok) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }

    const d = json.data || {};
    const tx = d.transaction_request || {};
    return [
      `**Agent Kiosk Executable Swap Quote** (${d.aggregator || 'aggregator'})`,
      `  Route: ${amount} ${d.from_token?.symbol || fromToken} -> ~${d.to_token?.estimated_amount_human ?? '?'} ${d.to_token?.symbol || toToken} on ${d.from_chain || chain}`,
      tx.to ? `  Router Target: ${tx.to}` : '',
      tx.data ? `  Calldata Bytes: ${Math.max(0, (String(tx.data).length - 2) / 2)}B` : '',
      `  Attested: ${json.attestation?.attested ? 'Yes (HMAC-SHA256)' : 'No'}`,
    ]
      .filter(Boolean)
      .join('\n');
  } catch (err) {
    return `Error fetching swap quote: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function handleGate(rest: string, opts: KioskFetchOptions = {}): Promise<string> {
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  const token = parts[0];
  const notional = parts[1] ? Number(parts[1]) : 100;

  if (!token || !/^0x[a-fA-F0-9]{40}$/.test(token)) {
    return 'Usage: /kiosk gate <0xBaseTokenAddress> [notionalUsd]\nExample: /kiosk gate 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 500';
  }

  try {
    const data = await callKioskMcpTool(
      'greyridge_swap_gate',
      { token, side: 'buy', notional_usd: Number.isFinite(notional) ? notional : 100 },
      opts,
    );
    if (data._locked) return data.notice;

    const decision = String(data.decision || data.verdict || 'UNKNOWN').toUpperCase();
    const flags = Array.isArray(data.flags) && data.flags.length > 0 ? data.flags.join(', ') : 'none';
    return [
      `**Pre-Swap Safety Gate** (${data.token_meta?.symbol || token.slice(0, 10)})`,
      `  Decision: ${decision} (Verdict: ${data.verdict || decision}, Risk Score: ${data.risk_score ?? 'n/a'})`,
      data.reason ? `  Reason: ${data.reason}` : '',
      data.liquidity_usd != null ? `  Pool Liquidity: $${Number(data.liquidity_usd).toLocaleString('en-US')}` : '',
      `  Flags: ${flags}`,
    ]
      .filter(Boolean)
      .join('\n');
  } catch (err) {
    return `Error checking token safety gate: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function handleArb(query: string, opts: KioskFetchOptions = {}): Promise<string> {
  try {
    const data = await callKioskMcpTool(
      'kalshi_polymarket_arb',
      { query: query.trim() || 'bitcoin', limit: 5 },
      opts,
    );
    if (data._locked) return data.notice;

    const pairs = data.arbitrage_opportunities || data.opportunities || data.markets || [];
    if (!Array.isArray(pairs) || pairs.length === 0) {
      return data.llm_summary || `No cross-venue prediction arbitrage spreads found for "${query || 'bitcoin'}".`;
    }

    const lines = [`**Cross-Venue Prediction Market Spreads** (${query.trim() || 'bitcoin'})`, ''];
    for (const item of pairs.slice(0, 5)) {
      const title = item.question || item.title || item.event || 'Market';
      const spread = item.spread_pct ?? item.spread ?? item.edge_pct;
      lines.push(`  • ${title}${spread != null ? ` — Spread: ${spread}%` : ''}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Error scanning prediction arbitrage: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function handleFunding(symbol: string, opts: KioskFetchOptions = {}): Promise<string> {
  try {
    const data = await callKioskMcpTool(
      'perp_funding_arbitrage',
      { symbol: symbol.trim().toUpperCase() || undefined, limit: 5 },
      opts,
    );
    if (data._locked) return data.notice;

    const rows = data.opportunities || data.pairs || data.rates || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return data.llm_summary || 'No perpetual funding arbitrage opportunities returned.';
    }

    const lines = ['**Perpetual Funding Arbitrage (Hyperliquid vs. dYdX)**', ''];
    for (const r of rows.slice(0, 5)) {
      const sym = r.symbol || r.asset || symbol || 'PERP';
      const apr = r.net_spread_apr_pct ?? r.apr_spread_pct ?? r.annualized_spread_pct;
      lines.push(`  • ${sym}${apr != null ? ` — Net Basis Spread: ${apr}% APR` : ''}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Error scanning perp funding rates: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function handleCompliance(rest: string, opts: KioskFetchOptions = {}): Promise<string> {
  const [address, chain = 'base'] = rest.trim().split(/\s+/).filter(Boolean);
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return 'Usage: /kiosk compliance <0xWalletAddress> [chain]\nExample: /kiosk compliance 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 base';
  }

  try {
    const data = await callKioskMcpTool('compliance_check', { address, chain: chain.toLowerCase() }, opts);
    if (data._locked) return data.notice;

    return [
      `**AML & Sanctions Check** (${address.slice(0, 10)}... on ${chain})`,
      `  Status: ${data.compliance_status || 'UNKNOWN'}`,
      `  Safe to Transact: ${data.safe_to_transact ? 'Yes' : 'No'}`,
      `  Risk Score: ${data.aml_risk_score_100 ?? 0}/100`,
    ].join('\n');
  } catch (err) {
    return `Error screening address: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function executeAgentKiosk(args: string, opts: KioskFetchOptions = {}): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1).join(' ');

  switch (sub) {
    case 'swap':
      return handleSwap(rest, opts);
    case 'gate':
    case 'safety':
      return handleGate(rest, opts);
    case 'arb':
    case 'polymarket':
      return handleArb(rest, opts);
    case 'funding':
    case 'rates':
      return handleFunding(rest, opts);
    case 'compliance':
    case 'aml':
      return handleCompliance(rest, opts);
    case 'help':
    default:
      return [
        '**Agent Kiosk** — x402 & MCP Intelligence for Autonomous Trading Agents',
        '',
        'Commands:',
        '  /kiosk swap <amt> <from> <to> [chain]   Build executable EVM swap calldata (free)',
        '  /kiosk gate <0xToken> [notionalUsd]     Pre-trade Base token safety gate (GO/HOLD/BLOCK)',
        '  /kiosk arb [query]                      Polymarket vs. Kalshi cross-venue spreads',
        '  /kiosk funding [symbol]                 Hyperliquid vs. dYdX perp funding arbitrage',
        '  /kiosk compliance <0xAddress> [chain]   OFAC sanctions & AML counterparty screening',
        '  /kiosk help                             Show this command reference',
        '',
        'Optional env: AGENT_KIOSK_API_KEY (ak_live_... pass for unlimited calls)',
        'Docs & MCP: https://agent-kiosk.vercel.app',
      ].join('\n');
  }
}

export default {
  name: 'agent-kiosk',
  description:
    'Agent Kiosk — x402 & MCP pre-swap safety gate, prediction/perp arbitrage, AML screening, and EVM swap calldata',
  commands: ['/kiosk', '/agent-kiosk'],
  handle: (args: string) => executeAgentKiosk(args),
};
