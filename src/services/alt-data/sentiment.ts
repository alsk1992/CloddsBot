/**
 * Sentiment Analyzer — Weighted keyword scoring engine
 *
 * Scores alt-data events from -1 (very bearish) to +1 (very bullish).
 * Handles negation, category detection, and special numeric sources
 * (Fear & Greed index, funding rates).
 *
 * Fast and free — keyword matching runs in <1ms per event.
 */

import type { AltDataEvent, SentimentAnalyzer, SentimentLabel, SentimentResult } from './types.js';

// ── Keyword dictionaries ───────────────────────────────────────────────────

interface KeywordEntry {
  word: string;
  weight: number;
  direction: 'bullish' | 'bearish';
  category: string;
}

const KEYWORDS: KeywordEntry[] = [
  // Politics
  { word: 'win', weight: 0.5, direction: 'bullish', category: 'politics' },
  { word: 'wins', weight: 0.5, direction: 'bullish', category: 'politics' },
  { word: 'winning', weight: 0.4, direction: 'bullish', category: 'politics' },
  { word: 'victory', weight: 0.6, direction: 'bullish', category: 'politics' },
  { word: 'elected', weight: 0.6, direction: 'bullish', category: 'politics' },
  { word: 'landslide', weight: 0.7, direction: 'bullish', category: 'politics' },
  { word: 'lead', weight: 0.3, direction: 'bullish', category: 'politics' },
  { word: 'leading', weight: 0.3, direction: 'bullish', category: 'politics' },
  { word: 'ahead', weight: 0.3, direction: 'bullish', category: 'politics' },
  { word: 'surge', weight: 0.5, direction: 'bullish', category: 'politics' },
  { word: 'surging', weight: 0.5, direction: 'bullish', category: 'politics' },
  { word: 'loss', weight: 0.5, direction: 'bearish', category: 'politics' },
  { word: 'lose', weight: 0.5, direction: 'bearish', category: 'politics' },
  { word: 'losing', weight: 0.4, direction: 'bearish', category: 'politics' },
  { word: 'defeat', weight: 0.6, direction: 'bearish', category: 'politics' },
  { word: 'scandal', weight: 0.6, direction: 'bearish', category: 'politics' },
  { word: 'indictment', weight: 0.8, direction: 'bearish', category: 'politics' },
  { word: 'indicted', weight: 0.8, direction: 'bearish', category: 'politics' },
  { word: 'impeach', weight: 0.7, direction: 'bearish', category: 'politics' },
  { word: 'resign', weight: 0.7, direction: 'bearish', category: 'politics' },
  { word: 'drop out', weight: 0.8, direction: 'bearish', category: 'politics' },
  { word: 'trailing', weight: 0.4, direction: 'bearish', category: 'politics' },
  { word: 'behind', weight: 0.3, direction: 'bearish', category: 'politics' },
  { word: 'endorsement', weight: 0.4, direction: 'bullish', category: 'politics' },
  { word: 'endorsed', weight: 0.4, direction: 'bullish', category: 'politics' },

  // Crypto
  { word: 'bullish', weight: 0.6, direction: 'bullish', category: 'crypto' },
  { word: 'moon', weight: 0.5, direction: 'bullish', category: 'crypto' },
  { word: 'pump', weight: 0.5, direction: 'bullish', category: 'crypto' },
  { word: 'pumping', weight: 0.5, direction: 'bullish', category: 'crypto' },
  { word: 'rally', weight: 0.5, direction: 'bullish', category: 'crypto' },
  { word: 'breakout', weight: 0.5, direction: 'bullish', category: 'crypto' },
  { word: 'all-time high', weight: 0.7, direction: 'bullish', category: 'crypto' },
  { word: 'ath', weight: 0.6, direction: 'bullish', category: 'crypto' },
  { word: 'adoption', weight: 0.4, direction: 'bullish', category: 'crypto' },
  { word: 'etf approved', weight: 0.8, direction: 'bullish', category: 'crypto' },
  { word: 'institutional', weight: 0.3, direction: 'bullish', category: 'crypto' },
  { word: 'bearish', weight: 0.6, direction: 'bearish', category: 'crypto' },
  { word: 'crash', weight: 0.7, direction: 'bearish', category: 'crypto' },
  { word: 'dump', weight: 0.6, direction: 'bearish', category: 'crypto' },
  { word: 'dumping', weight: 0.6, direction: 'bearish', category: 'crypto' },
  { word: 'liquidation', weight: 0.6, direction: 'bearish', category: 'crypto' },
  { word: 'liquidated', weight: 0.6, direction: 'bearish', category: 'crypto' },
  { word: 'hack', weight: 0.7, direction: 'bearish', category: 'crypto' },
  { word: 'hacked', weight: 0.7, direction: 'bearish', category: 'crypto' },
  { word: 'exploit', weight: 0.6, direction: 'bearish', category: 'crypto' },
  { word: 'rug pull', weight: 0.8, direction: 'bearish', category: 'crypto' },
  { word: 'ban', weight: 0.6, direction: 'bearish', category: 'crypto' },
  { word: 'banned', weight: 0.6, direction: 'bearish', category: 'crypto' },
  { word: 'regulation', weight: 0.3, direction: 'bearish', category: 'crypto' },
  { word: 'sec lawsuit', weight: 0.7, direction: 'bearish', category: 'crypto' },
  { word: 'delisting', weight: 0.6, direction: 'bearish', category: 'crypto' },

  // Economics
  { word: 'rate cut', weight: 0.7, direction: 'bullish', category: 'economics' },
  { word: 'rate cuts', weight: 0.7, direction: 'bullish', category: 'economics' },
  { word: 'dovish', weight: 0.5, direction: 'bullish', category: 'economics' },
  { word: 'soft landing', weight: 0.6, direction: 'bullish', category: 'economics' },
  { word: 'growth', weight: 0.3, direction: 'bullish', category: 'economics' },
  { word: 'jobs added', weight: 0.4, direction: 'bullish', category: 'economics' },
  { word: 'stimulus', weight: 0.5, direction: 'bullish', category: 'economics' },
  { word: 'recovery', weight: 0.4, direction: 'bullish', category: 'economics' },
  { word: 'rate hike', weight: 0.6, direction: 'bearish', category: 'economics' },
  { word: 'rate hikes', weight: 0.6, direction: 'bearish', category: 'economics' },
  { word: 'hawkish', weight: 0.5, direction: 'bearish', category: 'economics' },
  { word: 'recession', weight: 0.7, direction: 'bearish', category: 'economics' },
  { word: 'inflation', weight: 0.4, direction: 'bearish', category: 'economics' },
  { word: 'unemployment', weight: 0.4, direction: 'bearish', category: 'economics' },
  { word: 'layoffs', weight: 0.5, direction: 'bearish', category: 'economics' },
  { word: 'default', weight: 0.7, direction: 'bearish', category: 'economics' },
  { word: 'debt ceiling', weight: 0.4, direction: 'bearish', category: 'economics' },
  { word: 'shutdown', weight: 0.5, direction: 'bearish', category: 'economics' },
  { word: 'tariff', weight: 0.4, direction: 'bearish', category: 'economics' },
  { word: 'tariffs', weight: 0.4, direction: 'bearish', category: 'economics' },
  { word: 'trade war', weight: 0.6, direction: 'bearish', category: 'economics' },

  // Geopolitical
  { word: 'ceasefire', weight: 0.6, direction: 'bullish', category: 'geopolitical' },
  { word: 'peace', weight: 0.5, direction: 'bullish', category: 'geopolitical' },
  { word: 'peace deal', weight: 0.7, direction: 'bullish', category: 'geopolitical' },
  { word: 'de-escalation', weight: 0.5, direction: 'bullish', category: 'geopolitical' },
  { word: 'agreement', weight: 0.3, direction: 'bullish', category: 'geopolitical' },
  { word: 'war', weight: 0.6, direction: 'bearish', category: 'geopolitical' },
  { word: 'invasion', weight: 0.7, direction: 'bearish', category: 'geopolitical' },
  { word: 'missile', weight: 0.5, direction: 'bearish', category: 'geopolitical' },
  { word: 'sanctions', weight: 0.5, direction: 'bearish', category: 'geopolitical' },
  { word: 'escalation', weight: 0.5, direction: 'bearish', category: 'geopolitical' },
  { word: 'conflict', weight: 0.4, direction: 'bearish', category: 'geopolitical' },
  { word: 'attack', weight: 0.5, direction: 'bearish', category: 'geopolitical' },
  { word: 'nuclear', weight: 0.7, direction: 'bearish', category: 'geopolitical' },
  { word: 'terror', weight: 0.6, direction: 'bearish', category: 'geopolitical' },
  { word: 'terrorism', weight: 0.6, direction: 'bearish', category: 'geopolitical' },

  // Sports
  { word: 'injury', weight: 0.5, direction: 'bearish', category: 'sports' },
  { word: 'injured', weight: 0.5, direction: 'bearish', category: 'sports' },
  { word: 'out for season', weight: 0.8, direction: 'bearish', category: 'sports' },
  { word: 'suspended', weight: 0.6, direction: 'bearish', category: 'sports' },
  { word: 'traded', weight: 0.4, direction: 'bearish', category: 'sports' },
  { word: 'comeback', weight: 0.5, direction: 'bullish', category: 'sports' },
  { word: 'signed', weight: 0.4, direction: 'bullish', category: 'sports' },
  { word: 'mvp', weight: 0.5, direction: 'bullish', category: 'sports' },
  { word: 'streak', weight: 0.4, direction: 'bullish', category: 'sports' },
  { word: 'undefeated', weight: 0.5, direction: 'bullish', category: 'sports' },

  // General sentiment
  { word: 'confirmed', weight: 0.4, direction: 'bullish', category: 'general' },
  { word: 'approved', weight: 0.5, direction: 'bullish', category: 'general' },
  { word: 'passed', weight: 0.4, direction: 'bullish', category: 'general' },
  { word: 'breakthrough', weight: 0.6, direction: 'bullish', category: 'general' },
  { word: 'denied', weight: 0.4, direction: 'bearish', category: 'general' },
  { word: 'rejected', weight: 0.5, direction: 'bearish', category: 'general' },
  { word: 'failed', weight: 0.5, direction: 'bearish', category: 'general' },
  { word: 'collapse', weight: 0.7, direction: 'bearish', category: 'general' },
  { word: 'crisis', weight: 0.6, direction: 'bearish', category: 'general' },
  { word: 'catastrophe', weight: 0.7, direction: 'bearish', category: 'general' },
  { word: 'disaster', weight: 0.6, direction: 'bearish', category: 'general' },
];

// Negation words that flip polarity
const NEGATION_WORDS = new Set([
  'not', 'no', "n't", 'never', 'neither', 'nor', 'unlikely', 'won\'t',
  'cannot', "can't", 'doubt',
]);

// Confidence threshold — total matched weight needed for confidence = 1.0
const CONFIDENCE_THRESHOLD = 1.5;

// Max text length to score (truncate longer text to avoid perf issues)
const MAX_TEXT_LENGTH = 2000;

// ── Helpers ────────────────────────────────────────────────────────────────

function scoreToLabel(score: number): SentimentLabel {
  if (score <= -0.5) return 'very_bearish';
  if (score <= -0.15) return 'bearish';
  if (score >= 0.5) return 'very_bullish';
  if (score >= 0.15) return 'bullish';
  return 'neutral';
}

function detectCategory(matched: KeywordEntry[]): string {
  // Category from most frequent matched keyword category
  const counts: Record<string, number> = {};
  for (const entry of matched) {
    counts[entry.category] = (counts[entry.category] ?? 0) + entry.weight;
  }

  let best = 'general';
  let bestWeight = 0;
  for (const [cat, weight] of Object.entries(counts)) {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = cat;
    }
  }

  return best;
}

function isNegated(text: string, wordIndex: number): boolean {
  // Look at the 3 words before the matched keyword for negation
  const before = text.slice(0, wordIndex).toLowerCase();
  const precedingWords = before.split(/\s+/).slice(-3);
  return precedingWords.some((w) => NEGATION_WORDS.has(w));
}

// ── Numeric source handlers ────────────────────────────────────────────────

function scoreFearGreed(value: number): SentimentResult {
  // Fear & Greed Index: 0 = Extreme Fear, 100 = Extreme Greed
  const normalized = Math.max(0, Math.min(100, value));
  const score = (normalized - 50) / 50; // Map 0-100 → -1 to +1

  return {
    score,
    confidence: 0.7, // Numeric data → higher baseline confidence
    label: scoreToLabel(score),
    matchedKeywords: [`fear_greed:${normalized}`],
    category: 'crypto',
  };
}

function scoreFundingRate(value: number): SentimentResult {
  // Funding rates: positive = crowded long (contrarian bearish)
  //                negative = crowded short (contrarian bullish)
  // Value arrives as percentage (Binance raw rate * 100).
  // Normal range: ±0.01%, elevated: 0.01-0.03%, extreme: >0.03%

  // Contrarian signal: extreme longs → bearish, extreme shorts → bullish
  let score: number;
  let confidence: number;

  const absRate = Math.abs(value);
  if (absRate < 0.01) {
    // Normal range — weak signal
    score = -value * 10; // Small contrarian
    confidence = 0.2;
  } else if (absRate < 0.03) {
    // Elevated — moderate signal
    score = -Math.sign(value) * 0.4;
    confidence = 0.5;
  } else {
    // Extreme — strong contrarian signal
    score = -Math.sign(value) * 0.7;
    confidence = 0.8;
  }

  return {
    score,
    confidence,
    label: scoreToLabel(score),
    matchedKeywords: [`funding_rate:${value.toFixed(4)}`],
    category: 'crypto',
  };
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createSentimentAnalyzer(): SentimentAnalyzer {
  // Pre-process keywords for fast lookup (lowercase, sorted by length desc for multi-word first)
  const sortedKeywords = [...KEYWORDS].sort((a, b) => b.word.length - a.word.length);

  function analyze(event: AltDataEvent): SentimentResult {
    // Handle numeric sources directly
    if (event.source === 'fear_greed' && event.numericValue !== undefined) {
      return scoreFearGreed(event.numericValue);
    }
    if (event.source === 'funding_rate' && event.numericValue !== undefined) {
      return scoreFundingRate(event.numericValue);
    }

    // Text-based scoring (truncate to cap processing time)
    const text = `${event.text} ${event.body ?? ''}`.toLowerCase().slice(0, MAX_TEXT_LENGTH);
    const matchedEntries: KeywordEntry[] = [];
    const matchedKeywords: string[] = [];
    let bullishSum = 0;
    let bearishSum = 0;
    let totalWeight = 0;

    for (const entry of sortedKeywords) {
      const idx = text.indexOf(entry.word);
      if (idx === -1) continue;

      // Check word boundary (avoid matching "win" in "window" or "rate cut" in "irate cutting")
      const charBefore = idx > 0 ? text[idx - 1] : ' ';
      const charAfter = idx + entry.word.length < text.length ? text[idx + entry.word.length] : ' ';
      if (/\w/.test(charBefore) || /\w/.test(charAfter)) continue;

      matchedEntries.push(entry);
      matchedKeywords.push(entry.word);

      let direction = entry.direction;
      // Check negation
      if (isNegated(text, idx)) {
        direction = direction === 'bullish' ? 'bearish' : 'bullish';
      }

      if (direction === 'bullish') {
        bullishSum += entry.weight;
      } else {
        bearishSum += entry.weight;
      }
      totalWeight += entry.weight;
    }

    // Normalize score to [-1, +1]
    const rawDiff = bullishSum - bearishSum;
    const maxPossible = Math.max(totalWeight, 1);
    const score = Math.max(-1, Math.min(1, rawDiff / maxPossible));

    // Confidence based on total matched weight
    const confidence = Math.min(1, totalWeight / CONFIDENCE_THRESHOLD);

    const category = detectCategory(matchedEntries);

    return {
      score,
      confidence,
      label: scoreToLabel(score),
      matchedKeywords,
      category,
    };
  }

  return { analyze };
}
