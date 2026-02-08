/**
 * Feed Descriptors — Single registration point for all feeds.
 *
 * To add a new feed:
 *   1. Create src/feeds/<name>/index.ts
 *   2. Add a descriptor object below
 *   3. Call registry.register(descriptor) at the bottom
 *
 * Feeds use lazy dynamic imports so nothing is loaded until actually needed.
 */

import {
  type FeedDescriptor,
  FeedCapability,
  getGlobalFeedRegistry,
} from './registry';

// =============================================================================
// PREDICTION MARKETS
// =============================================================================

const polymarket: FeedDescriptor = {
  id: 'polymarket',
  name: 'Polymarket',
  description: 'Binary prediction markets on Polygon — largest on-chain prediction market',
  status: 'available',
  skillCommand: '/poly',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.ORDERBOOK,
    FeedCapability.REALTIME_PRICES,
    FeedCapability.TRADING,
  ],
  dataTypes: ['markets', 'orderbooks', 'prices', 'trades'],
  connectionType: 'hybrid',
  requiredEnv: [],
  optionalEnv: ['POLY_API_KEY', 'POLY_API_SECRET', 'POLY_API_PASSPHRASE', 'POLY_PRIVATE_KEY', 'POLY_FUNDER_ADDRESS'],
  configKey: 'polymarket',
  docsUrl: 'https://docs.polymarket.com',
  create: async (config) => {
    const { createPolymarketFeed } = await import('./polymarket/index');
    return createPolymarketFeed() as any;
  },
};

const kalshi: FeedDescriptor = {
  id: 'kalshi',
  name: 'Kalshi',
  description: 'CFTC-regulated US prediction exchange — event contracts on politics, economics, weather',
  status: 'available',
  skillCommand: '/kalshi',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.ORDERBOOK,
    FeedCapability.REALTIME_PRICES,
    FeedCapability.TRADING,
  ],
  dataTypes: ['markets', 'orderbooks', 'prices', 'trades', 'events'],
  connectionType: 'hybrid',
  requiredEnv: [],
  optionalEnv: ['KALSHI_API_KEY_ID', 'KALSHI_PRIVATE_KEY'],
  configKey: 'kalshi',
  docsUrl: 'https://trading-api.readme.io',
  create: async () => {
    const { createKalshiFeed } = await import('./kalshi/index');
    return createKalshiFeed() as any;
  },
};

const manifold: FeedDescriptor = {
  id: 'manifold',
  name: 'Manifold Markets',
  description: 'Play-money prediction markets — open API, broad topic coverage',
  status: 'available',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.REALTIME_PRICES,
  ],
  dataTypes: ['markets', 'prices', 'probabilities'],
  connectionType: 'hybrid',
  requiredEnv: [],
  optionalEnv: ['MANIFOLD_API_KEY'],
  configKey: 'manifold',
  docsUrl: 'https://docs.manifold.markets/api',
  create: async () => {
    const { createManifoldFeed } = await import('./manifold/index');
    return createManifoldFeed() as any;
  },
};

const metaculus: FeedDescriptor = {
  id: 'metaculus',
  name: 'Metaculus',
  description: 'Long-range forecasting platform — calibrated predictions on science, tech, geopolitics',
  status: 'available',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.HISTORICAL,
  ],
  dataTypes: ['markets', 'probabilities', 'forecasts'],
  connectionType: 'polling',
  requiredEnv: [],
  optionalEnv: ['METACULUS_API_KEY'],
  configKey: 'metaculus',
  docsUrl: 'https://www.metaculus.com/api',
  create: async (config) => {
    const { createMetaculusFeed } = await import('./metaculus/index');
    return createMetaculusFeed() as any;
  },
};

const predictit: FeedDescriptor = {
  id: 'predictit',
  name: 'PredictIt',
  description: 'Political betting market — US politics focused, read-only data',
  status: 'available',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.MARKET_DATA,
  ],
  dataTypes: ['markets', 'prices'],
  connectionType: 'polling',
  requiredEnv: [],
  optionalEnv: [],
  configKey: undefined,
  create: async () => {
    const { createPredictItFeed } = await import('./predictit/index');
    return createPredictItFeed() as any;
  },
};

const drift: FeedDescriptor = {
  id: 'drift',
  name: 'Drift BET',
  description: 'Solana-based prediction markets via Drift Protocol',
  status: 'available',
  skillCommand: '/drift',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.TRADING,
  ],
  dataTypes: ['markets', 'prices'],
  connectionType: 'polling',
  requiredEnv: [],
  optionalEnv: ['DRIFT_PRIVATE_KEY'],
  configKey: 'drift',
  create: async (config) => {
    const { createDriftFeed } = await import('./drift/index');
    return createDriftFeed(config as any) as any;
  },
};

const agentbets: FeedDescriptor = {
  id: 'agentbets',
  name: 'AgentBets',
  description: 'Prediction markets for AI agents on Solana devnet — built for the Colosseum hackathon',
  status: 'available',
  skillCommand: '/agentbets',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.EDGE_DETECTION,
  ],
  dataTypes: ['markets', 'prices', 'opportunities'],
  connectionType: 'polling',
  requiredEnv: [],
  optionalEnv: [],
  configKey: undefined,
  docsUrl: 'https://github.com/nox-oss/agentbets',
  create: async () => {
    const { createAgentBetsFeed } = await import('./agentbets/index');
    return createAgentBetsFeed() as any;
  },
};

const betfair: FeedDescriptor = {
  id: 'betfair',
  name: 'Betfair',
  description: 'World\'s largest betting exchange — sports, politics, specials with deep liquidity',
  status: 'available',
  skillCommand: '/bf',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.ORDERBOOK,
    FeedCapability.REALTIME_PRICES,
    FeedCapability.TRADING,
    FeedCapability.SPORTS,
  ],
  dataTypes: ['markets', 'orderbooks', 'prices', 'trades', 'sports_events'],
  connectionType: 'hybrid',
  requiredEnv: ['BETFAIR_APP_KEY'],
  optionalEnv: ['BETFAIR_SESSION_TOKEN', 'BETFAIR_USERNAME', 'BETFAIR_PASSWORD'],
  configKey: 'betfair',
  docsUrl: 'https://docs.developer.betfair.com',
  create: async (config) => {
    const { createBetfairFeed } = await import('./betfair/index');
    return createBetfairFeed(config as any) as any;
  },
};

const smarkets: FeedDescriptor = {
  id: 'smarkets',
  name: 'Smarkets',
  description: 'Low-commission betting exchange — politics, sports, entertainment',
  status: 'available',
  skillCommand: '/sm',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.ORDERBOOK,
    FeedCapability.REALTIME_PRICES,
    FeedCapability.TRADING,
    FeedCapability.SPORTS,
  ],
  dataTypes: ['markets', 'orderbooks', 'prices', 'trades'],
  connectionType: 'hybrid',
  requiredEnv: [],
  optionalEnv: ['SMARKETS_SESSION_TOKEN', 'SMARKETS_API_TOKEN'],
  configKey: 'smarkets',
  docsUrl: 'https://docs.smarkets.com',
  create: async (config) => {
    const { createSmarketsFeed } = await import('./smarkets/index');
    return createSmarketsFeed(config as any) as any;
  },
};

const opinion: FeedDescriptor = {
  id: 'opinion',
  name: 'Opinion.trade',
  description: 'BNB Chain prediction market — DeFi-native with on-chain orderbook',
  status: 'available',
  skillCommand: '/op',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.ORDERBOOK,
    FeedCapability.TRADING,
  ],
  dataTypes: ['markets', 'orderbooks', 'prices', 'trades'],
  connectionType: 'hybrid',
  requiredEnv: [],
  optionalEnv: ['OPINION_API_KEY', 'OPINION_PRIVATE_KEY', 'OPINION_MULTISIG_ADDRESS'],
  configKey: 'opinion',
  create: async (config) => {
    const { createOpinionFeed } = await import('./opinion/index');
    return createOpinionFeed(config as any) as any;
  },
};

const predictfunDesc: FeedDescriptor = {
  id: 'predictfun',
  name: 'Predict.fun',
  description: 'BNB Chain prediction market — CTF exchange with neg-risk support',
  status: 'available',
  skillCommand: '/pf',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.ORDERBOOK,
    FeedCapability.TRADING,
  ],
  dataTypes: ['markets', 'orderbooks', 'prices', 'trades'],
  connectionType: 'polling',
  requiredEnv: [],
  optionalEnv: ['PREDICTFUN_PRIVATE_KEY', 'PREDICTFUN_API_KEY'],
  configKey: 'predictfun',
  create: async (config) => {
    const { createPredictFunFeed } = await import('./predictfun/index');
    return createPredictFunFeed(config as any) as any;
  },
};

const hedgehog: FeedDescriptor = {
  id: 'hedgehog',
  name: 'Hedgehog Markets',
  description: 'Solana prediction market — binary outcomes with AMM + orderbook',
  status: 'available',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.REALTIME_PRICES,
  ],
  dataTypes: ['markets', 'prices'],
  connectionType: 'hybrid',
  requiredEnv: [],
  optionalEnv: ['HEDGEHOG_API_KEY', 'HEDGEHOG_PRIVATE_KEY'],
  configKey: 'hedgehog',
  create: async (config) => {
    const { createHedgehogFeed } = await import('./hedgehog/index');
    return createHedgehogFeed(config as any) as any;
  },
};

const virtuals: FeedDescriptor = {
  id: 'virtuals',
  name: 'Virtuals Protocol',
  description: 'Base chain AI agent marketplace — agent tokens, bonding curves, sentiment',
  status: 'available',
  category: 'crypto',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.CRYPTO_PRICES,
  ],
  dataTypes: ['agents', 'prices', 'bonding_curves'],
  connectionType: 'polling',
  requiredEnv: [],
  optionalEnv: ['VIRTUALS_PRIVATE_KEY', 'VIRTUALS_RPC_URL'],
  configKey: 'virtuals',
  create: async (config) => {
    const { createVirtualsFeed } = await import('./virtuals/index');
    return createVirtualsFeed(config as any) as any;
  },
};

// =============================================================================
// DATA FEEDS
// =============================================================================

const crypto: FeedDescriptor = {
  id: 'crypto',
  name: 'Crypto Prices',
  description: 'Real-time crypto prices — BTC, ETH, SOL, XRP + 7 more via Binance/Coinbase',
  status: 'available',
  category: 'crypto',
  capabilities: [
    FeedCapability.CRYPTO_PRICES,
    FeedCapability.REALTIME_PRICES,
    FeedCapability.HISTORICAL,
  ],
  dataTypes: ['prices', 'ohlcv', 'volume', 'change_24h'],
  connectionType: 'websocket',
  requiredEnv: [],
  optionalEnv: [],
  create: async () => {
    const { createCryptoFeed } = await import('./crypto/index');
    return createCryptoFeed() as any;
  },
};

const news: FeedDescriptor = {
  id: 'news',
  name: 'News & Social',
  description: 'RSS feeds (Reuters, NPR, Politico, 538) + Twitter/X monitoring for market-moving news',
  status: 'available',
  category: 'news',
  capabilities: [
    FeedCapability.NEWS,
  ],
  dataTypes: ['articles', 'tweets', 'sentiment'],
  connectionType: 'polling',
  requiredEnv: [],
  optionalEnv: ['TWITTER_BEARER_TOKEN'],
  configKey: 'news',
  create: async (config) => {
    const { createNewsFeed } = await import('./news/index');
    return createNewsFeed(config as any) as any;
  },
};

const externalData: FeedDescriptor = {
  id: 'external',
  name: 'External Data (Edge)',
  description: 'CME FedWatch, polls, model predictions — fair value estimation for edge detection',
  status: 'available',
  category: 'economics',
  capabilities: [
    FeedCapability.EDGE_DETECTION,
    FeedCapability.ECONOMICS,
    FeedCapability.POLITICS,
  ],
  dataTypes: ['fed_rates', 'polls', 'model_predictions', 'fair_value'],
  connectionType: 'polling',
  requiredEnv: [],
  optionalEnv: [],
  create: async () => {
    // External data module exports individual functions, not a feed factory
    const external = await import('./external/index');
    return {
      analyzeEdge: external.analyzeEdge,
      calculateKelly: external.calculateKelly,
      getFedWatchProbabilities: external.getFedWatchProbabilities,
      searchMarkets: async () => [],
      getMarket: async () => null,
    } as any;
  },
};

// =============================================================================
// WEATHER, GEOPOLITICAL & ECONOMIC FEEDS
// =============================================================================

const weatherOpenMeteo: FeedDescriptor = {
  id: 'weather-openmeteo',
  name: 'Weather (Open-Meteo)',
  description: 'Free weather API — forecasts, historical, alerts for any location. No API key needed.',
  status: 'available',
  category: 'weather',
  capabilities: [
    FeedCapability.WEATHER,
    FeedCapability.HISTORICAL,
  ],
  dataTypes: ['temperature', 'precipitation', 'wind', 'forecasts', 'historical'],
  connectionType: 'polling',
  requiredEnv: [],
  optionalEnv: [],
  docsUrl: 'https://open-meteo.com/en/docs',
  version: '1.0.0',
  create: async () => {
    const { createOpenMeteoFeed } = await import('./weather-openmeteo/index');
    return createOpenMeteoFeed() as any;
  },
};

const weatherNWS: FeedDescriptor = {
  id: 'weather-nws',
  name: 'Weather (NWS)',
  description: 'US National Weather Service — official forecasts, severe weather alerts, observations',
  status: 'available',
  category: 'weather',
  capabilities: [
    FeedCapability.WEATHER,
  ],
  dataTypes: ['forecasts', 'alerts', 'observations'],
  connectionType: 'polling',
  requiredEnv: [],
  optionalEnv: [],
  docsUrl: 'https://www.weather.gov/documentation/services-web-api',
  version: '1.0.0',
  create: async () => {
    const { createNWSFeed } = await import('./weather-nws/index');
    return createNWSFeed() as any;
  },
};

const acledConflict: FeedDescriptor = {
  id: 'acled-conflict',
  name: 'ACLED Conflict Data',
  description: 'Armed conflict & protest events worldwide — real-time geopolitical event tracking',
  status: 'available',
  category: 'geopolitical',
  capabilities: [
    FeedCapability.GEOPOLITICAL,
    FeedCapability.HISTORICAL,
  ],
  dataTypes: ['conflicts', 'protests', 'violence_events', 'fatalities'],
  connectionType: 'polling',
  requiredEnv: ['ACLED_API_KEY'],
  optionalEnv: ['ACLED_EMAIL'],
  docsUrl: 'https://apidocs.acleddata.com',
  version: '1.0.0',
  create: async () => {
    const { createACLEDFeed } = await import('./acled/index');
    return createACLEDFeed() as any;
  },
};

const fredEconomics: FeedDescriptor = {
  id: 'fred',
  name: 'FRED Economic Data',
  description: 'Federal Reserve economic data — GDP, CPI, unemployment, interest rates, 800k+ series',
  status: 'available',
  category: 'economics',
  capabilities: [
    FeedCapability.ECONOMICS,
    FeedCapability.HISTORICAL,
  ],
  dataTypes: ['gdp', 'cpi', 'unemployment', 'interest_rates', 'economic_indicators'],
  connectionType: 'polling',
  requiredEnv: ['FRED_API_KEY'],
  optionalEnv: [],
  docsUrl: 'https://fred.stlouisfed.org/docs/api/fred/',
  version: '1.0.0',
  create: async () => {
    const { createFREDFeed } = await import('./fred/index');
    return createFREDFeed() as any;
  },
};

const polymarketRtds: FeedDescriptor = {
  id: 'polymarket-rtds',
  name: 'Polymarket RTDS',
  description: 'Real-time data stream — Polymarket WebSocket for low-latency price and trade updates',
  status: 'available',
  category: 'prediction_market',
  capabilities: [
    FeedCapability.REALTIME_PRICES,
  ],
  dataTypes: ['prices', 'trades', 'orderbook_updates'],
  connectionType: 'websocket',
  requiredEnv: [],
  optionalEnv: [],
  configKey: 'polymarket',
  create: async () => {
    const { createPolymarketRtds } = await import('./polymarket/rtds');
    return createPolymarketRtds() as any;
  },
};

// =============================================================================
// PERPETUAL FUTURES
// =============================================================================

const percolator: FeedDescriptor = {
  id: 'percolator',
  name: 'Percolator',
  version: '1.0.0',
  description: 'On-chain Solana perpetual futures by Anatoly Yakovenko — leveraged perps with pluggable matchers',
  status: 'available',
  skillCommand: '/percolator',
  category: 'crypto',
  capabilities: [
    FeedCapability.MARKET_DATA,
    FeedCapability.ORDERBOOK,
    FeedCapability.REALTIME_PRICES,
    FeedCapability.TRADING,
  ],
  dataTypes: ['markets', 'orderbooks', 'prices', 'positions'],
  connectionType: 'polling',
  requiredEnv: [],
  optionalEnv: ['PERCOLATOR_PROGRAM_ID', 'PERCOLATOR_SLAB', 'SOLANA_RPC_URL', 'SOLANA_PRIVATE_KEY'],
  configKey: 'percolator',
  docsUrl: 'https://github.com/aeyakovenko/percolator-cli',
  create: async (config) => {
    const { createPercolatorFeed } = await import('../percolator/feed.js');
    return createPercolatorFeed(config as any) as any;
  },
};

// =============================================================================
// REGISTER ALL FEEDS
// =============================================================================

let _registered = false;

export function registerAllFeeds(): void {
  if (_registered) return;
  _registered = true;
  const registry = getGlobalFeedRegistry();

  // Prediction markets
  registry.register(polymarket);
  registry.register(kalshi);
  registry.register(manifold);
  registry.register(metaculus);
  registry.register(predictit);
  registry.register(drift);
  registry.register(agentbets);
  registry.register(betfair);
  registry.register(smarkets);
  registry.register(opinion);
  registry.register(predictfunDesc);
  registry.register(hedgehog);
  registry.register(virtuals);
  registry.register(polymarketRtds);
  registry.register(percolator);

  // Data feeds
  registry.register(crypto);
  registry.register(news);
  registry.register(externalData);

  // Weather, geopolitical & economic data
  registry.register(weatherOpenMeteo);
  registry.register(weatherNWS);
  registry.register(acledConflict);
  registry.register(fredEconomics);
}

/** Get all descriptor objects for programmatic access. */
export const allDescriptors: FeedDescriptor[] = [
  polymarket, kalshi, manifold, metaculus, predictit, drift, agentbets,
  betfair, smarkets, opinion, predictfunDesc, hedgehog, virtuals,
  polymarketRtds, percolator, crypto, news, externalData,
  weatherOpenMeteo, weatherNWS, acledConflict, fredEconomics,
];
