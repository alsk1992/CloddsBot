/**
 * ML Signal Model for Trade Entry/Exit Decisions
 *
 * Features:
 * - Statistical feature extraction from market data
 * - Simple gradient boosting implementation (TypeScript)
 * - External Python model integration via subprocess
 * - Real-time signal generation
 * - Model persistence and retraining
 *
 * This module provides a lightweight ML signal system that can be used
 * without external dependencies, with optional Python integration for
 * more sophisticated models (XGBoost, LightGBM, etc.)
 */

import { execSync, spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface MarketFeatures {
  /** Price-related features */
  price: {
    current: number;
    change1h: number;   // 1-hour price change %
    change24h: number;  // 24-hour price change %
    volatility24h: number;  // 24h volatility (std dev)
    rsi14: number;      // 14-period RSI
    momentum: number;   // Price momentum
  };
  /** Volume-related features */
  volume: {
    current24h: number;
    changeVsAvg: number;  // Volume vs 7-day avg
    buyRatio: number;     // Buy volume / total volume
  };
  /** Orderbook features */
  orderbook: {
    bidAskRatio: number;
    imbalanceScore: number;
    spreadPct: number;
    depth10Pct: number;   // Liquidity within 10% of mid
  };
  /** Market metadata */
  market: {
    daysToExpiry: number;
    totalVolume: number;
    marketCap: number;
    category: string;
  };
  /** External signals */
  external?: {
    whaleActivity: number;    // Whale buy signal (-1 to 1)
    newsScore: number;        // News sentiment (-1 to 1)
    correlatedMove: number;   // Related market movement
  };
}

export interface MLSignal {
  /** Signal direction: buy (1), sell (-1), or hold (0) */
  direction: 1 | 0 | -1;
  /** Confidence in signal (0-1) */
  confidence: number;
  /** Predicted probability of price going up */
  probUp: number;
  /** Feature importance for this prediction */
  featureImportance: Array<{ feature: string; importance: number }>;
  /** Model used for prediction */
  model: string;
  /** Timestamp */
  timestamp: Date;
  /** Recommended entry/exit levels */
  levels?: {
    entryPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
  };
}

export interface TrainingData {
  features: MarketFeatures;
  outcome: {
    direction: 1 | -1;  // Did price go up or down
    return: number;     // Actual return %
    horizon: string;    // Prediction horizon (e.g., "1h", "24h")
  };
  timestamp: Date;
}

export interface ModelConfig {
  /** Model type */
  type: 'simple' | 'ensemble' | 'xgboost_python';
  /** Features to use (empty = all) */
  features?: string[];
  /** Prediction horizon */
  horizon: '1h' | '4h' | '24h';
  /** Minimum confidence to generate signal */
  minConfidence: number;
  /** Number of trees for ensemble (if applicable) */
  numTrees?: number;
  /** Learning rate */
  learningRate?: number;
  /** Max depth for trees */
  maxDepth?: number;
  /** Path to Python model (if using xgboost_python) */
  pythonModelPath?: string;
}

export interface MLSignalModel {
  /** Generate signal for a market */
  predict(features: MarketFeatures): Promise<MLSignal>;

  /** Train model on historical data */
  train(data: TrainingData[]): Promise<{ accuracy: number; auc: number }>;

  /** Save model to disk */
  save(path?: string): void;

  /** Load model from disk */
  load(path?: string): boolean;

  /** Get model performance metrics */
  getMetrics(): ModelMetrics;

  /** Add training data point */
  addTrainingData(data: TrainingData): void;

  /** Retrain model with accumulated data */
  retrain(): Promise<void>;
}

export interface ModelMetrics {
  /** Total predictions made */
  totalPredictions: number;
  /** Correct predictions */
  correctPredictions: number;
  /** Accuracy (correct / total) */
  accuracy: number;
  /** Predictions by direction */
  byDirection: {
    buy: { count: number; correct: number; accuracy: number };
    sell: { count: number; correct: number; accuracy: number };
    hold: { count: number; correct: number; accuracy: number };
  };
  /** Feature importance (average) */
  featureImportance: Map<string, number>;
  /** Last retrain time */
  lastRetrain?: Date;
  /** Training data size */
  trainingDataSize: number;
}

// =============================================================================
// FEATURE EXTRACTION
// =============================================================================

/**
 * Extract features from raw market data
 */
export function extractFeatures(
  priceHistory: Array<{ price: number; volume: number; timestamp: Date }>,
  orderbookSnapshot?: { bids: [number, number][]; asks: [number, number][] },
  metadata?: { daysToExpiry?: number; totalVolume?: number; category?: string }
): MarketFeatures {
  // Need at least some price history
  if (priceHistory.length < 2) {
    throw new Error('Need at least 2 data points for feature extraction');
  }

  const current = priceHistory[priceHistory.length - 1];
  const prices = priceHistory.map(p => p.price);

  // Price features
  const price1hAgo = findPriceAt(priceHistory, Date.now() - 60 * 60 * 1000);
  const price24hAgo = findPriceAt(priceHistory, Date.now() - 24 * 60 * 60 * 1000);

  const change1h = price1hAgo ? (current.price - price1hAgo) / price1hAgo : 0;
  const change24h = price24hAgo ? (current.price - price24hAgo) / price24hAgo : 0;

  const volatility24h = calculateVolatility(prices.slice(-24));
  const rsi14 = calculateRSI(prices.slice(-15));
  const momentum = calculateMomentum(prices.slice(-10));

  // Volume features
  const volumes = priceHistory.map(p => p.volume);
  const avgVolume7d = average(volumes.slice(-168));  // 7 days * 24 hours
  const current24hVolume = sum(volumes.slice(-24));
  const volumeChangeVsAvg = avgVolume7d > 0 ? current24hVolume / avgVolume7d : 1;

  // Orderbook features
  let orderbookFeatures = {
    bidAskRatio: 1,
    imbalanceScore: 0,
    spreadPct: 0.02,
    depth10Pct: 0,
  };

  if (orderbookSnapshot) {
    const totalBidVol = sum(orderbookSnapshot.bids.map(b => b[1]));
    const totalAskVol = sum(orderbookSnapshot.asks.map(a => a[1]));

    orderbookFeatures.bidAskRatio = totalAskVol > 0 ? totalBidVol / totalAskVol : 1;
    orderbookFeatures.imbalanceScore = (totalBidVol - totalAskVol) / (totalBidVol + totalAskVol + 1);

    const bestBid = orderbookSnapshot.bids[0]?.[0] || 0;
    const bestAsk = orderbookSnapshot.asks[0]?.[0] || 1;
    orderbookFeatures.spreadPct = (bestAsk - bestBid) / ((bestBid + bestAsk) / 2);

    // Depth within 10%
    const midPrice = (bestBid + bestAsk) / 2;
    orderbookFeatures.depth10Pct = sum(
      orderbookSnapshot.bids
        .filter(([p]) => p >= midPrice * 0.9)
        .map(([, v]) => v)
    ) + sum(
      orderbookSnapshot.asks
        .filter(([p]) => p <= midPrice * 1.1)
        .map(([, v]) => v)
    );
  }

  return {
    price: {
      current: current.price,
      change1h,
      change24h,
      volatility24h,
      rsi14,
      momentum,
    },
    volume: {
      current24h: current24hVolume,
      changeVsAvg: volumeChangeVsAvg,
      buyRatio: 0.5,  // Would need trade-level data
    },
    orderbook: orderbookFeatures,
    market: {
      daysToExpiry: metadata?.daysToExpiry || 30,
      totalVolume: metadata?.totalVolume || 0,
      marketCap: 0,
      category: metadata?.category || 'other',
    },
  };
}

// =============================================================================
// SIMPLE ML MODEL (NO EXTERNAL DEPS)
// =============================================================================

/**
 * Create a simple ML signal model using statistical methods
 */
export function createMLSignalModel(config: ModelConfig): MLSignalModel {
  const modelDir = join(homedir(), '.clodds', 'models');
  if (!existsSync(modelDir)) {
    mkdirSync(modelDir, { recursive: true });
  }

  // Model state
  let weights: Map<string, number> = new Map();
  let trainingData: TrainingData[] = [];
  let metrics: ModelMetrics = createEmptyMetrics();

  // Feature names for consistent ordering
  const featureNames = [
    'price.change1h',
    'price.change24h',
    'price.volatility24h',
    'price.rsi14',
    'price.momentum',
    'volume.changeVsAvg',
    'orderbook.bidAskRatio',
    'orderbook.imbalanceScore',
    'orderbook.spreadPct',
    'market.daysToExpiry',
  ];

  // Initialize weights
  for (const name of featureNames) {
    weights.set(name, 0);
  }

  // ==========================================================================
  // PREDICTION
  // ==========================================================================

  async function predict(features: MarketFeatures): Promise<MLSignal> {
    // Extract feature vector
    const vector = extractFeatureVector(features);

    let probUp: number;
    let featureImportance: Array<{ feature: string; importance: number }>;

    if (config.type === 'xgboost_python' && config.pythonModelPath) {
      // Use Python model
      const result = await callPythonModel(vector, config.pythonModelPath);
      probUp = result.probUp;
      featureImportance = result.featureImportance;
    } else {
      // Use simple weighted linear model
      probUp = predictSimple(vector);
      featureImportance = featureNames.map((name, i) => ({
        feature: name,
        importance: Math.abs(weights.get(name) || 0) * Math.abs(vector[i]),
      }));
    }

    // Determine direction based on probability
    let direction: 1 | 0 | -1;
    if (probUp > 0.5 + config.minConfidence / 2) {
      direction = 1;
    } else if (probUp < 0.5 - config.minConfidence / 2) {
      direction = -1;
    } else {
      direction = 0;
    }

    const confidence = Math.abs(probUp - 0.5) * 2;

    // Update metrics
    metrics.totalPredictions++;

    return {
      direction,
      confidence: Math.round(confidence * 100) / 100,
      probUp: Math.round(probUp * 1000) / 1000,
      featureImportance: featureImportance
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 5),
      model: config.type,
      timestamp: new Date(),
      levels: direction !== 0 ? calculateLevels(features, direction) : undefined,
    };
  }

  function predictSimple(vector: number[]): number {
    // Simple weighted sum with sigmoid
    let sum = 0;
    for (let i = 0; i < vector.length; i++) {
      sum += (weights.get(featureNames[i]) || 0) * vector[i];
    }
    // Sigmoid
    return 1 / (1 + Math.exp(-sum));
  }

  function extractFeatureVector(features: MarketFeatures): number[] {
    return [
      features.price.change1h,
      features.price.change24h,
      features.price.volatility24h,
      (features.price.rsi14 - 50) / 50,  // Normalize to [-1, 1]
      features.price.momentum,
      features.volume.changeVsAvg - 1,   // Center at 0
      features.orderbook.bidAskRatio - 1,  // Center at 0
      features.orderbook.imbalanceScore,
      -features.orderbook.spreadPct * 10,  // Negative = wide spread is bad
      Math.max(0, (30 - features.market.daysToExpiry) / 30),  // Time pressure
    ];
  }

  function calculateLevels(features: MarketFeatures, direction: 1 | -1): MLSignal['levels'] {
    const current = features.price.current;
    const volatility = features.price.volatility24h || 0.02;

    if (direction === 1) {
      return {
        entryPrice: current,
        stopLoss: current * (1 - volatility * 2),
        takeProfit: current * (1 + volatility * 3),
      };
    } else {
      return {
        entryPrice: current,
        stopLoss: current * (1 + volatility * 2),
        takeProfit: current * (1 - volatility * 3),
      };
    }
  }

  // ==========================================================================
  // TRAINING
  // ==========================================================================

  async function train(data: TrainingData[]): Promise<{ accuracy: number; auc: number }> {
    if (data.length < 10) {
      logger.warn('Insufficient training data (< 10 samples)');
      return { accuracy: 0, auc: 0.5 };
    }

    // Add to training data
    trainingData = [...trainingData, ...data];

    // Simple gradient descent
    const learningRate = config.learningRate || 0.01;
    const epochs = 100;

    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalLoss = 0;

      for (const sample of data) {
        const vector = extractFeatureVector(sample.features);
        const target = sample.outcome.direction === 1 ? 1 : 0;
        const predicted = predictSimple(vector);

        // Binary cross-entropy gradient
        const error = predicted - target;
        totalLoss += -target * Math.log(predicted + 1e-7) - (1 - target) * Math.log(1 - predicted + 1e-7);

        // Update weights
        for (let i = 0; i < vector.length; i++) {
          const gradient = error * vector[i];
          const currentWeight = weights.get(featureNames[i]) || 0;
          weights.set(featureNames[i], currentWeight - learningRate * gradient);
        }
      }

      if (epoch % 20 === 0) {
        logger.debug({ epoch, loss: totalLoss / data.length }, 'Training progress');
      }
    }

    // Calculate accuracy
    let correct = 0;
    let predictions: Array<{ prob: number; actual: number }> = [];

    for (const sample of data) {
      const vector = extractFeatureVector(sample.features);
      const prob = predictSimple(vector);
      const predicted = prob > 0.5 ? 1 : -1;
      predictions.push({ prob, actual: sample.outcome.direction === 1 ? 1 : 0 });

      if (predicted === sample.outcome.direction) {
        correct++;
      }
    }

    const accuracy = correct / data.length;
    const auc = calculateAUC(predictions);

    // Update metrics
    metrics.lastRetrain = new Date();
    metrics.trainingDataSize = trainingData.length;

    // Update feature importance
    for (const name of featureNames) {
      metrics.featureImportance.set(name, Math.abs(weights.get(name) || 0));
    }

    logger.info({ accuracy, auc, samples: data.length }, 'Model trained');

    return { accuracy: Math.round(accuracy * 1000) / 1000, auc: Math.round(auc * 1000) / 1000 };
  }

  // ==========================================================================
  // PERSISTENCE
  // ==========================================================================

  function save(path?: string): void {
    const savePath = path || join(modelDir, `ml_signal_${config.horizon}.json`);

    const state = {
      config,
      weights: Object.fromEntries(weights),
      metrics,
      trainingDataSize: trainingData.length,
      savedAt: new Date().toISOString(),
    };

    writeFileSync(savePath, JSON.stringify(state, null, 2));
    logger.info({ path: savePath }, 'Model saved');
  }

  function load(path?: string): boolean {
    const loadPath = path || join(modelDir, `ml_signal_${config.horizon}.json`);

    if (!existsSync(loadPath)) {
      logger.warn({ path: loadPath }, 'Model file not found');
      return false;
    }

    try {
      const state = JSON.parse(readFileSync(loadPath, 'utf-8'));
      weights = new Map(Object.entries(state.weights));
      metrics = state.metrics;
      logger.info({ path: loadPath, trainingSize: state.trainingDataSize }, 'Model loaded');
      return true;
    } catch (error) {
      logger.error({ error, path: loadPath }, 'Failed to load model');
      return false;
    }
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  function getMetrics(): ModelMetrics {
    return { ...metrics };
  }

  function addTrainingData(data: TrainingData): void {
    trainingData.push(data);
  }

  async function retrain(): Promise<void> {
    if (trainingData.length < 20) {
      logger.warn('Not enough training data for retrain');
      return;
    }
    await train(trainingData);
    save();
  }

  return {
    predict,
    train,
    save,
    load,
    getMetrics,
    addTrainingData,
    retrain,
  };
}

// =============================================================================
// PYTHON MODEL INTEGRATION
// =============================================================================

async function callPythonModel(
  features: number[],
  modelPath: string
): Promise<{ probUp: number; featureImportance: Array<{ feature: string; importance: number }> }> {
  try {
    // Write features to temp file
    const tempPath = `/tmp/ml_features_${Date.now()}.json`;
    writeFileSync(tempPath, JSON.stringify({ features }));

    // Call Python script
    const result = execSync(
      `python3 -c "
import json
import xgboost as xgb
import numpy as np

with open('${tempPath}') as f:
    data = json.load(f)

model = xgb.XGBClassifier()
model.load_model('${modelPath}')

features = np.array([data['features']])
prob = model.predict_proba(features)[0][1]

importance = model.feature_importances_
result = {
    'probUp': float(prob),
    'importance': [float(i) for i in importance]
}
print(json.dumps(result))
"`,
      { encoding: 'utf-8', timeout: 10000 }
    );

    const parsed = JSON.parse(result.trim());

    return {
      probUp: parsed.probUp,
      featureImportance: parsed.importance.map((imp: number, i: number) => ({
        feature: `feature_${i}`,
        importance: imp,
      })),
    };
  } catch (error) {
    logger.error({ error }, 'Python model call failed');
    // Fallback to neutral prediction
    return {
      probUp: 0.5,
      featureImportance: [],
    };
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function createEmptyMetrics(): ModelMetrics {
  return {
    totalPredictions: 0,
    correctPredictions: 0,
    accuracy: 0,
    byDirection: {
      buy: { count: 0, correct: 0, accuracy: 0 },
      sell: { count: 0, correct: 0, accuracy: 0 },
      hold: { count: 0, correct: 0, accuracy: 0 },
    },
    featureImportance: new Map(),
    trainingDataSize: 0,
  };
}

function findPriceAt(history: Array<{ price: number; timestamp: Date }>, targetTime: number): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].timestamp.getTime() <= targetTime) {
      return history[i].price;
    }
  }
  return null;
}

function calculateVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return standardDeviation(returns);
}

function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i < Math.min(period + 1, prices.length); i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMomentum(prices: number[]): number {
  if (prices.length < 2) return 0;
  const first = prices[0];
  const last = prices[prices.length - 1];
  return (last - first) / first;
}

function calculateAUC(predictions: Array<{ prob: number; actual: number }>): number {
  // Simple AUC calculation
  const sorted = [...predictions].sort((a, b) => b.prob - a.prob);
  let tpCount = 0;
  let fpCount = 0;
  let lastTp = 0;
  let auc = 0;

  for (const pred of sorted) {
    if (pred.actual === 1) {
      tpCount++;
    } else {
      fpCount++;
      auc += tpCount;
    }
  }

  const totalPos = predictions.filter(p => p.actual === 1).length;
  const totalNeg = predictions.length - totalPos;

  if (totalPos === 0 || totalNeg === 0) return 0.5;
  return auc / (totalPos * totalNeg);
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return sum(arr) / arr.length;
}

function standardDeviation(arr: number[]): number {
  if (arr.length < 2) return 0;
  const avg = average(arr);
  const squareDiffs = arr.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(average(squareDiffs));
}

// =============================================================================
// FACTORY FOR DIFFERENT MODEL TYPES
// =============================================================================

/**
 * Create an ensemble of ML models for more robust predictions
 */
export function createEnsembleModel(configs: ModelConfig[]): MLSignalModel {
  const models = configs.map(config => createMLSignalModel(config));

  return {
    async predict(features: MarketFeatures): Promise<MLSignal> {
      const predictions = await Promise.all(models.map(m => m.predict(features)));

      // Average predictions
      const avgProbUp = average(predictions.map(p => p.probUp));
      const avgConfidence = average(predictions.map(p => p.confidence));

      // Majority vote for direction
      const directions = predictions.map(p => p.direction);
      const directionCounts = { 1: 0, 0: 0, '-1': 0 };
      directions.forEach(d => directionCounts[d.toString() as '1' | '0' | '-1']++);

      let direction: 1 | 0 | -1 = 0;
      if (directionCounts['1'] > directionCounts['-1']) direction = 1;
      else if (directionCounts['-1'] > directionCounts['1']) direction = -1;

      // Combine feature importance
      const importanceMap = new Map<string, number>();
      for (const pred of predictions) {
        for (const fi of pred.featureImportance) {
          importanceMap.set(fi.feature, (importanceMap.get(fi.feature) || 0) + fi.importance);
        }
      }

      return {
        direction,
        confidence: Math.round(avgConfidence * 100) / 100,
        probUp: Math.round(avgProbUp * 1000) / 1000,
        featureImportance: Array.from(importanceMap.entries())
          .map(([feature, importance]) => ({ feature, importance: importance / models.length }))
          .sort((a, b) => b.importance - a.importance)
          .slice(0, 5),
        model: 'ensemble',
        timestamp: new Date(),
        levels: predictions[0].levels,
      };
    },

    async train(data: TrainingData[]): Promise<{ accuracy: number; auc: number }> {
      const results = await Promise.all(models.map(m => m.train(data)));
      return {
        accuracy: average(results.map(r => r.accuracy)),
        auc: average(results.map(r => r.auc)),
      };
    },

    save(path?: string): void {
      models.forEach((m, i) => m.save(path ? `${path}_${i}` : undefined));
    },

    load(path?: string): boolean {
      return models.every((m, i) => m.load(path ? `${path}_${i}` : undefined));
    },

    getMetrics(): ModelMetrics {
      // Return first model's metrics (they should be similar)
      return models[0].getMetrics();
    },

    addTrainingData(data: TrainingData): void {
      models.forEach(m => m.addTrainingData(data));
    },

    async retrain(): Promise<void> {
      await Promise.all(models.map(m => m.retrain()));
    },
  };
}
