/**
 * PercolatorFeed — polls slab account for price, orderbook, and position data.
 * Emits 'price' and 'orderbook' events compatible with FeedManager.
 */

import { EventEmitter } from 'events';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger.js';
import type { PercolatorConfig, PercolatorMarketState, PercolatorPosition } from './types.js';
import { DEFAULT_RPC_URL } from './types.js';
import { fetchSlab, parseHeader, parseConfig, parseEngine, parseAllAccounts, AccountKind, type Account } from './slab.js';

export interface PercolatorFeed extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): void;
  getMarketState(): PercolatorMarketState | null;
  getPositions(owner?: PublicKey): PercolatorPosition[];
  getPrice(): number | null;
}

export function createPercolatorFeed(config: PercolatorConfig): PercolatorFeed {
  const feed = new EventEmitter() as PercolatorFeed;
  const pollInterval = config.pollIntervalMs ?? 2000;
  const rpcUrl = config.rpcUrl ?? process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const configSpreadBps = BigInt(config.spreadBps ?? 50);
  const POLL_TIMEOUT_MS = 10_000;

  let connection: Connection | null = null;
  let slabPubkey: PublicKey | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastState: PercolatorMarketState | null = null;
  let lastSlabData: Buffer | null = null;
  let lastPrice: number | null = null;

  async function poll(): Promise<void> {
    if (!connection || !slabPubkey) return;
    try {
      const data = await Promise.race([
        fetchSlab(connection, slabPubkey),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('RPC poll timeout')), POLL_TIMEOUT_MS)),
      ]);
      lastSlabData = data;

      const header = parseHeader(data);
      const mktConfig = parseConfig(data);
      const engine = parseEngine(data);

      // Oracle price: use authority_price_e6 if set, else lastEffectivePriceE6
      const oraclePriceE6 = mktConfig.authorityPriceE6 > 0n
        ? mktConfig.authorityPriceE6
        : mktConfig.lastEffectivePriceE6;
      const oraclePriceUsd = Number(oraclePriceE6) / 1_000_000;

      // Find best LP bid/ask by scanning LP accounts
      const allAccounts = parseAllAccounts(data);
      let bestBid: PercolatorMarketState['bestBid'] = null;
      let bestAsk: PercolatorMarketState['bestAsk'] = null;

      for (const { idx, account } of allAccounts) {
        if (account.kind !== AccountKind.LP) continue;
        if (account.capital === 0n) continue;

        // Passive matcher LP: quote = oracle ± spread
        const bidPriceE6 = oraclePriceE6 - (oraclePriceE6 * configSpreadBps / 10000n);
        const askPriceE6 = oraclePriceE6 + (oraclePriceE6 * configSpreadBps / 10000n);

        if (!bestBid || bidPriceE6 > bestBid.price) {
          bestBid = { lpIndex: idx, price: bidPriceE6, priceUsd: Number(bidPriceE6) / 1_000_000 };
        }
        if (!bestAsk || askPriceE6 < bestAsk.price) {
          bestAsk = { lpIndex: idx, price: askPriceE6, priceUsd: Number(askPriceE6) / 1_000_000 };
        }
      }

      const spreadBps = bestBid && bestAsk && oraclePriceE6 > 0n
        ? Number((bestAsk.price - bestBid.price) * 10000n / oraclePriceE6)
        : 0;

      const state: PercolatorMarketState = {
        oraclePrice: oraclePriceE6,
        oraclePriceUsd,
        oracleDecimals: 6,
        totalOpenInterest: engine.totalOpenInterest,
        vault: engine.vault,
        insuranceFund: engine.insuranceFund.balance,
        fundingRate: engine.fundingRateBpsPerSlotLast,
        bestBid,
        bestAsk,
        spreadBps,
        lastCrankSlot: engine.lastCrankSlot,
      };

      lastState = state;

      // Emit price event if changed
      if (lastPrice !== oraclePriceUsd) {
        lastPrice = oraclePriceUsd;
        feed.emit('price', {
          platform: 'percolator' as const,
          marketId: slabPubkey.toBase58(),
          outcomeId: 'perp',
          price: oraclePriceUsd,
          timestamp: Date.now(),
        });
      }

      // Emit orderbook event
      if (bestBid && bestAsk) {
        feed.emit('orderbook', {
          platform: 'percolator' as const,
          marketId: slabPubkey.toBase58(),
          outcomeId: 'perp',
          bids: [[bestBid.priceUsd, Number(engine.vault) / 1_000_000]] as Array<[number, number]>,
          asks: [[bestAsk.priceUsd, Number(engine.vault) / 1_000_000]] as Array<[number, number]>,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      logger.warn({ err }, 'Percolator feed poll error');
    }
  }

  feed.connect = async () => {
    if (!config.slabAddress) {
      throw new Error('Percolator: slabAddress required');
    }
    connection = new Connection(rpcUrl, 'confirmed');
    slabPubkey = new PublicKey(config.slabAddress);

    logger.info({
      slab: config.slabAddress,
      rpc: rpcUrl,
      pollMs: pollInterval,
    }, 'Percolator feed connecting');

    // Initial poll
    await poll();

    // Start polling
    timer = setInterval(poll, pollInterval);
  };

  feed.disconnect = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    connection = null;
    lastState = null;
    lastSlabData = null;
    lastPrice = null;
    logger.info('Percolator feed disconnected');
  };

  feed.getMarketState = () => lastState;

  feed.getPositions = (owner?: PublicKey): PercolatorPosition[] => {
    if (!lastSlabData) return [];
    const allAccounts = parseAllAccounts(lastSlabData);
    return allAccounts
      .filter(({ account }) => {
        if (account.kind !== AccountKind.User) return false;
        if (account.positionSize === 0n) return false;
        if (owner && !account.owner.equals(owner)) return false;
        return true;
      })
      .map(({ idx, account }) => ({
        accountIndex: idx,
        capital: account.capital,
        positionSize: account.positionSize,
        entryPrice: account.entryPrice,
        pnl: account.pnl,
        fundingIndex: account.fundingIndex,
        owner: account.owner,
      }));
  };

  feed.getPrice = () => lastPrice;

  return feed;
}
