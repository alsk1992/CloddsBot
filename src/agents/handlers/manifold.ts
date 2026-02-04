/**
 * Manifold Handlers
 *
 * Platform handlers for Manifold prediction market.
 * Migrated from inline switch cases in agents/index.ts.
 */

import type { ToolInput, HandlerResult, HandlersMap, HandlerContext } from './types';
import { enforceMaxOrderSize, enforceExposureLimits } from '../../trading/risk';
import type { Platform } from '../../types';

// =============================================================================
// TYPES
// =============================================================================

type ManifoldApiResponse = Record<string, unknown>;

// =============================================================================
// HELPERS
// =============================================================================

const MANIFOLD_API = 'https://api.manifold.markets';

/**
 * Get Manifold API key from context credentials
 */
function getManifoldApiKey(context: HandlerContext): string | null {
  const manifoldCreds = context.tradingContext?.credentials.get('manifold');
  if (!manifoldCreds || manifoldCreds.platform !== 'manifold') return null;
  return manifoldCreds.data.apiKey as string;
}

/**
 * Auth headers for Manifold API
 */
function authHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Key ${apiKey}`,
  };
}

/**
 * Read-only auth headers (no Content-Type)
 */
function readAuthHeaders(apiKey: string): Record<string, string> {
  return {
    'Authorization': `Key ${apiKey}`,
  };
}

/**
 * Standard credential error message
 */
const CRED_ERROR = JSON.stringify({
  error: 'No Manifold credentials set up. Use setup_manifold_credentials first.',
});

// =============================================================================
// TRADING HANDLERS (require auth + risk checks)
// =============================================================================

// 1. manifold_bet
async function betHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const userId = context.userId || '';
  const marketId = toolInput.market_id as string;
  const amount = toolInput.amount as number;
  const outcome = toolInput.outcome as string;
  const limitProb = toolInput.limit_prob as number | undefined;

  const maxError = enforceMaxOrderSize(context, amount, 'manifold_bet');
  if (maxError) return maxError;
  const exposureError = enforceExposureLimits(context, userId, {
    platform: 'manifold' as Platform,
    marketId,
    outcomeId: outcome,
    notional: amount,
    label: 'manifold_bet',
  });
  if (exposureError) return exposureError;

  const body: Record<string, unknown> = {
    contractId: marketId,
    amount,
    outcome,
  };
  if (limitProb !== undefined) {
    body.limitProb = limitProb;
  }

  try {
    const response = await fetch(`${MANIFOLD_API}/v0/bet`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401 || response.status === 403) {
        await context.credentials?.markFailure(userId, 'manifold');
      }
      return JSON.stringify({ error: 'Bet failed', details: errorText });
    }

    await context.credentials?.markSuccess(userId, 'manifold');
    const result = await response.json() as ManifoldApiResponse;
    return JSON.stringify({ result: 'Bet placed', betId: result.betId, shares: result.shares });
  } catch (err: unknown) {
    const error = err as Error;
    return JSON.stringify({ error: 'Bet failed', details: error.message });
  }
}

// 2. manifold_sell
async function sellHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const userId = context.userId || '';
  const marketId = toolInput.market_id as string;
  const outcome = toolInput.outcome as string;
  const shares = toolInput.shares as number | undefined;

  const body: Record<string, unknown> = {
    contractId: marketId,
    outcome,
  };
  if (shares !== undefined) {
    body.shares = shares;
  }

  try {
    const response = await fetch(`${MANIFOLD_API}/v0/market/${marketId}/sell`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401 || response.status === 403) {
        await context.credentials?.markFailure(userId, 'manifold');
      }
      return JSON.stringify({ error: 'Sell failed', details: errorText });
    }

    await context.credentials?.markSuccess(userId, 'manifold');
    const result = await response.json() as ManifoldApiResponse;
    return JSON.stringify({ result: 'Shares sold', ...(result || {}) });
  } catch (err: unknown) {
    const error = err as Error;
    return JSON.stringify({ error: 'Sell failed', details: error.message });
  }
}

// 3. manifold_multiple_choice
async function multipleChoiceHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const userId = context.userId || '';
  const marketId = toolInput.market_id as string;
  const answerId = toolInput.answer_id as string;
  const amount = toolInput.amount as number;

  const maxError = enforceMaxOrderSize(context, amount, 'manifold_multiple_choice');
  if (maxError) return maxError;
  const exposureError = enforceExposureLimits(context, userId, {
    platform: 'manifold' as Platform,
    marketId,
    outcomeId: answerId,
    notional: amount,
    label: 'manifold_multiple_choice',
  });
  if (exposureError) return exposureError;

  try {
    const response = await fetch(`${MANIFOLD_API}/v0/bet`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ contractId: marketId, amount, answerId }),
    });
    if (!response.ok) {
      return JSON.stringify({ error: `Bet failed: ${response.status}` });
    }
    const result = await response.json() as ManifoldApiResponse;
    return JSON.stringify({ result: 'Bet placed', ...(result || {}) });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 4. manifold_multi_bet
async function multiBetHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const userId = context.userId || '';
  const marketId = toolInput.market_id as string;
  const answerIds = toolInput.answer_ids as string[];
  const amount = toolInput.amount as number;

  const maxError = enforceMaxOrderSize(context, amount, 'manifold_multi_bet');
  if (maxError) return maxError;
  const exposureError = enforceExposureLimits(context, userId, {
    platform: 'manifold' as Platform,
    marketId,
    notional: amount,
    label: 'manifold_multi_bet',
  });
  if (exposureError) return exposureError;

  try {
    const response = await fetch(`${MANIFOLD_API}/v0/multi-bet`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ contractId: marketId, answerIds, amount }),
    });
    if (!response.ok) return JSON.stringify({ error: `Multi-bet failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// =============================================================================
// READ HANDLERS (require auth)
// =============================================================================

// 5. manifold_search
async function searchHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(_context);
  if (!apiKey) return CRED_ERROR;

  const query = toolInput.query as string;
  const limit = (toolInput.limit as number) || 10;
  try {
    const response = await fetch(
      `${MANIFOLD_API}/v0/search-markets?term=${encodeURIComponent(query)}&limit=${limit}&filter=open&sort=liquidity`
    );
    const markets = await response.json() as ManifoldApiResponse[];
    return JSON.stringify(markets.slice(0, limit).map((m: ManifoldApiResponse) => ({
      id: m.id,
      question: m.question,
      probability: m.probability,
      volume: m.volume,
      url: m.url,
    })));
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 6. manifold_market
async function marketHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(_context);
  if (!apiKey) return CRED_ERROR;

  const idOrSlug = toolInput.id_or_slug as string;
  try {
    let response = await fetch(`${MANIFOLD_API}/v0/market/${idOrSlug}`);
    if (!response.ok) {
      response = await fetch(`${MANIFOLD_API}/v0/slug/${idOrSlug}`);
    }
    const market = await response.json();
    return JSON.stringify(market);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 7. manifold_balance
async function balanceHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  try {
    const response = await fetch(`${MANIFOLD_API}/v0/me`, {
      headers: readAuthHeaders(apiKey),
    });
    const user = await response.json() as ManifoldApiResponse;
    return JSON.stringify({ balance: user.balance, username: user.username });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 8. manifold_positions
async function positionsHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  try {
    const response = await fetch(`${MANIFOLD_API}/v0/bets?limit=1000`, {
      headers: readAuthHeaders(apiKey),
    });
    const bets = await response.json() as Array<{
      contractId: string;
      outcome: string;
      shares?: number;
      isSold?: boolean;
      amount: number;
    }>;
    // Aggregate by market
    const positions: Record<string, { yes: number; no: number; invested: number }> = {};
    for (const bet of bets) {
      if (!positions[bet.contractId]) {
        positions[bet.contractId] = { yes: 0, no: 0, invested: 0 };
      }
      if (bet.outcome === 'YES') {
        positions[bet.contractId].yes += bet.shares || 0;
      } else {
        positions[bet.contractId].no += bet.shares || 0;
      }
      if (!bet.isSold) {
        positions[bet.contractId].invested += bet.amount;
      }
    }
    return JSON.stringify(positions);
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 9. manifold_bets
async function betsHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const marketId = toolInput.market_id as string | undefined;
  try {
    const url = marketId
      ? `${MANIFOLD_API}/v0/bets?contractId=${marketId}`
      : `${MANIFOLD_API}/v0/bets`;
    const response = await fetch(url, {
      headers: readAuthHeaders(apiKey),
    });
    const bets = await response.json() as ManifoldApiResponse[];
    return JSON.stringify(bets.slice(0, 50));
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 10. manifold_cancel
async function cancelHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const betId = toolInput.bet_id as string;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/bet/cancel/${betId}`, {
      method: 'POST',
      headers: readAuthHeaders(apiKey),
    });
    if (!response.ok) {
      return JSON.stringify({ error: `Cancel failed: ${response.status}` });
    }
    return JSON.stringify({ result: 'Cancelled', bet_id: betId });
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 11. manifold_get_me
async function getMeHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  try {
    const response = await fetch(`${MANIFOLD_API}/v0/me`, {
      headers: readAuthHeaders(apiKey),
    });
    if (!response.ok) return JSON.stringify({ error: `Auth failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 12. manifold_get_user_portfolio
async function getUserPortfolioHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const inputUserId = toolInput.user_id as string | undefined;
  let targetUserId = inputUserId;

  if (!targetUserId) {
    const apiKey = getManifoldApiKey(context);
    if (!apiKey) {
      return JSON.stringify({ error: 'No user_id provided and no Manifold credentials set up.' });
    }
    // Get own user ID first
    const meResponse = await fetch(`${MANIFOLD_API}/v0/me`, {
      headers: readAuthHeaders(apiKey),
    });
    if (!meResponse.ok) return JSON.stringify({ error: 'Could not get user info' });
    const me = await meResponse.json() as { id: string };
    targetUserId = me.id;
  }

  try {
    const response = await fetch(`${MANIFOLD_API}/v0/get-user-portfolio?userId=${targetUserId}`);
    if (!response.ok) return JSON.stringify({ error: `Portfolio fetch failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 13. manifold_create_market
async function createMarketHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const body: Record<string, unknown> = {
    outcomeType: toolInput.outcome_type,
    question: toolInput.question,
  };
  if (toolInput.description) body.descriptionMarkdown = toolInput.description;
  if (toolInput.close_time) body.closeTime = toolInput.close_time;
  if (toolInput.initial_prob) body.initialProb = toolInput.initial_prob;
  if (toolInput.min !== undefined) body.min = toolInput.min;
  if (toolInput.max !== undefined) body.max = toolInput.max;
  if (toolInput.answers) body.answers = toolInput.answers;
  if (toolInput.group_ids) body.groupIds = toolInput.group_ids;
  if (toolInput.visibility) body.visibility = toolInput.visibility;

  try {
    const response = await fetch(`${MANIFOLD_API}/v0/market`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errText = await response.text();
      return JSON.stringify({ error: `Create failed: ${response.status}`, details: errText });
    }
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 14. manifold_add_answer
async function addAnswerHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const marketId = toolInput.market_id as string;
  const text = toolInput.text as string;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/market/${marketId}/answer`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return JSON.stringify({ error: `Add answer failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 15. manifold_add_liquidity
async function addLiquidityHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const marketId = toolInput.market_id as string;
  const amount = toolInput.amount as number;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/market/${marketId}/add-liquidity`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ amount }),
    });
    if (!response.ok) return JSON.stringify({ error: `Add liquidity failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 16. manifold_add_bounty
async function addBountyHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const marketId = toolInput.market_id as string;
  const amount = toolInput.amount as number;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/market/${marketId}/add-bounty`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ amount }),
    });
    if (!response.ok) return JSON.stringify({ error: `Add bounty failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 17. manifold_award_bounty
async function awardBountyHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const marketId = toolInput.market_id as string;
  const commentId = toolInput.comment_id as string;
  const amount = toolInput.amount as number;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/market/${marketId}/award-bounty`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ amount, commentId }),
    });
    if (!response.ok) return JSON.stringify({ error: `Award bounty failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 18. manifold_close_market
async function closeMarketHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const marketId = toolInput.market_id as string;
  const closeTime = toolInput.close_time as number;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/market/${marketId}/close`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ closeTime }),
    });
    if (!response.ok) return JSON.stringify({ error: `Close market failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 19. manifold_manage_topic
async function manageTopicHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const marketId = toolInput.market_id as string;
  const groupId = toolInput.group_id as string;
  const remove = toolInput.remove as boolean || false;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/market/${marketId}/group`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ groupId, remove }),
    });
    if (!response.ok) return JSON.stringify({ error: `Manage topic failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 20. manifold_resolve_market
async function resolveMarketHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const marketId = toolInput.market_id as string;
  const outcome = toolInput.outcome as string;
  const probabilityInt = toolInput.probability_int as number | undefined;

  const body: Record<string, unknown> = { outcome };
  if (probabilityInt !== undefined) body.probabilityInt = probabilityInt;

  try {
    const response = await fetch(`${MANIFOLD_API}/v0/market/${marketId}/resolve`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });
    if (!response.ok) return JSON.stringify({ error: `Resolve failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 21. manifold_create_comment
async function createCommentHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const marketId = toolInput.market_id as string;
  const content = toolInput.content as string;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/comment`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ contractId: marketId, markdown: content }),
    });
    if (!response.ok) return JSON.stringify({ error: `Create comment failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 22. manifold_send_mana
async function sendManaHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  const apiKey = getManifoldApiKey(context);
  if (!apiKey) return CRED_ERROR;

  const toIds = toolInput.to_ids as string[];
  const amount = toolInput.amount as number;
  const message = toolInput.message as string | undefined;

  const body: Record<string, unknown> = { toIds, amount };
  if (message) body.message = message;

  try {
    const response = await fetch(`${MANIFOLD_API}/v0/managram`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });
    if (!response.ok) return JSON.stringify({ error: `Send mana failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// =============================================================================
// PUBLIC HANDLERS (no auth needed)
// =============================================================================

// 23. manifold_get_user
async function getUserHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const username = toolInput.username as string;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/user/${encodeURIComponent(username)}`);
    if (!response.ok) return JSON.stringify({ error: `User not found: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 24. manifold_get_user_lite
async function getUserLiteHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const username = toolInput.username as string;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/user/${encodeURIComponent(username)}/lite`);
    if (!response.ok) return JSON.stringify({ error: `User not found: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 25. manifold_get_user_by_id
async function getUserByIdHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const targetUserId = toolInput.user_id as string;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/user/by-id/${targetUserId}`);
    if (!response.ok) return JSON.stringify({ error: `User not found: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 26. manifold_get_user_by_id_lite
async function getUserByIdLiteHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const targetUserId = toolInput.user_id as string;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/user/by-id/${targetUserId}/lite`);
    if (!response.ok) return JSON.stringify({ error: `User not found: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 27. manifold_get_user_portfolio_history
async function getUserPortfolioHistoryHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const targetUserId = toolInput.user_id as string;
  const period = toolInput.period as string;
  try {
    const response = await fetch(
      `${MANIFOLD_API}/v0/get-user-portfolio-history?userId=${targetUserId}&period=${period}`
    );
    if (!response.ok) return JSON.stringify({ error: `Portfolio history fetch failed: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 28. manifold_list_users
async function listUsersHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const limit = (toolInput.limit as number) || 1000;
  const before = toolInput.before as string | undefined;
  try {
    let url = `${MANIFOLD_API}/v0/users?limit=${limit}`;
    if (before) url += `&before=${before}`;
    const response = await fetch(url);
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 29. manifold_get_groups
async function getGroupsHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const beforeTime = toolInput.before_time as number | undefined;
  const availableToUserId = toolInput.available_to_user_id as string | undefined;
  try {
    let url = `${MANIFOLD_API}/v0/groups`;
    const params: string[] = [];
    if (beforeTime) params.push(`beforeTime=${beforeTime}`);
    if (availableToUserId) params.push(`availableToUserId=${availableToUserId}`);
    if (params.length) url += '?' + params.join('&');
    const response = await fetch(url);
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 30. manifold_get_group
async function getGroupHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const slug = toolInput.slug as string;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/group/${encodeURIComponent(slug)}`);
    if (!response.ok) return JSON.stringify({ error: `Group not found: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 31. manifold_get_group_by_id
async function getGroupByIdHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const groupId = toolInput.group_id as string;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/group/by-id/${groupId}`);
    if (!response.ok) return JSON.stringify({ error: `Group not found: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 32. manifold_list_markets
async function listMarketsHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const limit = (toolInput.limit as number) || 500;
  const sort = toolInput.sort as string | undefined;
  const order = toolInput.order as string | undefined;
  const before = toolInput.before as string | undefined;
  const userId = toolInput.user_id as string | undefined;
  const groupId = toolInput.group_id as string | undefined;
  try {
    let url = `${MANIFOLD_API}/v0/markets?limit=${limit}`;
    if (sort) url += `&sort=${sort}`;
    if (order) url += `&order=${order}`;
    if (before) url += `&before=${before}`;
    if (userId) url += `&userId=${userId}`;
    if (groupId) url += `&groupId=${groupId}`;
    const response = await fetch(url);
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 33. manifold_get_market_by_slug
async function getMarketBySlugHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const slug = toolInput.slug as string;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/slug/${encodeURIComponent(slug)}`);
    if (!response.ok) return JSON.stringify({ error: `Market not found: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 34. manifold_get_probability
async function getProbabilityHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/market/${marketId}/prob`);
    if (!response.ok) return JSON.stringify({ error: `Market not found: ${response.status}` });
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 35. manifold_get_probabilities
async function getProbabilitiesHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const marketIds = toolInput.market_ids as string[];
  try {
    const response = await fetch(`${MANIFOLD_API}/v0/market-probs?ids=${marketIds.join(',')}`);
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 36. manifold_get_market_positions
async function getMarketPositionsHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string;
  const order = toolInput.order as string | undefined;
  const top = toolInput.top as number | undefined;
  const bottom = toolInput.bottom as number | undefined;
  const userId = toolInput.user_id as string | undefined;
  try {
    let url = `${MANIFOLD_API}/v0/market/${marketId}/positions`;
    const params: string[] = [];
    if (order) params.push(`order=${order}`);
    if (top) params.push(`top=${top}`);
    if (bottom) params.push(`bottom=${bottom}`);
    if (userId) params.push(`userId=${userId}`);
    if (params.length) url += '?' + params.join('&');
    const response = await fetch(url);
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 37. manifold_get_user_metrics
async function getUserMetricsHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const targetUserId = toolInput.user_id as string;
  const limit = toolInput.limit as number | undefined;
  const offset = toolInput.offset as number | undefined;
  const order = toolInput.order as string | undefined;
  try {
    let url = `${MANIFOLD_API}/v0/get-user-contract-metrics-with-contracts?userId=${targetUserId}`;
    if (limit) url += `&limit=${limit}`;
    if (offset) url += `&offset=${offset}`;
    if (order) url += `&order=${order}`;
    const response = await fetch(url);
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 38. manifold_get_comments
async function getCommentsHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const marketId = toolInput.market_id as string | undefined;
  const marketSlug = toolInput.market_slug as string | undefined;
  const userId = toolInput.user_id as string | undefined;
  const limit = (toolInput.limit as number) || 1000;
  const page = toolInput.page as number | undefined;
  try {
    let url = `${MANIFOLD_API}/v0/comments`;
    const params: string[] = [];
    if (marketId) params.push(`contractId=${marketId}`);
    if (marketSlug) params.push(`contractSlug=${marketSlug}`);
    if (userId) params.push(`userId=${userId}`);
    params.push(`limit=${limit}`);
    if (page) params.push(`page=${page}`);
    if (params.length) url += '?' + params.join('&');
    const response = await fetch(url);
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 39. manifold_get_transactions
async function getTransactionsHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const limit = (toolInput.limit as number) || 100;
  const offset = toolInput.offset as number | undefined;
  const before = toolInput.before as string | undefined;
  const after = toolInput.after as string | undefined;
  const toId = toolInput.to_id as string | undefined;
  const fromId = toolInput.from_id as string | undefined;
  const category = toolInput.category as string | undefined;
  try {
    let url = `${MANIFOLD_API}/v0/txns`;
    const params: string[] = [`limit=${limit}`];
    if (offset) params.push(`offset=${offset}`);
    if (before) params.push(`before=${before}`);
    if (after) params.push(`after=${after}`);
    if (toId) params.push(`toId=${toId}`);
    if (fromId) params.push(`fromId=${fromId}`);
    if (category) params.push(`category=${category}`);
    url += '?' + params.join('&');
    const response = await fetch(url);
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// 40. manifold_get_leagues
async function getLeaguesHandler(
  toolInput: ToolInput,
  _context: HandlerContext
): Promise<HandlerResult> {
  const userId = toolInput.user_id as string | undefined;
  const season = toolInput.season as number | undefined;
  const cohort = toolInput.cohort as string | undefined;
  try {
    let url = `${MANIFOLD_API}/v0/leagues`;
    const params: string[] = [];
    if (userId) params.push(`userId=${userId}`);
    if (season) params.push(`season=${season}`);
    if (cohort) params.push(`cohort=${cohort}`);
    if (params.length) url += '?' + params.join('&');
    const response = await fetch(url);
    return JSON.stringify(await response.json());
  } catch (err: unknown) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// =============================================================================
// EXPORT HANDLERS MAP
// =============================================================================

export const manifoldHandlers: HandlersMap = {
  // Trading (require auth + risk checks)
  manifold_bet: betHandler,
  manifold_sell: sellHandler,
  manifold_multiple_choice: multipleChoiceHandler,
  manifold_multi_bet: multiBetHandler,

  // Read (require auth)
  manifold_search: searchHandler,
  manifold_market: marketHandler,
  manifold_balance: balanceHandler,
  manifold_positions: positionsHandler,
  manifold_bets: betsHandler,
  manifold_cancel: cancelHandler,
  manifold_get_me: getMeHandler,
  manifold_get_user_portfolio: getUserPortfolioHandler,
  manifold_create_market: createMarketHandler,
  manifold_add_answer: addAnswerHandler,
  manifold_add_liquidity: addLiquidityHandler,
  manifold_add_bounty: addBountyHandler,
  manifold_award_bounty: awardBountyHandler,
  manifold_close_market: closeMarketHandler,
  manifold_manage_topic: manageTopicHandler,
  manifold_resolve_market: resolveMarketHandler,
  manifold_create_comment: createCommentHandler,
  manifold_send_mana: sendManaHandler,

  // Public (no auth needed)
  manifold_get_user: getUserHandler,
  manifold_get_user_lite: getUserLiteHandler,
  manifold_get_user_by_id: getUserByIdHandler,
  manifold_get_user_by_id_lite: getUserByIdLiteHandler,
  manifold_get_user_portfolio_history: getUserPortfolioHistoryHandler,
  manifold_list_users: listUsersHandler,
  manifold_get_groups: getGroupsHandler,
  manifold_get_group: getGroupHandler,
  manifold_get_group_by_id: getGroupByIdHandler,
  manifold_list_markets: listMarketsHandler,
  manifold_get_market_by_slug: getMarketBySlugHandler,
  manifold_get_probability: getProbabilityHandler,
  manifold_get_probabilities: getProbabilitiesHandler,
  manifold_get_market_positions: getMarketPositionsHandler,
  manifold_get_user_metrics: getUserMetricsHandler,
  manifold_get_comments: getCommentsHandler,
  manifold_get_transactions: getTransactionsHandler,
  manifold_get_leagues: getLeaguesHandler,
};

export default manifoldHandlers;
