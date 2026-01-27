/**
 * External Data Sources for Edge Detection
 * Fetches probabilities from models, polls, and betting odds
 */

import { logger } from '../../utils/logger';

export interface ExternalSource {
  name: string;
  type: 'model' | 'poll' | 'betting' | 'official';
  probability: number;
  lastUpdated: Date;
  url?: string;
}

export interface EdgeAnalysis {
  marketId: string;
  marketQuestion: string;
  marketPrice: number;
  sources: ExternalSource[];
  fairValue: number;
  edge: number;
  edgePct: number;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * CME FedWatch Tool - Fed rate probabilities
 * Scrapes from CME website
 */
export async function getFedWatchProbabilities(): Promise<Map<string, number>> {
  const probs = new Map<string, number>();

  try {
    // CME FedWatch data can be fetched from their API
    // For now, return placeholder that would be replaced with actual scraping
    const response = await fetch('https://www.cmegroup.com/services/fed-funds-target-rate-probabilities/');

    if (response.ok) {
      const data = await response.json();
      // Parse the actual CME response format
      // This is a simplified version
      if (data && typeof data === 'object') {
        for (const [meeting, prob] of Object.entries(data)) {
          if (typeof prob === 'number') {
            probs.set(meeting, prob / 100);
          }
        }
      }
    }
  } catch (error) {
    logger.warn('Failed to fetch FedWatch data:', error);
  }

  return probs;
}

/**
 * RealClearPolitics polling averages
 */
export async function getRCPPollingAverage(race: string): Promise<ExternalSource | null> {
  try {
    // RCP doesn't have a public API, would need to scrape
    // Placeholder for actual implementation
    logger.debug(`Would fetch RCP average for: ${race}`);
    return null;
  } catch (error) {
    logger.warn('Failed to fetch RCP data:', error);
    return null;
  }
}

/**
 * 538/Silver Bulletin model probabilities
 */
export async function get538Probability(market: string): Promise<ExternalSource | null> {
  try {
    // 538 model data - would need to scrape or use their API if available
    logger.debug(`Would fetch 538 data for: ${market}`);
    return null;
  } catch (error) {
    logger.warn('Failed to fetch 538 data:', error);
    return null;
  }
}

/**
 * Get betting odds from offshore books
 * Converts American odds to probability
 */
function americanOddsToProbability(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

/**
 * Analyze edge for a market by comparing to external sources
 */
export async function analyzeEdge(
  marketId: string,
  marketQuestion: string,
  marketPrice: number,
  category: 'politics' | 'economics' | 'sports' | 'other'
): Promise<EdgeAnalysis> {
  const sources: ExternalSource[] = [];

  // Fetch relevant external data based on category
  if (category === 'economics') {
    const fedWatch = await getFedWatchProbabilities();
    // Match market to FedWatch data
    for (const [meeting, prob] of fedWatch) {
      if (marketQuestion.toLowerCase().includes(meeting.toLowerCase())) {
        sources.push({
          name: 'CME FedWatch',
          type: 'official',
          probability: prob,
          lastUpdated: new Date(),
          url: 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html',
        });
      }
    }
  }

  if (category === 'politics') {
    const rcp = await getRCPPollingAverage(marketQuestion);
    if (rcp) sources.push(rcp);

    const fiveThirtyEight = await get538Probability(marketQuestion);
    if (fiveThirtyEight) sources.push(fiveThirtyEight);
  }

  // Calculate fair value as average of sources
  let fairValue = marketPrice;
  if (sources.length > 0) {
    const sum = sources.reduce((acc, s) => acc + s.probability, 0);
    fairValue = sum / sources.length;
  }

  const edge = fairValue - marketPrice;
  const edgePct = marketPrice > 0 ? (edge / marketPrice) * 100 : 0;

  // Determine confidence based on number and agreement of sources
  let confidence: 'low' | 'medium' | 'high' = 'low';
  if (sources.length >= 3) {
    const stdDev = calculateStdDev(sources.map(s => s.probability));
    if (stdDev < 0.05) confidence = 'high';
    else if (stdDev < 0.10) confidence = 'medium';
  } else if (sources.length >= 1) {
    confidence = 'medium';
  }

  return {
    marketId,
    marketQuestion,
    marketPrice,
    sources,
    fairValue,
    edge,
    edgePct,
    confidence,
  };
}

function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Kelly Criterion calculator
 */
export function calculateKelly(
  marketPrice: number,
  estimatedProbability: number,
  bankroll: number
): { fullKelly: number; halfKelly: number; quarterKelly: number } {
  // Kelly = (bp - q) / b
  // where b = odds received (1/price - 1), p = prob of winning, q = prob of losing

  const b = (1 / marketPrice) - 1;
  const p = estimatedProbability;
  const q = 1 - p;

  const kellyFraction = (b * p - q) / b;

  // Never bet negative Kelly (edge is wrong direction)
  const safeKelly = Math.max(0, kellyFraction);

  return {
    fullKelly: bankroll * safeKelly,
    halfKelly: bankroll * safeKelly * 0.5,
    quarterKelly: bankroll * safeKelly * 0.25,
  };
}
