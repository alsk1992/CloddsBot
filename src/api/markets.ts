/**
 * Markets API Endpoints
 */

import type { Env } from '../config';
import type { Platform } from '../types';
import { searchMarkets, getMarket, getOrderbook } from '../feeds';

export async function handleMarketsApi(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const url = new URL(request.url);

  // GET /api/markets/search?q=<query>&platform=<platform>&limit=<limit>
  if (path === '/api/markets/search') {
    const query = url.searchParams.get('q') || url.searchParams.get('query');
    if (!query) {
      return Response.json(
        { error: 'Missing query parameter' },
        { status: 400 }
      );
    }

    const platform = url.searchParams.get('platform') as Platform | null;
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    const markets = await searchMarkets(
      query,
      env,
      platform || undefined,
      Math.min(limit, 50)
    );

    return Response.json({ markets, count: markets.length });
  }

  // GET /api/markets/:platform/:id
  const marketMatch = path.match(/^\/api\/markets\/([^/]+)\/(.+)$/);
  if (marketMatch && request.method === 'GET') {
    const [, platform, marketId] = marketMatch;

    if (!['polymarket', 'kalshi', 'manifold'].includes(platform)) {
      return Response.json({ error: 'Invalid platform' }, { status: 400 });
    }

    const market = await getMarket(marketId, platform as Platform, env);

    if (!market) {
      return Response.json({ error: 'Market not found' }, { status: 404 });
    }

    return Response.json({ market });
  }

  // GET /api/markets/:platform/:id/orderbook
  const orderbookMatch = path.match(/^\/api\/markets\/([^/]+)\/(.+)\/orderbook$/);
  if (orderbookMatch && request.method === 'GET') {
    const [, platform, marketId] = orderbookMatch;

    if (!['polymarket', 'kalshi'].includes(platform)) {
      return Response.json(
        { error: 'Orderbook not available for this platform' },
        { status: 400 }
      );
    }

    const orderbook = await getOrderbook(marketId, platform as Platform, env);

    if (!orderbook) {
      return Response.json({ error: 'Orderbook not found' }, { status: 404 });
    }

    return Response.json({ orderbook });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
