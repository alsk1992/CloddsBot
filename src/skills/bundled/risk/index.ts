/**
 * Risk CLI Skill
 *
 * Commands:
 * /risk - Current risk status
 * /risk status - Detailed status
 * /risk limits - View all limits
 * /risk set <param> <value> - Configure a limit
 * /risk trip "reason" - Manually trip circuit breaker
 * /risk reset - Reset after cooldown
 * /risk kill - Emergency stop all trading
 * /risk check <notional> - Check if a trade is allowed
 * /risk dashboard - Real-time risk metrics
 * /risk var - VaR / CVaR numbers
 * /risk stress [scenario] - Run stress test
 * /risk regime - Current volatility regime
 */

import { enforceMaxOrderSize } from '../../../trading/risk';
import type { RiskEngine } from '../../../risk/engine';
import { createVaRCalculator } from '../../../risk/var';
import { createVolatilityDetector } from '../../../risk/volatility';
import {
  runStressTest,
  getAvailableScenarios,
  type StressPosition,
} from '../../../risk/stress';
import { getRiskDashboard } from '../../../risk/dashboard';

// =============================================================================
// STATE
// =============================================================================

// In-memory risk state — used when no real engine is wired in
let circuitBreakerState: 'armed' | 'tripped' | 'killed' = 'armed';
let tripReason: string | null = null;
let tripTime: number | null = null;

const limits: Record<string, number> = {
  'max-loss': 1000,
  'max-loss-pct': 10,
  'max-drawdown': 20,
  'max-position': 25,
  'max-trades': 50,
  'consecutive-losses': 5,
};

// Shared subsystem instances for dashboard/var/regime commands
const varCalculator = createVaRCalculator({ windowSize: 100 });
const volatilityDetector = createVolatilityDetector();

// Lazy-initialized engine (populated when a real context is available)
let _engine: RiskEngine | null = null;

/**
 * Wire the skill to a real RiskEngine instance. Call this at startup
 * if you have the necessary dependencies (DB, safety manager, etc.).
 */
export function setRiskEngine(engine: RiskEngine): void {
  _engine = engine;
}

// =============================================================================
// HANDLERS
// =============================================================================

function handleStatus(): string {
  let output = '**Risk Status**\n\n';
  output += `Circuit Breaker: ${circuitBreakerState}\n`;
  output += `Trading Allowed: ${circuitBreakerState === 'armed' ? 'Yes' : 'No'}\n`;
  if (tripReason) {
    output += `Trip Reason: ${tripReason}\n`;
  }
  if (tripTime) {
    output += `Tripped At: ${new Date(tripTime).toLocaleString()}\n`;
  }

  // If engine is available, add real metrics
  if (_engine) {
    const risk = _engine.getPortfolioRisk();
    output += `\n**Portfolio Risk**\n`;
    output += `  Regime: ${risk.regime}\n`;
    output += `  VaR (95%): $${risk.var95.toFixed(2)}\n`;
    output += `  VaR (99%): $${risk.var99.toFixed(2)}\n`;
    output += `  CVaR (95%): $${risk.cvar95.toFixed(2)}\n`;
    output += `  Drawdown: ${risk.drawdownPct.toFixed(1)}%\n`;
    output += `  Daily P&L: $${risk.dailyPnL.toFixed(2)}\n`;
    output += `  Positions: ${risk.positionCount}\n`;
  }

  output += '\n**Limits:**\n';
  for (const [key, value] of Object.entries(limits)) {
    output += `  ${key}: ${value}\n`;
  }
  return output;
}

function handleLimits(): string {
  let output = '**Risk Limits**\n\n';
  output += `| Parameter | Value |\n`;
  output += `|-----------|-------|\n`;
  for (const [key, value] of Object.entries(limits)) {
    output += `| ${key} | ${value} |\n`;
  }
  return output;
}

function handleSet(param: string, value: string): string {
  const numValue = parseFloat(value);
  if (isNaN(numValue)) {
    return `Invalid value: ${value}. Must be a number.`;
  }

  const validParams = Object.keys(limits);
  if (!validParams.includes(param)) {
    return `Unknown parameter: ${param}\n\nValid parameters: ${validParams.join(', ')}`;
  }

  limits[param] = numValue;
  return `Set **${param}** to **${numValue}**`;
}

function handleTrip(reason: string): string {
  if (circuitBreakerState === 'killed') {
    return 'System is in KILLED state. Use `/risk reset` first.';
  }
  circuitBreakerState = 'tripped';
  tripReason = reason || 'Manual trip';
  tripTime = Date.now();
  return `Circuit breaker **TRIPPED**: ${tripReason}`;
}

function handleReset(): string {
  if (circuitBreakerState === 'armed') {
    return 'Circuit breaker is already armed. No reset needed.';
  }
  circuitBreakerState = 'armed';
  tripReason = null;
  tripTime = null;
  return 'Circuit breaker **RESET**. Trading is now allowed.';
}

function handleKill(): string {
  circuitBreakerState = 'killed';
  tripReason = 'Emergency kill switch activated';
  tripTime = Date.now();
  return '**EMERGENCY STOP** - All trading disabled. Manual reset required via `/risk reset`.';
}

function handleCheck(notionalStr: string): string {
  const notional = parseFloat(notionalStr);
  if (isNaN(notional) || notional <= 0) {
    return 'Usage: /risk check <notional>\n\nExample: /risk check 500';
  }

  if (circuitBreakerState !== 'armed') {
    return `Trade **BLOCKED** - Circuit breaker is ${circuitBreakerState}.\nReason: ${tripReason || 'N/A'}`;
  }

  const maxOrderSize = limits['max-loss'] || 1000;
  const result = enforceMaxOrderSize(
    { tradingContext: { maxOrderSize }, db: { getUser: () => undefined, getPositions: () => [] } },
    notional,
    `Risk check for $${notional}`
  );

  if (result) {
    return `Trade **BLOCKED**:\n\`\`\`json\n${result}\n\`\`\``;
  }

  return `Trade **ALLOWED** - $${notional} is within risk limits.`;
}

function handleDashboard(): string {
  if (_engine) {
    const db = _engine.getDashboard();
    let output = '**Risk Dashboard**\n\n';
    output += `| Metric | Value |\n`;
    output += `|--------|-------|\n`;
    output += `| VaR (95%) | $${db.portfolioVaR95.toFixed(2)} |\n`;
    output += `| VaR (99%) | $${db.portfolioVaR99.toFixed(2)} |\n`;
    output += `| CVaR (95%) | $${db.cvar95.toFixed(2)} |\n`;
    output += `| Regime | ${db.regime} (${db.regimeSizeMultiplier}x) |\n`;
    output += `| Circuit Breaker | ${db.circuitBreakerTripped ? 'TRIPPED' : 'OK'} |\n`;
    output += `| Daily P&L | $${db.dailyPnL.toFixed(2)} |\n`;
    output += `| Daily Loss Limit | $${db.dailyLossLimit} |\n`;
    output += `| Loss Utilization | ${(db.dailyLossUtilization * 100).toFixed(0)}% |\n`;
    output += `| Drawdown | ${db.currentDrawdown.toFixed(1)}% / ${db.maxDrawdown}% |\n`;
    output += `| Open Positions | ${db.openPositions} |\n`;
    output += `| Concentration (HHI) | ${db.concentrationHHI} |\n`;
    output += `| Kill Switch | ${db.killSwitchActive ? 'ACTIVE' : 'Off'} |\n`;
    output += `| Kelly Fraction | ${db.kellyFraction} |\n`;

    if (db.warnings.length > 0) {
      output += `\n**Warnings:**\n`;
      for (const w of db.warnings) {
        output += `- ${w}\n`;
      }
    }
    return output;
  }

  // Fallback: use standalone subsystems
  const dashboard = getRiskDashboard({
    varCalculator,
    volatilityDetector,
  });

  let output = '**Risk Dashboard** (standalone mode)\n\n';
  output += `| Metric | Value |\n`;
  output += `|--------|-------|\n`;
  output += `| VaR (95%) | $${dashboard.portfolioVaR95.toFixed(2)} |\n`;
  output += `| VaR (99%) | $${dashboard.portfolioVaR99.toFixed(2)} |\n`;
  output += `| Regime | ${dashboard.regime} |\n`;
  output += `| Circuit Breaker | ${circuitBreakerState} |\n`;
  output += `\n*Connect a RiskEngine for full metrics.*`;
  return output;
}

function handleVaR(): string {
  if (_engine) {
    const calc = _engine.getVaRCalculator();
    const var95 = calc.calculateAt(0.95);
    const var99 = calc.calculateAt(0.99);

    let output = '**Value-at-Risk**\n\n';
    output += `| Metric | Value |\n`;
    output += `|--------|-------|\n`;
    output += `| Historical VaR (95%) | $${var95.historicalVaR.toFixed(2)} |\n`;
    output += `| Parametric VaR (95%) | $${var95.parametricVaR.toFixed(2)} |\n`;
    output += `| CVaR / ES (95%) | $${var95.cvar.toFixed(2)} |\n`;
    output += `| Historical VaR (99%) | $${var99.historicalVaR.toFixed(2)} |\n`;
    output += `| Parametric VaR (99%) | $${var99.parametricVaR.toFixed(2)} |\n`;
    output += `| CVaR / ES (99%) | $${var99.cvar.toFixed(2)} |\n`;
    output += `| Sample Size | ${var95.sampleSize} |\n`;
    output += `| Mean P&L | $${var95.meanPnL.toFixed(2)} |\n`;
    output += `| Std Dev | $${var95.stdDev.toFixed(2)} |\n`;

    const positions = calc.positionVaR();
    if (positions.length > 0) {
      output += '\n**Per-Position VaR (95%)**\n\n';
      output += `| Position | VaR | Contribution |\n`;
      output += `|----------|-----|--------------|\n`;
      for (const p of positions.slice(0, 10)) {
        output += `| ${p.positionId} | $${p.var95.toFixed(2)} | ${(p.varContribution * 100).toFixed(0)}% |\n`;
      }
    }

    return output;
  }

  // Fallback
  const var95 = varCalculator.calculateAt(0.95);
  let output = '**Value-at-Risk** (standalone mode)\n\n';
  output += `VaR (95%): $${var95.historicalVaR.toFixed(2)}\n`;
  output += `CVaR (95%): $${var95.cvar.toFixed(2)}\n`;
  output += `Sample Size: ${var95.sampleSize}\n`;
  output += `\n*Connect a RiskEngine and record trades for meaningful VaR.*`;
  return output;
}

function handleStress(scenarioArg?: string): string {
  const positions: StressPosition[] = [];

  // Try to get real positions from engine
  if (_engine) {
    const risk = _engine.getPortfolioRisk();
    // Use portfolio snapshot as a single position if we don't have detail
    if (risk.totalValue > 0) {
      positions.push({
        id: 'portfolio',
        platform: 'mixed',
        value: risk.totalValue,
        pnlPct: 0,
        side: 'long',
      });
    }
  }

  if (positions.length === 0) {
    // Show available scenarios even without positions
    const scenarios = getAvailableScenarios();
    let output = '**Stress Test** — No positions to test against\n\n';
    output += 'Available scenarios:\n';
    for (const s of scenarios) {
      output += `- \`${s.name}\` — ${s.description}\n`;
    }
    output += '\nUsage: `/risk stress flash_crash`';
    return output;
  }

  const result = runStressTest(positions, scenarioArg || 'flash_crash');

  let output = `**Stress Test: ${result.scenario}**\n\n`;
  output += `${result.description}\n\n`;
  output += `| Metric | Value |\n`;
  output += `|--------|-------|\n`;
  output += `| Estimated Loss | $${result.estimatedLoss.toFixed(2)} (${result.estimatedLossPct.toFixed(1)}%) |\n`;
  output += `| Portfolio Before | $${result.portfolioValueBefore.toFixed(2)} |\n`;
  output += `| Portfolio After | $${result.portfolioValueAfter.toFixed(2)} |\n`;
  output += `| Positions at Risk | ${result.positionsAtRisk} |\n`;
  output += `| Severity | ${result.severity.toUpperCase()} |\n`;

  if (result.mostAffected.length > 0) {
    output += `\n**Most Affected:**\n`;
    for (const p of result.mostAffected) {
      output += `- ${p.id}: -$${p.estimatedLoss.toFixed(2)}\n`;
    }
  }

  output += `\n**Recommendations:**\n`;
  for (const r of result.recommendations) {
    output += `- ${r}\n`;
  }

  return output;
}

function handleRegime(): string {
  if (_engine) {
    const detector = _engine.getVolatilityDetector();
    const snapshot = detector.detect();

    let output = '**Volatility Regime**\n\n';
    output += `| Metric | Value |\n`;
    output += `|--------|-------|\n`;
    output += `| Regime | ${snapshot.regime.toUpperCase()} |\n`;
    output += `| Size Multiplier | ${snapshot.sizeMultiplier}x |\n`;
    output += `| Rolling Std Dev | ${(snapshot.rollingStdDev * 100).toFixed(2)}% |\n`;
    output += `| ATR | ${(snapshot.atr * 100).toFixed(2)}% |\n`;
    output += `| Mean P&L | ${(snapshot.meanPnL * 100).toFixed(2)}% |\n`;
    output += `| Sample Size | ${snapshot.sampleSize} |\n`;
    output += `| Should Halt | ${snapshot.shouldHalt ? 'YES' : 'No'} |\n`;

    output += '\n**Regime Thresholds:**\n';
    output += '- low: 1.2x (calm)\n';
    output += '- normal: 1.0x (baseline)\n';
    output += '- high: 0.5x (reduced)\n';
    output += '- extreme: 0.25x (minimal/halt)\n';

    return output;
  }

  // Fallback
  const snapshot = volatilityDetector.detect();
  let output = '**Volatility Regime** (standalone mode)\n\n';
  output += `Regime: ${snapshot.regime.toUpperCase()}\n`;
  output += `Size Multiplier: ${snapshot.sizeMultiplier}x\n`;
  output += `Sample Size: ${snapshot.sampleSize}\n`;
  output += `\n*Connect a RiskEngine and record trades for live regime detection.*`;
  return output;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'status';
  const rest = parts.slice(1);

  switch (command) {
    case 'status':
      return handleStatus();

    case 'limits':
      return handleLimits();

    case 'set':
      if (rest.length < 2) return 'Usage: /risk set <param> <value>\n\nExample: /risk set max-loss 2000';
      return handleSet(rest[0], rest[1]);

    case 'trip':
      return handleTrip(rest.join(' '));

    case 'reset':
      return handleReset();

    case 'kill':
      return handleKill();

    case 'check':
      if (!rest[0]) return 'Usage: /risk check <notional>\n\nExample: /risk check 500';
      return handleCheck(rest[0]);

    case 'dashboard':
    case 'dash':
      return handleDashboard();

    case 'var':
      return handleVaR();

    case 'stress':
      return handleStress(rest[0]);

    case 'regime':
    case 'vol':
      return handleRegime();

    case 'help':
    default:
      return `**Risk Management Commands**

**Status:**
  /risk                         Current risk status
  /risk status                  Detailed status
  /risk limits                  View all limits
  /risk dashboard               Real-time risk metrics
  /risk var                     VaR / CVaR numbers
  /risk stress [scenario]       Run stress test
  /risk regime                  Volatility regime

**Configure:**
  /risk set max-loss 1000       Max daily loss ($)
  /risk set max-loss-pct 10     Max daily loss (%)
  /risk set max-drawdown 20     Max drawdown (%)
  /risk set max-position 25     Max single position (%)
  /risk set max-trades 50       Max trades per day
  /risk set consecutive-losses 5  Stop after N losses

**Circuit Breaker:**
  /risk trip "reason"           Manually trip breaker
  /risk reset                   Reset after cooldown
  /risk kill                    Emergency stop all trading

**Checks:**
  /risk check 500               Check if trade is allowed

**Stress Scenarios:**
  flash_crash, liquidity_crunch, platform_down,
  correlation_spike, black_swan`;
  }
}

export default {
  name: 'risk',
  description: 'Circuit breaker, loss limits, VaR, stress tests, and automated risk controls',
  commands: ['/risk'],
  handle: execute,
};
