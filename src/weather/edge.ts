/**
 * Weather Edge Calculator
 *
 * Calculate betting edge by comparing NOAA forecasts to Polymarket odds.
 */

import { logger } from '../utils/logger';
import { NOAAClient, getNOAAClient, ForecastPeriod } from './noaa';
import { WeatherMarket, WeatherMarketFinder, getWeatherMarketFinder } from './markets';

// ============================================================================
// Types
// ============================================================================

export interface WeatherEdge {
  market: WeatherMarket;
  forecast: ForecastPeriod | null;
  noaaProbability: number;      // 0-100
  marketPrice: number;          // 0-1 (YES price)
  edge: number;                 // Positive = bet YES, Negative = bet NO
  edgePercent: number;          // Edge as percentage
  confidence: 'high' | 'medium' | 'low';
  recommendation: 'YES' | 'NO' | 'SKIP';
  reasoning: string;
}

export interface EdgeScanResult {
  scannedAt: Date;
  totalMarkets: number;
  marketsWithEdge: number;
  topOpportunities: WeatherEdge[];
}

export interface BetRecommendation {
  market: WeatherMarket;
  side: 'YES' | 'NO';
  edge: number;
  suggestedAmount: number;
  kellyFraction: number;
  expectedValue: number;
}

// Edge thresholds
const MIN_EDGE_PERCENT = 5;       // Minimum edge to consider
const HIGH_EDGE_PERCENT = 15;     // High confidence threshold
const KELLY_FRACTION = 0.25;      // Use quarter Kelly

// ============================================================================
// Edge Calculator
// ============================================================================

export class WeatherEdgeCalculator {
  private noaa: NOAAClient;
  private markets: WeatherMarketFinder;

  constructor(noaa?: NOAAClient, markets?: WeatherMarketFinder) {
    this.noaa = noaa || getNOAAClient();
    this.markets = markets || getWeatherMarketFinder();
  }

  /**
   * Calculate edge for a specific market
   */
  async calculateEdge(market: WeatherMarket): Promise<WeatherEdge> {
    // Get forecast if we have coordinates
    let forecast: ForecastPeriod | null = null;
    let noaaProbability = 50; // Default to 50% if we can't determine

    if (market.coordinates && market.targetDate) {
      try {
        forecast = await this.getForecastForDate(
          market.coordinates.lat,
          market.coordinates.lon,
          market.targetDate
        );

        if (forecast) {
          noaaProbability = this.calculateNOAAProbability(market, forecast);
        }
      } catch (error) {
        logger.warn(`[EdgeCalc] Could not get forecast for ${market.location}:`, error);
      }
    }

    // Get YES price from market
    const yesOutcome = market.outcomes.find(o =>
      o.name.toLowerCase() === 'yes' ||
      o.name.toLowerCase().includes('yes')
    );
    const marketPrice = yesOutcome?.price ?? 0.5;

    // Calculate edge
    const noaaDecimal = noaaProbability / 100;
    const edge = noaaDecimal - marketPrice;
    const edgePercent = edge * 100;

    // Determine confidence
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (forecast && market.coordinates) {
      if (Math.abs(edgePercent) >= HIGH_EDGE_PERCENT) {
        confidence = 'high';
      } else if (Math.abs(edgePercent) >= MIN_EDGE_PERCENT) {
        confidence = 'medium';
      }
    }

    // Determine recommendation
    let recommendation: 'YES' | 'NO' | 'SKIP' = 'SKIP';
    let reasoning = '';

    if (Math.abs(edgePercent) < MIN_EDGE_PERCENT) {
      reasoning = `Edge of ${edgePercent.toFixed(1)}% is below minimum threshold of ${MIN_EDGE_PERCENT}%`;
    } else if (!forecast) {
      reasoning = 'No forecast data available for accurate edge calculation';
    } else if (edge > 0) {
      recommendation = 'YES';
      reasoning = `NOAA probability (${noaaProbability.toFixed(0)}%) exceeds market price (${(marketPrice * 100).toFixed(0)}%) by ${edgePercent.toFixed(1)}%`;
    } else {
      recommendation = 'NO';
      reasoning = `Market price (${(marketPrice * 100).toFixed(0)}%) exceeds NOAA probability (${noaaProbability.toFixed(0)}%) by ${Math.abs(edgePercent).toFixed(1)}%`;
    }

    return {
      market,
      forecast,
      noaaProbability,
      marketPrice,
      edge,
      edgePercent,
      confidence,
      recommendation,
      reasoning,
    };
  }

  /**
   * Scan all weather markets for edge opportunities
   */
  async scanForEdge(minEdgePercent = MIN_EDGE_PERCENT): Promise<EdgeScanResult> {
    const markets = await this.markets.getWeatherMarkets({ activeOnly: true });

    const edges: WeatherEdge[] = [];

    for (const market of markets) {
      try {
        const edge = await this.calculateEdge(market);

        if (Math.abs(edge.edgePercent) >= minEdgePercent && edge.recommendation !== 'SKIP') {
          edges.push(edge);
        }
      } catch (error) {
        logger.warn(`[EdgeCalc] Failed to calculate edge for ${market.id}:`, error);
      }
    }

    // Sort by absolute edge (best opportunities first)
    edges.sort((a, b) => Math.abs(b.edgePercent) - Math.abs(a.edgePercent));

    return {
      scannedAt: new Date(),
      totalMarkets: markets.length,
      marketsWithEdge: edges.length,
      topOpportunities: edges.slice(0, 10),
    };
  }

  /**
   * Get bet recommendation with position sizing
   */
  getBetRecommendation(
    edge: WeatherEdge,
    bankroll: number = 100
  ): BetRecommendation | null {
    if (edge.recommendation === 'SKIP') return null;

    const side = edge.recommendation;
    const edgeDecimal = Math.abs(edge.edge);

    // Kelly criterion: f = (bp - q) / b
    // Where b = decimal odds - 1, p = probability, q = 1 - p
    // Simplified for binary markets: f = edge / odds
    const odds = side === 'YES' ? edge.marketPrice : (1 - edge.marketPrice);
    if (odds <= 0 || odds >= 1) return null;
    const kellyFraction = edgeDecimal / (1 - odds);

    // Use fractional Kelly for safety
    const adjustedKelly = Math.min(kellyFraction * KELLY_FRACTION, 0.1); // Cap at 10%
    const suggestedAmount = Math.max(bankroll * adjustedKelly, 1); // Minimum $1

    // Expected value
    const winProb = side === 'YES' ? edge.noaaProbability / 100 : 1 - edge.noaaProbability / 100;
    const winPayout = suggestedAmount / odds - suggestedAmount;
    const lossPayout = -suggestedAmount;
    const expectedValue = winProb * winPayout + (1 - winProb) * lossPayout;

    return {
      market: edge.market,
      side,
      edge: edge.edgePercent,
      suggestedAmount: Math.round(suggestedAmount * 100) / 100,
      kellyFraction: adjustedKelly,
      expectedValue: Math.round(expectedValue * 100) / 100,
    };
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Get forecast for a specific date
   */
  private async getForecastForDate(
    lat: number,
    lon: number,
    targetDate: Date
  ): Promise<ForecastPeriod | null> {
    const forecast = await this.noaa.getForecast(lat, lon);

    for (const period of forecast.periods) {
      const periodStart = new Date(period.startTime);
      const periodEnd = new Date(period.endTime);

      if (targetDate >= periodStart && targetDate < periodEnd) {
        return period;
      }
    }

    // If exact match not found, find closest
    const targetTime = targetDate.getTime();
    let closest: ForecastPeriod | null = null;
    let closestDiff = Infinity;

    for (const period of forecast.periods) {
      const periodStart = new Date(period.startTime).getTime();
      const diff = Math.abs(periodStart - targetTime);

      if (diff < closestDiff) {
        closestDiff = diff;
        closest = period;
      }
    }

    return closest;
  }

  /**
   * Calculate NOAA probability based on market type and forecast
   */
  private calculateNOAAProbability(market: WeatherMarket, forecast: ForecastPeriod): number {
    switch (market.metric) {
      case 'temperature':
        return this.calculateTempProbability(market, forecast);
      case 'precipitation':
        return this.calculatePrecipProbability(market, forecast);
      case 'snow':
        return this.calculateSnowProbability(market, forecast);
      default:
        return 50; // Default for unknown metrics
    }
  }

  /**
   * Calculate temperature probability
   */
  private calculateTempProbability(market: WeatherMarket, forecast: ForecastPeriod): number {
    if (!market.threshold) return 50;

    const temp = forecast.temperature;
    const threshold = market.threshold;
    const comparison = market.comparison || 'above';

    // Temperature forecasts are usually accurate within +/- 3°F
    const accuracy = 3;

    if (comparison === 'above') {
      // Probability of exceeding threshold
      if (temp >= threshold + accuracy) return 95;
      if (temp >= threshold) return 75;
      if (temp >= threshold - accuracy) return 50;
      if (temp >= threshold - accuracy * 2) return 25;
      return 5;
    } else {
      // Probability of being below threshold
      if (temp <= threshold - accuracy) return 95;
      if (temp <= threshold) return 75;
      if (temp <= threshold + accuracy) return 50;
      if (temp <= threshold + accuracy * 2) return 25;
      return 5;
    }
  }

  /**
   * Calculate precipitation probability
   */
  private calculatePrecipProbability(market: WeatherMarket, forecast: ForecastPeriod): number {
    // NOAA provides precipitation probability directly
    const noaaProb = forecast.probabilityOfPrecipitation.value;

    if (noaaProb === null) return 50;

    // If market is about "will it rain", use NOAA probability directly
    if (!market.threshold) {
      return noaaProb;
    }

    // If market has amount threshold (e.g., "more than 1 inch")
    // Adjust probability based on amount (rough heuristic)
    const threshold = market.threshold;

    // Higher amounts are less likely
    if (threshold >= 2) return Math.min(noaaProb * 0.3, 30);
    if (threshold >= 1) return Math.min(noaaProb * 0.5, 50);
    if (threshold >= 0.5) return Math.min(noaaProb * 0.7, 70);

    return noaaProb;
  }

  /**
   * Calculate snow probability
   */
  private calculateSnowProbability(market: WeatherMarket, forecast: ForecastPeriod): number {
    const temp = forecast.temperature;
    const precipProb = forecast.probabilityOfPrecipitation.value ?? 0;

    // Snow requires cold temps and precipitation
    if (temp > 40) return 5;
    if (temp > 35) return precipProb * 0.2;
    if (temp > 32) return precipProb * 0.5;
    if (temp > 28) return precipProb * 0.8;

    return precipProb * 0.9;
  }
}

// ============================================================================
// Factory
// ============================================================================

let edgeCalculatorInstance: WeatherEdgeCalculator | null = null;

export function getWeatherEdgeCalculator(): WeatherEdgeCalculator {
  if (!edgeCalculatorInstance) {
    edgeCalculatorInstance = new WeatherEdgeCalculator();
  }
  return edgeCalculatorInstance;
}
