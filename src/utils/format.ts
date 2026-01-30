/**
 * Message formatting utilities
 */

import type { Market, ArbitrageOpportunity } from '../types';

export function formatPrice(price: number): string {
  return `${Math.round(price * 100)}¢`;
}

export function formatPercent(value: number, decimals = 1): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(decimals)}%`;
}

export function formatMarket(market: Market): string {
  const outcomes = market.outcomes
    .map((o) => `  ${o.name}: ${formatPrice(o.price)}`)
    .join('\n');

  let text = `**${market.question}**\n`;
  text += `Platform: ${market.platform}\n`;
  text += outcomes;

  if (market.volume24h > 0) {
    text += `\nVolume (24h): $${formatNumber(market.volume24h)}`;
  }

  if (market.liquidity > 0) {
    text += `\nLiquidity: $${formatNumber(market.liquidity)}`;
  }

  text += `\n[View](${market.url})`;

  return text;
}

export function formatMarketShort(market: Market): string {
  const price = market.outcomes[0]?.price ?? 0;
  return `${market.question} - ${formatPrice(price)} (${market.platform})`;
}

export function formatArbitrage(opp: ArbitrageOpportunity): string {
  let text = `**Arbitrage Found** (${opp.mode})\n`;
  text += `${opp.marketQuestion ?? opp.marketId}\n`;
  text += `Platform: ${opp.platform}\n`;
  text += `Yes: ${formatPrice(opp.yesPrice)} | No: ${formatPrice(opp.noPrice)}\n`;
  text += `Sum: ${formatPrice(opp.yesPrice + opp.noPrice)}\n`;
  text += `**Edge: ${formatPercent(opp.edgePct)}**`;

  return text;
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toFixed(0);
}

export function formatKelly(
  marketPrice: number,
  estimatedProb: number,
  bankroll: number
): string {
  // Kelly formula: f* = (bp - q) / b
  // where b = odds, p = win prob, q = lose prob
  const edge = estimatedProb - marketPrice;
  const odds = 1 / marketPrice - 1; // convert to decimal odds
  const kellyFraction = (odds * estimatedProb - (1 - estimatedProb)) / odds;

  // Cap at 25% (quarter Kelly for safety)
  const safeFraction = Math.max(0, Math.min(0.25, kellyFraction / 4));
  const betSize = bankroll * safeFraction;

  let text = `**Kelly Analysis**\n`;
  text += `Market price: ${formatPrice(marketPrice)}\n`;
  text += `Your estimate: ${formatPrice(estimatedProb)}\n`;
  text += `Edge: ${formatPercent(edge)}\n`;
  text += `Full Kelly: ${formatPercent(kellyFraction)}\n`;
  text += `Quarter Kelly (recommended): ${formatPercent(safeFraction)}\n`;
  text += `Bet size: $${betSize.toFixed(2)}`;

  return text;
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

// Telegram markdown escaping
export function escapeTelegramMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// Discord markdown escaping
export function escapeDiscordMarkdown(text: string): string {
  return text.replace(/([*_~`|\\])/g, '\\$1');
}
