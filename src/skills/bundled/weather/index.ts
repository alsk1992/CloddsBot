/**
 * Weather Betting Skill - NOAA data for Polymarket weather markets
 *
 * Commands:
 * /weather scan                    Scan all weather markets for edge
 * /weather forecast <city>         Get NOAA forecast
 * /weather markets                 List active weather markets
 * /weather edge <market-id>        Calculate edge for specific market
 * /weather bet <market-id> <amt>   Execute bet
 * /weather auto [options]          Auto-bet on high-edge markets
 * /weather history                 View bet history
 */

import type { NOAAClient, WeatherForecast, ForecastPeriod } from '../../../weather/noaa';
import type { WeatherMarketFinder, WeatherMarket } from '../../../weather/markets';
import type { WeatherEdgeCalculator, WeatherEdge, BetRecommendation } from '../../../weather/edge';

// Lazy-load weather modules
async function getWeatherModules() {
  const [noaa, markets, edge] = await Promise.all([
    import('../../../weather/noaa'),
    import('../../../weather/markets'),
    import('../../../weather/edge'),
  ]);
  return {
    getNOAAClient: noaa.getNOAAClient,
    CITY_COORDINATES: noaa.CITY_COORDINATES,
    getWeatherMarketFinder: markets.getWeatherMarketFinder,
    getWeatherEdgeCalculator: edge.getWeatherEdgeCalculator,
  };
}

// Bet history storage
interface WeatherBet {
  id: string;
  marketId: string;
  marketQuestion: string;
  side: 'YES' | 'NO';
  amount: number;
  edge: number;
  forecast: string;
  timestamp: number;
  status: 'pending' | 'won' | 'lost';
  txSignature?: string;
}

const betHistory: WeatherBet[] = [];

function isConfigured(): boolean {
  return !!(process.env.POLY_API_KEY && process.env.POLY_API_SECRET);
}

function formatForecast(forecast: WeatherForecast): string {
  let output = `**Weather Forecast: ${forecast.location}**\n\n`;

  for (const period of forecast.periods.slice(0, 6)) {
    const temp = `${period.temperature}°${period.temperatureUnit}`;
    const precip = period.probabilityOfPrecipitation.value;
    const precipStr = precip !== null ? ` | Rain: ${precip}%` : '';

    output += `**${period.name}**: ${temp}${precipStr}\n`;
    output += `  ${period.shortForecast}\n`;
    output += `  Wind: ${period.windSpeed} ${period.windDirection}\n\n`;
  }

  return output;
}

function formatMarket(market: WeatherMarket): string {
  const yesPrice = market.outcomes.find(o => o.name.toLowerCase().includes('yes'))?.price || 0;
  const noPrice = market.outcomes.find(o => o.name.toLowerCase().includes('no'))?.price || 0;

  let output = `**${market.question}**\n`;
  output += `  ID: \`${market.id.slice(0, 12)}...\`\n`;
  output += `  Location: ${market.location}\n`;
  output += `  Type: ${market.metric}`;
  if (market.threshold) {
    output += ` | Threshold: ${market.threshold}${market.thresholdUnit || ''}`;
  }
  output += `\n`;
  output += `  YES: ${(yesPrice * 100).toFixed(1)}% | NO: ${(noPrice * 100).toFixed(1)}%\n`;
  output += `  Volume: $${market.volume.toLocaleString()} | Liquidity: $${market.liquidity.toLocaleString()}\n`;
  output += `  Ends: ${market.endDate.toLocaleDateString()}`;

  return output;
}

function formatEdge(edge: WeatherEdge): string {
  const recommendation = edge.recommendation === 'YES' ? '📈 YES'
    : edge.recommendation === 'NO' ? '📉 NO'
      : '➖ SKIP';

  let output = `**Edge Analysis**\n\n`;
  output += `Market: ${edge.market.question.slice(0, 60)}...\n`;
  output += `Location: ${edge.market.location}\n\n`;

  output += `**Probabilities:**\n`;
  output += `  NOAA Forecast: ${edge.noaaProbability.toFixed(0)}%\n`;
  output += `  Market Price: ${(edge.marketPrice * 100).toFixed(0)}%\n`;
  output += `  **Edge: ${edge.edgePercent >= 0 ? '+' : ''}${edge.edgePercent.toFixed(1)}%**\n\n`;

  output += `Confidence: ${edge.confidence.toUpperCase()}\n`;
  output += `Recommendation: ${recommendation}\n\n`;
  output += `Reasoning: ${edge.reasoning}`;

  if (edge.forecast) {
    output += `\n\n**Forecast Period:**\n`;
    output += `  ${edge.forecast.name}: ${edge.forecast.temperature}°${edge.forecast.temperatureUnit}\n`;
    output += `  ${edge.forecast.shortForecast}`;
  }

  return output;
}

async function handleForecast(args: string[]): Promise<string> {
  if (args.length === 0) {
    return 'Usage: /weather forecast <city>\n\nExample: /weather forecast "New York"';
  }

  const city = args.join(' ').replace(/"/g, '');

  try {
    const { getNOAAClient, CITY_COORDINATES } = await getWeatherModules();
    const noaa = getNOAAClient();

    // Check if city is known
    const normalizedCity = city.toLowerCase();
    if (!CITY_COORDINATES[normalizedCity]) {
      const cities = Object.values(CITY_COORDINATES).map(c => c.name).slice(0, 20);
      return `Unknown city: ${city}\n\nSupported cities include:\n${cities.join(', ')}`;
    }

    const forecast = await noaa.getForecastByCity(city);
    return formatForecast(forecast);
  } catch (error) {
    return `Failed to get forecast: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleMarkets(): Promise<string> {
  try {
    const { getWeatherMarketFinder } = await getWeatherModules();
    const finder = getWeatherMarketFinder();

    const markets = await finder.getWeatherMarkets({ activeOnly: true });

    if (markets.length === 0) {
      return 'No active weather markets found on Polymarket.';
    }

    let output = `**Active Weather Markets (${markets.length})**\n\n`;

    for (const market of markets.slice(0, 10)) {
      output += formatMarket(market) + '\n\n';
    }

    if (markets.length > 10) {
      output += `\n_...and ${markets.length - 10} more markets_`;
    }

    return output;
  } catch (error) {
    return `Failed to fetch markets: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleScan(args: string[]): Promise<string> {
  // Parse threshold
  let minEdge = 5;
  const thresholdIndex = args.indexOf('--threshold');
  if (thresholdIndex >= 0 && args[thresholdIndex + 1]) {
    minEdge = parseFloat(args[thresholdIndex + 1]);
  }

  try {
    const { getWeatherEdgeCalculator } = await getWeatherModules();
    const calc = getWeatherEdgeCalculator();

    const result = await calc.scanForEdge(minEdge);

    if (result.topOpportunities.length === 0) {
      return `**Weather Market Scan**

Scanned ${result.totalMarkets} markets.
No opportunities found with edge >= ${minEdge}%.

Try lowering threshold: \`/weather scan --threshold 3\``;
    }

    let output = `**Weather Market Scan**\n\n`;
    output += `Scanned: ${result.totalMarkets} markets\n`;
    output += `Opportunities: ${result.marketsWithEdge} with edge >= ${minEdge}%\n\n`;
    output += `**Top Opportunities:**\n\n`;

    for (const edge of result.topOpportunities.slice(0, 5)) {
      const direction = edge.edgePercent > 0 ? '📈' : '📉';
      const side = edge.recommendation;

      output += `${direction} **${Math.abs(edge.edgePercent).toFixed(1)}% edge** (${side})\n`;
      output += `   ${edge.market.question.slice(0, 50)}...\n`;
      output += `   NOAA: ${edge.noaaProbability.toFixed(0)}% | Market: ${(edge.marketPrice * 100).toFixed(0)}%\n`;
      output += `   ID: \`${edge.market.id.slice(0, 12)}...\`\n\n`;
    }

    output += `\nBet with: \`/weather bet <market-id> <amount>\``;

    return output;
  } catch (error) {
    return `Scan failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleEdge(args: string[]): Promise<string> {
  if (args.length === 0) {
    return 'Usage: /weather edge <market-id>';
  }

  const marketId = args[0];

  try {
    const { getWeatherMarketFinder, getWeatherEdgeCalculator } = await getWeatherModules();
    const finder = getWeatherMarketFinder();
    const calc = getWeatherEdgeCalculator();

    const market = await finder.getMarket(marketId);
    if (!market) {
      return `Market not found: ${marketId}`;
    }

    const edge = await calc.calculateEdge(market);
    return formatEdge(edge);
  } catch (error) {
    return `Failed to calculate edge: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleBet(args: string[]): Promise<string> {
  if (!isConfigured()) {
    return 'Polymarket not configured. Set POLY_API_KEY, POLY_API_SECRET, and POLY_API_PASSPHRASE.';
  }

  if (args.length < 2) {
    return 'Usage: /weather bet <market-id> <amount>\n\nExample: /weather bet abc123 10';
  }

  const marketId = args[0];
  const amount = parseFloat(args[1]);

  if (isNaN(amount) || amount <= 0) {
    return 'Invalid amount. Provide a positive number.';
  }

  try {
    const { getWeatherMarketFinder, getWeatherEdgeCalculator } = await getWeatherModules();
    const finder = getWeatherMarketFinder();
    const calc = getWeatherEdgeCalculator();

    const market = await finder.getMarket(marketId);
    if (!market) {
      return `Market not found: ${marketId}`;
    }

    const edge = await calc.calculateEdge(market);

    if (edge.recommendation === 'SKIP') {
      return `**Not Recommended**

${edge.reasoning}

Edge: ${edge.edgePercent.toFixed(1)}%
Minimum recommended: 5%`;
    }

    const side = edge.recommendation;
    const outcome = market.outcomes.find(o =>
      o.name.toLowerCase().includes(side.toLowerCase())
    );

    if (!outcome) {
      return `Could not find ${side} outcome for market.`;
    }

    // Get Polymarket credentials
    const address = process.env.POLY_ADDRESS || process.env.POLY_FUNDER_ADDRESS;
    const apiKey = process.env.POLY_API_KEY;
    const apiSecret = process.env.POLY_API_SECRET;
    const apiPassphrase = process.env.POLY_API_PASSPHRASE;

    if (!address || !apiKey || !apiSecret || !apiPassphrase) {
      return `Missing Polymarket credentials. Set:
- POLY_ADDRESS (or POLY_FUNDER_ADDRESS)
- POLY_API_KEY
- POLY_API_SECRET
- POLY_API_PASSPHRASE`;
    }

    // Import execution service
    const { createExecutionService } = await import('../../../execution');

    const executor = createExecutionService({
      polymarket: {
        address,
        apiKey,
        apiSecret,
        apiPassphrase,
      },
    });

    // Calculate shares from dollar amount
    // shares = amount / price
    const price = side === 'YES' ? edge.marketPrice : (1 - edge.marketPrice);
    if (price <= 0) {
      return `Cannot calculate shares: market price is ${(edge.marketPrice * 100).toFixed(1)}%.`;
    }
    const shares = Math.floor(amount / price);

    if (shares < 1) {
      return `Amount too small. Minimum bet is $${price.toFixed(2)} for 1 share.`;
    }

    // Record bet
    const bet: WeatherBet = {
      id: Math.random().toString(36).slice(2, 10),
      marketId: market.id,
      marketQuestion: market.question,
      side,
      amount,
      edge: edge.edgePercent,
      forecast: `NOAA: ${edge.noaaProbability.toFixed(0)}% | Market: ${(edge.marketPrice * 100).toFixed(0)}%`,
      timestamp: Date.now(),
      status: 'pending',
    };

    // Execute the order
    const orderSide = side === 'YES' ? 'buy' : 'sell';
    const result = await executor.buyLimit({
      platform: 'polymarket',
      marketId: market.id,
      tokenId: outcome.tokenId,
      price,
      size: shares,
      orderType: 'GTC',
    });

    if (result.success) {
      bet.status = 'pending'; // Will be won/lost when market resolves
      bet.txSignature = result.orderId;
      betHistory.push(bet);

      return `**Weather Bet Placed**

Market: ${market.question.slice(0, 60)}...
Side: ${side}
Shares: ${shares}
Price: $${price.toFixed(2)}
Total: $${(shares * price).toFixed(2)}
Edge: ${edge.edgePercent >= 0 ? '+' : ''}${edge.edgePercent.toFixed(1)}%

Order ID: \`${result.orderId}\`
Status: ${result.status}

${edge.reasoning}`;
    } else {
      return `**Bet Failed**

${result.error || 'Unknown error'}

Market: ${market.question.slice(0, 60)}...
Attempted: ${side} ${shares} shares @ $${price.toFixed(2)}`;
    }

  } catch (error) {
    return `Bet failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleAuto(args: string[]): Promise<string> {
  // Parse options
  let threshold = 10;
  let maxBets = 3;
  let bankroll = 100;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--threshold':
        threshold = parseFloat(next);
        i++;
        break;
      case '--max-bets':
        maxBets = parseInt(next);
        i++;
        break;
      case '--bankroll':
        bankroll = parseFloat(next);
        i++;
        break;
    }
  }

  if (!isConfigured()) {
    return `Polymarket not configured for live trading.

**Simulation Mode:**

Would scan for markets with edge >= ${threshold}%
Max bets: ${maxBets}
Bankroll: $${bankroll}

Set POLY_API_KEY to enable live trading.`;
  }

  try {
    const { getWeatherEdgeCalculator } = await getWeatherModules();
    const calc = getWeatherEdgeCalculator();

    const result = await calc.scanForEdge(threshold);

    if (result.topOpportunities.length === 0) {
      return `**Auto-Bet Scan**

No opportunities found with edge >= ${threshold}%.
Scanned ${result.totalMarkets} markets.`;
    }

    let output = `**Auto-Bet Recommendations**\n\n`;
    output += `Threshold: ${threshold}% | Max bets: ${maxBets} | Bankroll: $${bankroll}\n\n`;

    let totalBet = 0;

    for (const edge of result.topOpportunities.slice(0, maxBets)) {
      const rec = calc.getBetRecommendation(edge, bankroll);
      if (!rec) continue;

      output += `**${rec.side}** on "${edge.market.question.slice(0, 40)}..."\n`;
      output += `  Edge: ${rec.edge.toFixed(1)}% | Bet: $${rec.suggestedAmount.toFixed(2)}\n`;
      output += `  Kelly: ${(rec.kellyFraction * 100).toFixed(1)}% | EV: $${rec.expectedValue.toFixed(2)}\n\n`;

      totalBet += rec.suggestedAmount;
    }

    output += `**Total suggested: $${totalBet.toFixed(2)}**\n\n`;
    output += `_Note: This is a simulation. Actual betting requires manual confirmation._`;

    return output;
  } catch (error) {
    return `Auto-bet failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleHistory(): Promise<string> {
  if (betHistory.length === 0) {
    return 'No bet history yet. Place bets with `/weather bet <market-id> <amount>`';
  }

  let output = '**Weather Bet History**\n\n';

  for (const bet of betHistory.slice(-10).reverse()) {
    const status = bet.status === 'won' ? '✅' : bet.status === 'lost' ? '❌' : '⏳';
    const time = new Date(bet.timestamp).toLocaleString();

    output += `${status} ${time}\n`;
    output += `   ${bet.side} $${bet.amount.toFixed(2)} | Edge: ${bet.edge.toFixed(1)}%\n`;
    output += `   ${bet.marketQuestion.slice(0, 50)}...\n\n`;
  }

  return output;
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const rest = parts.slice(1);

  switch (command) {
    case 'forecast':
    case 'f':
      return handleForecast(rest);

    case 'markets':
    case 'm':
      return handleMarkets();

    case 'scan':
    case 's':
      return handleScan(rest);

    case 'edge':
    case 'e':
      return handleEdge(rest);

    case 'bet':
    case 'b':
      return handleBet(rest);

    case 'auto':
    case 'a':
      return handleAuto(rest);

    case 'history':
    case 'hist':
    case 'h':
      return handleHistory();

    case 'help':
    default:
      return `**Weather Betting**

Use NOAA forecasts to find edge on Polymarket weather markets.

**Commands:**
\`\`\`
/weather forecast <city>           Get NOAA forecast
/weather markets                   List active weather markets
/weather scan [--threshold 10]     Scan for edge opportunities
/weather edge <market-id>          Calculate edge for market
/weather bet <market-id> <amount>  Execute bet
/weather auto [options]            Auto-bet recommendations
/weather history                   View bet history
\`\`\`

**Example Workflow:**
\`\`\`
/weather forecast "New York"
/weather scan --threshold 10
/weather edge abc123
/weather bet abc123 10
\`\`\`

**How It Works:**
1. NOAA provides official US weather forecasts
2. We match forecasts to Polymarket weather markets
3. Edge = NOAA probability - Market price
4. Bet when edge exceeds threshold`;
  }
}

export default {
  name: 'weather',
  description: 'Weather betting - use NOAA forecasts to find edge on Polymarket weather markets',
  commands: ['/weather'],
  handle: execute,
};
