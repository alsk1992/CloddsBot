/**
 * Polymarket Weather Market Matching
 *
 * Discover and match Polymarket weather markets with NOAA forecasts.
 */

import { logger } from '../utils/logger';
import { CITY_COORDINATES } from './noaa';

// ============================================================================
// Types
// ============================================================================

export interface WeatherMarket {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  description?: string;
  location: string;
  coordinates?: { lat: number; lon: number };
  metric: 'temperature' | 'precipitation' | 'record' | 'snow' | 'wind' | 'other';
  threshold?: number;
  thresholdUnit?: string;
  comparison?: 'above' | 'below' | 'exactly';
  targetDate?: Date;
  endDate: Date;
  outcomes: WeatherOutcome[];
  volume: number;
  liquidity: number;
  active: boolean;
}

export interface WeatherOutcome {
  id: string;
  name: string;
  price: number;       // 0-1 (YES price)
  tokenId: string;
}

export interface MarketSearchParams {
  location?: string;
  metric?: 'temperature' | 'precipitation' | 'record' | 'snow' | 'wind';
  minVolume?: number;
  activeOnly?: boolean;
}

// Polymarket Gamma API
const GAMMA_API = 'https://gamma-api.polymarket.com';

// Weather-related keywords for market detection
const WEATHER_KEYWORDS = [
  'temperature', 'degree', 'degrees', 'fahrenheit', 'celsius',
  'rain', 'precipitation', 'snow', 'inch', 'inches',
  'record high', 'record low', 'heat', 'cold', 'freeze',
  'wind', 'mph', 'hurricane', 'storm', 'tornado',
  'weather', 'climate', 'forecast',
];

// Location extraction patterns
const LOCATION_PATTERNS = [
  /(?:in|at|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:,\s*[A-Z]{2})?)/,
  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:temperature|weather|rain|snow)/,
  /(?:NYC|LA|SF|DC)/,
];

// Temperature threshold patterns
const TEMP_PATTERNS = [
  /(\d+)\s*(?:degrees?|°)\s*(?:F|fahrenheit)?/i,
  /(?:exceed|above|over|below|under)\s*(\d+)/i,
  /(?:hit|reach)\s*(\d+)/i,
];

// Precipitation patterns
const PRECIP_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*inch(?:es)?/i,
  /(?:rain|snow|precipitation)/i,
];

// ============================================================================
// Market Discovery
// ============================================================================

export class WeatherMarketFinder {
  private marketCache: Map<string, { data: WeatherMarket[]; timestamp: number }> = new Map();
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutes
  private readonly maxCacheSize = 100;

  /**
   * Get all active weather markets from Polymarket
   */
  async getWeatherMarkets(params: MarketSearchParams = {}): Promise<WeatherMarket[]> {
    const cacheKey = JSON.stringify(params);
    const cached = this.marketCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    try {
      // Search for weather-related markets
      const markets = await this.searchMarkets();

      // Filter to weather markets
      const weatherMarkets = markets
        .filter(m => this.isWeatherMarket(m))
        .map(m => this.parseWeatherMarket(m))
        .filter((m): m is WeatherMarket => m !== null);

      // Apply filters
      let filtered = weatherMarkets;

      if (params.location) {
        const loc = params.location.toLowerCase();
        filtered = filtered.filter(m => m.location.toLowerCase().includes(loc));
      }

      if (params.metric) {
        filtered = filtered.filter(m => m.metric === params.metric);
      }

      if (params.minVolume) {
        filtered = filtered.filter(m => m.volume >= params.minVolume!);
      }

      if (params.activeOnly !== false) {
        filtered = filtered.filter(m => m.active);
      }

      if (this.marketCache.size >= this.maxCacheSize) {
        const oldestKey = this.marketCache.keys().next().value;
        if (oldestKey !== undefined) this.marketCache.delete(oldestKey);
      }
      this.marketCache.set(cacheKey, { data: filtered, timestamp: Date.now() });
      return filtered;
    } catch (error) {
      logger.error('[WeatherMarkets] Failed to fetch markets:', error);
      throw error;
    }
  }

  /**
   * Get a specific market by ID or slug
   */
  async getMarket(idOrSlug: string): Promise<WeatherMarket | null> {
    try {
      const url = `${GAMMA_API}/markets/${idOrSlug}`;
      const response = await fetch(url);

      if (!response.ok) return null;

      const market = await response.json() as RawMarket;
      if (!this.isWeatherMarket(market)) return null;

      return this.parseWeatherMarket(market);
    } catch (error) {
      logger.error('[WeatherMarkets] Failed to fetch market:', error);
      return null;
    }
  }

  /**
   * Search all markets (internal)
   */
  private async searchMarkets(): Promise<RawMarket[]> {
    const allMarkets: RawMarket[] = [];

    // Try searching with weather keywords
    for (const keyword of ['weather', 'temperature', 'rain', 'snow', 'record']) {
      try {
        const url = `${GAMMA_API}/markets?_q=${encodeURIComponent(keyword)}&active=true&limit=100`;
        const response = await fetch(url);

        if (response.ok) {
          const markets = await response.json() as RawMarket[];
          allMarkets.push(...markets);
        }
      } catch (err) {
        logger.debug({ keyword, err }, '[WeatherMarkets] Keyword search failed');
      }
    }

    // Also try tag-based search
    try {
      const url = `${GAMMA_API}/markets?tag=weather&active=true&limit=100`;
      const response = await fetch(url);

      if (response.ok) {
        const markets = await response.json() as RawMarket[];
        allMarkets.push(...markets);
      }
    } catch (err) {
      logger.debug({ err }, '[WeatherMarkets] Tag-based search failed');
    }

    // Deduplicate by ID
    const seen = new Set<string>();
    return allMarkets.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }

  /**
   * Check if a market is weather-related
   */
  private isWeatherMarket(market: RawMarket): boolean {
    const text = `${market.question || ''} ${market.description || ''}`.toLowerCase();

    return WEATHER_KEYWORDS.some(kw => text.includes(kw));
  }

  /**
   * Parse raw market data into WeatherMarket
   */
  private parseWeatherMarket(raw: RawMarket): WeatherMarket | null {
    try {
      const question = raw.question || '';
      const description = raw.description || '';
      const text = `${question} ${description}`;

      // Extract location
      const location = this.extractLocation(text);
      const coordinates = this.getCoordinates(location);

      // Determine metric type
      const metric = this.determineMetric(text);

      // Extract threshold
      const { threshold, unit, comparison } = this.extractThreshold(text, metric);

      // Parse target date from question or end date
      const targetDate = this.extractDate(text) || new Date(raw.endDate);

      // Parse outcomes
      const outcomes: WeatherOutcome[] = (raw.tokens || []).map((t: RawToken) => ({
        id: t.token_id,
        name: t.outcome,
        price: Number.isFinite(parseFloat(t.price)) ? parseFloat(t.price) : 0,
        tokenId: t.token_id,
      }));

      return {
        id: raw.id,
        conditionId: raw.conditionId || raw.id,
        slug: raw.slug || raw.id,
        question,
        description,
        location,
        coordinates,
        metric,
        threshold,
        thresholdUnit: unit,
        comparison,
        targetDate,
        endDate: new Date(raw.endDate),
        outcomes,
        volume: raw.volume ?? 0,
        liquidity: raw.liquidity ?? 0,
        active: raw.active !== false && raw.closed !== true,
      };
    } catch (error) {
      logger.error('[WeatherMarkets] Failed to parse market:', error);
      return null;
    }
  }

  /**
   * Extract location from market text
   */
  private extractLocation(text: string): string {
    // Try patterns
    for (const pattern of LOCATION_PATTERNS) {
      const match = text.match(pattern);
      if (match) return match[1];
    }

    // Try known city names
    const lower = text.toLowerCase();
    for (const [key, data] of Object.entries(CITY_COORDINATES)) {
      if (lower.includes(key)) return data.name;
    }

    return 'Unknown';
  }

  /**
   * Get coordinates for a location
   */
  private getCoordinates(location: string): { lat: number; lon: number } | undefined {
    const normalized = location.toLowerCase().replace(/,.*$/, '').trim();

    const coords = CITY_COORDINATES[normalized];
    if (coords) return { lat: coords.lat, lon: coords.lon };

    // Try partial match
    for (const [key, data] of Object.entries(CITY_COORDINATES)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return { lat: data.lat, lon: data.lon };
      }
    }

    return undefined;
  }

  /**
   * Determine the metric type
   */
  private determineMetric(text: string): WeatherMarket['metric'] {
    const lower = text.toLowerCase();

    if (lower.includes('temperature') || lower.includes('degree') || lower.includes('°f') || lower.includes('°c')) {
      return 'temperature';
    }
    if (lower.includes('rain') || lower.includes('precipitation') || lower.includes('precip')) {
      return 'precipitation';
    }
    if (lower.includes('snow') || lower.includes('snowfall')) {
      return 'snow';
    }
    if (lower.includes('wind') || lower.includes('mph') || lower.includes('gust')) {
      return 'wind';
    }
    if (lower.includes('record')) {
      return 'record';
    }

    return 'other';
  }

  /**
   * Extract threshold value
   */
  private extractThreshold(
    text: string,
    metric: string
  ): { threshold?: number; unit?: string; comparison?: 'above' | 'below' | 'exactly' } {
    const lower = text.toLowerCase();

    // Determine comparison type
    let comparison: 'above' | 'below' | 'exactly' | undefined;
    if (lower.includes('exceed') || lower.includes('above') || lower.includes('over') || lower.includes('hit')) {
      comparison = 'above';
    } else if (lower.includes('below') || lower.includes('under') || lower.includes('less than')) {
      comparison = 'below';
    }

    // Extract number based on metric
    if (metric === 'temperature') {
      for (const pattern of TEMP_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
          const parsed = parseInt(match[1], 10);
          if (!isNaN(parsed)) {
            return { threshold: parsed, unit: '°F', comparison };
          }
        }
      }
    }

    if (metric === 'precipitation' || metric === 'snow') {
      for (const pattern of PRECIP_PATTERNS) {
        const match = text.match(pattern);
        if (match && match[1]) {
          return { threshold: parseFloat(match[1]), unit: 'inches', comparison };
        }
      }
    }

    return { comparison };
  }

  /**
   * Extract date from text
   */
  private extractDate(text: string): Date | undefined {
    // Try common date patterns
    const patterns = [
      /(?:on|by)\s+([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/i,
      /(\d{1,2}\/\d{1,2}\/\d{4})/,
      /(\d{4}-\d{2}-\d{2})/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const date = new Date(match[1]);
        if (!isNaN(date.getTime())) return date;
      }
    }

    return undefined;
  }
}

// ============================================================================
// Types for raw API response
// ============================================================================

interface RawMarket {
  id: string;
  conditionId?: string;
  slug?: string;
  question?: string;
  description?: string;
  endDate: string;
  active?: boolean;
  closed?: boolean;
  volume?: number;
  liquidity?: number;
  tokens?: RawToken[];
}

interface RawToken {
  token_id: string;
  outcome: string;
  price: string;
}

// ============================================================================
// Factory
// ============================================================================

let marketFinderInstance: WeatherMarketFinder | null = null;

export function getWeatherMarketFinder(): WeatherMarketFinder {
  if (!marketFinderInstance) {
    marketFinderInstance = new WeatherMarketFinder();
  }
  return marketFinderInstance;
}
