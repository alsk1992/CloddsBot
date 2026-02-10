/**
 * Metaculus CLI Skill
 *
 * Commands:
 * /mc search [query] - Search questions
 * /mc question <id> - Get question details
 * /mc tournaments - List active tournaments
 * /mc tournament <id> - Get tournament questions
 */

import { createMetaculusFeed, MetaculusFeed } from '../../../feeds/metaculus/index';
import { logger } from '../../../utils/logger';

let feed: MetaculusFeed | null = null;

async function getFeed(): Promise<MetaculusFeed> {
  if (feed) return feed;

  try {
    feed = await createMetaculusFeed();
    await feed.connect();
    return feed;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Metaculus feed');
    throw error;
  }
}

async function handleSearch(query: string): Promise<string> {
  const f = await getFeed();

  try {
    const defaultQuery = !query;
    const markets = await f.searchMarkets(query || 'AI');
    if (markets.length === 0) {
      return 'No questions found.';
    }

    let output = defaultQuery
      ? `**Metaculus Questions** (showing default results — use \`/mc search <query>\` to filter)\n\n`
      : `**Metaculus Questions** (${markets.length} results)\n\n`;
    for (const market of markets.slice(0, 15)) {
      const probability = market.outcomes[0]?.price || 0.5;
      output += `**${market.question}**\n`;
      output += `  ID: \`${market.id}\`\n`;
      output += `  Probability: ${(probability * 100).toFixed(0)}%\n`;
      output += `  Predictions: ${market.volume24h.toLocaleString()}\n`;
      if (market.endDate) {
        output += `  Closes: ${market.endDate.toLocaleDateString()}\n`;
      }
      output += '\n';
    }
    return output;
  } catch (error) {
    return `Error searching questions: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleQuestion(questionId: string): Promise<string> {
  const f = await getFeed();

  try {
    const market = await f.getMarket(questionId);
    if (!market) {
      return `Question ${questionId} not found.`;
    }

    const probability = market.outcomes[0]?.price || 0.5;

    let output = `**${market.question}**\n\n`;
    output += `ID: \`${market.id}\`\n`;
    output += `Community Prediction: **${(probability * 100).toFixed(1)}%**\n`;
    output += `Predictions: ${market.volume24h.toLocaleString()}\n`;

    if (market.endDate) {
      output += `Closes: ${market.endDate.toLocaleString()}\n`;
    }
    if (market.resolved) {
      output += `Resolution: ${market.resolutionValue === 1 ? 'Yes' : market.resolutionValue === 0 ? 'No' : market.resolutionValue}\n`;
    }

    output += `\nURL: ${market.url}\n`;

    if (market.description) {
      output += `\n**Description:**\n${market.description.slice(0, 500)}${market.description.length > 500 ? '...' : ''}`;
    }

    return output;
  } catch (error) {
    return `Error fetching question: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleTournaments(): Promise<string> {
  const f = await getFeed();

  try {
    const tournaments = await f.getTournaments();
    if (tournaments.length === 0) {
      return 'No tournaments found.';
    }

    let output = `**Metaculus Tournaments** (${tournaments.length})\n\n`;
    for (const t of tournaments.slice(0, 20)) {
      output += `**${t.name}**\n`;
      output += `  ID: \`${t.id}\`\n`;
      output += `  Questions: ${t.questionCount}\n\n`;
    }
    return output;
  } catch (error) {
    return `Error fetching tournaments: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleTournament(tournamentId: string): Promise<string> {
  const f = await getFeed();

  try {
    const id = parseInt(tournamentId, 10);
    if (isNaN(id)) {
      return 'Invalid tournament ID.';
    }

    const markets = await f.getTournamentQuestions(id, { maxResults: 20 });
    if (markets.length === 0) {
      return `No questions found in tournament ${tournamentId}.`;
    }

    let output = `**Tournament ${tournamentId} Questions** (${markets.length})\n\n`;
    for (const market of markets) {
      const probability = market.outcomes[0]?.price || 0.5;
      output += `**${market.question}**\n`;
      output += `  ID: \`${market.id}\` | Prob: ${(probability * 100).toFixed(0)}%\n\n`;
    }
    return output;
  } catch (error) {
    return `Error fetching tournament: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'search':
    case 'questions':
      return handleSearch(rest.join(' '));

    case 'question':
    case 'q':
      if (!rest[0]) return 'Usage: /mc question <id>';
      return handleQuestion(rest[0]);

    case 'tournaments':
    case 'contests':
      return handleTournaments();

    case 'tournament':
    case 'contest':
      if (!rest[0]) return 'Usage: /mc tournament <id>';
      return handleTournament(rest[0]);

    case 'help':
    default:
      return `**Metaculus Forecasting Commands**

  /mc search [query]      - Search questions
  /mc question <id>       - Get question details
  /mc tournaments         - List tournaments
  /mc tournament <id>     - Tournament questions

**Examples:**
  /mc search AI safety
  /mc question 3479
  /mc tournament 1234

Note: Metaculus is a forecasting platform (no trading).`;
  }
}

export default {
  name: 'metaculus',
  description: 'Metaculus forecasting platform - search questions, view predictions, and browse tournaments',
  commands: ['/metaculus'],
  handle: execute,
};
