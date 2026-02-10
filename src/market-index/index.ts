/**
 * Market Index - Lightweight semantic search for prediction markets
 *
 * Ported concepts from pm-indexer, adapted for Clodds + SQLite.
 */

import { logger } from '../utils/logger';
import type { Database } from '../db';
import type { EmbeddingsService, SearchResult } from '../embeddings';
import type { MarketIndexEntry, Platform } from '../types';

const POLYMARKET_BASE = 'https://gamma-api.polymarket.com';
const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const MANIFOLD_BASE = 'https://api.manifold.markets/v0';
const METACULUS_BASE = 'https://www.metaculus.com/api2';

const DEFAULT_LIMIT = 500;
const PAGE_SIZE = 100;

const SPORTS_TAGS = [
  'Sports',
  'NFL',
  'NBA',
  'MLB',
  'NHL',
  'Soccer',
  'Football',
  'Basketball',
  'Baseball',
  'Hockey',
  'Tennis',
  'Golf',
  'FIFA',
  'NCAA',
  'UFC',
  'Boxing',
  'MMA',
  'Cricket',
  'Rugby',
  'F1',
  'NASCAR',
  'Olympics',
];

type IndexStatus = 'open' | 'closed' | 'settled' | 'all';

interface PolymarketTag {
  id: string;
  slug: string;
  label: string;
}

interface PolymarketEvent {
  id: string;
  title: string;
  description: string;
  tags?: PolymarketTag[];
  markets?: PolymarketMarket[];
}

interface PolymarketMarket {
  id: string;
  question: string;
  description?: string;
  slug: string;
  outcomes: string[];
  outcomePrices?: string[];
  volume?: string;
  volume24hr?: string;
  liquidity?: string;
  endDate?: string;
  closed?: boolean;
  archived?: boolean;
  tags?: PolymarketTag[];
  groupItemTitle?: string;
}

interface KalshiEvent {
  event_ticker: string;
  title: string;
  category: string;
  markets?: KalshiMarket[];
}

interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  status: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  close_time?: string;
  expiration_time?: string;
  rules_primary?: string;
  category?: string;
  tags?: string[];
  volume_24h?: number;
  open_interest?: number;
}

interface ManifoldMarket {
  id: string;
  slug: string;
  question: string;
  description?: string;
  textDescription?: string;
  volume?: number;
  totalLiquidity?: number;
  outcomeType: 'BINARY' | 'MULTIPLE_CHOICE' | 'PSEUDO_NUMERIC' | 'FREE_RESPONSE';
  answers?: Array<{ id: string; text: string }>;
  closeTime?: number;
  isResolved?: boolean;
  createdTime?: number;
  lastUpdatedTime?: number;
  url?: string;
}

interface MetaculusQuestion {
  id: number;
  title: string;
  description: string;
  created_time: string;
  close_time?: string;
  resolve_time?: string | null;
  resolution?: number | null;
  status?: string;
  url?: string;
  page_url?: string;
  possibilities?: { type?: string };
  number_of_predictions?: number;
}

interface PaginatedResponse<T> {
  results: T[];
  next?: string | null;
}

export interface MarketIndexSyncOptions {
  platforms?: Platform[];
  limitPerPlatform?: number;
  status?: IndexStatus;
  excludeSports?: boolean;
  minVolume24h?: number;
  minLiquidity?: number;
  minOpenInterest?: number;
  minPredictions?: number;
  excludeResolved?: boolean;
  prune?: boolean;
  staleAfterMs?: number;
}

export interface MarketIndexSearchOptions {
  query: string;
  platform?: Platform;
  limit?: number;
  maxCandidates?: number;
  minScore?: number;
  platformWeights?: Partial<Record<Platform, number>>;
}

export interface MarketIndexStats {
  total: number;
  byPlatform: Record<string, number>;
  lastSyncAt?: Date;
  lastSyncIndexed?: number;
  lastSyncByPlatform?: Record<string, number>;
  lastSyncDurationMs?: number;
  lastPruned?: number;
}

export interface MarketIndexService {
  sync(options?: MarketIndexSyncOptions): Promise<{ indexed: number; byPlatform: Record<string, number> }>;
  search(options: MarketIndexSearchOptions): Promise<Array<SearchResult<MarketIndexEntry>>>;
  stats(platforms?: Platform[]): MarketIndexStats;
}

function isSportsMarket(tags: string[] | undefined): boolean {
  if (!tags || tags.length === 0) return false;
  return SPORTS_TAGS.some((sport) =>
    tags.some((tag) => tag.toLowerCase().includes(sport.toLowerCase()))
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify(null);
  }
}

function buildSearchText(entry: MarketIndexEntry): string {
  const parts: string[] = [entry.question];

  if (entry.description) parts.push(entry.description);

  if (entry.outcomesJson) {
    try {
      const outcomes = JSON.parse(entry.outcomesJson) as string[];
      if (Array.isArray(outcomes)) {
        parts.push(outcomes.join(' '));
      }
    } catch {
      // ignore bad JSON
    }
  }

  if (entry.tagsJson) {
    try {
      const tags = JSON.parse(entry.tagsJson) as string[];
      if (Array.isArray(tags)) {
        parts.push(tags.join(' '));
      }
    } catch {
      // ignore bad JSON
    }
  }

  return parts.filter(Boolean).join('\n');
}

function computeTextBoost(query: string, entry: MarketIndexEntry): number {
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return 0;

  const haystack = buildSearchText(entry).toLowerCase();
  let matches = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      matches += 1;
    }
  }

  if (matches === 0) return 0;
  return Math.min(0.15, matches * 0.02);
}

function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

function buildContentHash(entry: MarketIndexEntry): string {
  const payload = JSON.stringify({
    platform: entry.platform,
    marketId: entry.marketId,
    slug: entry.slug,
    question: entry.question,
    description: entry.description,
    outcomesJson: entry.outcomesJson,
    tagsJson: entry.tagsJson,
    status: entry.status,
    url: entry.url,
    endDate: entry.endDate ? entry.endDate.toISOString() : null,
    resolved: entry.resolved,
    volume24h: entry.volume24h,
    liquidity: entry.liquidity,
    openInterest: entry.openInterest,
    predictions: entry.predictions,
  });
  return hashContent(payload);
}

function shouldSkipResolved(entry: MarketIndexEntry, excludeResolved?: boolean, status?: IndexStatus): boolean {
  if (!excludeResolved && status !== 'settled') return false;
  if (status === 'settled') return !entry.resolved;
  if (excludeResolved) return entry.resolved;
  return false;
}

function meetsThresholds(
  metrics: {
    volume24h?: number;
    liquidity?: number;
    openInterest?: number;
    predictions?: number;
  },
  options: MarketIndexSyncOptions
): boolean {
  if (typeof options.minVolume24h === 'number' && metrics.volume24h !== undefined) {
    if (metrics.volume24h < options.minVolume24h) return false;
  }
  if (typeof options.minLiquidity === 'number' && metrics.liquidity !== undefined) {
    if (metrics.liquidity < options.minLiquidity) return false;
  }
  if (typeof options.minOpenInterest === 'number' && metrics.openInterest !== undefined) {
    if (metrics.openInterest < options.minOpenInterest) return false;
  }
  if (typeof options.minPredictions === 'number' && metrics.predictions !== undefined) {
    if (metrics.predictions < options.minPredictions) return false;
  }
  return true;
}

async function fetchPolymarketMarkets(
  limit: number,
  status: IndexStatus,
  excludeSports: boolean,
  options: MarketIndexSyncOptions
): Promise<MarketIndexEntry[]> {
  const entries: MarketIndexEntry[] = [];
  const statuses: Array<Exclude<IndexStatus, 'all'>> =
    status === 'all' ? ['open', 'closed', 'settled'] : [status];

  for (const nextStatus of statuses) {
    let offset = 0;
    let fetched = 0;
    while (fetched < limit) {
      const params = new URLSearchParams({
        limit: PAGE_SIZE.toString(),
        offset: offset.toString(),
      });

      if (nextStatus === 'open') {
        params.set('closed', 'false');
      } else if (nextStatus === 'closed') {
        params.set('closed', 'true');
      } else if (nextStatus === 'settled') {
        params.set('archived', 'true');
      }

      const response = await fetch(`${POLYMARKET_BASE}/events?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Polymarket API error: ${response.status}`);
      }
      const events = (await response.json()) as PolymarketEvent[];
      if (!Array.isArray(events) || events.length === 0) break;

      for (const event of events) {
        const eventTags = (event.tags || []).map((t) => t.label);
        const markets = event.markets ?? [];
        for (const market of markets) {
          if (fetched >= limit) break;
          const tags = (market.tags || event.tags || []).map((t) => t.label);
          if (excludeSports && isSportsMarket(tags)) continue;

      const volume24hRaw = market.volume24hr ? Number.parseFloat(market.volume24hr) : undefined;
      const volume24h = volume24hRaw !== undefined && !Number.isNaN(volume24hRaw) ? volume24hRaw : undefined;
      const liquidityRaw = market.liquidity ? Number.parseFloat(market.liquidity) : undefined;
      const liquidity = liquidityRaw !== undefined && !Number.isNaN(liquidityRaw) ? liquidityRaw : undefined;
          if (!meetsThresholds({ volume24h, liquidity }, options)) continue;
          const resolved = Boolean(market.archived);
          const entry: MarketIndexEntry = {
            platform: 'polymarket',
            marketId: market.id,
            slug: market.slug,
            question: market.question,
            description: market.description || event.description,
            outcomesJson: safeJson(market.outcomes ?? []),
            tagsJson: safeJson(tags.length ? tags : eventTags),
            status: market.archived ? 'settled' : market.closed ? 'closed' : 'open',
            url: market.slug ? `https://polymarket.com/market/${market.slug}` : undefined,
            endDate: market.endDate ? new Date(market.endDate) : undefined,
            resolved,
            updatedAt: new Date(),
            volume24h,
            liquidity,
            rawJson: safeJson(market),
          };
          if (shouldSkipResolved(entry, options.excludeResolved, status)) {
            continue;
          }
          entries.push(entry);
          fetched += 1;
        }
      }

      offset += PAGE_SIZE;
      if (events.length < PAGE_SIZE) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return entries;
}

async function fetchKalshiMarkets(
  limit: number,
  status: IndexStatus,
  excludeSports: boolean,
  options: MarketIndexSyncOptions
): Promise<MarketIndexEntry[]> {
  const entries: MarketIndexEntry[] = [];
  const statuses: Array<Exclude<IndexStatus, 'all'>> =
    status === 'all' ? ['open', 'closed', 'settled'] : [status];

  for (const nextStatus of statuses) {
    let cursor: string | undefined;
    let fetched = 0;

    while (fetched < limit) {
      const params = new URLSearchParams({
        status: nextStatus,
        limit: PAGE_SIZE.toString(),
        with_nested_markets: 'true',
      });
      if (cursor) params.set('cursor', cursor);

      const response = await fetch(`${KALSHI_BASE}/events?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Kalshi API error: ${response.status}`);
      }
      const data = (await response.json()) as { events?: KalshiEvent[]; cursor?: string };
      const events = data.events ?? [];
      if (events.length === 0) break;

      for (const event of events) {
        if (excludeSports && event.category === 'Sports') {
          continue;
        }
        const markets = event.markets ?? [];
        for (const market of markets) {
          if (fetched >= limit) break;
          const volume24h = typeof market.volume_24h === 'number' ? market.volume_24h : undefined;
          const openInterest = typeof market.open_interest === 'number' ? market.open_interest : undefined;
          if (!meetsThresholds({ volume24h, openInterest }, options)) continue;

          const outcomeYes = market.yes_sub_title || 'Yes';
          const outcomeNo = market.no_sub_title || 'No';
          const entry: MarketIndexEntry = {
            platform: 'kalshi',
            marketId: market.ticker,
            slug: market.ticker,
            question: market.title || market.subtitle || event.title,
            description: market.rules_primary || market.subtitle || event.title,
            outcomesJson: safeJson([outcomeYes, outcomeNo]),
            tagsJson: safeJson(market.tags ?? (event.category ? [event.category] : [])),
            status: market.status,
            url: `https://kalshi.com/markets/${market.ticker}`,
            endDate: market.close_time ? new Date(market.close_time) : undefined,
            resolved: market.status === 'settled',
            updatedAt: new Date(),
            volume24h,
            openInterest,
            rawJson: safeJson(market),
          };
          if (shouldSkipResolved(entry, options.excludeResolved, status)) {
            continue;
          }
          entries.push(entry);
          fetched += 1;
        }
      }

      cursor = data.cursor;
      if (!cursor) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return entries;
}

async function fetchManifoldMarkets(limit: number, options: MarketIndexSyncOptions, status: IndexStatus): Promise<MarketIndexEntry[]> {
  const entries: MarketIndexEntry[] = [];
  let before: number | undefined;
  const now = Date.now();

  while (entries.length < limit) {
    const params = new URLSearchParams({
      limit: PAGE_SIZE.toString(),
    });
    if (before) params.set('before', before.toString());

    const response = await fetch(`${MANIFOLD_BASE}/markets?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Manifold API error: ${response.status}`);
    }
    const markets = (await response.json()) as ManifoldMarket[];
    if (!Array.isArray(markets) || markets.length === 0) break;

    for (const market of markets) {
      if (entries.length >= limit) break;
      const outcomes =
        market.outcomeType === 'MULTIPLE_CHOICE' && market.answers
          ? market.answers.map((a) => a.text)
          : ['Yes', 'No'];

      const resolved = Boolean(market.isResolved);
      const closeTime = market.closeTime ? new Date(market.closeTime) : undefined;
      if (status === 'open' && (resolved || (closeTime && closeTime.getTime() <= now))) {
        continue;
      }
      if (status === 'closed' && (resolved || !closeTime || closeTime.getTime() > now)) {
        continue;
      }
      if (status === 'settled' && !resolved) {
        continue;
      }

      const volume = typeof market.volume === 'number' ? market.volume : undefined;
      const liquidity = typeof market.totalLiquidity === 'number' ? market.totalLiquidity : undefined;
      if (!meetsThresholds({ volume24h: volume, liquidity }, options)) continue;

      const entry: MarketIndexEntry = {
        platform: 'manifold',
        marketId: market.id,
        slug: market.slug,
        question: market.question,
        description: market.textDescription || market.description,
        outcomesJson: safeJson(outcomes),
        tagsJson: safeJson([]),
        status: resolved ? 'settled' : closeTime && closeTime.getTime() <= now ? 'closed' : 'open',
        url: market.url || `https://manifold.markets/${market.slug}`,
        endDate: closeTime,
        resolved,
        updatedAt: new Date(market.lastUpdatedTime ?? Date.now()),
        volume24h: volume,
        liquidity,
        rawJson: safeJson(market),
      };
      if (shouldSkipResolved(entry, options.excludeResolved, status)) {
        continue;
      }
      entries.push(entry);
    }

    before = markets[markets.length - 1]?.createdTime;
    if (!before) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  return entries;
}

async function fetchMetaculusMarkets(limit: number, status: IndexStatus, options: MarketIndexSyncOptions): Promise<MarketIndexEntry[]> {
  const entries: MarketIndexEntry[] = [];
  let nextUrl: string | null = `${METACULUS_BASE}/questions/?${new URLSearchParams({
    limit: PAGE_SIZE.toString(),
    status: status === 'all' ? 'open' : status,
    type: 'forecast',
  }).toString()}`;

  while (nextUrl && entries.length < limit) {
    const response = await fetch(nextUrl, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Metaculus API error: ${response.status}`);
    }
    const data = (await response.json()) as PaginatedResponse<MetaculusQuestion>;
    for (const q of data.results || []) {
      if (entries.length >= limit) break;
      const predictions = typeof q.number_of_predictions === 'number' ? q.number_of_predictions : undefined;
      if (!meetsThresholds({ predictions }, options)) continue;

      const entry: MarketIndexEntry = {
        platform: 'metaculus',
        marketId: q.id.toString(),
        slug: q.id.toString(),
        question: q.title,
        description: q.description,
        outcomesJson: safeJson(['Yes', 'No']),
        tagsJson: safeJson([]),
        status: q.status,
        url: q.page_url || q.url || `https://www.metaculus.com/questions/${q.id}/`,
        endDate: q.close_time ? new Date(q.close_time) : undefined,
        resolved: q.resolution !== null && q.resolution !== undefined,
        updatedAt: new Date(),
        predictions,
        rawJson: safeJson(q),
      };
      if (shouldSkipResolved(entry, options.excludeResolved, status)) {
        continue;
      }
      entries.push(entry);
    }
    nextUrl = data.next || null;
    await new Promise((r) => setTimeout(r, 100));
  }

  return entries;
}

export function createMarketIndexService(
  db: Database,
  embeddings: EmbeddingsService,
  options?: { platformWeights?: Partial<Record<Platform, number>> }
): MarketIndexService {
  const lastSync = {
    at: null as Date | null,
    indexed: 0,
    byPlatform: {} as Record<string, number>,
    durationMs: 0,
    pruned: 0,
  };
  const platformWeights = options?.platformWeights ?? {};

  return {
    async sync(options = {}) {
      const platforms = options.platforms ?? ['polymarket', 'kalshi', 'manifold', 'metaculus'];
      const limit = options.limitPerPlatform ?? DEFAULT_LIMIT;
      const status = options.status ?? 'open';
      const excludeSports = options.excludeSports ?? true;
      const prune = options.prune ?? false;
      const staleAfterMs = options.staleAfterMs ?? 7 * 24 * 60 * 60 * 1000;
      const startedAt = Date.now();

      const byPlatform: Record<string, number> = {};
      let total = 0;
      let prunedTotal = 0;

      for (const platform of platforms) {
        try {
          let entries: MarketIndexEntry[] = [];
          switch (platform) {
            case 'polymarket':
              entries = await fetchPolymarketMarkets(limit, status, excludeSports, options);
              break;
            case 'kalshi':
              entries = await fetchKalshiMarkets(limit, status, excludeSports, options);
              break;
            case 'manifold':
              entries = await fetchManifoldMarkets(limit, options, status);
              break;
            case 'metaculus':
              entries = await fetchMetaculusMarkets(limit, status, options);
              break;
            default:
              continue;
          }

          let updated = 0;
          for (const entry of entries) {
            const contentHash = buildContentHash(entry);
            const existingHash = db.getMarketIndexHash(entry.platform, entry.marketId);
            if (existingHash && existingHash === contentHash) {
              continue;
            }
            entry.contentHash = contentHash;
            db.upsertMarketIndex(entry);
            updated += 1;
          }

          byPlatform[platform] = updated;
          total += updated;

          if (prune) {
            const cutoff = Date.now() - staleAfterMs;
            const pruned = db.pruneMarketIndex(cutoff, platform);
            prunedTotal += pruned;
          }
        } catch (error) {
          logger.warn({ platform, error }, 'Market index sync failed');
          byPlatform[platform] = 0;
        }
      }

      lastSync.at = new Date();
      lastSync.indexed = total;
      lastSync.byPlatform = { ...byPlatform };
      lastSync.durationMs = Date.now() - startedAt;
      lastSync.pruned = prunedTotal;

      return { indexed: total, byPlatform };
    },

    async search(options) {
      const limit = options.limit ?? 10;
      const maxCandidates = options.maxCandidates ?? 1500;
      const textQuery = options.query.length >= 3 ? options.query : undefined;
      const candidates = db.listMarketIndex({
        platform: options.platform,
        limit: maxCandidates,
        textQuery,
      });

      if (candidates.length === 0) return [];

      const queryEmbedding = await embeddings.embed(options.query);

      const cachedVectors: Array<{ entry: MarketIndexEntry; vector: number[] }> = [];
      const missing: Array<{ entry: MarketIndexEntry; content: string; contentHash: string }> = [];

      for (const entry of candidates) {
        const contentHash = entry.contentHash || buildContentHash(entry);
        const cached = db.getMarketIndexEmbedding(entry.platform, entry.marketId);
        if (cached && cached.contentHash === contentHash) {
          cachedVectors.push({ entry: { ...entry, contentHash }, vector: cached.vector });
        } else {
          const content = buildSearchText(entry);
          missing.push({ entry: { ...entry, contentHash }, content, contentHash });
        }
      }

      if (missing.length > 0) {
        const embeddingsBatch = await embeddings.embedBatch(missing.map((m) => m.content));
        for (let i = 0; i < missing.length; i++) {
          const { entry, contentHash } = missing[i];
          const vector = embeddingsBatch[i];
          db.upsertMarketIndexEmbedding(entry.platform, entry.marketId, contentHash, vector);
          cachedVectors.push({ entry, vector });
        }
      }

      const results: Array<SearchResult<MarketIndexEntry>> = cachedVectors.map(({ entry, vector }) => ({
        item: entry,
        score: embeddings.cosineSimilarity(queryEmbedding, vector),
      }));

      const boosted = results.map((r) => {
        const weight = options.platformWeights?.[r.item.platform] ?? platformWeights[r.item.platform] ?? 1;
        return {
          ...r,
          score: r.score * weight + computeTextBoost(options.query, r.item),
        };
      });

      boosted.sort((a, b) => b.score - a.score);

      const minScore = options.minScore;
      const final = typeof minScore === 'number'
        ? boosted.filter((r) => r.score >= minScore)
        : boosted;
      return final.slice(0, limit);
    },

    stats(platforms?: Platform[]) {
      const selected = platforms ?? ['polymarket', 'kalshi', 'manifold', 'metaculus'];
      const byPlatform: Record<string, number> = {};
      let total = 0;
      for (const platform of selected) {
        const count = db.countMarketIndex(platform);
        byPlatform[platform] = count;
        total += count;
      }
      return {
        total,
        byPlatform,
        lastSyncAt: lastSync.at ?? undefined,
        lastSyncIndexed: lastSync.indexed ?? undefined,
        lastSyncByPlatform: Object.keys(lastSync.byPlatform).length ? lastSync.byPlatform : undefined,
        lastSyncDurationMs: lastSync.durationMs ?? undefined,
        lastPruned: lastSync.pruned ?? undefined,
      };
    },
  };
}
