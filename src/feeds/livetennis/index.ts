/**
 * Live Tennis API Feed
 *
 * Live tennis scores, upcoming fixtures, and player lookup from the
 * Live Tennis API (livetennisapi.com) — ATP, WTA, Challenger, ITF and
 * junior Grand Slam coverage.
 *
 * Uses the FREE keyed tier only (30 requests/minute, 100 requests/day):
 * live scores, upcoming matches, fixtures, and players (including a
 * player's own current ranking). That quota suits develop-and-test or
 * ~15-minute-cadence checks, NOT continuous fast polling — responses are
 * cached in-process (see CACHE TTLS below) so repeated skill/agent calls
 * don't burn through the daily quota.
 *
 * Get a key: https://livetennisapi.com/subscribe/free
 * API docs:  https://docs.livetennisapi.com
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface LiveTennisScore {
  /** Sets won: [sets_p1, sets_p2] */
  sets: number[];
  /** Games per set: [games_p1_per_set[], games_p2_per_set[]] */
  games: number[][];
  /** In-game points as tennis strings ("0", "15", "30", "40", "AD"); entries can be null */
  points: Array<string | null>;
  /** Which player is serving (1 | 2), or null when unknown */
  server: 1 | 2 | null;
  isTiebreak: boolean;
  /**
   * Derived, not an API field: the receiver can win this game on the next
   * point. See isBreakPoint() for the exact rule.
   */
  isBreakPoint: boolean;
  timestamp: Date | null;
}

export interface LiveTennisPlayer {
  id: number;
  name: string;
  /** Opaque tour string of the record itself (e.g. 'atp', 'challenger_men') */
  tour: string | null;
  country: string | null;
  /** The player's own current ranking (available on the free tier) */
  ranking: number | null;
  rankingPoints: number | null;
  hand: 'R' | 'L' | null;
  isDoublesTeam: boolean;
}

export interface LiveTennisMatch {
  id: number;
  tournament: string;
  /** Tour in the filter vocabulary: atp | wta | challenger | itf | juniors, or null */
  tour: string | null;
  surface: 'hard' | 'clay' | 'grass' | null;
  indoor: boolean;
  format: 'BO3' | 'BO5' | null;
  round: string | null;
  status: 'upcoming' | 'live' | 'completed' | 'cancelled';
  /** singles | doubles | null (null means the feed doesn't know — not singles) */
  draw: 'singles' | 'doubles' | null;
  scheduledTime: Date | null;
  players: { p1: LiveTennisPlayer; p2: LiveTennisPlayer };
  score: LiveTennisScore | null;
  /** Completed matches only: 1 | 2 */
  winner: number | null;
}

export interface LiveTennisFixture {
  id: number;
  eventDate: string | null;
  /** Scheduled start (UTC); null until the order of play assigns a time */
  startTime: Date | null;
  tournament: string | null;
  round: string | null;
  surface: string | null;
  player1Name: string | null;
  player2Name: string | null;
  /** Player ids where resolved — null is a real state, not a gap */
  player1Id: number | null;
  player2Id: number | null;
  tour: string | null;
}

export interface LiveTennisFeed extends EventEmitter {
  start(): Promise<void>;
  stop(): void;

  /** Matches currently in play (optionally filtered by tour: atp|wta|challenger|itf|juniors) */
  getLiveMatches(tour?: string): Promise<LiveTennisMatch[]>;

  /** Matches about to start (same tour filter as getLiveMatches) */
  getUpcomingMatches(tour?: string): Promise<LiveTennisMatch[]>;

  /** Upcoming scheduled fixtures, earliest first */
  getFixtures(limit?: number): Promise<LiveTennisFixture[]>;

  /** Search players by name (ranked players first) */
  searchPlayers(query: string): Promise<LiveTennisPlayer[]>;

  /** One player by id (bio + current ranking) */
  getPlayer(playerId: number): Promise<LiveTennisPlayer | null>;

  /** One match by id, with its latest score */
  getMatch(matchId: number): Promise<LiveTennisMatch | null>;

  /** Current score only for a match — lowest-latency REST read */
  getScore(matchId: number): Promise<LiveTennisScore | null>;
}

// =============================================================================
// API HELPERS
// =============================================================================

const BASE_URL = 'https://api.livetennisapi.com/api/public/v1';

// CACHE TTLS — deliberately conservative for the free tier's 100 req/day.
const LIVE_TTL_MS = 60_000; // live/upcoming match lists
const FIXTURES_TTL_MS = 10 * 60_000; // schedules move slowly
const PLAYER_TTL_MS = 60 * 60_000; // bios/rankings change at most daily

function apiKey(): string {
  const key = process.env.LIVETENNIS_API_KEY;
  if (!key) {
    throw new Error(
      'LIVETENNIS_API_KEY not set. Get a free key at https://livetennisapi.com/subscribe/free'
    );
  }
  return key;
}

async function ltFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'X-API-Key': apiKey(),
      Accept: 'application/json',
    },
  });
  if (res.status === 429) {
    throw new Error(
      'Live Tennis API rate limit hit (free tier: 30 req/min, 100 req/day)'
    );
  }
  if (res.status === 403) {
    throw new Error(
      `Live Tennis API: endpoint above this key's tier (${await res.text()})`
    );
  }
  if (!res.ok) {
    throw new Error(`Live Tennis API error ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Break-point derivation (the API doesn't ship this as a field; it's implied
 * by the score): the RECEIVER wins the game with the next point — receiver at
 * AD, or receiver at 40 while the server is at 0/15/30. Never during a
 * tiebreak, and false when the server or points are unknown.
 */
export function isBreakPoint(
  server: 1 | 2 | null,
  points: Array<string | null>,
  isTiebreak: boolean
): boolean {
  if (isTiebreak) return false;
  if (server !== 1 && server !== 2) return false;
  const serverPoints = points[server - 1];
  const receiverPoints = points[server === 1 ? 1 : 0];
  if (serverPoints == null || receiverPoints == null) return false;
  if (receiverPoints === 'AD') return true;
  return receiverPoints === '40' && ['0', '15', '30'].includes(serverPoints);
}

// =============================================================================
// RESPONSE MAPPING
// =============================================================================

interface ApiScore {
  sets?: number[];
  games?: number[][];
  points?: Array<string | null>;
  server?: 1 | 2 | null;
  is_tiebreak?: boolean;
  timestamp?: string | null;
}

interface ApiPlayer {
  id: number;
  name: string;
  tour?: string | null;
  country?: string | null;
  ranking?: number | null;
  ranking_points?: number | null;
  hand?: 'R' | 'L' | null;
  is_doubles_team?: boolean;
}

interface ApiMatch {
  id: number;
  tournament: string;
  tour?: string | null;
  surface?: 'hard' | 'clay' | 'grass' | null;
  indoor?: boolean;
  format?: 'BO3' | 'BO5' | null;
  round?: string | null;
  status: 'upcoming' | 'live' | 'completed' | 'cancelled';
  draw?: 'singles' | 'doubles' | null;
  scheduled_time?: string | null;
  players?: { p1?: ApiPlayer; p2?: ApiPlayer };
  score?: ApiScore | null;
  winner?: number | null;
}

interface ApiFixture {
  id: number;
  event_date?: string | null;
  start_time?: string | null;
  tournament?: string | null;
  round?: string | null;
  surface?: string | null;
  player1_name?: string | null;
  player2_name?: string | null;
  player1_id?: number | null;
  player2_id?: number | null;
  tour?: string | null;
}

export function mapScore(s: ApiScore | null | undefined): LiveTennisScore | null {
  if (!s) return null;
  const server = s.server ?? null;
  const points = s.points ?? [];
  const isTiebreak = s.is_tiebreak ?? false;
  return {
    sets: s.sets ?? [],
    games: s.games ?? [],
    points,
    server,
    isTiebreak,
    isBreakPoint: isBreakPoint(server, points, isTiebreak),
    timestamp: s.timestamp ? new Date(s.timestamp) : null,
  };
}

function mapPlayer(p: ApiPlayer): LiveTennisPlayer {
  return {
    id: p.id,
    name: p.name,
    tour: p.tour ?? null,
    country: p.country ?? null,
    ranking: p.ranking ?? null,
    rankingPoints: p.ranking_points ?? null,
    hand: p.hand ?? null,
    isDoublesTeam: p.is_doubles_team ?? false,
  };
}

const UNKNOWN_PLAYER: ApiPlayer = { id: 0, name: 'Unknown' };

function mapMatch(m: ApiMatch): LiveTennisMatch {
  return {
    id: m.id,
    tournament: m.tournament,
    tour: m.tour ?? null,
    surface: m.surface ?? null,
    indoor: m.indoor ?? false,
    format: m.format ?? null,
    round: m.round ?? null,
    status: m.status,
    draw: m.draw ?? null,
    scheduledTime: m.scheduled_time ? new Date(m.scheduled_time) : null,
    players: {
      p1: mapPlayer(m.players?.p1 ?? UNKNOWN_PLAYER),
      p2: mapPlayer(m.players?.p2 ?? UNKNOWN_PLAYER),
    },
    score: mapScore(m.score),
    winner: m.winner ?? null,
  };
}

function mapFixture(f: ApiFixture): LiveTennisFixture {
  return {
    id: f.id,
    eventDate: f.event_date ?? null,
    startTime: f.start_time ? new Date(f.start_time) : null,
    tournament: f.tournament ?? null,
    round: f.round ?? null,
    surface: f.surface ?? null,
    player1Name: f.player1_name ?? null,
    player2Name: f.player2_name ?? null,
    player1Id: f.player1_id ?? null,
    player2Id: f.player2_id ?? null,
    tour: f.tour ?? null,
  };
}

// =============================================================================
// FACTORY
// =============================================================================

export async function createLiveTennisFeed(): Promise<LiveTennisFeed> {
  const emitter = new EventEmitter() as LiveTennisFeed;

  // Tiny TTL cache so agent chatter doesn't burn the 100/day free quota.
  const cache = new Map<string, { expires: number; value: unknown }>();

  async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    const value = await load();
    cache.set(key, { expires: Date.now() + ttlMs, value });
    return value;
  }

  emitter.start = async () => {
    logger.info('Live Tennis API feed started');
  };

  emitter.stop = () => {
    cache.clear();
    logger.info('Live Tennis API feed stopped');
  };

  const listMatches = async (status: 'live' | 'upcoming', tour?: string) => {
    const tourParam = tour ? `&tour=${encodeURIComponent(tour)}` : '';
    return cached(`matches:${status}:${tour ?? ''}`, LIVE_TTL_MS, async () => {
      const data = await ltFetch<{ data: ApiMatch[] }>(
        `/matches?status=${status}${tourParam}`
      );
      return data.data.map(mapMatch);
    });
  };

  emitter.getLiveMatches = (tour?: string) => listMatches('live', tour);
  emitter.getUpcomingMatches = (tour?: string) => listMatches('upcoming', tour);

  emitter.getFixtures = async (limit = 20): Promise<LiveTennisFixture[]> => {
    return cached(`fixtures:${limit}`, FIXTURES_TTL_MS, async () => {
      const data = await ltFetch<{ data: ApiFixture[] }>(`/fixtures?limit=${limit}`);
      return data.data.map(mapFixture);
    });
  };

  emitter.searchPlayers = async (query: string): Promise<LiveTennisPlayer[]> => {
    return cached(`players:${query.toLowerCase()}`, PLAYER_TTL_MS, async () => {
      const data = await ltFetch<{ data: ApiPlayer[] }>(
        `/players?search=${encodeURIComponent(query)}`
      );
      return data.data.map(mapPlayer);
    });
  };

  emitter.getPlayer = async (playerId: number): Promise<LiveTennisPlayer | null> => {
    try {
      return await cached(`player:${playerId}`, PLAYER_TTL_MS, async () => {
        const p = await ltFetch<ApiPlayer>(`/players/${playerId}`);
        return mapPlayer(p);
      });
    } catch (error) {
      logger.warn({ error, playerId }, 'Live Tennis API player lookup failed');
      return null;
    }
  };

  emitter.getMatch = async (matchId: number): Promise<LiveTennisMatch | null> => {
    try {
      // No cache: a single match read is usually a "what's the score NOW" ask.
      const m = await ltFetch<ApiMatch>(`/matches/${matchId}`);
      return mapMatch(m);
    } catch (error) {
      logger.warn({ error, matchId }, 'Live Tennis API match lookup failed');
      return null;
    }
  };

  emitter.getScore = async (matchId: number): Promise<LiveTennisScore | null> => {
    try {
      const s = await ltFetch<ApiScore>(`/matches/${matchId}/score`);
      return mapScore(s);
    } catch (error) {
      logger.warn({ error, matchId }, 'Live Tennis API score lookup failed');
      return null;
    }
  };

  return emitter;
}
