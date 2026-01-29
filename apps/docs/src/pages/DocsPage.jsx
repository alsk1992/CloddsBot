import React, { useState } from 'react';
import { Link } from 'react-router-dom';

// Navigation structure
const navigation = [
  {
    title: 'Getting Started',
    items: [
      { id: 'quickstart', name: 'Quick Start' },
      { id: 'cli-commands', name: 'CLI Commands' },
      { id: 'chat-commands', name: 'Chat Commands' },
      { id: 'configuration', name: 'Configuration' },
    ],
  },
  {
    title: 'Channels (22)',
    items: [
      { id: 'channels-overview', name: 'Overview' },
      { id: 'telegram-setup', name: 'Telegram' },
      { id: 'discord-setup', name: 'Discord' },
      { id: 'other-channels', name: 'Other Channels' },
    ],
  },
  {
    title: 'Markets (9)',
    items: [
      { id: 'markets-overview', name: 'Overview' },
      { id: 'polymarket', name: 'Polymarket' },
      { id: 'kalshi', name: 'Kalshi' },
      { id: 'other-markets', name: 'Other Markets' },
    ],
  },
  {
    title: 'Arbitrage',
    items: [
      { id: 'arb-overview', name: 'Overview' },
      { id: 'arb-types', name: 'Opportunity Types' },
      { id: 'arb-combinatorial', name: 'Combinatorial' },
      { id: 'arb-scoring', name: 'Scoring System' },
    ],
  },
  {
    title: 'Trading',
    items: [
      { id: 'trading-execution', name: 'Execution' },
      { id: 'trading-bots', name: 'Trading Bots' },
      { id: 'trading-safety', name: 'Safety Controls' },
    ],
  },
  {
    title: 'AI & Tools',
    items: [
      { id: 'ai-providers', name: 'LLM Providers' },
      { id: 'ai-tools', name: 'Tools (21)' },
      { id: 'ai-memory', name: 'Memory System' },
      { id: 'ai-skills', name: 'Skills (13)' },
    ],
  },
  {
    title: 'Crypto & DeFi',
    items: [
      { id: 'solana-dex', name: 'Solana DEX' },
      { id: 'wormhole', name: 'Wormhole Bridge' },
      { id: 'x402', name: 'x402 Payments' },
    ],
  },
];

function CodeBlock({ children, title, language = 'bash' }) {
  return (
    <div className="my-4 rounded-lg overflow-hidden border border-slate-700">
      {title && (
        <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 text-sm text-slate-400">
          {title}
        </div>
      )}
      <pre className="p-4 bg-slate-900 overflow-x-auto">
        <code className="text-sm text-slate-300 font-mono">{children}</code>
      </pre>
    </div>
  );
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="mb-16 scroll-mt-24">
      <h2 className="text-2xl font-bold text-white mb-6 pb-3 border-b border-slate-700">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Subsection({ title, children }) {
  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold text-slate-200 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Table({ headers, rows }) {
  return (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700">
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-3 text-left text-slate-400 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-slate-300">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ children, color = 'cyan' }) {
  const colors = {
    cyan: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    green: 'bg-green-500/20 text-green-400 border-green-500/30',
    purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  };
  return (
    <span className={`px-2 py-1 text-xs rounded border ${colors[color]}`}>
      {children}
    </span>
  );
}

function Alert({ type = 'info', children }) {
  const styles = {
    info: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300',
    warning: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300',
    success: 'bg-green-500/10 border-green-500/30 text-green-300',
  };
  return (
    <div className={`p-4 rounded-lg border ${styles[type]} my-4`}>
      {children}
    </div>
  );
}

export default function DocsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Mobile toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-slate-800 rounded-lg border border-slate-700"
      >
        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-72 bg-slate-800/50 backdrop-blur-sm border-r border-slate-700
        transform transition-transform duration-200 ease-in-out overflow-y-auto
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
      `}>
        <div className="p-6">
          <Link to="/" className="flex items-center gap-3 mb-2">
            <img src="/logo.png" alt="Clodds" className="w-8 h-8" />
            <span className="text-xl font-bold text-white">Clodds</span>
          </Link>
          <p className="text-sm text-slate-400 mb-6">Documentation</p>

          <nav className="space-y-6">
            {navigation.map((section) => (
              <div key={section.title}>
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  {section.title}
                </h2>
                <ul className="space-y-1">
                  {section.items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        onClick={() => setSidebarOpen(false)}
                        className="block px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-md transition-colors"
                      >
                        {item.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="mt-8 pt-6 border-t border-slate-700">
            <a
              href="https://github.com/alsk1992/CloddsBot"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-slate-400 hover:text-white"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="lg:pl-72">
        <div className="max-w-4xl mx-auto px-6 py-12">

          {/* Hero */}
          <div className="mb-16">
            <h1 className="text-4xl font-bold text-white mb-4">Clodds Documentation</h1>
            <p className="text-xl text-slate-400 mb-6">
              AI-powered prediction market trading platform. 22 channels, 9 markets, 21 tools.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge color="cyan">22 Channels</Badge>
              <Badge color="green">9 Markets</Badge>
              <Badge color="purple">21 Tools</Badge>
              <Badge color="yellow">13 Skills</Badge>
            </div>
          </div>

          {/* Quick Start */}
          <Section id="quickstart" title="Quick Start">
            <p className="text-slate-400 mb-4">Get running in under 2 minutes.</p>

            <CodeBlock title="Terminal">
{`git clone https://github.com/alsk1992/CloddsBot.git
cd CloddsBot
npm install
cp .env.example .env
# Add ANTHROPIC_API_KEY to .env
npm run build && npm start`}
            </CodeBlock>

            <p className="text-slate-400 mt-4">
              Open <code className="text-cyan-400">http://localhost:18789/webchat</code> — no account needed.
            </p>

            <Alert type="info">
              For Telegram: add <code>TELEGRAM_BOT_TOKEN</code> to <code>.env</code> and message your bot.
            </Alert>
          </Section>

          {/* CLI Commands */}
          <Section id="cli-commands" title="CLI Commands">
            <p className="text-slate-400 mb-4">All terminal commands start with <code className="text-cyan-400">clodds</code>:</p>

            <Subsection title="Core">
              <CodeBlock>
{`clodds start                    # Start the gateway
clodds repl                     # Interactive local REPL
clodds doctor                   # Run system diagnostics
clodds status                   # Show system status
clodds endpoints                # Show webhook endpoints`}
              </CodeBlock>
            </Subsection>

            <Subsection title="User Management">
              <CodeBlock>
{`clodds pairing list <channel>   # List pending pairing requests
clodds pairing approve <ch> <c> # Approve a pairing request
clodds pairing users <channel>  # List paired users
clodds pairing add <ch> <user>  # Add user to allowlist`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Configuration">
              <CodeBlock>
{`clodds config get [key]         # Get config value
clodds config set <key> <val>   # Set config value
clodds config path              # Show config file path`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Skills & Extensions">
              <CodeBlock>
{`clodds skills list              # List installed skills
clodds skills search <query>    # Search skill registry
clodds skills install <slug>    # Install a skill
clodds skills update [slug]     # Update skills`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Sessions, Memory & MCP">
              <CodeBlock>
{`clodds session list             # List active sessions
clodds session clear [id]       # Clear session(s)
clodds memory list <userId>     # View user memories
clodds memory clear <userId>    # Clear memories
clodds mcp list                 # List MCP servers
clodds mcp add <name> <cmd>     # Add MCP server`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Chat Commands */}
          <Section id="chat-commands" title="Chat Commands">
            <p className="text-slate-400 mb-4">These work inside any chat (Telegram, Discord, WebChat, etc.):</p>

            <Subsection title="Opportunity Finding">
              <CodeBlock>
{`/opportunity scan [query]        Find arbitrage opportunities
/opportunity combinatorial       Scan conditional dependencies
/opportunity active              Show active opportunities
/opportunity stats               Performance statistics
/opportunity link <a> <b>        Link equivalent markets
/opportunity realtime start      Enable real-time scanning`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Trading">
              <CodeBlock>
{`/buy <platform> <market> <side> <size> @ <price>
/sell <platform> <market> <side> <size> @ <price>
/portfolio                       Show positions and P&L
/trades stats                    Trade statistics
/trades recent                   Recent history`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Bots & Safety">
              <CodeBlock>
{`/bot list                        List trading bots
/bot start <id>                  Start a bot
/bot stop <id>                   Stop a bot
/safety status                   View safety controls
/safety kill                     Emergency stop all`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Research & Memory">
              <CodeBlock>
{`/markets <query>                 Search all markets
/compare <query>                 Compare prices across platforms
/news <topic>                    Get relevant news
/remember <type> <key>=<value>   Store preference/fact/note
/memory                          View stored memories
/help                            List all commands`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Configuration */}
          <Section id="configuration" title="Configuration">
            <Subsection title="Environment Variables">
              <CodeBlock title=".env">
{`# Required
ANTHROPIC_API_KEY=sk-ant-...

# Channels (pick any)
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
SLACK_BOT_TOKEN=...
SLACK_APP_TOKEN=...

# Trading
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
KALSHI_API_KEY=...
BETFAIR_APP_KEY=...

# Solana
SOLANA_RPC_URL=...
SOLANA_PRIVATE_KEY=...

# Features
MARKET_INDEX_ENABLED=true
OPPORTUNITY_FINDER_ENABLED=true`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Config File">
              <CodeBlock title="clodds.json">
{`{
  "gateway": { "port": 18789 },
  "agent": { "model": "claude-sonnet-4-20250514" },
  "opportunityFinder": {
    "enabled": true,
    "minEdge": 0.5,
    "platforms": ["polymarket", "kalshi", "betfair"]
  },
  "safety": {
    "dailyLossLimit": 500,
    "maxDrawdownPct": 20,
    "maxPositionPct": 25
  },
  "trading": { "dryRun": true }
}`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Channels Overview */}
          <Section id="channels-overview" title="Channels Overview (22)">
            <p className="text-slate-400 mb-6">Connect via any messaging platform you already use.</p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
              {['Telegram', 'Discord', 'WhatsApp', 'Slack', 'Teams', 'Matrix', 'Signal', 'Google Chat', 'iMessage', 'LINE', 'Mattermost', 'Nextcloud Talk', 'Zalo', 'Nostr', 'Tlon/Urbit', 'Twitch', 'Voice', 'WebChat', 'IRC', 'Email', 'SMS', 'Webhook'].map(ch => (
                <div key={ch} className="px-3 py-2 bg-slate-800 rounded-lg text-slate-300 text-sm text-center border border-slate-700">
                  {ch}
                </div>
              ))}
            </div>

            <Alert type="success">
              All channels support: real-time sync, message editing, rich text, images, reactions, and offline queuing.
            </Alert>
          </Section>

          {/* Telegram Setup */}
          <Section id="telegram-setup" title="Telegram Setup">
            <ol className="list-decimal list-inside space-y-2 text-slate-400">
              <li>Create bot via <a href="https://t.me/botfather" className="text-cyan-400 hover:underline">@BotFather</a></li>
              <li>Copy the token</li>
              <li>Add <code className="text-cyan-400">TELEGRAM_BOT_TOKEN=...</code> to <code>.env</code></li>
              <li>Restart Clodds</li>
              <li>Message your bot</li>
            </ol>
          </Section>

          {/* Discord Setup */}
          <Section id="discord-setup" title="Discord Setup">
            <ol className="list-decimal list-inside space-y-2 text-slate-400">
              <li>Create app at <a href="https://discord.com/developers" className="text-cyan-400 hover:underline">Discord Developer Portal</a></li>
              <li>Enable <strong>Message Content Intent</strong> under Bot settings</li>
              <li>Copy bot token</li>
              <li>Add <code className="text-cyan-400">DISCORD_BOT_TOKEN=...</code> to <code>.env</code></li>
              <li>Generate OAuth2 URL with <code>bot</code> scope and invite to server</li>
            </ol>
          </Section>

          {/* Other Channels */}
          <Section id="other-channels" title="Other Channels">
            <Table
              headers={['Channel', 'Setup', 'Auth']}
              rows={[
                ['Slack', 'Create app, enable Socket Mode', 'Bot + App tokens'],
                ['WhatsApp', 'BlueBubbles or Baileys', 'Session file'],
                ['Teams', 'Azure AD app registration', 'OAuth'],
                ['Matrix', 'Homeserver account', 'Access token'],
                ['Signal', 'Signal-cli bridge', 'Phone number'],
                ['WebChat', 'Built-in, no setup', 'None'],
              ]}
            />
          </Section>

          {/* Markets Overview */}
          <Section id="markets-overview" title="Markets Overview (9)">
            <Subsection title="Full Trading Support">
              <Table
                headers={['Platform', 'Feed', 'Trading', 'Type']}
                rows={[
                  ['Polymarket', 'WebSocket', '✓', 'Crypto (USDC)'],
                  ['Kalshi', 'WebSocket', '✓', 'US Regulated'],
                  ['Betfair', 'WebSocket', '✓', 'Sports Exchange'],
                  ['Smarkets', 'WebSocket', '✓', 'Sports (2% fees)'],
                  ['Drift', 'REST', '✓', 'Solana DEX'],
                ]}
              />
            </Subsection>

            <Subsection title="Data Feeds Only">
              <Table
                headers={['Platform', 'Feed', 'Type']}
                rows={[
                  ['Manifold', 'WebSocket', 'Play Money'],
                  ['Metaculus', 'REST', 'Forecasting'],
                  ['PredictIt', 'REST', 'US Politics'],
                ]}
              />
            </Subsection>
          </Section>

          {/* Polymarket */}
          <Section id="polymarket" title="Polymarket Integration">
            <p className="text-slate-400 mb-4">Full trading support with CLOB API.</p>

            <CodeBlock title=".env">
{`POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_FUNDER_ADDRESS=0x...`}
            </CodeBlock>

            <p className="text-slate-400 mt-4">Features: limit/market orders, real-time orderbook, position tracking, P&L calculation.</p>
          </Section>

          {/* Kalshi */}
          <Section id="kalshi" title="Kalshi Integration">
            <p className="text-slate-400 mb-4">US regulated exchange with full trading support.</p>

            <CodeBlock title=".env">
{`KALSHI_API_KEY=...
KALSHI_EMAIL=...`}
            </CodeBlock>
          </Section>

          {/* Other Markets */}
          <Section id="other-markets" title="Other Markets">
            <Table
              headers={['Platform', 'API Key Env', 'Notes']}
              rows={[
                ['Betfair', 'BETFAIR_APP_KEY', 'UK sports exchange'],
                ['Smarkets', 'SMARKETS_API_KEY', 'EU sports, 2% fees'],
                ['Drift', 'SOLANA_PRIVATE_KEY', 'Solana perps'],
                ['Manifold', 'MANIFOLD_API_KEY', 'Play money markets'],
              ]}
            />
          </Section>

          {/* Arbitrage Overview */}
          <Section id="arb-overview" title="Arbitrage Detection">
            <p className="text-slate-400 mb-4">
              Based on <a href="https://arxiv.org/abs/2508.03474" className="text-cyan-400 hover:underline">arXiv:2508.03474</a> —
              researchers found <strong>$40M+ in realized arbitrage</strong> on Polymarket.
            </p>

            <Alert type="info">
              Clodds implements semantic matching, liquidity scoring, Kelly sizing, and real-time WebSocket scanning.
            </Alert>
          </Section>

          {/* Arbitrage Types */}
          <Section id="arb-types" title="Opportunity Types">
            <Subsection title="1. Internal Arbitrage">
              <CodeBlock>
{`YES: 45c + NO: 52c = 97c
Buy both → guaranteed $1 payout
Profit: 3c per dollar (3% risk-free)`}
              </CodeBlock>
            </Subsection>

            <Subsection title="2. Cross-Platform Arbitrage">
              <CodeBlock>
{`Polymarket: Trump YES @ 52c
Kalshi: Trump YES @ 55c

Buy Polymarket, Sell Kalshi → 3c profit`}
              </CodeBlock>
            </Subsection>

            <Subsection title="3. Edge vs Fair Value">
              <CodeBlock>
{`Market price: 45%
538 model: 52%

Edge: 7% → Buy YES`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Combinatorial */}
          <Section id="arb-combinatorial" title="Combinatorial Arbitrage">
            <p className="text-slate-400 mb-4">Exploits logical relationships between markets.</p>

            <CodeBlock title="Relationship Types">
{`→ implies:    "Trump wins" → "Republican wins"
¬ inverse:    P(A) + P(B) = 1
⊕ exclusive:  "Biden wins" vs "Trump wins"
∨ exhaustive: All candidates sum to 100%`}
            </CodeBlock>

            <CodeBlock title="Example Mispricing">
{`"Trump wins": 55c
"Republican wins": 52c

Violation! P(Trump) must be ≤ P(Republican)
Strategy: Sell Trump YES, Buy Republican YES`}
            </CodeBlock>
          </Section>

          {/* Scoring */}
          <Section id="arb-scoring" title="Scoring System">
            <p className="text-slate-400 mb-4">Opportunities scored 0-100 based on:</p>

            <Table
              headers={['Factor', 'Weight', 'Description']}
              rows={[
                ['Edge %', '35%', 'Raw arbitrage spread'],
                ['Liquidity', '25%', 'Available $ to trade'],
                ['Confidence', '25%', 'Match quality'],
                ['Execution', '15%', 'Platform reliability'],
              ]}
            />

            <p className="text-slate-400 mt-4">
              Penalties: low liquidity (-5), cross-platform (-3/platform), high slippage (-5 if &gt;2%), low confidence (-5 if &lt;70%).
            </p>
          </Section>

          {/* Trading Execution */}
          <Section id="trading-execution" title="Trade Execution">
            <p className="text-slate-400 mb-4">Unified interface for all platforms.</p>

            <CodeBlock title="Order Types">
{`# Limit order
/buy polymarket "Trump wins" YES 100 @ 0.52

# Market order
/buy kalshi "Fed rate hike" YES 50

# Sell position
/sell polymarket "Trump wins" YES 100 @ 0.55`}
            </CodeBlock>

            <Subsection title="Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>Limit, market, GTC, FOK orders</li>
                <li>Real-time orderbook data</li>
                <li>Position tracking with cost basis</li>
                <li>P&L calculation (realized + unrealized)</li>
                <li>Trade history with fill prices</li>
              </ul>
            </Subsection>
          </Section>

          {/* Trading Bots */}
          <Section id="trading-bots" title="Trading Bots">
            <Table
              headers={['Strategy', 'Description']}
              rows={[
                ['Mean Reversion', 'Buy dips, sell rallies based on moving average deviation'],
                ['Momentum', 'Follow price trends with configurable lookback'],
                ['Arbitrage', 'Auto-execute cross-platform opportunities'],
              ]}
            />

            <Subsection title="Bot Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>Configurable intervals and position sizes</li>
                <li>Kelly criterion or fixed percentage sizing</li>
                <li>Stop-loss and take-profit exits</li>
                <li>Portfolio-aware execution</li>
                <li>Signal logging and backtesting</li>
              </ul>
            </Subsection>
          </Section>

          {/* Safety */}
          <Section id="trading-safety" title="Safety Controls">
            <Alert type="warning">
              Always configure safety limits before live trading!
            </Alert>

            <Table
              headers={['Control', 'Default', 'Description']}
              rows={[
                ['Daily Loss Limit', '$500', 'Stop after max daily loss'],
                ['Max Drawdown', '20%', 'Halt at portfolio drawdown'],
                ['Position Limit', '25%', 'Max single position size'],
                ['Correlation Limit', '3', 'Max same-direction bets'],
              ]}
            />

            <CodeBlock title="Emergency Stop">
{`/safety kill "Market volatility"
# Immediately stops all bots, blocks new trades

/safety resume
# Resume trading after review`}
            </CodeBlock>
          </Section>

          {/* AI Providers */}
          <Section id="ai-providers" title="LLM Providers (6)">
            <Table
              headers={['Provider', 'Models', 'Use Case']}
              rows={[
                ['Anthropic', 'Claude Opus, Sonnet, Haiku', 'Primary (best for trading)'],
                ['OpenAI', 'GPT-4, GPT-4o', 'Fallback'],
                ['Google', 'Gemini Pro, Flash', 'Multimodal'],
                ['Groq', 'Llama, Mixtral', 'High-speed inference'],
                ['Together', 'Open models', 'Cost-effective'],
                ['Ollama', 'Local models', 'Privacy-first'],
              ]}
            />
          </Section>

          {/* Tools */}
          <Section id="ai-tools" title="Tools (21)">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-slate-200 font-medium mb-3">Trading & Markets</h4>
                <ul className="text-slate-400 text-sm space-y-1">
                  <li>• markets — Search markets</li>
                  <li>• trading — Execute orders</li>
                  <li>• portfolio — Position tracking</li>
                  <li>• opportunity — Arbitrage finder</li>
                </ul>
              </div>
              <div>
                <h4 className="text-slate-200 font-medium mb-3">Development</h4>
                <ul className="text-slate-400 text-sm space-y-1">
                  <li>• browser — Puppeteer automation</li>
                  <li>• exec — Shell commands (sandboxed)</li>
                  <li>• files — File operations</li>
                  <li>• git — Version control</li>
                </ul>
              </div>
              <div>
                <h4 className="text-slate-200 font-medium mb-3">Communication</h4>
                <ul className="text-slate-400 text-sm space-y-1">
                  <li>• email — SMTP sending</li>
                  <li>• sms — Twilio SMS</li>
                  <li>• webhooks — HTTP callbacks</li>
                  <li>• web-fetch — HTTP requests</li>
                </ul>
              </div>
              <div>
                <h4 className="text-slate-200 font-medium mb-3">Data & Analysis</h4>
                <ul className="text-slate-400 text-sm space-y-1">
                  <li>• sql — Database queries</li>
                  <li>• image — Vision analysis</li>
                  <li>• transcription — Audio to text</li>
                  <li>• web-search — Search engines</li>
                </ul>
              </div>
            </div>
          </Section>

          {/* Memory */}
          <Section id="ai-memory" title="Memory System">
            <ul className="list-disc list-inside text-slate-400 space-y-2">
              <li><strong>Semantic search</strong> — Vector embeddings via LanceDB</li>
              <li><strong>Hybrid search</strong> — BM25 + semantic for best results</li>
              <li><strong>Context compression</strong> — Auto-summarize old messages</li>
              <li><strong>User profiles</strong> — Preferences, trading rules</li>
              <li><strong>Facts & notes</strong> — Persistent knowledge storage</li>
            </ul>
          </Section>

          {/* Skills */}
          <Section id="ai-skills" title="Skills (13)">
            <div className="grid md:grid-cols-2 gap-2">
              {[
                ['alerts', 'Price and event alerts'],
                ['edge', 'Edge detection and analysis'],
                ['markets', 'Market search and discovery'],
                ['news', 'News aggregation'],
                ['portfolio', 'Portfolio management'],
                ['portfolio-sync', 'Multi-platform sync'],
                ['research', 'Market research automation'],
                ['trading-kalshi', 'Kalshi trading'],
                ['trading-manifold', 'Manifold trading'],
                ['trading-polymarket', 'Polymarket trading'],
              ].map(([name, desc]) => (
                <div key={name} className="flex items-center gap-2 text-sm">
                  <code className="text-cyan-400">{name}</code>
                  <span className="text-slate-500">—</span>
                  <span className="text-slate-400">{desc}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Solana DEX */}
          <Section id="solana-dex" title="Solana DEX Integration">
            <Table
              headers={['Protocol', 'Features']}
              rows={[
                ['Jupiter', 'DEX aggregator, best route finding'],
                ['Raydium', 'AMM swaps, pool discovery'],
                ['Orca', 'Whirlpool concentrated liquidity'],
                ['Meteora', 'DLMM dynamic pools'],
                ['Pump.fun', 'Token launch protocol'],
              ]}
            />

            <CodeBlock title=".env">
{`SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=...`}
            </CodeBlock>
          </Section>

          {/* Wormhole */}
          <Section id="wormhole" title="Wormhole Bridge">
            <p className="text-slate-400 mb-4">Cross-chain token transfers:</p>
            <ul className="list-disc list-inside text-slate-400 space-y-1">
              <li>Ethereum ↔ Solana</li>
              <li>Polygon ↔ Base</li>
              <li>Avalanche ↔ Optimism</li>
              <li>Auto-route selection</li>
              <li>USDC and token wrapping</li>
            </ul>
          </Section>

          {/* x402 */}
          <Section id="x402" title="x402 Payments">
            <p className="text-slate-400 mb-4">Machine-to-machine crypto payments:</p>
            <ul className="list-disc list-inside text-slate-400 space-y-1">
              <li><strong>Networks:</strong> Base, Base Sepolia, Solana, Solana Devnet</li>
              <li><strong>Asset:</strong> USDC</li>
              <li><strong>Features:</strong> Auto-approval, fee-free via Coinbase facilitator</li>
              <li>Full client and server middleware</li>
            </ul>
          </Section>

          {/* Footer */}
          <div className="mt-20 pt-8 border-t border-slate-700 text-center">
            <p className="text-slate-500 text-sm">
              Clodds Documentation • <a href="https://github.com/alsk1992/CloddsBot" className="text-cyan-400 hover:underline">GitHub</a> • MIT License
            </p>
          </div>

        </div>
      </main>
    </div>
  );
}
