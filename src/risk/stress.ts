/**
 * Stress Testing
 *
 * Predefined and custom scenarios to evaluate portfolio resilience:
 * - Flash crash: all positions lose 20% instantly
 * - Liquidity crunch: slippage doubles, partial fills
 * - Platform down: one platform unavailable, positions stuck
 * - Correlation spike: all positions move together (correlation -> 1.0)
 * - Black swan: 3-sigma move across all markets
 */

// =============================================================================
// TYPES
// =============================================================================

export type ScenarioName =
  | 'flash_crash'
  | 'liquidity_crunch'
  | 'platform_down'
  | 'correlation_spike'
  | 'black_swan';

export interface StressPosition {
  /** Position ID or label */
  id: string;
  /** Platform hosting this position */
  platform: string;
  /** Current value in USD */
  value: number;
  /** Current P&L percentage (as decimal, e.g. 0.05 for +5%) */
  pnlPct: number;
  /** Side: YES/NO or long/short */
  side: 'long' | 'short';
}

export interface StressResult {
  /** Scenario that was run */
  scenario: ScenarioName | string;
  /** Description of the scenario */
  description: string;
  /** Estimated portfolio loss in USD */
  estimatedLoss: number;
  /** Estimated loss as percentage of portfolio */
  estimatedLossPct: number;
  /** Total portfolio value before stress */
  portfolioValueBefore: number;
  /** Estimated portfolio value after stress */
  portfolioValueAfter: number;
  /** Number of positions at risk of total loss */
  positionsAtRisk: number;
  /** Positions most affected */
  mostAffected: Array<{ id: string; estimatedLoss: number }>;
  /** Recommended actions */
  recommendations: string[];
  /** Severity: how bad is this scenario */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface StressTestConfig {
  /** Custom scenario overrides */
  scenarios?: Partial<Record<ScenarioName, { lossPct: number; description: string }>>;
}

// =============================================================================
// SCENARIO DEFINITIONS
// =============================================================================

interface ScenarioDef {
  name: ScenarioName;
  description: string;
  /** How much each position loses (as decimal fraction of value) */
  lossFraction: number;
  /** Does this scenario affect all platforms equally? */
  affectsAllPlatforms: boolean;
  /** Additional effects */
  effects: string[];
}

const SCENARIOS: Record<ScenarioName, ScenarioDef> = {
  flash_crash: {
    name: 'flash_crash',
    description: 'All positions lose 20% of value instantly',
    lossFraction: 0.20,
    affectsAllPlatforms: true,
    effects: ['Rapid price decline', 'Stop losses may not execute at target', 'Liquidity dries up temporarily'],
  },
  liquidity_crunch: {
    name: 'liquidity_crunch',
    description: 'Slippage doubles, fills are partial — effective loss ~10%',
    lossFraction: 0.10,
    affectsAllPlatforms: true,
    effects: ['Order book thins out', 'Market orders fill at worse prices', 'Limit orders may not fill'],
  },
  platform_down: {
    name: 'platform_down',
    description: 'Primary platform goes offline — cannot close positions',
    lossFraction: 0.15,
    affectsAllPlatforms: false,
    effects: ['Cannot exit positions', 'No new hedges possible', 'Positions may expire unfavorably'],
  },
  correlation_spike: {
    name: 'correlation_spike',
    description: 'All positions move together — correlation approaches 1.0',
    lossFraction: 0.25,
    affectsAllPlatforms: true,
    effects: ['Diversification benefit vanishes', 'Portfolio drawdown amplified', 'Hedges fail'],
  },
  black_swan: {
    name: 'black_swan',
    description: '3-sigma move across all markets — extreme tail event',
    lossFraction: 0.40,
    affectsAllPlatforms: true,
    effects: ['Unprecedented market move', 'Models break down', 'Margin calls possible', 'Recovery uncertain'],
  },
};

// =============================================================================
// IMPLEMENTATION
// =============================================================================

function classifySeverity(lossPct: number): StressResult['severity'] {
  if (lossPct < 5) return 'low';
  if (lossPct < 15) return 'medium';
  if (lossPct < 30) return 'high';
  return 'critical';
}

function generateRecommendations(
  scenario: ScenarioDef,
  lossPct: number,
  positions: StressPosition[]
): string[] {
  const recs: string[] = [];

  if (lossPct > 20) {
    recs.push('Reduce overall portfolio exposure immediately');
  }

  if (positions.length > 5) {
    recs.push('Consider closing weakest positions to reduce exposure');
  }

  // Platform-specific
  if (!scenario.affectsAllPlatforms) {
    const platforms = [...new Set(positions.map((p) => p.platform))];
    if (platforms.length < 2) {
      recs.push('Diversify across multiple platforms to reduce single-platform risk');
    }
  }

  // Direction concentration
  const longCount = positions.filter((p) => p.side === 'long').length;
  const shortCount = positions.filter((p) => p.side === 'short').length;
  const total = positions.length;
  if (total > 0 && (longCount / total > 0.8 || shortCount / total > 0.8)) {
    recs.push('Portfolio is directionally concentrated — consider hedging with opposing positions');
  }

  // Correlation scenario
  if (scenario.name === 'correlation_spike') {
    recs.push('Add uncorrelated positions or explicit hedges');
  }

  // Generic
  if (lossPct > 10) {
    recs.push('Review and tighten stop-loss levels');
    recs.push('Consider reducing position sizes via Kelly criterion');
  }

  if (recs.length === 0) {
    recs.push('Portfolio appears resilient to this scenario');
  }

  return recs;
}

/**
 * Run a stress test scenario against a set of positions.
 */
export function runStressTest(
  positions: StressPosition[],
  scenario: ScenarioName | string = 'flash_crash',
  config: StressTestConfig = {}
): StressResult {
  const baseDef = SCENARIOS[scenario as ScenarioName];

  if (!baseDef) {
    // Custom scenario — apply a generic 15% loss
    return runCustomScenario(positions, scenario, 0.15);
  }

  // Apply config overrides if provided
  const override = config.scenarios?.[scenario as ScenarioName];
  const scenarioDef: ScenarioDef = override
    ? { ...baseDef, lossFraction: override.lossPct / 100, description: override.description }
    : baseDef;

  const portfolioValue = positions.reduce((sum, p) => sum + p.value, 0);

  if (portfolioValue === 0 || positions.length === 0) {
    return {
      scenario,
      description: scenarioDef.description,
      estimatedLoss: 0,
      estimatedLossPct: 0,
      portfolioValueBefore: 0,
      portfolioValueAfter: 0,
      positionsAtRisk: 0,
      mostAffected: [],
      recommendations: ['No open positions — no risk exposure'],
      severity: 'low',
    };
  }

  // Pre-compute platform concentration for platform_down scenario
  let largestPlatform: string | undefined;
  if (scenarioDef.name === 'platform_down') {
    const platformValues = new Map<string, number>();
    for (const p of positions) {
      platformValues.set(p.platform, (platformValues.get(p.platform) || 0) + p.value);
    }
    largestPlatform = [...platformValues.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  // Calculate per-position impact
  const impacts: Array<{ id: string; estimatedLoss: number }> = [];
  let totalLoss = 0;
  let atRisk = 0;

  for (const pos of positions) {
    // Adjust loss fraction based on position characteristics
    let effectiveLoss = scenarioDef.lossFraction;

    // Short positions may benefit from crash scenarios
    if (pos.side === 'short' && (scenarioDef.name === 'flash_crash' || scenarioDef.name === 'black_swan')) {
      effectiveLoss = -effectiveLoss * 0.5; // Shorts gain partially
    }

    // Platform-down only affects largest platform concentration
    if (scenarioDef.name === 'platform_down' && pos.platform !== largestPlatform) {
      effectiveLoss = 0; // Other platforms unaffected
    }

    const loss = pos.value * effectiveLoss;
    totalLoss += loss;

    if (loss > 0) {
      impacts.push({ id: pos.id, estimatedLoss: Math.round(loss * 100) / 100 });
    }

    // Position at risk if loss exceeds 50% of value
    if (effectiveLoss > 0.5) {
      atRisk++;
    }
  }

  totalLoss = Math.max(0, totalLoss);
  const lossPct = portfolioValue > 0 ? (totalLoss / portfolioValue) * 100 : 0;

  return {
    scenario,
    description: scenarioDef.description,
    estimatedLoss: Math.round(totalLoss * 100) / 100,
    estimatedLossPct: Math.round(lossPct * 100) / 100,
    portfolioValueBefore: Math.round(portfolioValue * 100) / 100,
    portfolioValueAfter: Math.round((portfolioValue - totalLoss) * 100) / 100,
    positionsAtRisk: atRisk,
    mostAffected: impacts.sort((a, b) => b.estimatedLoss - a.estimatedLoss).slice(0, 5),
    recommendations: generateRecommendations(scenarioDef, lossPct, positions),
    severity: classifySeverity(lossPct),
  };
}

function runCustomScenario(
  positions: StressPosition[],
  scenarioName: string,
  lossFraction: number
): StressResult {
  const portfolioValue = positions.reduce((sum, p) => sum + p.value, 0);
  const totalLoss = portfolioValue * lossFraction;
  const lossPct = portfolioValue > 0 ? lossFraction * 100 : 0;

  const impacts = positions
    .map((p) => ({ id: p.id, estimatedLoss: Math.round(p.value * lossFraction * 100) / 100 }))
    .sort((a, b) => b.estimatedLoss - a.estimatedLoss)
    .slice(0, 5);

  return {
    scenario: scenarioName,
    description: `Custom scenario: ${lossFraction * 100}% loss across all positions`,
    estimatedLoss: Math.round(totalLoss * 100) / 100,
    estimatedLossPct: Math.round(lossPct * 100) / 100,
    portfolioValueBefore: Math.round(portfolioValue * 100) / 100,
    portfolioValueAfter: Math.round((portfolioValue - totalLoss) * 100) / 100,
    positionsAtRisk: 0,
    mostAffected: impacts,
    recommendations: lossPct > 10 ? ['Consider reducing exposure'] : ['Portfolio within tolerance'],
    severity: classifySeverity(lossPct),
  };
}

/**
 * Run all predefined scenarios and return results sorted by severity.
 */
export function runAllScenarios(positions: StressPosition[]): StressResult[] {
  const scenarioNames = Object.keys(SCENARIOS) as ScenarioName[];
  return scenarioNames
    .map((name) => runStressTest(positions, name))
    .sort((a, b) => b.estimatedLossPct - a.estimatedLossPct);
}

/**
 * Get list of available scenario names.
 */
export function getAvailableScenarios(): Array<{ name: ScenarioName; description: string }> {
  return Object.values(SCENARIOS).map((s) => ({ name: s.name, description: s.description }));
}
