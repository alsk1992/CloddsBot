/**
 * Live Tennis Skill - live scores, fixtures & player lookup
 *
 * Match-state ground truth for tennis event markets (Polymarket, Kalshi,
 * Betfair all run tennis match-winner markets), backed by the Live Tennis
 * API's free keyed tier.
 *
 * Commands:
 * /tennis live [tour]        Matches in play right now
 * /tennis upcoming [tour]    Matches about to start
 * /tennis fixtures [n]       Upcoming scheduled fixtures
 * /tennis player <name>      Player lookup (bio + current ranking)
 * /tennis match <id>         One match with its latest score
 */

import type {
  LiveTennisFeed,
  LiveTennisMatch,
  LiveTennisFixture,
  LiveTennisPlayer,
  LiveTennisScore,
} from '../../../feeds/livetennis/index';

const TOURS = ['atp', 'wta', 'challenger', 'itf', 'juniors'];

// Lazily created feed (module-level so the TTL cache survives across calls)
let feed: LiveTennisFeed | null = null;

async function getFeed(): Promise<LiveTennisFeed> {
  if (!feed) {
    const { createLiveTennisFeed } = await import('../../../feeds/livetennis/index');
    feed = await createLiveTennisFeed();
  }
  return feed;
}

function formatScore(score: LiveTennisScore | null, p1: string, p2: string): string {
  if (!score) return '  _no score yet_';

  const setsLine = (score.games[0] || [])
    .map((g1, i) => `${g1}-${score.games[1]?.[i] ?? 0}`)
    .join(' ');

  let output = `  Sets: ${score.sets[0] ?? 0}-${score.sets[1] ?? 0}`;
  if (setsLine) output += ` (${setsLine})`;

  const [pts1, pts2] = score.points;
  if (pts1 != null && pts2 != null) {
    output += ` | ${score.isTiebreak ? 'Tiebreak' : 'Points'}: ${pts1}-${pts2}`;
  }

  if (score.server === 1 || score.server === 2) {
    output += ` | Serving: ${score.server === 1 ? p1 : p2}`;
  }
  if (score.isBreakPoint) {
    output += ' | **break point**';
  }
  return output;
}

function formatMatch(match: LiveTennisMatch): string {
  const p1 = match.players.p1.name;
  const p2 = match.players.p2.name;

  let output = `**${p1} vs ${p2}**\n`;
  output += `  ${match.tournament}`;
  if (match.round) output += ` | ${match.round}`;
  if (match.surface) output += ` | ${match.surface}${match.indoor ? ' (indoor)' : ''}`;
  if (match.tour) output += ` | ${match.tour.toUpperCase()}`;
  output += `\n  ID: \`${match.id}\` | Status: ${match.status}`;
  if (match.status === 'completed' && match.winner) {
    output += ` | Winner: ${match.winner === 1 ? p1 : p2}`;
  }
  output += '\n';
  output += formatScore(match.score, p1, p2);
  return output;
}

function formatFixture(fixture: LiveTennisFixture): string {
  const when = fixture.startTime
    ? fixture.startTime.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    : fixture.eventDate || 'TBD';

  let output = `**${fixture.player1Name || '?'} vs ${fixture.player2Name || '?'}**\n`;
  output += `  ${when}`;
  if (fixture.tournament) output += ` | ${fixture.tournament}`;
  if (fixture.round) output += ` | ${fixture.round}`;
  if (fixture.surface) output += ` | ${fixture.surface}`;
  return output;
}

function formatPlayer(player: LiveTennisPlayer): string {
  let output = `**${player.name}**`;
  if (player.country) output += ` (${player.country})`;
  output += '\n';
  output += `  ID: \`${player.id}\``;
  if (player.ranking != null) {
    output += ` | Ranking: #${player.ranking}`;
    if (player.rankingPoints != null) output += ` (${player.rankingPoints} pts)`;
  }
  if (player.tour) output += ` | Tour: ${player.tour}`;
  if (player.hand) output += ` | ${player.hand === 'R' ? 'Right' : 'Left'}-handed`;
  if (player.isDoublesTeam) output += ' | doubles team';
  return output;
}

function parseTour(args: string[]): { tour?: string; error?: string } {
  if (args.length === 0) return {};
  const tour = args[0].toLowerCase();
  if (!TOURS.includes(tour)) {
    return { error: `Unknown tour: ${args[0]}\n\nSupported tours: ${TOURS.join(', ')}` };
  }
  return { tour };
}

async function handleMatches(kind: 'live' | 'upcoming', args: string[]): Promise<string> {
  const { tour, error } = parseTour(args);
  if (error) return error;

  try {
    const tennis = await getFeed();
    const matches = kind === 'live'
      ? await tennis.getLiveMatches(tour)
      : await tennis.getUpcomingMatches(tour);

    if (matches.length === 0) {
      return kind === 'live'
        ? `No matches in play right now${tour ? ` on ${tour.toUpperCase()}` : ''}.`
        : `No upcoming matches found${tour ? ` on ${tour.toUpperCase()}` : ''}.`;
    }

    const title = kind === 'live' ? 'Live Tennis Matches' : 'Upcoming Tennis Matches';
    let output = `**${title} (${matches.length})**\n\n`;
    for (const match of matches.slice(0, 10)) {
      output += formatMatch(match) + '\n\n';
    }
    if (matches.length > 10) {
      output += `_...and ${matches.length - 10} more_`;
    }
    return output;
  } catch (error) {
    return `Failed to fetch matches: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleFixtures(args: string[]): Promise<string> {
  let limit = 10;
  if (args[0]) {
    const parsed = parseInt(args[0], 10);
    if (!isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 50);
  }

  try {
    const tennis = await getFeed();
    const fixtures = await tennis.getFixtures(limit);

    if (fixtures.length === 0) {
      return 'No scheduled fixtures found.';
    }

    let output = `**Upcoming Fixtures (${fixtures.length})**\n\n`;
    for (const fixture of fixtures) {
      output += formatFixture(fixture) + '\n\n';
    }
    return output;
  } catch (error) {
    return `Failed to fetch fixtures: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handlePlayer(args: string[]): Promise<string> {
  if (args.length === 0) {
    return 'Usage: /tennis player <name>\n\nExample: /tennis player Alcaraz';
  }

  const query = args.join(' ').replace(/"/g, '');

  try {
    const tennis = await getFeed();
    const players = await tennis.searchPlayers(query);

    if (players.length === 0) {
      return `No players found matching "${query}".`;
    }

    let output = `**Players matching "${query}" (${players.length})**\n\n`;
    for (const player of players.slice(0, 8)) {
      output += formatPlayer(player) + '\n\n';
    }
    if (players.length > 8) {
      output += `_...and ${players.length - 8} more_`;
    }
    return output;
  } catch (error) {
    return `Player search failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleMatch(args: string[]): Promise<string> {
  const matchId = parseInt(args[0] ?? '', 10);
  if (isNaN(matchId)) {
    return 'Usage: /tennis match <id>\n\nGet ids from `/tennis live` or `/tennis upcoming`.';
  }

  try {
    const tennis = await getFeed();
    const match = await tennis.getMatch(matchId);

    if (!match) {
      return `Match not found: ${matchId}`;
    }
    return formatMatch(match);
  } catch (error) {
    return `Failed to fetch match: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'live':
    case 'l':
      return handleMatches('live', rest);

    case 'upcoming':
    case 'u':
      return handleMatches('upcoming', rest);

    case 'fixtures':
    case 'fix':
    case 'f':
      return handleFixtures(rest);

    case 'player':
    case 'p':
      return handlePlayer(rest);

    case 'match':
    case 'm':
      return handleMatch(rest);

    case 'help':
    default:
      return `**Live Tennis**

Live scores, fixtures and player lookup — match-state ground truth for
tennis event markets (Polymarket, Kalshi and Betfair all list tennis
match-winner markets).

**Commands:**
\`\`\`
/tennis live [tour]        Matches in play (tour: atp|wta|challenger|itf|juniors)
/tennis upcoming [tour]    Matches about to start
/tennis fixtures [n]       Upcoming scheduled fixtures
/tennis player <name>      Player lookup (bio + current ranking)
/tennis match <id>         One match with its latest score
\`\`\`

**Example Workflow:**
\`\`\`
/tennis live atp
/tennis match 12345
/tennis player Alcaraz
\`\`\`

**Setup:**
Set LIVETENNIS_API_KEY — free key (no card) from
https://livetennisapi.com/subscribe/free

**Free-tier limits (honest numbers):** 30 requests/minute, 100 requests/day.
Good for develop-and-test or ~15-minute-cadence checks, not continuous fast
polling. Responses are cached in-process (live: 60s, fixtures: 10m,
players: 1h) to stretch the quota.`;
  }
}

export default {
  name: 'livetennis',
  description: 'Live tennis scores, fixtures and player lookup — match-state ground truth for tennis event markets',
  commands: ['/tennis'],
  requires: { env: ['LIVETENNIS_API_KEY'] },
  handle: execute,
};
