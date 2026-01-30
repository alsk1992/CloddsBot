/**
 * Arbitrage API Endpoints
 */

import type { Env } from '../config';
import type { ArbitrageOpportunity, Platform } from '../types';
import { getActiveMarkets } from '../feeds';
import { getRecentArbitrage, saveArbitrage, expireOldArbitrage } from '../storage/d1';

export async function handleArbitrageApi(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const url = new URL(request.url);

  // GET /api/arbitrage/scan?min_edge=<pct>&platforms=<platforms>
  if (path === '/api/arbitrage/scan' && request.method === 'GET') {
    const minEdge = parseFloat(url.searchParams.get('min_edge') || '1') / 100;
    const platformsParam = url.searchParams.get('platforms');
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    const platforms = platformsParam
      ? (platformsParam.split(',') as Platform[])
      : (['polymarket', 'kalshi', 'manifold'] as Platform[]);

    const opportunities: ArbitrageOpportunity[] = [];

    // Scan each platform
    for (const platform of platforms) {
      const markets = await getActiveMarkets(env, platform, 100);

      for (const market of markets) {
        if (market.outcomes.length < 2) continue;

        // Find YES/NO outcomes
        const yesOutcome = market.outcomes.find(
          (o) =>
            o.name.toLowerCase() === 'yes' ||
            o.name.toLowerCase().includes('yes')
        );
        const noOutcome = market.outcomes.find(
          (o) =>
            o.name.toLowerCase() === 'no' ||
            o.name.toLowerCase().includes('no')
        );

        if (!yesOutcome || !noOutcome) continue;

        const sum = yesOutcome.price + noOutcome.price;
        const edge = 1 - sum;

        if (edge >= minEdge) {
          opportunities.push({
            id: `${market.platform}-${market.id}`,
            platform: market.platform,
            marketId: market.id,
            marketQuestion: market.question,
            yesPrice: yesOutcome.price,
            noPrice: noOutcome.price,
            edgePct: edge,
            mode: 'internal',
            foundAt: Date.now(),
          });
        }
      }
    }

    // Sort by edge descending
    opportunities.sort((a, b) => b.edgePct - a.edgePct);

    const results = opportunities.slice(0, Math.min(limit, 50));

    return Response.json({
      opportunities: results,
      count: results.length,
      scannedPlatforms: platforms,
      minEdge: minEdge * 100,
    });
  }

  // GET /api/arbitrage/recent
  if (path === '/api/arbitrage/recent' && request.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const opportunities = await getRecentArbitrage(env.DB, Math.min(limit, 100));

    return Response.json({
      opportunities,
      count: opportunities.length,
    });
  }

  // POST /api/arbitrage/save (for storing found opportunities)
  if (path === '/api/arbitrage/save' && request.method === 'POST') {
    const body = (await request.json()) as Omit<
      ArbitrageOpportunity,
      'id' | 'foundAt'
    >;

    const saved = await saveArbitrage(env.DB, body);

    return Response.json({ opportunity: saved });
  }

  // POST /api/arbitrage/expire (cleanup old entries)
  if (path === '/api/arbitrage/expire' && request.method === 'POST') {
    const body = (await request.json()) as { maxAgeMs?: number };
    await expireOldArbitrage(env.DB, body.maxAgeMs);

    return Response.json({ success: true });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
