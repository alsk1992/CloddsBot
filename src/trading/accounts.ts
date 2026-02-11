/**
 * Multi-Account Trading - Run bots across multiple accounts for A/B testing
 *
 * Features:
 * - Multiple Polymarket/Kalshi accounts
 * - Account-scoped bot instances
 * - A/B test tracking and comparison
 * - Isolated risk per account
 */

import { EventEmitter } from 'eventemitter3';
import { Database } from '../db/index';
import { logger } from '../utils/logger';
import type { Platform } from '../types';
import type { ExecutionConfig } from '../execution/index';
import type { TradeStats } from './logger';

// =============================================================================
// TYPES
// =============================================================================

export interface TradingAccount {
  id: string;
  name: string;
  platform: Platform;
  /** Account type for organization */
  type: 'live' | 'paper' | 'test_a' | 'test_b' | 'backup';
  /** Credentials (stored encrypted in practice) */
  credentials: AccountCredentials;
  /** Risk limits for this account */
  risk: AccountRiskLimits;
  /** Enabled for trading */
  enabled: boolean;
  /** Tags for filtering */
  tags?: string[];
  /** Notes */
  notes?: string;
  createdAt: Date;
}

export interface AccountCredentials {
  // Polymarket
  apiKey?: string;
  apiSecret?: string;
  apiPassphrase?: string;
  privateKey?: string;
  funderAddress?: string;
  // Kalshi
  email?: string;
  password?: string;
  apiKeyId?: string;
  // Generic
  [key: string]: string | undefined;
}

export interface AccountRiskLimits {
  /** Max order size for this account */
  maxOrderSize: number;
  /** Max total exposure */
  maxExposure: number;
  /** Daily loss limit */
  dailyLossLimit?: number;
  /** Stop trading if hit */
  stopOnDailyLoss?: boolean;
}

export interface ABTest {
  id: string;
  name: string;
  description?: string;
  /** Strategy being tested */
  strategyId: string;
  /** Accounts in the test */
  accounts: ABTestAccount[];
  /** Test parameters that differ */
  variations: Record<string, ABTestVariation>;
  /** Test status */
  status: 'pending' | 'running' | 'paused' | 'completed';
  /** Start/end times */
  startedAt?: Date;
  endedAt?: Date;
  /** Minimum trades before significance */
  minTrades: number;
  /** Results */
  results?: ABTestResults;
  createdAt: Date;
}

export interface ABTestAccount {
  accountId: string;
  /** Variation assigned to this account */
  variation: string;
  /** Bot instance ID */
  botInstanceId?: string;
}

export interface ABTestVariation {
  name: string;
  /** Parameter overrides for this variation */
  params: Record<string, unknown>;
}

export interface ABTestResults {
  /** Per-variation stats */
  byVariation: Record<string, {
    accountId: string;
    trades: number;
    winRate: number;
    totalPnL: number;
    avgPnL: number;
    sharpeRatio: number;
  }>;
  /** Statistical significance */
  significance?: {
    winner: string;
    pValue: number;
    confident: boolean;
  };
  /** Summary */
  summary: string;
}

export interface AccountManager extends EventEmitter {
  /** Add a trading account */
  addAccount(account: Omit<TradingAccount, 'id' | 'createdAt'>): TradingAccount;

  /** Update account */
  updateAccount(accountId: string, updates: Partial<TradingAccount>): boolean;

  /** Remove account */
  removeAccount(accountId: string): boolean;

  /** Get account by ID */
  getAccount(accountId: string): TradingAccount | null;

  /** List all accounts */
  listAccounts(platform?: Platform): TradingAccount[];

  /** Get execution config for account */
  getExecutionConfig(accountId: string): ExecutionConfig | null;

  /** Create A/B test */
  createABTest(test: Omit<ABTest, 'id' | 'createdAt' | 'status'>): ABTest;

  /** Start A/B test (launches bots on all accounts) */
  startABTest(testId: string): Promise<boolean>;

  /** Stop A/B test */
  stopABTest(testId: string): Promise<void>;

  /** Get A/B test status */
  getABTest(testId: string): ABTest | null;

  /** List A/B tests */
  listABTests(): ABTest[];

  /** Calculate A/B test results */
  calculateResults(testId: string): ABTestResults | null;

  /** Compare accounts performance */
  compareAccounts(accountIds: string[], days?: number): AccountComparison;

  /** Clone strategy to account with variations */
  cloneStrategyToAccount(
    strategyId: string,
    accountId: string,
    paramOverrides?: Record<string, unknown>
  ): string;
}

export interface AccountComparison {
  accounts: Array<{
    id: string;
    name: string;
    stats: TradeStats;
  }>;
  best: {
    byPnL: string;
    byWinRate: string;
    bySharpe: string;
  };
  summary: string;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createAccountManager(db: Database): AccountManager {
  const emitter = new EventEmitter() as AccountManager;
  const accounts = new Map<string, TradingAccount>();
  const abTests = new Map<string, ABTest>();

  // Initialize tables
  db.run(`
    CREATE TABLE IF NOT EXISTS trading_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      type TEXT NOT NULL,
      credentials_json TEXT,
      risk_json TEXT,
      enabled INTEGER DEFAULT 1,
      tags_json TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ab_tests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      strategy_id TEXT NOT NULL,
      accounts_json TEXT NOT NULL,
      variations_json TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      min_trades INTEGER DEFAULT 30,
      results_json TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // Load existing accounts
  try {
    const rows = db.query<any>(`SELECT * FROM trading_accounts`);
    for (const row of rows) {
      try {
        accounts.set(row.id, {
          id: row.id,
          name: row.name,
          platform: row.platform as Platform,
          type: row.type,
          credentials: row.credentials_json ? JSON.parse(row.credentials_json) : {},
          risk: row.risk_json ? JSON.parse(row.risk_json) : { maxOrderSize: 100, maxExposure: 1000 },
          enabled: row.enabled === 1,
          tags: row.tags_json ? JSON.parse(row.tags_json) : undefined,
          notes: row.notes,
          createdAt: new Date(row.created_at),
        });
      } catch (e) {
        logger.warn({ accountId: row.id, error: e }, 'Skipping account with corrupt JSON');
      }
    }
    logger.info({ count: accounts.size }, 'Loaded trading accounts');
  } catch {
    logger.debug('No existing trading accounts');
  }

  // Load existing A/B tests
  try {
    const rows = db.query<any>(`SELECT * FROM ab_tests`);
    for (const row of rows) {
      abTests.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        strategyId: row.strategy_id,
        accounts: JSON.parse(row.accounts_json),
        variations: JSON.parse(row.variations_json),
        status: row.status,
        startedAt: row.started_at ? new Date(row.started_at) : undefined,
        endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
        minTrades: row.min_trades,
        results: row.results_json ? JSON.parse(row.results_json) : undefined,
        createdAt: new Date(row.created_at),
      });
    }
    logger.info({ count: abTests.size }, 'Loaded A/B tests');
  } catch {
    logger.debug('No existing A/B tests');
  }

  function generateId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function saveAccount(account: TradingAccount): void {
    accounts.set(account.id, account);
    db.run(
      `INSERT OR REPLACE INTO trading_accounts
       (id, name, platform, type, credentials_json, risk_json, enabled, tags_json, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        account.id,
        account.name,
        account.platform,
        account.type,
        JSON.stringify(account.credentials),
        JSON.stringify(account.risk),
        account.enabled ? 1 : 0,
        account.tags ? JSON.stringify(account.tags) : null,
        account.notes || null,
        account.createdAt.toISOString(),
      ]
    );
  }

  function saveABTest(test: ABTest): void {
    abTests.set(test.id, test);
    db.run(
      `INSERT OR REPLACE INTO ab_tests
       (id, name, description, strategy_id, accounts_json, variations_json, status,
        started_at, ended_at, min_trades, results_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        test.id,
        test.name,
        test.description || null,
        test.strategyId,
        JSON.stringify(test.accounts),
        JSON.stringify(test.variations),
        test.status,
        test.startedAt?.toISOString() || null,
        test.endedAt?.toISOString() || null,
        test.minTrades,
        test.results ? JSON.stringify(test.results) : null,
        test.createdAt.toISOString(),
      ]
    );
  }

  // Attach methods
  Object.assign(emitter, {
    addAccount(data) {
      const account: TradingAccount = {
        ...data,
        id: generateId('acc'),
        createdAt: new Date(),
      };

      saveAccount(account);
      emitter.emit('accountAdded', account);
      logger.info({ accountId: account.id, name: account.name, platform: account.platform }, 'Account added');

      return account;
    },

    updateAccount(accountId, updates) {
      const account = accounts.get(accountId);
      if (!account) return false;

      Object.assign(account, updates);
      saveAccount(account);
      emitter.emit('accountUpdated', account);

      return true;
    },

    removeAccount(accountId) {
      const account = accounts.get(accountId);
      if (!account) return false;

      accounts.delete(accountId);
      db.run(`DELETE FROM trading_accounts WHERE id = ?`, [accountId]);
      emitter.emit('accountRemoved', accountId);

      return true;
    },

    getAccount(accountId) {
      return accounts.get(accountId) || null;
    },

    listAccounts(platform) {
      const all = Array.from(accounts.values());
      return platform ? all.filter((a) => a.platform === platform) : all;
    },

    getExecutionConfig(accountId) {
      const account = accounts.get(accountId);
      if (!account) return null;

      if (account.platform === 'polymarket') {
        return {
          polymarket: {
            apiKey: account.credentials.apiKey || '',
            apiSecret: account.credentials.apiSecret || '',
            apiPassphrase: account.credentials.apiPassphrase || '',
            privateKey: account.credentials.privateKey,
            funderAddress: account.credentials.funderAddress,
          },
          maxOrderSize: account.risk.maxOrderSize,
          dryRun: account.type === 'paper',
        };
      }

      if (account.platform === 'kalshi') {
        return {
          kalshi: {
            apiKeyId: account.credentials.apiKeyId || '',
            privateKeyPath: account.credentials.privateKeyPath || '',
          },
          maxOrderSize: account.risk.maxOrderSize,
          dryRun: account.type === 'paper',
        };
      }

      return null;
    },

    createABTest(data) {
      const test: ABTest = {
        ...data,
        id: generateId('ab'),
        status: 'pending',
        createdAt: new Date(),
      };

      saveABTest(test);
      emitter.emit('abTestCreated', test);
      logger.info({ testId: test.id, name: test.name, accounts: test.accounts.length }, 'A/B test created');

      return test;
    },

    async startABTest(testId) {
      const test = abTests.get(testId);
      if (!test) return false;

      if (test.status === 'running') {
        logger.warn({ testId }, 'A/B test already running');
        return false;
      }

      test.status = 'running';
      test.startedAt = new Date();
      saveABTest(test);

      // Emit event for bot manager to start bots
      emitter.emit('abTestStarted', test);
      logger.info({ testId, accounts: test.accounts.length }, 'A/B test started');

      return true;
    },

    async stopABTest(testId) {
      const test = abTests.get(testId);
      if (!test) return;

      test.status = 'completed';
      test.endedAt = new Date();

      // Calculate final results
      const results = emitter.calculateResults(testId);
      if (results) {
        test.results = results;
      }

      saveABTest(test);
      emitter.emit('abTestStopped', test);
      logger.info({ testId, results: results?.summary }, 'A/B test stopped');
    },

    getABTest(testId) {
      return abTests.get(testId) || null;
    },

    listABTests() {
      return Array.from(abTests.values());
    },

    calculateResults(testId) {
      const test = abTests.get(testId);
      if (!test) return null;

      // This would query trade stats per account from the trade logger
      // Simplified implementation - in production would pull real stats
      const byVariation: ABTestResults['byVariation'] = {};

      for (const testAccount of test.accounts) {
        const variation = test.variations[testAccount.variation];
        if (!variation) continue;

        // Would query: trading.logger.getStats({ accountId: testAccount.accountId })
        byVariation[testAccount.variation] = {
          accountId: testAccount.accountId,
          trades: 0,
          winRate: 0,
          totalPnL: 0,
          avgPnL: 0,
          sharpeRatio: 0,
        };
      }

      // Calculate statistical significance (simplified)
      const variations = Object.keys(byVariation);
      let winner = variations[0];
      let bestPnL = -Infinity;

      for (const v of variations) {
        if (byVariation[v].totalPnL > bestPnL) {
          bestPnL = byVariation[v].totalPnL;
          winner = v;
        }
      }

      const totalTrades = Object.values(byVariation).reduce((sum, v) => sum + v.trades, 0);

      return {
        byVariation,
        significance: {
          winner,
          pValue: 0.5, // Would calculate real p-value
          confident: totalTrades >= test.minTrades,
        },
        summary: `${winner} leads with $${bestPnL.toFixed(2)} PnL (${totalTrades} total trades)`,
      };
    },

    compareAccounts(accountIds, days = 30) {
      const comparison: AccountComparison = {
        accounts: [],
        best: {
          byPnL: '',
          byWinRate: '',
          bySharpe: '',
        },
        summary: '',
      };

      let bestPnL = -Infinity;
      let bestWinRate = -Infinity;
      let bestSharpe = -Infinity;

      for (const accountId of accountIds) {
        const account = accounts.get(accountId);
        if (!account) continue;

        // Would query real stats from trade logger
        const stats: TradeStats = {
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          totalPnL: 0,
          avgPnL: 0,
          avgWin: 0,
          avgLoss: 0,
          largestWin: 0,
          largestLoss: 0,
          profitFactor: 0,
          totalVolume: 0,
          totalFees: 0,
          totalMakerRebates: 0,
          netFees: 0,
          makerTrades: 0,
          takerTrades: 0,
          byPlatform: {} as any,
          byStrategy: {},
        };

        comparison.accounts.push({
          id: account.id,
          name: account.name,
          stats,
        });

        if (stats.totalPnL > bestPnL) {
          bestPnL = stats.totalPnL;
          comparison.best.byPnL = account.id;
        }
        if (stats.winRate > bestWinRate) {
          bestWinRate = stats.winRate;
          comparison.best.byWinRate = account.id;
        }
      }

      comparison.summary = `Compared ${accountIds.length} accounts over ${days} days`;
      return comparison;
    },

    cloneStrategyToAccount(strategyId, accountId, paramOverrides) {
      const account = accounts.get(accountId);
      if (!account) {
        throw new Error(`Account ${accountId} not found`);
      }

      const instanceId = `${strategyId}_${accountId}_${Date.now().toString(36)}`;

      emitter.emit('strategyCloned', {
        strategyId,
        accountId,
        instanceId,
        paramOverrides,
      });

      logger.info({ strategyId, accountId, instanceId }, 'Strategy cloned to account');
      return instanceId;
    },
  } as Partial<AccountManager>);

  return emitter;
}

// =============================================================================
// CONVENIENCE TYPES
// =============================================================================

export interface QuickABTestConfig {
  name: string;
  strategyId: string;
  /** Account A (control) */
  accountA: string;
  /** Account B (test) */
  accountB: string;
  /** Parameter to vary */
  varyParam: string;
  /** Value for account A */
  valueA: unknown;
  /** Value for account B */
  valueB: unknown;
  /** Min trades for significance */
  minTrades?: number;
}

/** Quick helper to create common A/B test */
export function createQuickABTest(
  manager: AccountManager,
  config: QuickABTestConfig
): ABTest {
  return manager.createABTest({
    name: config.name,
    strategyId: config.strategyId,
    accounts: [
      { accountId: config.accountA, variation: 'control' },
      { accountId: config.accountB, variation: 'test' },
    ],
    variations: {
      control: {
        name: 'Control (A)',
        params: { [config.varyParam]: config.valueA },
      },
      test: {
        name: 'Test (B)',
        params: { [config.varyParam]: config.valueB },
      },
    },
    minTrades: config.minTrades || 30,
  });
}
