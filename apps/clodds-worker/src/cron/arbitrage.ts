/**
 * Arbitrage Scanner Cron Job
 * Runs every 5 minutes to find arbitrage opportunities
 */

import type { Env } from '../config';
import type { ArbitrageOpportunity, Platform } from '../types';
import { getActiveMarkets } from '../feeds';
import { saveArbitrage, expireOldArbitrage, getRecentArbitrage } from '../storage/d1';

const MIN_EDGE_PCT = 0.005; // 0.5% minimum edge
const PLATFORMS: Platform[] = ['polymarket', 'kalshi'];

export async function scanArbitrage(env: Env): Promise<void> {
  console.log('Starting arbitrage scan...');

  try {
    // Expire old opportunities first
    await expireOldArbitrage(env.DB, 3600000); // 1 hour

    const opportunities: ArbitrageOpportunity[] = [];

    // Scan each platform
    for (const platform of PLATFORMS) {
      try {
        const markets = await getActiveMarkets(env, platform, 200);
        console.log(`Scanning ${markets.length} markets on ${platform}`);

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

          if (edge >= MIN_EDGE_PCT) {
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
      } catch (error) {
        console.error(`Error scanning ${platform}:`, error);
      }
    }

    // Sort by edge descending
    opportunities.sort((a, b) => b.edgePct - a.edgePct);

    // Get existing to avoid duplicates
    const existing = await getRecentArbitrage(env.DB, 100);
    const existingIds = new Set(existing.map((o) => `${o.platform}-${o.marketId}`));

    // Save new opportunities
    let savedCount = 0;
    for (const opp of opportunities) {
      const key = `${opp.platform}-${opp.marketId}`;
      if (!existingIds.has(key)) {
        await saveArbitrage(env.DB, opp);
        savedCount++;
      }
    }

    console.log(
      `Arbitrage scan complete. Found ${opportunities.length} opportunities, saved ${savedCount} new.`
    );

    // TODO: Send alerts to subscribed users
    // This would require storing user alert preferences and using the appropriate
    // channel to send notifications (Telegram, Discord, etc.)
  } catch (error) {
    console.error('Arbitrage scan failed:', error);
  }
}
