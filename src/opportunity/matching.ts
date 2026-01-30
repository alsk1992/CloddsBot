/**
 * Market Matching - Semantic and text-based market matching across platforms
 *
 * Features:
 * - Embedding-based semantic similarity
 * - Text normalization and token matching
 * - Manual link overrides
 * - Caching for performance
 * - Configurable similarity thresholds
 */

import type { Database } from '../db/index';
import type { EmbeddingsService } from '../embeddings/index';
import type { Platform, Market } from '../types';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface MarketMatcherConfig {
  /** Enable semantic matching (requires embeddings service) */
  semanticEnabled?: boolean;
  /** Similarity threshold (0-1) for semantic matching */
  similarityThreshold?: number;
  /** Minimum token overlap for text matching */
  minTokenOverlap?: number;
  /** Cache TTL in ms */
  cacheTtlMs?: number;
}

export interface MarketMatch {
  /** Canonical ID for this match group */
  canonicalId: string;
  /** All matched markets */
  markets: Array<{ platform: Platform; market: Market }>;
  /** Similarity score (0-1) */
  similarity: number;
  /** Match method used */
  method: 'semantic' | 'text' | 'manual' | 'slug';
  /** Normalized question */
  normalizedQuestion: string;
  /** Verification result if semantic/text matching was used */
  verification?: MatchVerification;
  /** Whether this match needs human review before arbitrage */
  needsReview?: boolean;
}

export interface MarketMatcher {
  /** Find matching markets across platforms */
  findMatches(
    markets: Array<{ platform: Platform; market: Market }>
  ): Promise<MarketMatch[]>;

  /** Check if two markets match */
  areMatching(
    marketA: { platform: Platform; market: Market },
    marketB: { platform: Platform; market: Market }
  ): Promise<{ matches: boolean; similarity: number; method: string }>;

  /** Add manual link */
  addManualLink(marketA: string, marketB: string): void;

  /** Remove manual link */
  removeManualLink(marketA: string, marketB: string): void;

  /** Get embedding for a market question */
  getEmbedding(question: string): Promise<number[] | null>;

  /** Clear cache */
  clearCache(): void;

  /** Verify that a semantic match is actually about the same question */
  verifyMatch(
    marketA: { platform: Platform; market: Market },
    marketB: { platform: Platform; market: Market }
  ): Promise<MatchVerification>;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_CONFIG: Required<MarketMatcherConfig> = {
  semanticEnabled: true,
  similarityThreshold: 0.85,
  minTokenOverlap: 0.6,
  cacheTtlMs: 300000, // 5 minutes
};

// Common stop words to ignore
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'will', 'be', 'is', 'are', 'was', 'were', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or',
  'because', 'until', 'while', 'this', 'that', 'these', 'those', 'what',
]);

// Critical entities that MUST match for verification
const CRITICAL_ENTITY_TYPES = ['date', 'threshold', 'person', 'team', 'year'] as const;

export interface MatchVerification {
  /** Whether the match is verified */
  verified: boolean;
  /** Confidence score (0-1) */
  confidence: number;
  /** Warnings about potential mismatches */
  warnings: string[];
  /** Critical entities extracted from both questions */
  entities: {
    a: ExtractedEntities;
    b: ExtractedEntities;
  };
  /** Whether human review is recommended */
  needsReview: boolean;
}

export interface ExtractedEntities {
  dates: string[];
  years: string[];
  thresholds: string[];
  persons: string[];
  teams: string[];
  numbers: string[];
}

// Entity normalization patterns
const ENTITY_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Dates
  { pattern: /\b(jan|january)\b/gi, replacement: 'january' },
  { pattern: /\b(feb|february)\b/gi, replacement: 'february' },
  { pattern: /\b(mar|march)\b/gi, replacement: 'march' },
  { pattern: /\b(apr|april)\b/gi, replacement: 'april' },
  { pattern: /\b(jun|june)\b/gi, replacement: 'june' },
  { pattern: /\b(jul|july)\b/gi, replacement: 'july' },
  { pattern: /\b(aug|august)\b/gi, replacement: 'august' },
  { pattern: /\b(sep|sept|september)\b/gi, replacement: 'september' },
  { pattern: /\b(oct|october)\b/gi, replacement: 'october' },
  { pattern: /\b(nov|november)\b/gi, replacement: 'november' },
  { pattern: /\b(dec|december)\b/gi, replacement: 'december' },
  // Common entities
  { pattern: /\b(us|u\.s\.|united states)\b/gi, replacement: 'us' },
  { pattern: /\b(uk|u\.k\.|united kingdom|britain)\b/gi, replacement: 'uk' },
  { pattern: /\b(fed|federal reserve|fomc)\b/gi, replacement: 'fed' },
  { pattern: /\b(gdp|gross domestic product)\b/gi, replacement: 'gdp' },
  { pattern: /\b(cpi|consumer price index)\b/gi, replacement: 'cpi' },
  // Numbers
  { pattern: /(\d+)\s*%/g, replacement: '$1percent' },
  { pattern: /\$(\d+)/g, replacement: '$1dollars' },
  { pattern: /(\d+)\s*(bp|bps|basis points?)/gi, replacement: '$1bp' },
];

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createMarketMatcher(
  db: Database,
  embeddings?: EmbeddingsService,
  config: MarketMatcherConfig = {}
): MarketMatcher {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Manual links
  const manualLinks = new Map<string, Set<string>>();

  // Embedding cache
  const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();

  // Load manual links from DB
  loadManualLinks();

  function loadManualLinks(): void {
    try {
      const rows = db.query<{ market_a: string; market_b: string }>(
        'SELECT market_a, market_b FROM market_links WHERE source = ?',
        ['manual']
      );

      for (const row of rows) {
        addToLinkSet(row.market_a, row.market_b);
      }

      logger.debug({ count: rows.length }, 'Loaded manual market links');
    } catch (error) {
      logger.warn({ error }, 'Failed to load manual links');
    }
  }

  function addToLinkSet(a: string, b: string): void {
    if (!manualLinks.has(a)) manualLinks.set(a, new Set());
    if (!manualLinks.has(b)) manualLinks.set(b, new Set());
    manualLinks.get(a)!.add(b);
    manualLinks.get(b)!.add(a);
  }

  function removeFromLinkSet(a: string, b: string): void {
    manualLinks.get(a)?.delete(b);
    manualLinks.get(b)?.delete(a);
  }

  // ===========================================================================
  // NORMALIZATION
  // ===========================================================================

  function normalizeQuestion(question: string): string {
    let normalized = question.toLowerCase().trim();

    // Apply entity patterns
    for (const { pattern, replacement } of ENTITY_PATTERNS) {
      normalized = normalized.replace(pattern, replacement);
    }

    // Remove punctuation except numbers
    normalized = normalized.replace(/[^\w\s\d]/g, ' ');

    // Normalize whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
  }

  function tokenize(text: string): string[] {
    const normalized = normalizeQuestion(text);
    return normalized
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  }

  function generateCanonicalId(question: string): string {
    const tokens = tokenize(question).slice(0, 8);
    return tokens.join('_');
  }

  // ===========================================================================
  // ENTITY EXTRACTION FOR VERIFICATION
  // ===========================================================================

  function extractEntities(question: string): ExtractedEntities {
    const text = question.toLowerCase();
    const entities: ExtractedEntities = {
      dates: [],
      years: [],
      thresholds: [],
      persons: [],
      teams: [],
      numbers: [],
    };

    // Extract years (2020-2030)
    const yearMatches = text.match(/\b(20[2-3]\d)\b/g);
    if (yearMatches) entities.years = [...new Set(yearMatches)];

    // Extract month-year combinations
    const monthYearRegex = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(?:\.?\s*)?(20[2-3]\d)?\b/gi;
    const dateMatches = text.matchAll(monthYearRegex);
    for (const match of dateMatches) {
      const month = match[1].toLowerCase().slice(0, 3);
      const year = match[2] || '';
      entities.dates.push(`${month}${year}`);
    }

    // Extract specific dates (e.g., "January 20", "Jan 1st")
    const specificDateRegex = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;
    const specificDateMatches = text.matchAll(specificDateRegex);
    for (const match of specificDateMatches) {
      entities.dates.push(`${match[1].slice(0, 3)}${match[2]}`);
    }

    // Extract thresholds/percentages
    const thresholdRegex = /(\d+(?:\.\d+)?)\s*(%|percent|bp|bps|basis\s*points?)/gi;
    const thresholdMatches = text.matchAll(thresholdRegex);
    for (const match of thresholdMatches) {
      entities.thresholds.push(`${match[1]}${match[2].toLowerCase().replace(/basis\s*points?/, 'bp')}`);
    }

    // Extract dollar amounts
    const dollarRegex = /\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|b|trillion|billion|million|thousand)?/gi;
    const dollarMatches = text.matchAll(dollarRegex);
    for (const match of dollarMatches) {
      const num = match[1].replace(/,/g, '');
      const suffix = match[2] ? match[2].toLowerCase()[0] : '';
      entities.thresholds.push(`$${num}${suffix}`);
    }

    // Extract numbers generally
    const numberMatches = text.match(/\b\d+(?:\.\d+)?\b/g);
    if (numberMatches) {
      entities.numbers = [...new Set(numberMatches)].slice(0, 10);
    }

    // Extract common politician/celebrity names (simplified list)
    const personPatterns = [
      /\b(trump|biden|harris|obama|desantis|pence|vance|newsom|haley|ramaswamy)\b/gi,
      /\b(musk|bezos|gates|zuckerberg|altman|powell|yellen)\b/gi,
      /\b(putin|xi|zelensky|modi|macron|sunak|starmer)\b/gi,
    ];
    for (const pattern of personPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        entities.persons.push(...matches.map((m) => m.toLowerCase()));
      }
    }
    entities.persons = [...new Set(entities.persons)];

    // Extract team names (sports)
    const teamPatterns = [
      /\b(chiefs|eagles|49ers|ravens|lions|cowboys|packers|bills|dolphins|jets)\b/gi,
      /\b(lakers|celtics|warriors|bucks|nuggets|suns|heat|76ers|knicks|nets)\b/gi,
      /\b(yankees|dodgers|braves|astros|phillies|rangers|diamondbacks|cubs)\b/gi,
    ];
    for (const pattern of teamPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        entities.teams.push(...matches.map((m) => m.toLowerCase()));
      }
    }
    entities.teams = [...new Set(entities.teams)];

    return entities;
  }

  function compareEntitySets(a: string[], b: string[]): { match: boolean; missing: string[] } {
    if (a.length === 0 && b.length === 0) {
      return { match: true, missing: [] };
    }

    const setA = new Set(a);
    const setB = new Set(b);

    // Check if all items in A are in B and vice versa
    const missingFromB = a.filter((x) => !setB.has(x));
    const missingFromA = b.filter((x) => !setA.has(x));

    const allMissing = [...missingFromB, ...missingFromA];
    return {
      match: allMissing.length === 0,
      missing: allMissing,
    };
  }

  async function verifyMatch(
    marketA: { platform: Platform; market: Market },
    marketB: { platform: Platform; market: Market }
  ): Promise<MatchVerification> {
    const questionA = marketA.market.question;
    const questionB = marketB.market.question;

    const entitiesA = extractEntities(questionA);
    const entitiesB = extractEntities(questionB);

    const warnings: string[] = [];
    let confidence = 1.0;
    let needsReview = false;

    // Check year mismatch (critical)
    const yearComparison = compareEntitySets(entitiesA.years, entitiesB.years);
    if (!yearComparison.match && (entitiesA.years.length > 0 || entitiesB.years.length > 0)) {
      warnings.push(`Year mismatch: ${entitiesA.years.join(',')} vs ${entitiesB.years.join(',')}`);
      confidence -= 0.5; // Major penalty
      needsReview = true;
    }

    // Check date mismatch (critical)
    const dateComparison = compareEntitySets(entitiesA.dates, entitiesB.dates);
    if (!dateComparison.match && (entitiesA.dates.length > 0 || entitiesB.dates.length > 0)) {
      warnings.push(`Date mismatch: ${entitiesA.dates.join(',')} vs ${entitiesB.dates.join(',')}`);
      confidence -= 0.4;
      needsReview = true;
    }

    // Check threshold mismatch (critical for price/percentage markets)
    const thresholdComparison = compareEntitySets(entitiesA.thresholds, entitiesB.thresholds);
    if (!thresholdComparison.match && (entitiesA.thresholds.length > 0 || entitiesB.thresholds.length > 0)) {
      warnings.push(`Threshold mismatch: ${entitiesA.thresholds.join(',')} vs ${entitiesB.thresholds.join(',')}`);
      confidence -= 0.4;
      needsReview = true;
    }

    // Check person mismatch
    const personComparison = compareEntitySets(entitiesA.persons, entitiesB.persons);
    if (!personComparison.match && (entitiesA.persons.length > 0 || entitiesB.persons.length > 0)) {
      warnings.push(`Person mismatch: ${entitiesA.persons.join(',')} vs ${entitiesB.persons.join(',')}`);
      confidence -= 0.3;
      needsReview = true;
    }

    // Check team mismatch
    const teamComparison = compareEntitySets(entitiesA.teams, entitiesB.teams);
    if (!teamComparison.match && (entitiesA.teams.length > 0 || entitiesB.teams.length > 0)) {
      warnings.push(`Team mismatch: ${entitiesA.teams.join(',')} vs ${entitiesB.teams.join(',')}`);
      confidence -= 0.3;
    }

    // Check for significant number differences
    const numericDiff = checkNumericDifference(entitiesA.numbers, entitiesB.numbers);
    if (numericDiff) {
      warnings.push(numericDiff);
      confidence -= 0.2;
    }

    // Clamp confidence
    confidence = Math.max(0, Math.min(1, confidence));

    // Verified if confidence is high enough
    const verified = confidence >= 0.7 && warnings.length < 2;

    return {
      verified,
      confidence,
      warnings,
      entities: { a: entitiesA, b: entitiesB },
      needsReview,
    };
  }

  function checkNumericDifference(numsA: string[], numsB: string[]): string | null {
    // Look for significant number differences that could indicate different questions
    const setA = new Set(numsA.map(Number).filter((n) => !isNaN(n)));
    const setB = new Set(numsB.map(Number).filter((n) => !isNaN(n)));

    // Only flag if there are specific numbers that differ significantly
    const uniqueToA = [...setA].filter((n) => {
      // Check if there's a close number in B
      return ![...setB].some((b) => Math.abs(n - b) / Math.max(n, b) < 0.1);
    });

    const uniqueToB = [...setB].filter((n) => {
      return ![...setA].some((a) => Math.abs(n - a) / Math.max(n, a) < 0.1);
    });

    if (uniqueToA.length > 0 && uniqueToB.length > 0) {
      return `Different key numbers: ${uniqueToA.join(',')} vs ${uniqueToB.join(',')}`;
    }

    return null;
  }

  // ===========================================================================
  // SIMILARITY CALCULATIONS
  // ===========================================================================

  function calculateJaccardSimilarity(tokensA: string[], tokensB: string[]): number {
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);

    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  function calculateCosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (normA * normB);
  }

  // ===========================================================================
  // EMBEDDING
  // ===========================================================================

  async function getEmbedding(question: string): Promise<number[] | null> {
    if (!embeddings || !cfg.semanticEnabled) return null;

    const normalized = normalizeQuestion(question);
    const cached = embeddingCache.get(normalized);

    if (cached && Date.now() - cached.timestamp < cfg.cacheTtlMs) {
      return cached.embedding;
    }

    try {
      const result = await embeddings.embed(normalized);
      if (result && result.length > 0) {
        embeddingCache.set(normalized, { embedding: result, timestamp: Date.now() });
        return result;
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to get embedding');
    }

    return null;
  }

  // ===========================================================================
  // MATCHING
  // ===========================================================================

  async function areMatching(
    marketA: { platform: Platform; market: Market },
    marketB: { platform: Platform; market: Market }
  ): Promise<{ matches: boolean; similarity: number; method: string; verification?: MatchVerification }> {
    const keyA = `${marketA.platform}:${marketA.market.id}`;
    const keyB = `${marketB.platform}:${marketB.market.id}`;

    // 1. Check manual links first (no verification needed - human approved)
    if (manualLinks.get(keyA)?.has(keyB)) {
      return { matches: true, similarity: 1.0, method: 'manual' };
    }

    // 2. Check slug match (exact ID match across platforms - trusted)
    if (marketA.market.slug && marketB.market.slug) {
      const slugA = marketA.market.slug.toLowerCase();
      const slugB = marketB.market.slug.toLowerCase();
      if (slugA === slugB) {
        return { matches: true, similarity: 1.0, method: 'slug' };
      }
    }

    const questionA = marketA.market.question;
    const questionB = marketB.market.question;

    // 3. Try semantic matching WITH VERIFICATION
    if (cfg.semanticEnabled && embeddings) {
      const [embA, embB] = await Promise.all([
        getEmbedding(questionA),
        getEmbedding(questionB),
      ]);

      if (embA && embB) {
        const similarity = calculateCosineSimilarity(embA, embB);
        if (similarity >= cfg.similarityThreshold) {
          // CRITICAL: Verify semantic matches to catch false positives
          const verification = await verifyMatch(marketA, marketB);

          if (!verification.verified) {
            logger.warn(
              {
                marketA: { platform: marketA.platform, id: marketA.market.id, question: questionA },
                marketB: { platform: marketB.platform, id: marketB.market.id, question: questionB },
                similarity,
                warnings: verification.warnings,
                confidence: verification.confidence,
              },
              'Semantic match REJECTED - failed verification'
            );
            // Don't return match - fall through to text matching
          } else {
            logger.debug(
              {
                similarity,
                confidence: verification.confidence,
                method: 'semantic',
              },
              'Semantic match verified'
            );
            return {
              matches: true,
              similarity: similarity * verification.confidence,
              method: 'semantic',
              verification,
            };
          }
        }
      }
    }

    // 4. Fall back to text matching with verification
    const tokensA = tokenize(questionA);
    const tokensB = tokenize(questionB);
    const similarity = calculateJaccardSimilarity(tokensA, tokensB);

    if (similarity >= cfg.minTokenOverlap) {
      // Also verify text matches
      const verification = await verifyMatch(marketA, marketB);

      if (!verification.verified && verification.confidence < 0.5) {
        logger.warn(
          {
            marketA: { platform: marketA.platform, id: marketA.market.id },
            marketB: { platform: marketB.platform, id: marketB.market.id },
            similarity,
            warnings: verification.warnings,
          },
          'Text match REJECTED - low confidence'
        );
        return { matches: false, similarity, method: 'none', verification };
      }

      return {
        matches: true,
        similarity: similarity * verification.confidence,
        method: 'text',
        verification,
      };
    }

    return { matches: false, similarity, method: 'none' };
  }

  async function findMatches(
    markets: Array<{ platform: Platform; market: Market }>
  ): Promise<MarketMatch[]> {
    const matchGroups = new Map<string, MarketMatch>();

    // Group by normalized question first (fast)
    const byNormalized = new Map<string, Array<{ platform: Platform; market: Market }>>();

    for (const item of markets) {
      const normalized = normalizeQuestion(item.market.question);
      const key = generateCanonicalId(item.market.question);

      if (!byNormalized.has(key)) {
        byNormalized.set(key, []);
      }
      byNormalized.get(key)!.push(item);
    }

    // Process groups that have multiple platforms
    for (const [canonicalId, group] of byNormalized) {
      const platforms = new Set(group.map((g) => g.platform));

      if (platforms.size < 2) {
        // Still create match for single platform (for internal arb)
        if (group.length > 0) {
          matchGroups.set(canonicalId, {
            canonicalId,
            markets: group,
            similarity: 1.0,
            method: 'text',
            normalizedQuestion: normalizeQuestion(group[0].market.question),
          });
        }
        continue;
      }

      // Multiple platforms - verify matches
      const verified: Array<{ platform: Platform; market: Market }> = [];
      let bestSimilarity = 0;
      let method: 'semantic' | 'text' | 'manual' | 'slug' = 'text';
      let matchVerification: MatchVerification | undefined;
      let anyNeedsReview = false;

      for (let i = 0; i < group.length; i++) {
        if (i === 0) {
          verified.push(group[i]);
          continue;
        }

        const result = await areMatching(group[0], group[i]);
        if (result.matches) {
          verified.push(group[i]);
          if (result.similarity > bestSimilarity) {
            bestSimilarity = result.similarity;
            method = result.method as typeof method;
            matchVerification = result.verification;
          }
          if (result.verification?.needsReview) {
            anyNeedsReview = true;
          }
        }
      }

      if (verified.length >= 1) {
        matchGroups.set(canonicalId, {
          canonicalId,
          markets: verified,
          similarity: bestSimilarity || 1.0,
          method,
          normalizedQuestion: normalizeQuestion(group[0].market.question),
          verification: matchVerification,
          needsReview: anyNeedsReview,
        });
      }
    }

    // Check manual links for additional matches
    for (const [keyA, linkedKeys] of manualLinks) {
      for (const keyB of linkedKeys) {
        const [platformA, marketIdA] = keyA.split(':');
        const [platformB, marketIdB] = keyB.split(':');

        const marketA = markets.find(
          (m) => m.platform === platformA && m.market.id === marketIdA
        );
        const marketB = markets.find(
          (m) => m.platform === platformB && m.market.id === marketIdB
        );

        if (marketA && marketB) {
          const canonicalId = `manual_${keyA}_${keyB}`;
          if (!matchGroups.has(canonicalId)) {
            matchGroups.set(canonicalId, {
              canonicalId,
              markets: [marketA, marketB],
              similarity: 1.0,
              method: 'manual',
              normalizedQuestion: normalizeQuestion(marketA.market.question),
            });
          }
        }
      }
    }

    return Array.from(matchGroups.values());
  }

  // ===========================================================================
  // MANUAL LINKS
  // ===========================================================================

  function addManualLink(marketA: string, marketB: string): void {
    addToLinkSet(marketA, marketB);

    // Persist to DB
    try {
      db.run(
        `INSERT OR REPLACE INTO market_links (id, market_a, market_b, source)
         VALUES (?, ?, ?, ?)`,
        [`${marketA}_${marketB}`, marketA, marketB, 'manual']
      );
    } catch (error) {
      logger.warn({ error }, 'Failed to persist manual link');
    }
  }

  function removeManualLink(marketA: string, marketB: string): void {
    removeFromLinkSet(marketA, marketB);

    try {
      db.run(
        'DELETE FROM market_links WHERE (market_a = ? AND market_b = ?) OR (market_a = ? AND market_b = ?)',
        [marketA, marketB, marketB, marketA]
      );
    } catch (error) {
      logger.warn({ error }, 'Failed to remove manual link');
    }
  }

  function clearCache(): void {
    embeddingCache.clear();
  }

  return {
    findMatches,
    areMatching,
    addManualLink,
    removeManualLink,
    getEmbedding,
    clearCache,
    verifyMatch,
  };
}
