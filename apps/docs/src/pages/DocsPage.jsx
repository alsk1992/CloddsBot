import React from 'react';
import DocsLayout from '../components/DocsLayout';
import CodeBlock, { InlineCode } from '../components/CodeBlock';

// Feature card component
function FeatureCard({ icon, title, description }) {
  return (
    <div className="p-6 bg-white rounded-xl border border-gray-200 hover:shadow-md transition-shadow">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-600">{description}</p>
    </div>
  );
}

// Command table component
function CommandTable({ commands }) {
  return (
    <div className="overflow-x-auto my-4">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Command</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {commands.map((cmd, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-4 py-3 whitespace-nowrap">
                <code className="text-sm text-indigo-600 font-mono">{cmd.command}</code>
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">{cmd.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Section component
function Section({ id, title, children }) {
  return (
    <section id={id} className="mb-16 scroll-mt-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-6 pb-2 border-b border-gray-200">
        {title}
      </h2>
      {children}
    </section>
  );
}

// Subsection component
function Subsection({ title, children }) {
  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">{title}</h3>
      {children}
    </div>
  );
}

// Alert component
function Alert({ type = 'info', children }) {
  const styles = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    success: 'bg-green-50 border-green-200 text-green-800',
    danger: 'bg-red-50 border-red-200 text-red-800',
  };

  const icons = {
    info: 'i',
    warning: '!',
    success: '✓',
    danger: '×',
  };

  return (
    <div className={`p-4 rounded-lg border ${styles[type]} my-4`}>
      <div className="flex items-start">
        <span className="font-bold mr-2">{icons[type]}</span>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <DocsLayout>
      {/* Hero */}
      <div className="mb-16">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Clodds Trading Documentation
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          Cross-platform prediction market trading with arbitrage detection,
          automated bots, and comprehensive risk management.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FeatureCard
            icon="🎯"
            title="Opportunity Finder"
            description="Semantic matching finds arbitrage across 8+ platforms automatically"
          />
          <FeatureCard
            icon="🤖"
            title="Trading Bots"
            description="Built-in strategies with customizable entry/exit logic"
          />
          <FeatureCard
            icon="🛡️"
            title="Safety Controls"
            description="Circuit breakers, drawdown limits, and kill switches"
          />
        </div>
      </div>

      {/* Quick Start */}
      <Section id="quickstart" title="Quick Start">
        <p className="text-gray-600 mb-4">
          Get up and running in minutes with the trading system.
        </p>

        <CodeBlock language="typescript" title="Initialize Trading System">
{`import { createTradingSystem } from './trading';
import { createOpportunityFinder } from './opportunity';

// Create trading system
const trading = createTradingSystem(db, {
  execution: {
    polymarket: { apiKey: '...', apiSecret: '...' },
    dryRun: false,
  },
  portfolioValue: 10000,
});

// Create opportunity finder
const finder = createOpportunityFinder(db, feeds, embeddings, {
  minEdge: 0.5,
  semanticMatching: true,
});

// Find opportunities
const opps = await finder.scan({ minEdge: 1 });

// Execute a trade
await trading.execution.buyLimit({
  platform: 'polymarket',
  marketId: opps[0].markets[0].marketId,
  outcome: 'YES',
  price: 0.45,
  size: 100,
});`}
        </CodeBlock>
      </Section>

      {/* Commands */}
      <Section id="commands" title="Commands">
        <Subsection title="Opportunity Commands">
          <CommandTable commands={[
            { command: '/opportunity scan [query]', description: 'Find arbitrage opportunities' },
            { command: '/opportunity active', description: 'Show active opportunities' },
            { command: '/opportunity link <a> <b>', description: 'Link equivalent markets' },
            { command: '/opportunity stats', description: 'View performance statistics' },
            { command: '/opportunity pairs', description: 'Platform pair analysis' },
            { command: '/opportunity realtime start', description: 'Enable real-time scanning' },
          ]} />
        </Subsection>

        <Subsection title="Trading Commands">
          <CommandTable commands={[
            { command: '/bot list', description: 'Show all trading bots' },
            { command: '/bot start <id>', description: 'Start a bot' },
            { command: '/bot stop <id>', description: 'Stop a bot' },
            { command: '/trades stats', description: 'View trade statistics' },
            { command: '/trades recent', description: 'Recent trade history' },
            { command: '/safety status', description: 'Safety controls status' },
            { command: '/safety kill', description: 'Emergency stop all trading' },
          ]} />
        </Subsection>
      </Section>

      {/* Opportunity Finder */}
      <Section id="opportunity-overview" title="Opportunity Finder">
        <p className="text-gray-600 mb-6">
          Automatically detects arbitrage and edge opportunities across multiple
          prediction market platforms using semantic matching and real-time price analysis.
        </p>

        <div className="bg-gray-50 rounded-xl p-6 mb-6">
          <h4 className="font-semibold text-gray-800 mb-4">Supported Platforms</h4>
          <div className="flex flex-wrap gap-2">
            {['Polymarket', 'Kalshi', 'Betfair', 'Manifold', 'PredictIt', 'Metaculus', 'Drift', 'Smarkets'].map(p => (
              <span key={p} className="px-3 py-1 bg-white rounded-full text-sm text-gray-700 border border-gray-200">
                {p}
              </span>
            ))}
          </div>
        </div>
      </Section>

      {/* Opportunity Types */}
      <Section id="opportunity-types" title="Opportunity Types">
        <div className="space-y-6">
          <div className="p-6 bg-white rounded-xl border border-gray-200">
            <div className="flex items-center mb-3">
              <span className="text-2xl mr-3">🔄</span>
              <h3 className="font-semibold text-gray-900">Internal Arbitrage</h3>
            </div>
            <p className="text-gray-600 mb-4">
              Buy both YES and NO on the same market when combined price is less than $1.00.
            </p>
            <CodeBlock language="text">
{`Example: Polymarket "Will X happen?"
  YES: 45c + NO: 52c = 97c
  Edge: 3% guaranteed profit`}
            </CodeBlock>
          </div>

          <div className="p-6 bg-white rounded-xl border border-gray-200">
            <div className="flex items-center mb-3">
              <span className="text-2xl mr-3">🌐</span>
              <h3 className="font-semibold text-gray-900">Cross-Platform Arbitrage</h3>
            </div>
            <p className="text-gray-600 mb-4">
              Same market priced differently across platforms. Semantic matching catches equivalent questions.
            </p>
            <CodeBlock language="text">
{`Example: "Fed rate hike in January"
  Polymarket YES: 65c
  Kalshi YES: 72c

  Strategy: Buy low, sell high
  Edge: 7%`}
            </CodeBlock>
          </div>

          <div className="p-6 bg-white rounded-xl border border-gray-200">
            <div className="flex items-center mb-3">
              <span className="text-2xl mr-3">📊</span>
              <h3 className="font-semibold text-gray-900">Edge vs Fair Value</h3>
            </div>
            <p className="text-gray-600 mb-4">
              Market mispriced relative to external benchmarks (polls, prediction models).
            </p>
            <CodeBlock language="text">
{`Example: Election market
  Market price: 45%
  538 model: 52%
  Edge: 7% (buy YES)`}
            </CodeBlock>
          </div>
        </div>
      </Section>

      {/* Scoring System */}
      <Section id="scoring" title="Scoring System">
        <p className="text-gray-600 mb-6">
          Opportunities are scored 0-100 based on multiple factors to prioritize the best trades.
        </p>

        <div className="overflow-x-auto my-4">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Factor</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Weight</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              <tr><td className="px-4 py-3 font-medium">Edge %</td><td className="px-4 py-3">35%</td><td className="px-4 py-3 text-gray-600">Raw arbitrage spread</td></tr>
              <tr><td className="px-4 py-3 font-medium">Liquidity</td><td className="px-4 py-3">25%</td><td className="px-4 py-3 text-gray-600">Available $ to trade</td></tr>
              <tr><td className="px-4 py-3 font-medium">Confidence</td><td className="px-4 py-3">25%</td><td className="px-4 py-3 text-gray-600">Match quality</td></tr>
              <tr><td className="px-4 py-3 font-medium">Execution</td><td className="px-4 py-3">15%</td><td className="px-4 py-3 text-gray-600">Platform reliability</td></tr>
            </tbody>
          </table>
        </div>

        <Alert type="info">
          Penalties are applied for low liquidity (-5), cross-platform complexity (-3 per platform),
          high slippage (-5 if &gt;2%), and low confidence (-5 if &lt;70%).
        </Alert>
      </Section>

      {/* Market Matching */}
      <Section id="matching" title="Market Matching">
        <Subsection title="Semantic Matching">
          <p className="text-gray-600 mb-4">
            Uses embeddings to match markets with different wording that refer to the same event.
          </p>
          <CodeBlock language="text">
{`"Will the Fed raise rates?"
  = "FOMC vote for rate hike?"
  = "Federal Reserve interest rate increase?"`}
          </CodeBlock>
        </Subsection>

        <Subsection title="Manual Linking">
          <p className="text-gray-600 mb-4">
            Override automatic matching for known equivalent markets:
          </p>
          <CodeBlock language="bash">
{`/opportunity link polymarket:abc123 kalshi:fed-rate-jan`}
          </CodeBlock>
        </Subsection>
      </Section>

      {/* Trading Bots */}
      <Section id="bots" title="Trading Bots">
        <p className="text-gray-600 mb-6">
          Run automated trading strategies with built-in risk management.
        </p>

        <CodeBlock language="typescript" title="Start a Bot">
{`// Register strategy
trading.bots.registerStrategy(createMeanReversionStrategy({
  platforms: ['polymarket'],
  threshold: 0.05,
  stopLoss: 0.1,
}));

// Start trading
await trading.bots.startBot('mean-reversion');

// Monitor status
const status = trading.bots.getBotStatus('mean-reversion');
console.log(\`Trades: \${status.tradesCount}, Win Rate: \${status.winRate}%\`);`}
        </CodeBlock>
      </Section>

      {/* Strategies */}
      <Section id="strategies" title="Built-in Strategies">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-2">Mean Reversion</h4>
            <p className="text-sm text-gray-600">Buys dips, sells rallies based on deviation from average</p>
          </div>
          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-2">Momentum</h4>
            <p className="text-sm text-gray-600">Follows trends and rides price movements</p>
          </div>
          <div className="p-4 bg-white rounded-lg border border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-2">Arbitrage</h4>
            <p className="text-sm text-gray-600">Exploits cross-platform price differences</p>
          </div>
        </div>

        <Subsection title="Custom Strategy">
          <CodeBlock language="typescript">
{`const myStrategy: Strategy = {
  config: {
    id: 'my-strategy',
    name: 'My Custom Strategy',
    platforms: ['polymarket'],
    intervalMs: 60000,
  },

  async evaluate(context) {
    const signals = [];
    const price = context.prices.get('polymarket:market123');

    if (price && price < 0.3) {
      signals.push({
        type: 'buy',
        platform: 'polymarket',
        marketId: 'market123',
        outcome: 'YES',
        price: price,
        sizePct: 5,
        reason: 'Undervalued',
      });
    }
    return signals;
  },
};

trading.bots.registerStrategy(myStrategy);`}
          </CodeBlock>
        </Subsection>
      </Section>

      {/* Safety Controls */}
      <Section id="safety" title="Safety Controls">
        <Alert type="warning">
          Always configure safety limits before live trading. The kill switch
          immediately stops all bots and blocks new trades.
        </Alert>

        <div className="overflow-x-auto my-4">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Breaker</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Default</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              <tr><td className="px-4 py-3 font-medium">Daily Loss</td><td className="px-4 py-3">$500</td><td className="px-4 py-3 text-gray-600">Max loss per day</td></tr>
              <tr><td className="px-4 py-3 font-medium">Max Drawdown</td><td className="px-4 py-3">20%</td><td className="px-4 py-3 text-gray-600">From peak equity</td></tr>
              <tr><td className="px-4 py-3 font-medium">Position Limit</td><td className="px-4 py-3">25%</td><td className="px-4 py-3 text-gray-600">Single position max</td></tr>
              <tr><td className="px-4 py-3 font-medium">Correlation</td><td className="px-4 py-3">3</td><td className="px-4 py-3 text-gray-600">Max same-direction bets</td></tr>
            </tbody>
          </table>
        </div>

        <CodeBlock language="bash" title="Emergency Stop">
{`/safety kill "Market volatility"
# Immediately stops all bots and blocks new trades

/safety resume
# Resume trading after review`}
        </CodeBlock>
      </Section>

      {/* A/B Testing */}
      <Section id="abtesting" title="A/B Testing">
        <p className="text-gray-600 mb-4">
          Run the same strategy on multiple accounts with different parameters to optimize performance.
        </p>

        <CodeBlock language="typescript">
{`// Create test
const test = createQuickABTest(trading.accounts, {
  name: 'Stop Loss Test',
  strategyId: 'mean-reversion',
  accountA: 'main-account',
  accountB: 'test-account',
  varyParam: 'stopLossPct',
  valueA: 5,
  valueB: 10,
});

// Start test
await trading.accounts.startABTest(test.id);

// Check results
const results = trading.accounts.calculateResults(test.id);
console.log('Winner:', results.significance.winner);`}
        </CodeBlock>
      </Section>

      {/* Configuration */}
      <Section id="config" title="Configuration">
        <CodeBlock language="json" title="clodds.json">
{`{
  "opportunityFinder": {
    "enabled": true,
    "minEdge": 0.5,
    "minLiquidity": 100,
    "platforms": ["polymarket", "kalshi", "betfair"],
    "semanticMatching": true,
    "realtime": false
  },
  "trading": {
    "execution": {
      "polymarket": {
        "apiKey": "...",
        "apiSecret": "..."
      },
      "dryRun": false
    },
    "portfolioValue": 10000
  },
  "safety": {
    "dailyLossLimit": 500,
    "maxDrawdownPct": 20
  }
}`}
        </CodeBlock>
      </Section>

      {/* Footer */}
      <div className="mt-16 pt-8 border-t border-gray-200">
        <p className="text-sm text-gray-500 text-center">
          Clodds Trading Documentation • Built with React
        </p>
      </div>
    </DocsLayout>
  );
}
