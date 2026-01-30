import React, { useState } from 'react';
import { Link } from 'react-router-dom';

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
      { id: 'channels-overview', name: 'All Channels' },
      { id: 'channel-setup', name: 'Setup Guides' },
    ],
  },
  {
    title: 'Markets (9)',
    items: [
      { id: 'markets-trading', name: 'Trading Platforms' },
      { id: 'markets-feeds', name: 'Data Feeds' },
      { id: 'crypto-prices', name: 'Crypto Prices' },
    ],
  },
  {
    title: 'Arbitrage',
    items: [
      { id: 'arb-types', name: 'Opportunity Types' },
      { id: 'arb-detection', name: 'Detection System' },
      { id: 'arb-scoring', name: 'Scoring & Matching' },
    ],
  },
  {
    title: 'Trading',
    items: [
      { id: 'trade-execution', name: 'Execution' },
      { id: 'trade-portfolio', name: 'Portfolio & P&L' },
      { id: 'trade-bots', name: 'Trading Bots' },
      { id: 'trade-safety', name: 'Safety Controls' },
    ],
  },
  {
    title: 'Perpetual Futures',
    items: [
      { id: 'futures-overview', name: 'Overview (4 Exchanges)' },
      { id: 'futures-setup', name: 'Easy Setup' },
      { id: 'futures-database', name: 'Database Tracking' },
      { id: 'futures-strategies', name: 'Custom Strategies' },
      { id: 'futures-ab-testing', name: 'A/B Testing' },
    ],
  },
  {
    title: 'Advanced Trading',
    items: [
      { id: 'whale-tracking', name: 'Whale Tracking' },
      { id: 'copy-trading', name: 'Copy Trading' },
      { id: 'smart-routing', name: 'Smart Order Routing' },
      { id: 'evm-dex', name: 'EVM DEX Trading' },
      { id: 'mev-protection', name: 'MEV Protection' },
      { id: 'external-feeds', name: 'External Data Feeds' },
    ],
  },
  {
    title: 'AI System',
    items: [
      { id: 'ai-providers', name: 'LLM Providers (6)' },
      { id: 'ai-agents', name: 'Agents (4)' },
      { id: 'ai-tools', name: 'Tools (21)' },
      { id: 'ai-skills', name: 'Skills (61)' },
      { id: 'ai-memory', name: 'Memory System' },
    ],
  },
  {
    title: 'Crypto & DeFi',
    items: [
      { id: 'solana-dex', name: 'Solana DEX (5)' },
      { id: 'x402-payments', name: 'x402 Payments' },
      { id: 'wormhole-bridge', name: 'Wormhole Bridge' },
    ],
  },
  {
    title: 'Authentication',
    items: [
      { id: 'auth-oauth', name: 'OAuth (Anthropic/OpenAI)' },
      { id: 'auth-copilot', name: 'GitHub Copilot' },
      { id: 'auth-google', name: 'Google/Gemini' },
      { id: 'auth-qwen', name: 'Qwen/DashScope' },
    ],
  },
  {
    title: 'Observability',
    items: [
      { id: 'telemetry-overview', name: 'OpenTelemetry' },
      { id: 'telemetry-metrics', name: 'Metrics & Prometheus' },
      { id: 'telemetry-tracing', name: 'Distributed Tracing' },
    ],
  },
  {
    title: 'Automation',
    items: [
      { id: 'cron-jobs', name: 'Cron Jobs' },
      { id: 'webhooks', name: 'Webhooks' },
      { id: 'extensions', name: 'Extensions (10)' },
    ],
  },
  {
    title: 'Deployment',
    items: [
      { id: 'deploy-options', name: 'Deployment Options' },
      { id: 'deploy-self-hosted', name: 'Self-Hosted' },
      { id: 'deploy-worker', name: 'Cloudflare Worker' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { id: 'architecture', name: 'Architecture' },
      { id: 'database', name: 'Database Schema' },
      { id: 'env-vars', name: 'Environment Vars' },
      { id: 'glossary', name: 'Glossary (170+ terms)' },
    ],
  },
];

function CodeBlock({ children, title }) {
  return (
    <div className="my-4 rounded-lg overflow-hidden border border-slate-700">
      {title && (
        <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 text-sm text-slate-400 font-mono">
          {title}
        </div>
      )}
      <pre className="p-4 bg-slate-900/80 overflow-x-auto">
        <code className="text-sm text-slate-300 font-mono whitespace-pre">{children}</code>
      </pre>
    </div>
  );
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="mb-16 scroll-mt-24">
      <h2 className="text-2xl font-bold text-white mb-6 pb-3 border-b border-slate-700">{title}</h2>
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
    <div className="overflow-x-auto my-4 rounded-lg border border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-800/50">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-3 text-left text-slate-300 font-medium border-b border-slate-700">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/30">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-slate-400">{cell}</td>
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
    orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    pink: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  };
  return (
    <span className={`px-2 py-1 text-xs rounded border ${colors[color]}`}>{children}</span>
  );
}

function Alert({ type = 'info', children }) {
  const styles = {
    info: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300',
    warning: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300',
    success: 'bg-green-500/10 border-green-500/30 text-green-300',
    danger: 'bg-red-500/10 border-red-500/30 text-red-300',
  };
  return <div className={`p-4 rounded-lg border ${styles[type]} my-4 text-sm`}>{children}</div>;
}

function FeatureGrid({ items }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 my-4">
      {items.map((item, i) => (
        <div key={i} className="px-3 py-2 bg-slate-800/50 rounded border border-slate-700 text-slate-300 text-sm text-center">
          {item}
        </div>
      ))}
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
            <img src="/logo.png" alt="Clodds" className="w-10 h-10" />
            <div>
              <span className="text-xl font-bold text-white">Clodds</span>
              <p className="text-xs text-slate-500">Claude + Odds</p>
            </div>
          </Link>

          <nav className="mt-6 space-y-6">
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
                        className="block px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 rounded transition-colors"
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
            <a href="https://github.com/alsk1992/CloddsBot" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-slate-400 hover:text-white">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
              </svg>
              GitHub
            </a>
          </div>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Main */}
      <main className="lg:pl-72">
        <div className="max-w-4xl mx-auto px-6 py-12">

          {/* Hero */}
          <div className="mb-16">
            <h1 className="text-4xl font-bold text-white mb-4">Clodds Documentation</h1>
            <p className="text-xl text-slate-400 mb-6">
              The complete AI-powered prediction market platform. Self-hosted, open source, infinitely extensible.
            </p>
            <div className="flex flex-wrap gap-2 mb-6">
              <Badge color="cyan">22 Channels</Badge>
              <Badge color="green">9 Markets</Badge>
              <Badge color="purple">21 Tools</Badge>
              <Badge color="yellow">61 Skills</Badge>
              <Badge color="orange">10 Chains</Badge>
              <Badge color="pink">x402 Payments</Badge>
            </div>
            <p className="text-slate-500 text-sm">
              Based on <a href="https://arxiv.org/abs/2508.03474" className="text-cyan-400 hover:underline">arXiv:2508.03474</a> which found $40M+ in realized arbitrage on Polymarket.
            </p>
          </div>

          {/* Quick Start */}
          <Section id="quickstart" title="Quick Start">
            <CodeBlock title="Terminal">
{`git clone https://github.com/alsk1992/CloddsBot.git
cd CloddsBot
npm install
cp .env.example .env
# Add ANTHROPIC_API_KEY to .env
npm run build && npm start`}
            </CodeBlock>
            <p className="text-slate-400">Open <code className="text-cyan-400">http://localhost:18789/webchat</code> — no account needed.</p>
            <Alert type="info">For Telegram: add <code>TELEGRAM_BOT_TOKEN</code> to <code>.env</code> and message your bot.</Alert>
          </Section>

          {/* CLI Commands */}
          <Section id="cli-commands" title="CLI Commands">
            <p className="text-slate-400 mb-4">All terminal commands start with <code className="text-cyan-400">clodds</code>:</p>

            <Subsection title="Core">
              <CodeBlock>
{`clodds start              # Start the gateway server
clodds repl               # Interactive local REPL for testing
clodds doctor             # Run system diagnostics
clodds status             # Show system status (users, webhooks, etc.)
clodds endpoints          # Show webhook endpoints for channels
clodds version            # Show version`}
              </CodeBlock>
            </Subsection>

            <Subsection title="User & Pairing">
              <CodeBlock>
{`clodds pairing list <channel>       # List pending pairing requests
clodds pairing approve <ch> <code>  # Approve a pairing request
clodds pairing reject <ch> <code>   # Reject a pairing request
clodds pairing users <channel>      # List paired users
clodds pairing add <ch> <userId>    # Add user to allowlist
clodds pairing remove <ch> <userId> # Remove from allowlist
clodds pairing set-owner <ch> <id>  # Set channel owner
clodds pairing owners <channel>     # List channel owners`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Configuration">
              <CodeBlock>
{`clodds config get [key]         # Get config value (all if no key)
clodds config set <key> <value> # Set config value
clodds config unset <key>       # Remove config value
clodds config path              # Show config file path`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Skills">
              <CodeBlock>
{`clodds skills list              # List installed skills
clodds skills search <query>    # Search skill registry
clodds skills install <slug>    # Install a skill
clodds skills update [slug]     # Update skill(s)
clodds skills uninstall <slug>  # Uninstall a skill
clodds skills info <slug>       # Show skill details
clodds skills check-updates     # Check for updates`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Sessions & Memory">
              <CodeBlock>
{`clodds session list             # List active sessions
clodds session clear [id]       # Clear session(s)
clodds memory list <userId>     # View user memories
clodds memory clear <userId>    # Clear memories
clodds memory export <userId>   # Export memories to JSON`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Cron Jobs">
              <CodeBlock>
{`clodds cron list          # List scheduled jobs
clodds cron show <id>     # Show job details
clodds cron enable <id>   # Enable a job
clodds cron disable <id>  # Disable a job
clodds cron delete <id>   # Delete a job`}
              </CodeBlock>
            </Subsection>

            <Subsection title="MCP Servers">
              <CodeBlock>
{`clodds mcp list               # List MCP servers
clodds mcp add <name> <cmd>   # Add MCP server
clodds mcp remove <name>      # Remove MCP server
clodds mcp test <name>        # Test connection`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Permissions">
              <CodeBlock>
{`clodds permissions list         # Show permission rules
clodds permissions allow <pat>  # Add allow pattern
clodds permissions remove <id>  # Remove rule
clodds permissions mode <mode>  # Set mode (ask/allow/deny)
clodds permissions pending      # Show pending requests
clodds permissions approve <id> # Approve pending
clodds permissions deny <id>    # Deny pending`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Usage & Hooks">
              <CodeBlock>
{`clodds usage summary      # Token usage summary
clodds usage by-model     # Usage by model
clodds usage by-user      # Usage by user
clodds usage export       # Export usage data

clodds hooks list         # List installed hooks
clodds hooks install <p>  # Install hook from path
clodds hooks uninstall <n># Uninstall hook
clodds hooks enable <n>   # Enable hook
clodds hooks disable <n>  # Disable hook`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Chat Commands */}
          <Section id="chat-commands" title="Chat Commands">
            <p className="text-slate-400 mb-4">These work inside any chat (Telegram, Discord, WebChat, etc.):</p>

            <Subsection title="Opportunity Finding">
              <CodeBlock>
{`/opportunity scan [query]        # Find arbitrage opportunities
/opportunity combinatorial       # Scan conditional dependencies
/opportunity active              # Show active opportunities
/opportunity stats               # Performance statistics
/opportunity link <a> <b>        # Link equivalent markets manually
/opportunity pairs               # Platform pair analysis
/opportunity realtime start      # Enable real-time scanning
/opportunity realtime stop       # Disable real-time scanning`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Trading">
              <CodeBlock>
{`/buy <platform> <market> <side> <size> @ <price>
/sell <platform> <market> <side> <size> @ <price>
/portfolio                       # Show all positions and P&L
/portfolio <platform>            # Platform-specific portfolio
/trades stats                    # Trade statistics
/trades recent                   # Recent trade history
/trades export                   # Export trades to CSV`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Bots & Safety">
              <CodeBlock>
{`/bot list                # List all trading bots
/bot start <id>          # Start a bot
/bot stop <id>           # Stop a bot
/bot status <id>         # Bot status details
/safety status           # View all safety controls
/safety kill [reason]    # Emergency stop ALL trading
/safety resume           # Resume after kill switch
/safety limits           # View/set limits`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Markets & Research">
              <CodeBlock>
{`/markets <query>         # Search all markets
/market <id>             # Market details
/compare <query>         # Compare prices across platforms
/news <topic>            # Get relevant news
/alerts list             # List active alerts
/alerts add <condition>  # Add price alert
/alerts remove <id>      # Remove alert`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Memory & General">
              <CodeBlock>
{`/remember <type> <key>=<value>   # Store fact/preference/note
/memory                          # View stored memories
/forget <key>                    # Delete memory
/help                            # List all commands
/model <name>                    # Change AI model
/new                             # Reset conversation
/status                          # Check context usage
/context                         # Show context info`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Configuration */}
          <Section id="configuration" title="Configuration">
            <Subsection title="Environment Variables">
              <CodeBlock title=".env">
{`# Required
ANTHROPIC_API_KEY=sk-ant-...

# Channels (enable any)
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
SLACK_BOT_TOKEN=...
SLACK_APP_TOKEN=...
WHATSAPP_SESSION_PATH=...
MATRIX_HOMESERVER=...
MATRIX_ACCESS_TOKEN=...
NOSTR_PRIVATE_KEY=...
TWITCH_OAUTH_TOKEN=...
LINE_CHANNEL_ACCESS_TOKEN=...

# Prediction Markets
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_FUNDER_ADDRESS=0x...
KALSHI_API_KEY=...
KALSHI_PRIVATE_KEY_PEM=...
BETFAIR_APP_KEY=...
BETFAIR_SESSION_TOKEN=...
SMARKETS_API_KEY=...
MANIFOLD_API_KEY=...

# Blockchain
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=...
ETHEREUM_RPC_URL=...
ETHEREUM_PRIVATE_KEY=...

# x402 Payments
X402_NETWORK=base  # base, base-sepolia, solana, solana-devnet
X402_AUTO_APPROVE_LIMIT=1.00

# Wormhole
WORMHOLE_NETWORK=Mainnet  # Mainnet, Testnet, Devnet

# Features
MARKET_INDEX_ENABLED=true
OPPORTUNITY_FINDER_ENABLED=true
CLODDS_STREAM_RESPONSES=1
CLODDS_STREAM_TOOL_CALLS=1`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Config File (clodds.json)">
              <CodeBlock title="clodds.json">
{`{
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1",
    "maxConnections": 1000
  },
  "agent": {
    "model": "claude-sonnet-4-20250514",
    "thinking": "enabled",
    "maxContextMessages": 20
  },
  "opportunityFinder": {
    "enabled": true,
    "minEdge": 0.5,
    "minLiquidity": 100,
    "platforms": ["polymarket", "kalshi", "betfair"],
    "semanticMatching": true,
    "pollIntervalMs": 10000
  },
  "safety": {
    "dailyLossLimit": 500,
    "maxDrawdownPct": 20,
    "maxPositionPct": 25,
    "maxCorrelatedPositions": 3
  },
  "trading": {
    "dryRun": true,
    "autoLog": true,
    "defaultSlippageBps": 50
  },
  "memory": {
    "embeddingProvider": "anthropic",
    "hybridSearch": true,
    "maxEntriesPerUser": 1000
  },
  "feeds": {
    "polymarket": { "enabled": true },
    "kalshi": { "enabled": true },
    "betfair": { "enabled": true },
    "manifold": { "enabled": true },
    "predictit": { "enabled": true }
  },
  "channels": {
    "webchat": { "enabled": true },
    "telegram": { "enabled": true },
    "discord": { "enabled": true }
  }
}`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Channels Overview */}
          <Section id="channels-overview" title="Messaging Channels (22)">
            <p className="text-slate-400 mb-4">Connect via any messaging platform. All channels support real-time sync, message editing, rich text, images, reactions, and offline queuing.</p>

            <Subsection title="Chat Platforms (13)">
              <Table
                headers={['Channel', 'Auth Method', 'Features']}
                rows={[
                  ['Telegram', 'Bot Token', 'Inline keyboards, file sharing, groups'],
                  ['Discord', 'Bot Token + Intents', 'Slash commands, threads, embeds'],
                  ['Slack', 'Bot + App Tokens', 'Socket Mode, blocks, workflows'],
                  ['WhatsApp', 'Baileys/BlueBubbles', 'Media, status, groups'],
                  ['Microsoft Teams', 'Azure AD OAuth', 'Cards, tabs, meetings'],
                  ['Matrix', 'Access Token', 'Federation, E2E encryption'],
                  ['Signal', 'Phone + signal-cli', 'E2E encryption, disappearing'],
                  ['Google Chat', 'Service Account', 'Cards, dialogs, spaces'],
                  ['iMessage', 'BlueBubbles (macOS)', 'Tapbacks, effects'],
                  ['LINE', 'Channel Token', 'Flex messages, rich menus'],
                  ['Mattermost', 'Bot Token', 'Self-hosted Slack alternative'],
                  ['Nextcloud Talk', 'App Password', 'WebRTC, file sharing'],
                  ['Zalo', 'Official API / Scraping', 'Vietnamese messaging'],
                ]}
              />
            </Subsection>

            <Subsection title="Decentralized (2)">
              <Table
                headers={['Channel', 'Auth Method', 'Features']}
                rows={[
                  ['Nostr', 'Private Key (nsec)', 'Decentralized, censorship-resistant'],
                  ['Tlon/Urbit', 'Ship + Code', 'Urbit network, persistent identity'],
                ]}
              />
            </Subsection>

            <Subsection title="Streaming, Voice & Built-in (4)">
              <Table
                headers={['Channel', 'Auth Method', 'Features']}
                rows={[
                  ['Twitch', 'OAuth Token', 'Chat commands, bits, subs'],
                  ['Voice', 'Audio Device', 'Speech-to-text, TTS'],
                  ['WebChat', 'None (built-in)', 'Browser at localhost:18789/webchat'],
                  ['IRC', 'Server + Nick', 'Classic IRC protocol'],
                ]}
              />
            </Subsection>

            <Subsection title="Additional Channels">
              <FeatureGrid items={['Email (SMTP)', 'SMS (Twilio)', 'Webhooks (HTTP)']} />
            </Subsection>
          </Section>

          {/* Channel Setup */}
          <Section id="channel-setup" title="Channel Setup Guides">
            <Subsection title="Telegram">
              <ol className="list-decimal list-inside space-y-2 text-slate-400">
                <li>Message <a href="https://t.me/botfather" className="text-cyan-400">@BotFather</a> on Telegram</li>
                <li>Send <code>/newbot</code> and follow prompts</li>
                <li>Copy the bot token</li>
                <li>Add to <code>.env</code>: <code className="text-cyan-400">TELEGRAM_BOT_TOKEN=your_token</code></li>
                <li>Restart Clodds and message your bot</li>
              </ol>
            </Subsection>

            <Subsection title="Discord">
              <ol className="list-decimal list-inside space-y-2 text-slate-400">
                <li>Go to <a href="https://discord.com/developers" className="text-cyan-400">Discord Developer Portal</a></li>
                <li>Create New Application → Bot → Add Bot</li>
                <li>Enable <strong>Message Content Intent</strong> under Privileged Intents</li>
                <li>Copy bot token → add to <code>.env</code>: <code className="text-cyan-400">DISCORD_BOT_TOKEN=...</code></li>
                <li>Generate OAuth2 URL with <code>bot</code> scope → invite to server</li>
              </ol>
            </Subsection>

            <Subsection title="Slack">
              <ol className="list-decimal list-inside space-y-2 text-slate-400">
                <li>Go to <a href="https://api.slack.com/apps" className="text-cyan-400">Slack API</a> → Create New App</li>
                <li>Enable <strong>Socket Mode</strong> under Settings</li>
                <li>Add Bot Token Scopes: <code>chat:write</code>, <code>im:history</code>, <code>im:read</code></li>
                <li>Install to workspace</li>
                <li>Add to <code>.env</code>: <code className="text-cyan-400">SLACK_BOT_TOKEN=xoxb-...</code> and <code className="text-cyan-400">SLACK_APP_TOKEN=xapp-...</code></li>
              </ol>
            </Subsection>

            <Subsection title="WebChat (No Setup)">
              <p className="text-slate-400">Built-in at <code className="text-cyan-400">http://localhost:18789/webchat</code> — works immediately after starting Clodds.</p>
            </Subsection>
          </Section>

          {/* Markets Trading */}
          <Section id="markets-trading" title="Trading Platforms (5)">
            <p className="text-slate-400 mb-4">Full order execution, portfolio tracking, and P&L calculation.</p>

            <Table
              headers={['Platform', 'Feed', 'Order Types', 'Currency', 'Notes']}
              rows={[
                ['Polymarket', 'WebSocket + RTDS', 'Limit, Market, GTC, FOK', 'USDC', 'Crypto, no KYC for small amounts'],
                ['Kalshi', 'WebSocket', 'Limit, Market', 'USD', 'US regulated, requires KYC'],
                ['Betfair', 'WebSocket', 'Limit, Market', 'GBP/USD', 'Sports exchange, UK licensed'],
                ['Smarkets', 'WebSocket', 'Limit, Market', 'GBP', '2% commission, lower than Betfair'],
                ['Drift', 'REST', 'Limit, Market', 'USDC (Solana)', 'Solana-based perps/prediction'],
              ]}
            />

            <Subsection title="Trading Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li><strong>Order Types:</strong> Limit, Market, GTC (Good-Till-Cancel), FOK (Fill-Or-Kill)</li>
                <li><strong>Real-time Orderbook:</strong> Live bid/ask data via WebSocket</li>
                <li><strong>Position Tracking:</strong> Shares, average price, cost basis</li>
                <li><strong>P&L Calculation:</strong> Realized + unrealized, daily/monthly summaries</li>
                <li><strong>Trade History:</strong> Full log with fill prices, timestamps, fees</li>
                <li><strong>Portfolio Snapshots:</strong> Historical NAV tracking</li>
                <li><strong>Dry Run Mode:</strong> Test without real money</li>
              </ul>
            </Subsection>
          </Section>

          {/* Markets Feeds */}
          <Section id="markets-feeds" title="Data Feeds (4)">
            <p className="text-slate-400 mb-4">Read-only market data for research and arbitrage detection.</p>

            <Table
              headers={['Platform', 'Feed Type', 'Data Available', 'Notes']}
              rows={[
                ['Manifold', 'WebSocket', 'Prices, volume, comments', 'Play money, good for testing'],
                ['Metaculus', 'REST', 'Forecasts, community predictions', 'Long-term forecasting'],
                ['PredictIt', 'REST', 'Prices, contracts', 'US politics focused'],
                ['External Polls', 'REST', '538, RCP, CME', 'Fair value benchmarks'],
              ]}
            />
          </Section>

          {/* Crypto Prices */}
          <Section id="crypto-prices" title="Crypto Price Feeds">
            <p className="text-slate-400 mb-4">Real-time prices via Binance WebSocket with Coinbase/CoinGecko fallback.</p>

            <Subsection title="Supported Assets (10)">
              <FeatureGrid items={['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'MATIC', 'DOT', 'LINK']} />
            </Subsection>

            <p className="text-slate-400 mt-4">Features: 24h volume, bid/ask spreads, multi-source fallback, configurable update intervals.</p>
          </Section>

          {/* Arbitrage Types */}
          <Section id="arb-types" title="Arbitrage Opportunity Types">
            <Subsection title="1. Internal Arbitrage (Rebalancing)">
              <p className="text-slate-400 mb-2">YES + NO prices don't sum to $1.00</p>
              <CodeBlock>
{`Example: "Will X happen?"
  YES: 45¢ + NO: 52¢ = 97¢
  Buy both → guaranteed $1 payout
  Profit: 3¢ per dollar (3% risk-free)`}
              </CodeBlock>
            </Subsection>

            <Subsection title="2. Cross-Platform Arbitrage">
              <p className="text-slate-400 mb-2">Same market priced differently across platforms.</p>
              <CodeBlock>
{`Example: "Fed rate hike in March"
  Polymarket YES: 52¢
  Kalshi YES: 55¢

  Strategy: Buy Polymarket, Sell Kalshi
  Edge: 3¢ per share`}
              </CodeBlock>
            </Subsection>

            <Subsection title="3. Combinatorial Arbitrage">
              <p className="text-slate-400 mb-2">Logical violations between related markets. Based on <a href="https://arxiv.org/abs/2508.03474" className="text-cyan-400">arXiv:2508.03474</a>.</p>
              <CodeBlock>
{`Relationship Types:
  → implies:    P(A) ≤ P(B)  — "Trump wins" implies "Republican wins"
  ¬ inverse:    P(A) + P(B) = 1  — complementary outcomes
  ⊕ exclusive:  P(A) + P(B) ≤ 1  — mutually exclusive
  ∨ exhaustive: ΣP = 1  — all outcomes sum to 100%

Example Mispricing:
  "Trump wins": 55¢
  "Republican wins": 52¢

  Violation! P(Trump) must be ≤ P(Republican)
  Strategy: Sell Trump YES, Buy Republican YES`}
              </CodeBlock>
            </Subsection>

            <Subsection title="4. Edge vs Fair Value">
              <p className="text-slate-400 mb-2">Market price differs from external models (538, polls, CME).</p>
              <CodeBlock>
{`Example: Election market
  Market price: 45%
  538 model: 52%

  Edge: +7% → Buy YES
  Kelly sizing determines position`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Arbitrage Detection */}
          <Section id="arb-detection" title="Detection System">
            <Subsection title="Features">
              <ul className="list-disc list-inside text-slate-400 space-y-2">
                <li><strong>Semantic Matching:</strong> Vector embeddings to find equivalent markets across platforms with different wording</li>
                <li><strong>Liquidity Scoring:</strong> Orderbook depth analysis, slippage estimation</li>
                <li><strong>Kelly Sizing:</strong> Optimal position sizing with fractional Kelly for safety</li>
                <li><strong>Real-time Scanning:</strong> WebSocket price subscriptions, continuous monitoring</li>
                <li><strong>Heuristic Reduction:</strong> O(2^n) → O(n·k) complexity via topic clustering</li>
                <li><strong>Win Rate Tracking:</strong> Historical performance by platform pair</li>
              </ul>
            </Subsection>

            <Subsection title="Matching Methods">
              <Table
                headers={['Method', 'How It Works', 'Accuracy']}
                rows={[
                  ['Manual Link', 'User explicitly links markets', 'Highest'],
                  ['Slug Match', 'Platform-specific identifiers', 'High'],
                  ['Text Similarity', 'Jaccard coefficient on question text', 'Medium'],
                  ['Vector Embedding', 'Semantic similarity via embeddings', 'Good for paraphrased questions'],
                ]}
              />
            </Subsection>
          </Section>

          {/* Arbitrage Scoring */}
          <Section id="arb-scoring" title="Scoring System">
            <p className="text-slate-400 mb-4">Opportunities scored 0-100 to prioritize best trades.</p>

            <Table
              headers={['Factor', 'Weight', 'Description']}
              rows={[
                ['Edge %', '35%', 'Raw arbitrage spread'],
                ['Liquidity', '25%', 'Available volume to trade'],
                ['Confidence', '25%', 'Match quality / certainty'],
                ['Execution', '15%', 'Platform reliability, speed'],
              ]}
            />

            <Subsection title="Penalties Applied">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>Low liquidity (&lt;$1000): -5 points</li>
                <li>Cross-platform complexity: -3 per platform</li>
                <li>High slippage (&gt;2%): -5 points</li>
                <li>Low confidence (&lt;70%): -5 points</li>
                <li>Near expiry (&lt;24h): -3 points</li>
              </ul>
            </Subsection>
          </Section>

          {/* Trade Execution */}
          <Section id="trade-execution" title="Trade Execution">
            <Subsection title="Order Types">
              <CodeBlock>
{`# Limit order at specific price
/buy polymarket "Trump wins" YES 100 @ 0.52

# Market order (best available price)
/buy kalshi "Fed hike" YES 50

# Sell position
/sell polymarket "Trump wins" YES 100 @ 0.55

# Size as percentage of portfolio
/buy polymarket "BTC above 100k" YES 5% @ 0.40`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Execution Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>Multi-platform order routing</li>
                <li>Portfolio-aware position sizing</li>
                <li>Slippage detection and warnings</li>
                <li>Automatic trade logging to database</li>
                <li>Dry-run mode for testing</li>
                <li>Rate limiting per platform</li>
              </ul>
            </Subsection>
          </Section>

          {/* Portfolio & P&L */}
          <Section id="trade-portfolio" title="Portfolio & P&L">
            <Subsection title="Position Tracking">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>Real-time position monitoring across all platforms</li>
                <li>Cost basis calculation (average price)</li>
                <li>Unrealized P&L with current market prices</li>
                <li>Realized P&L on closed positions</li>
                <li>Daily, weekly, monthly P&L summaries</li>
              </ul>
            </Subsection>

            <Subsection title="Statistics">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>Win rate (% of profitable trades)</li>
                <li>Profit factor (gross profit / gross loss)</li>
                <li>Sharpe ratio (risk-adjusted returns)</li>
                <li>Max drawdown tracking</li>
                <li>Average trade duration</li>
              </ul>
            </Subsection>
          </Section>

          {/* Trading Bots */}
          <Section id="trade-bots" title="Trading Bots">
            <Subsection title="Built-in Strategies">
              <Table
                headers={['Strategy', 'Logic', 'Best For']}
                rows={[
                  ['Mean Reversion', 'Buy below MA, sell above MA', 'Range-bound markets'],
                  ['Momentum', 'Follow price trends', 'Trending markets'],
                  ['Arbitrage', 'Auto-execute cross-platform opportunities', 'Always-on arb capture'],
                ]}
              />
            </Subsection>

            <Subsection title="Bot Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>Configurable intervals (1s to 1h)</li>
                <li>Kelly criterion or fixed percentage sizing</li>
                <li>Stop-loss and take-profit exits</li>
                <li>Portfolio-aware execution (respects limits)</li>
                <li>Signal logging for backtesting</li>
                <li>Live trading with safety limits</li>
                <li>Dry-run mode for testing</li>
              </ul>
            </Subsection>

            <Subsection title="Custom Strategy Interface">
              <CodeBlock title="TypeScript">
{`interface Strategy {
  config: {
    id: string;
    name: string;
    platforms: Platform[];
    intervalMs: number;
    limits: { maxPosition: number; stopLoss: number };
  };

  init?(ctx: StrategyContext): Promise<void>;
  evaluate(ctx: StrategyContext): Promise<Signal[]>;
  onTrade?(trade: Trade): void;
  cleanup?(): Promise<void>;
}`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Safety Controls */}
          <Section id="trade-safety" title="Safety Controls">
            <Alert type="warning">Always configure safety limits before live trading!</Alert>

            <Subsection title="Trading Limits">
              <Table
                headers={['Control', 'Default', 'Description']}
                rows={[
                  ['Daily Loss Limit', '$500', 'Stop trading after daily loss exceeds'],
                  ['Max Drawdown', '20%', 'Halt at portfolio drawdown from peak'],
                  ['Position Limit', '25%', 'Max single position as % of portfolio'],
                  ['Correlation Limit', '3', 'Max same-direction correlated bets'],
                  ['Order Size Limit', 'Varies', 'Max single order size'],
                ]}
              />
            </Subsection>

            <Subsection title="Circuit Breakers">
              <CodeBlock>
{`/safety kill "Market volatility"
# Immediately stops ALL bots
# Blocks ALL new trades
# Requires explicit resume

/safety resume
# Resume trading after manual review

/safety status
# View current safety state and limits`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Security Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li><strong>Sandboxed Execution:</strong> Shell commands require approval</li>
                <li><strong>Encrypted Credentials:</strong> AES-256-GCM at rest</li>
                <li><strong>Rate Limiting:</strong> Per-platform throttling</li>
                <li><strong>Audit Logging:</strong> All trades and commands logged</li>
                <li><strong>Permission System:</strong> Granular access control</li>
              </ul>
            </Subsection>
          </Section>

          {/* Perpetual Futures Overview */}
          <Section id="futures-overview" title="Perpetual Futures Trading">
            <p className="text-slate-400 mb-4">
              Trade perpetual futures with leverage across centralized and decentralized exchanges.
              Full PostgreSQL database integration, custom strategies, and A/B testing.
            </p>

            <Subsection title="Supported Exchanges (4)">
              <Table
                headers={['Exchange', 'Type', 'Max Leverage', 'KYC', 'API Methods']}
                rows={[
                  ['Binance Futures', 'CEX', '125x', 'Yes', '55+'],
                  ['Bybit', 'CEX', '100x', 'Yes', '50+'],
                  ['MEXC', 'CEX', '200x', 'No (small)', '35+'],
                  ['Hyperliquid', 'DEX', '50x', 'No', '60+'],
                ]}
              />
              <Alert type="info">MEXC and Hyperliquid allow trading without KYC for smaller amounts.</Alert>
            </Subsection>

            <Subsection title="Core Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li><strong>Long & Short:</strong> Open leveraged positions in either direction</li>
                <li><strong>Cross & Isolated Margin:</strong> Choose margin mode per position</li>
                <li><strong>Take-Profit / Stop-Loss:</strong> Automatic exit orders on entry</li>
                <li><strong>Liquidation Monitoring:</strong> Real-time alerts at 5%/3%/2% proximity</li>
                <li><strong>Position Management:</strong> View all positions, close individually or all</li>
                <li><strong>Funding Rate Tracking:</strong> Monitor funding costs</li>
                <li><strong>Database Integration:</strong> PostgreSQL trade logging</li>
                <li><strong>Custom Strategies:</strong> Build your own with FuturesStrategy interface</li>
                <li><strong>A/B Testing:</strong> Test strategy variants simultaneously</li>
              </ul>
            </Subsection>
          </Section>

          {/* Futures Setup */}
          <Section id="futures-setup" title="Easy Setup">
            <Subsection title="Environment Variables">
              <CodeBlock title=".env">
{`# Binance Futures
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret

# Bybit
BYBIT_API_KEY=your_api_key
BYBIT_API_SECRET=your_api_secret

# MEXC (No KYC for small amounts)
MEXC_API_KEY=your_api_key
MEXC_API_SECRET=your_api_secret

# Hyperliquid (Fully decentralized, No KYC)
HYPERLIQUID_PRIVATE_KEY=your_private_key
HYPERLIQUID_WALLET_ADDRESS=0x...

# Database for trade tracking
DATABASE_URL=postgres://user:pass@localhost:5432/clodds`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Quick Start">
              <CodeBlock title="TypeScript">
{`import { setupFromEnv } from 'clodds/trading/futures';

// Auto-configure from environment variables
const { clients, database, strategyEngine } = await setupFromEnv();

// clients.binance, clients.bybit, clients.mexc, clients.hyperliquid
// database: FuturesDatabase instance
// strategyEngine: StrategyEngine instance`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Chat Commands">
              <CodeBlock>
{`/futures balance binance           # Check margin balance
/futures positions                 # View all open positions
/futures long BTCUSDT 0.1 10x      # Open 0.1 BTC long at 10x
/futures short ETHUSDT 1 20x       # Open 1 ETH short at 20x
/futures close BTCUSDT             # Close BTC position
/futures close-all binance         # Close all positions on Binance
/futures markets binance           # List available markets
/futures funding BTCUSDT           # Check funding rate
/futures stats                     # View trade statistics`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Futures Database */}
          <Section id="futures-database" title="Database Tracking">
            <p className="text-slate-400 mb-4">All trades automatically logged to PostgreSQL for analysis.</p>

            <Subsection title="Tables Created">
              <CodeBlock title="SQL">
{`-- futures_trades: All executed trades
CREATE TABLE futures_trades (
  id SERIAL PRIMARY KEY,
  exchange VARCHAR(50),
  symbol VARCHAR(50),
  order_id VARCHAR(100),
  side VARCHAR(10),
  price DECIMAL,
  quantity DECIMAL,
  realized_pnl DECIMAL,
  commission DECIMAL,
  commission_asset VARCHAR(20),
  timestamp BIGINT,
  is_maker BOOLEAN,
  strategy VARCHAR(100),
  variant VARCHAR(100)
);

-- futures_strategy_variants: A/B test configurations
CREATE TABLE futures_strategy_variants (
  id SERIAL PRIMARY KEY,
  strategy VARCHAR(100),
  variant VARCHAR(100),
  config JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Query Your Performance">
              <CodeBlock title="SQL">
{`-- Performance by exchange
SELECT
  exchange,
  COUNT(*) as trades,
  SUM(realized_pnl) as total_pnl,
  AVG(realized_pnl) as avg_pnl,
  SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::float / COUNT(*) as win_rate
FROM futures_trades
GROUP BY exchange;

-- Best performing symbols
SELECT symbol, SUM(realized_pnl) as pnl
FROM futures_trades
GROUP BY symbol
ORDER BY pnl DESC
LIMIT 10;`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Programmatic Usage">
              <CodeBlock title="TypeScript">
{`import { FuturesDatabase } from 'clodds/trading/futures';

const db = new FuturesDatabase(process.env.DATABASE_URL!);
await db.initialize();

// Log a trade
await db.logTrade({
  exchange: 'binance',
  symbol: 'BTCUSDT',
  orderId: '12345',
  side: 'BUY',
  price: 95000,
  quantity: 0.01,
  realizedPnl: 50.25,
  commission: 0.95,
  timestamp: Date.now(),
  strategy: 'momentum',
  variant: 'aggressive',
});

// Query trades
const trades = await db.getTrades({ exchange: 'binance', symbol: 'BTCUSDT' });
const stats = await db.getTradeStats('binance');`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Futures Strategies */}
          <Section id="futures-strategies" title="Custom Strategies">
            <p className="text-slate-400 mb-4">Build your own trading strategies with the FuturesStrategy interface.</p>

            <Subsection title="Strategy Interface">
              <CodeBlock title="TypeScript">
{`interface FuturesStrategy {
  name: string;
  analyze(data: MarketData): Promise<StrategySignal | null>;
}

interface StrategySignal {
  action: 'BUY' | 'SELL' | 'CLOSE';
  symbol: string;
  confidence: number;  // 0-1
  reason: string;
  metadata?: Record<string, unknown>;
}`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Example Custom Strategy">
              <CodeBlock title="TypeScript">
{`import { FuturesStrategy, StrategySignal } from 'clodds/trading/futures';

class MomentumStrategy implements FuturesStrategy {
  name = 'momentum';

  constructor(private config: { lookbackPeriod: number; threshold: number }) {}

  async analyze(data: MarketData): Promise<StrategySignal | null> {
    const priceChange = (data.close - data.open) / data.open;

    if (priceChange > this.config.threshold) {
      return {
        action: 'BUY',
        symbol: data.symbol,
        confidence: Math.min(priceChange / this.config.threshold, 1),
        reason: 'Strong upward momentum detected',
        metadata: { priceChange, period: this.config.lookbackPeriod },
      };
    }

    if (priceChange < -this.config.threshold) {
      return {
        action: 'SELL',
        symbol: data.symbol,
        confidence: Math.min(Math.abs(priceChange) / this.config.threshold, 1),
        reason: 'Strong downward momentum detected',
        metadata: { priceChange, period: this.config.lookbackPeriod },
      };
    }

    return null;
  }
}`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Built-in Strategies">
              <Table
                headers={['Strategy', 'Logic', 'Config Options']}
                rows={[
                  ['MomentumStrategy', 'Follow price trends', 'lookbackPeriod, threshold'],
                  ['MeanReversionStrategy', 'Buy dips, sell rallies', 'maPeriod, deviationMultiplier'],
                  ['GridStrategy', 'Place orders at intervals', 'gridSize, levels, spacing'],
                ]}
              />
            </Subsection>
          </Section>

          {/* Futures A/B Testing */}
          <Section id="futures-ab-testing" title="A/B Testing">
            <p className="text-slate-400 mb-4">Test multiple strategy variants simultaneously to find optimal parameters.</p>

            <Subsection title="Register Variants">
              <CodeBlock title="TypeScript">
{`import { StrategyEngine, MomentumStrategy } from 'clodds/trading/futures';

const engine = new StrategyEngine(db);

// Register base strategy
engine.registerStrategy(new MomentumStrategy({ lookbackPeriod: 14, threshold: 0.03 }));

// Register A/B test variants
engine.registerVariant('momentum', 'aggressive', { threshold: 0.02, leverage: 10 });
engine.registerVariant('momentum', 'conservative', { threshold: 0.05, leverage: 3 });
engine.registerVariant('momentum', 'control', { threshold: 0.03, leverage: 5 });`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Analyze Results">
              <CodeBlock title="SQL">
{`-- Compare variant performance
SELECT
  strategy,
  variant,
  COUNT(*) as trades,
  SUM(realized_pnl) as total_pnl,
  AVG(realized_pnl) as avg_pnl,
  SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::float / COUNT(*) as win_rate
FROM futures_trades
WHERE strategy = 'momentum'
GROUP BY strategy, variant
ORDER BY total_pnl DESC;`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Programmatic Query">
              <CodeBlock title="TypeScript">
{`// Get variant performance from database
const results = await db.getVariantPerformance('momentum');

// Results:
// {
//   aggressive: { trades: 45, pnl: 1250, winRate: 0.62 },
//   conservative: { trades: 23, pnl: 890, winRate: 0.74 },
//   control: { trades: 34, pnl: 720, winRate: 0.65 }
// }

// Promote winning variant
const bestVariant = Object.entries(results)
  .sort((a, b) => b[1].pnl - a[1].pnl)[0];
console.log(\`Best variant: \${bestVariant[0]} with $\${bestVariant[1].pnl} PnL\`);`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Whale Tracking */}
          <Section id="whale-tracking" title="Whale Tracking">
            <p className="text-slate-400 mb-4">Monitor large trades and positions on Polymarket to identify market-moving activity.</p>

            <Subsection title="Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li><strong>Real-time Monitoring:</strong> WebSocket stream for instant trade alerts</li>
                <li><strong>Large Trade Detection:</strong> Track trades above configurable threshold (default $10k)</li>
                <li><strong>Position Tracking:</strong> Monitor whale positions above threshold (default $50k)</li>
                <li><strong>Market Activity:</strong> Aggregate whale activity per market</li>
                <li><strong>Top Traders:</strong> Rank addresses by volume, win rate, and returns</li>
              </ul>
            </Subsection>

            <Subsection title="Chat Commands">
              <CodeBlock>
{`/whale track 0x1234...  # Follow a specific address
/whale top 10           # Top 10 traders by volume
/whale activity trump   # Whale activity for Trump markets`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Programmatic Usage">
              <CodeBlock title="TypeScript">
{`import { createWhaleTracker } from 'clodds/feeds/polymarket/whale-tracker';

const tracker = createWhaleTracker({
  minTradeSize: 10000,    // $10k minimum
  minPositionSize: 50000, // $50k to track
  enableRealtime: true,
});

tracker.on('trade', (trade) => {
  console.log(\`Whale \${trade.side} $\${trade.usdValue} on \${trade.marketQuestion}\`);
});

tracker.on('positionOpened', (position) => {
  console.log(\`New position: \${position.address}\`);
});

await tracker.start();`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Crypto Whale Tracking (Multi-Chain)">
              <p className="text-slate-400 mb-3">Monitor whale activity across Solana and EVM chains:</p>
              <Table
                headers={['Chain', 'Provider', 'Features']}
                rows={[
                  ['Solana', 'Birdeye WebSocket', 'Token transfers, swaps, NFTs'],
                  ['Ethereum', 'Alchemy WebSocket', 'ERC-20, ETH transfers'],
                  ['Polygon', 'Alchemy WebSocket', 'MATIC, tokens'],
                  ['Arbitrum', 'Alchemy WebSocket', 'L2 activity'],
                  ['Base', 'Alchemy WebSocket', 'Coinbase L2'],
                  ['Optimism', 'Alchemy WebSocket', 'OP ecosystem'],
                ]}
              />
              <CodeBlock title="Chat Commands" className="mt-4">
{`/crypto-whale start                    # Start tracking all configured chains
/crypto-whale watch solana ABC123...   # Watch a Solana wallet
/crypto-whale watch ethereum 0x1234... # Watch an ETH wallet
/crypto-whale top solana 10            # Top 10 Solana whales
/crypto-whale recent ethereum 20       # Recent ETH whale transactions`}
              </CodeBlock>
              <CodeBlock title="TypeScript">
{`import { createCryptoWhaleTracker } from 'clodds/feeds/crypto/whale-tracker';

const tracker = createCryptoWhaleTracker({
  chains: ['solana', 'ethereum', 'polygon'],
  thresholds: {
    solana: 10000,    // $10k+ on Solana
    ethereum: 50000,  // $50k+ on ETH
    polygon: 5000,    // $5k+ on Polygon
  },
  birdeyeApiKey: process.env.BIRDEYE_API_KEY,
  alchemyApiKey: process.env.ALCHEMY_API_KEY,
});

tracker.on('transaction', (tx) => {
  console.log(\`\${tx.chain}: \${tx.type} $\${tx.usdValue} from \${tx.wallet}\`);
});

await tracker.start();`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Copy Trading */}
          <Section id="copy-trading" title="Copy Trading">
            <p className="text-slate-400 mb-4">Automatically mirror trades from successful wallets with configurable sizing.</p>

            <Subsection title="Sizing Modes">
              <Table
                headers={['Mode', 'Description', 'Example']}
                rows={[
                  ['Fixed', 'Same size for all copied trades', '$100 per trade'],
                  ['Proportional', 'Scale based on whale trade size', '10% of whale size'],
                  ['Percentage', 'Percentage of your portfolio', '1% per trade'],
                ]}
              />
            </Subsection>

            <Subsection title="Chat Commands">
              <CodeBlock>
{`/copy start 0x1234...   # Start copying an address
/copy config size=100   # Set copy size to $100
/copy config mode=fixed # Set sizing mode
/copy stop              # Stop copy trading`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Safety Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li><strong>Copy Delay:</strong> Configurable delay before copying (default 5s)</li>
                <li><strong>Max Position Size:</strong> Limit per-market exposure</li>
                <li><strong>Dry Run Mode:</strong> Test without real trades</li>
                <li><strong>Filtering:</strong> Skip trades below minimum confidence</li>
                <li><strong>Stop-Loss / Take-Profit:</strong> Automatic position exit with 5-second price polling</li>
              </ul>
            </Subsection>

            <Subsection title="Stop-Loss / Take-Profit Monitoring">
              <p className="text-slate-400 mb-3">Configure automatic position exits:</p>
              <CodeBlock>
{`/copy config sl=10      # Set 10% stop-loss
/copy config tp=20      # Set 20% take-profit
/copy status            # View active positions and SL/TP status`}
              </CodeBlock>
              <p className="text-slate-400 mt-3">Positions are monitored every 5 seconds. When thresholds are hit, positions are automatically closed and you receive a notification.</p>
            </Subsection>
          </Section>

          {/* Smart Order Routing */}
          <Section id="smart-routing" title="Smart Order Routing">
            <p className="text-slate-400 mb-4">Route orders to the platform with best price, liquidity, or lowest fees.</p>

            <Subsection title="Routing Modes">
              <Table
                headers={['Mode', 'Optimizes For', 'Best When']}
                rows={[
                  ['best_price', 'Lowest net price after fees', 'Small orders'],
                  ['best_liquidity', 'Maximum available depth', 'Large orders'],
                  ['lowest_fee', 'Minimum platform fees', 'High-frequency trading'],
                  ['balanced', 'Weighted combination', 'General use'],
                ]}
              />
            </Subsection>

            <Subsection title="Chat Commands">
              <CodeBlock>
{`/route trump buy 1000   # Find best route for $1000 buy
/compare "fed rate"     # Compare prices across platforms`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li><strong>Cross-Platform:</strong> Polymarket, Kalshi, Betfair, Smarkets</li>
                <li><strong>Slippage Estimation:</strong> Orderbook depth analysis</li>
                <li><strong>Fee Comparison:</strong> Platform fee calculation</li>
                <li><strong>Order Splitting:</strong> Split across platforms for better fill</li>
              </ul>
            </Subsection>
          </Section>

          {/* EVM DEX Trading */}
          <Section id="evm-dex" title="EVM DEX Trading">
            <p className="text-slate-400 mb-4">Trade on Uniswap V3 and 1inch across 5 EVM chains.</p>

            <Subsection title="Supported Chains">
              <Table
                headers={['Chain', 'RPC', 'Tokens']}
                rows={[
                  ['Ethereum', 'ETHEREUM_RPC_URL', 'USDC, WETH, USDT, DAI'],
                  ['Arbitrum', 'ARBITRUM_RPC_URL', 'USDC, WETH, ARB'],
                  ['Optimism', 'OPTIMISM_RPC_URL', 'USDC, WETH, OP'],
                  ['Base', 'BASE_RPC_URL', 'USDC, WETH'],
                  ['Polygon', 'POLYGON_RPC_URL', 'USDC, WETH, MATIC'],
                ]}
              />
            </Subsection>

            <Subsection title="Chat Commands">
              <CodeBlock>
{`/swap ethereum USDC WETH 1000   # Swap $1000 USDC for WETH
/swap base USDC ETH 500         # Swap on Base
/swap arbitrum USDT USDC 2000   # Swap on Arbitrum`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li><strong>Route Comparison:</strong> Compare Uniswap vs 1inch for best price</li>
                <li><strong>Slippage Protection:</strong> Configurable slippage tolerance (default 0.5%)</li>
                <li><strong>Fee Tiers:</strong> Auto-select optimal Uniswap V3 fee tier</li>
                <li><strong>Gas Estimation:</strong> Accurate gas cost calculation</li>
              </ul>
            </Subsection>
          </Section>

          {/* MEV Protection */}
          <Section id="mev-protection" title="MEV Protection">
            <p className="text-slate-400 mb-4">Protect swaps from sandwich attacks and front-running.</p>

            <Subsection title="Protection by Chain">
              <Table
                headers={['Chain', 'Method', 'Description']}
                rows={[
                  ['Ethereum', 'Flashbots Protect', 'Private transaction pool'],
                  ['Ethereum', 'MEV Blocker', 'Rebate-based protection'],
                  ['Solana', 'Jito Bundles', 'Priority inclusion bundles'],
                  ['L2s', 'Sequencer', 'Built-in ordering protection'],
                ]}
              />
            </Subsection>

            <Subsection title="Protection Levels">
              <Table
                headers={['Level', 'Description']}
                rows={[
                  ['none', 'No MEV protection (fastest)'],
                  ['basic', 'Private mempool submission'],
                  ['aggressive', 'Full protection + price impact limits'],
                ]}
              />
            </Subsection>

            <Alert type="info">MEV protection is automatically enabled for all EVM swaps. Set <code>MEV_PROTECTION_LEVEL</code> in config to adjust.</Alert>
          </Section>

          {/* External Data Feeds */}
          <Section id="external-feeds" title="External Data Feeds">
            <p className="text-slate-400 mb-4">Compare market prices against external models and polls for edge detection.</p>

            <Subsection title="Supported Sources">
              <Table
                headers={['Source', 'Data Type', 'Use Case']}
                rows={[
                  ['CME FedWatch', 'Rate probabilities', 'Fed decision markets'],
                  ['538/Silver', 'Election model', 'Political markets'],
                  ['RealClearPolitics', 'Polling averages', 'Election markets'],
                  ['PredictIt', 'Market prices', 'Cross-platform arb'],
                  ['Metaculus', 'Community forecasts', 'Long-term predictions'],
                ]}
              />
            </Subsection>

            <Subsection title="Edge Detection">
              <CodeBlock title="TypeScript">
{`import { analyzeEdge, calculateKelly } from 'clodds/feeds/external';

// Analyze edge vs external models
const edge = await analyzeEdge(
  'market-123',
  'Will Trump win?',
  0.45,  // market price
  'politics'
);
console.log(\`Fair value: \${edge.fairValue}, Edge: \${edge.edgePct}%\`);

// Calculate Kelly bet size
const kelly = calculateKelly(0.45, 0.52, 10000);
console.log(\`Half Kelly: $\${kelly.halfKelly}\`);`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* LLM Providers */}
          <Section id="ai-providers" title="LLM Providers (6)">
            <Table
              headers={['Provider', 'Models', 'Best For']}
              rows={[
                ['Anthropic', 'Claude Opus, Sonnet, Haiku', 'Primary (best for trading logic)'],
                ['OpenAI', 'GPT-4, GPT-4o, GPT-4o-mini', 'Fallback, function calling'],
                ['Google', 'Gemini Pro, Flash', 'Multimodal, long context'],
                ['Groq', 'Llama 3.3, Mixtral', 'Ultra-fast inference'],
                ['Together', 'Open source models', 'Cost-effective'],
                ['Ollama', 'Local models', 'Privacy-first, offline'],
              ]}
            />

            <p className="text-slate-400 mt-4">Switch models per-session with <code className="text-cyan-400">/model claude-sonnet</code></p>
          </Section>

          {/* Agents */}
          <Section id="ai-agents" title="Agents (4)">
            <Table
              headers={['Agent', 'Purpose', 'Tools Access']}
              rows={[
                ['Main', 'General conversation, task routing', 'All tools'],
                ['Trading', 'Order execution, portfolio management', 'Trading tools'],
                ['Research', 'Market analysis, news synthesis', 'Web, search tools'],
                ['Alerts', 'Price monitoring, notifications', 'Alerts, messaging'],
              ]}
            />
          </Section>

          {/* Tools */}
          <Section id="ai-tools" title="AI Tools (21)">
            <Subsection title="Trading & Markets">
              <Table
                headers={['Tool', 'Description']}
                rows={[
                  ['markets', 'Search markets across all platforms'],
                  ['trading', 'Execute buy/sell orders'],
                  ['portfolio', 'View positions and P&L'],
                  ['opportunity', 'Find and analyze arbitrage'],
                ]}
              />
            </Subsection>

            <Subsection title="Development">
              <Table
                headers={['Tool', 'Description']}
                rows={[
                  ['browser', 'Puppeteer automation (screenshot, click, type)'],
                  ['canvas', 'Image manipulation and templates'],
                  ['docker', 'Container management (run, exec, logs)'],
                  ['exec', 'Shell commands (sandboxed)'],
                  ['files', 'File operations (read, write, search)'],
                  ['git', 'Version control (status, diff, commit)'],
                  ['nodes', 'Node.js subprocess execution'],
                ]}
              />
            </Subsection>

            <Subsection title="Communication">
              <Table
                headers={['Tool', 'Description']}
                rows={[
                  ['email', 'SMTP sending (HTML/text)'],
                  ['sms', 'Twilio SMS integration'],
                  ['messages', 'Cross-platform messaging'],
                  ['webhooks', 'HTTP callbacks'],
                  ['web-fetch', 'HTTP requests with caching'],
                  ['web-search', 'Search engine queries'],
                ]}
              />
            </Subsection>

            <Subsection title="Data & Analysis">
              <Table
                headers={['Tool', 'Description']}
                rows={[
                  ['sql', 'Direct database queries'],
                  ['image', 'Vision analysis (Claude vision)'],
                  ['transcription', 'Audio to text (Whisper)'],
                ]}
              />
            </Subsection>
          </Section>

          {/* Skills */}
          <Section id="ai-skills" title="Skills (61)">
            <p className="text-slate-400 mb-4">61 bundled skills provide specialized functionality. Install more via <code className="text-cyan-400">clodds skills install</code>.</p>

            <Subsection title="Trading & Markets">
              <Table
                headers={['Skill', 'Description', 'Key Commands']}
                rows={[
                  ['trading-polymarket', 'Polymarket trading', '/buy poly, /sell poly'],
                  ['trading-kalshi', 'Kalshi trading', '/buy kalshi'],
                  ['trading-manifold', 'Manifold trading', '/buy manifold'],
                  ['trading-futures', 'Perpetual futures (4 exchanges)', '/futures long, /futures short'],
                  ['trading-solana', 'Solana DEX (Jupiter/Raydium)', '/swap sol'],
                  ['trading-evm', 'EVM DEX (Uniswap/1inch)', '/swap eth, /swap arb'],
                  ['trading-system', 'Unified trading with bots', '/bot start, /bot stop'],
                  ['execution', 'Order execution', '/execute, /orders'],
                  ['portfolio', 'Portfolio management', '/portfolio, /pnl'],
                  ['portfolio-sync', 'Multi-platform sync', '/sync'],
                ]}
              />
            </Subsection>

            <Subsection title="Data & Feeds">
              <Table
                headers={['Skill', 'Description', 'Key Commands']}
                rows={[
                  ['feeds', 'Real-time market data', '/feed price, /feed orderbook'],
                  ['integrations', 'External data sources', '/integrations add, /integrations test'],
                  ['webhooks', 'Incoming webhooks', '/webhook create, /webhook url'],
                  ['market-index', 'Market search', '/index search, /index trending'],
                  ['markets', 'Market browsing', '/markets, /market'],
                  ['news', 'News aggregation', '/news'],
                ]}
              />
            </Subsection>

            <Subsection title="Analysis & Opportunities">
              <Table
                headers={['Skill', 'Description', 'Key Commands']}
                rows={[
                  ['arbitrage', 'Cross-platform arbitrage', '/arb check, /arb compare'],
                  ['opportunity', 'Opportunity scanner', '/opportunity scan, /opportunity stats'],
                  ['edge', 'Edge detection', '/edge scan, /kelly'],
                  ['qmd', 'Quantitative data', '/qmd'],
                  ['research', 'Market research', '/research'],
                  ['history', 'Trade history', '/history stats, /history export'],
                ]}
              />
            </Subsection>

            <Subsection title="Strategy & Backtesting">
              <Table
                headers={['Skill', 'Description', 'Key Commands']}
                rows={[
                  ['backtest', 'Strategy validation', '/backtest, /backtest --monte-carlo'],
                  ['strategy', 'Strategy builder', '/strategy create, /strategies'],
                  ['sizing', 'Kelly criterion sizing', '/kelly, /sizing calculate'],
                  ['risk', 'Circuit breaker & limits', '/risk, /risk pause'],
                  ['positions', 'SL/TP/trailing stops', '/sl, /tp, /trailing'],
                  ['analytics', 'Performance attribution', '/analytics, /analytics attribution'],
                  ['slippage', 'Slippage protection', '/slippage estimate, /slippage protect'],
                  ['metrics', 'System telemetry', '/metrics, /metrics api'],
                ]}
              />
            </Subsection>

            <Subsection title="Smart Trading">
              <Table
                headers={['Skill', 'Description', 'Key Commands']}
                rows={[
                  ['whale-tracking', 'Multi-chain whale monitoring', '/whale start, /whale track'],
                  ['copy-trading', 'Mirror whale trades', '/copy follow, /copy list'],
                  ['alerts', 'Price and event alerts', '/alert, /alerts'],
                  ['triggers', 'Auto-execute on threshold', '/trigger buy, /triggers'],
                  ['router', 'Smart order routing', '/route, /route compare'],
                  ['mev', 'MEV protection', '/mev enable, /mev check'],
                ]}
              />
            </Subsection>

            <Subsection title="Automation">
              <Table
                headers={['Skill', 'Description', 'Key Commands']}
                rows={[
                  ['automation', 'Cron jobs, scheduling', '/cron list, /cron add'],
                  ['auto-reply', 'Automatic responses', '/auto-reply add'],
                  ['processes', 'Background jobs', '/job spawn, /jobs'],
                  ['plugins', 'Plugin management', '/plugins, /plugins install'],
                ]}
              />
            </Subsection>

            <Subsection title="AI & Memory">
              <Table
                headers={['Skill', 'Description', 'Key Commands']}
                rows={[
                  ['memory', 'Persistent memory', '/remember, /memory'],
                  ['embeddings', 'Vector embeddings', '/embeddings provider'],
                  ['search-config', 'Search indexing', '/search-config rebuild'],
                  ['routing', 'Agent routing', '/agents, /bind'],
                ]}
              />
            </Subsection>

            <Subsection title="Infrastructure">
              <Table
                headers={['Skill', 'Description', 'Key Commands']}
                rows={[
                  ['mcp', 'MCP server management', '/mcp list, /mcp add'],
                  ['streaming', 'Response streaming', '/streaming enable'],
                  ['remote', 'SSH tunnels', '/remote tunnel'],
                  ['monitoring', 'System health', '/monitor health'],
                  ['doctor', 'Diagnostics', '/doctor'],
                  ['sandbox', 'Safe code execution', '/run python, /sandbox'],
                  ['tailscale', 'VPN sharing', '/tailscale serve'],
                ]}
              />
            </Subsection>

            <Subsection title="User Management">
              <Table
                headers={['Skill', 'Description', 'Key Commands']}
                rows={[
                  ['credentials', 'Credential management', '/creds add, /creds test'],
                  ['pairing', 'User pairing', '/pair, /pairing approve'],
                  ['identity', 'OAuth & devices', '/identity link, /identity devices'],
                  ['permissions', 'Command approvals', '/permissions, /approve'],
                  ['sessions', 'Session management', '/new, /checkpoint'],
                  ['presence', 'Online status', '/presence, /presence away'],
                  ['usage', 'Token tracking', '/usage, /usage cost'],
                ]}
              />
            </Subsection>

            <Subsection title="Voice, Media & Cross-Chain">
              <Table
                headers={['Skill', 'Description', 'Key Commands']}
                rows={[
                  ['voice', 'Voice recognition', '/voice start, /voice wake'],
                  ['tts', 'Text-to-speech', '/speak, /voices'],
                  ['bridge', 'Wormhole bridging', '/bridge quote, /bridge send'],
                ]}
              />
            </Subsection>
          </Section>

          {/* Memory System */}
          <Section id="ai-memory" title="Memory System">
            <Subsection title="Memory Types">
              <Table
                headers={['Type', 'Purpose', 'Example']}
                rows={[
                  ['Facts', 'Persistent knowledge', '"User is risk-averse"'],
                  ['Preferences', 'Settings and rules', '"Max position size: $500"'],
                  ['Notes', 'User-created notes', '"Research XYZ market later"'],
                  ['Summaries', 'Session summaries', 'Auto-generated recaps'],
                  ['Context', 'Contextual info', 'Current market conditions'],
                ]}
              />
            </Subsection>

            <Subsection title="Search Methods">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li><strong>Keyword Search:</strong> BM25 full-text search</li>
                <li><strong>Semantic Search:</strong> Vector embeddings via LanceDB</li>
                <li><strong>Hybrid Search:</strong> Combined BM25 + semantic for best results</li>
              </ul>
            </Subsection>

            <Subsection title="Commands">
              <CodeBlock>
{`/remember fact risk_tolerance=conservative
/remember preference max_position=500
/remember note "Check BTC markets tomorrow"
/memory                    # View all memories
/forget risk_tolerance     # Delete specific memory`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Solana DEX */}
          <Section id="solana-dex" title="Solana DEX Integration (5)">
            <p className="text-slate-400 mb-4">Trade tokens on Solana with best route finding and slippage protection.</p>

            <Table
              headers={['Protocol', 'Type', 'Features']}
              rows={[
                ['Jupiter', 'DEX Aggregator', 'Best route across all DEXs, versioned transactions'],
                ['Raydium', 'AMM', 'Pool discovery, CLMM & DLMM pools'],
                ['Orca', 'Concentrated Liquidity', 'Whirlpool positions, tight spreads'],
                ['Meteora', 'Dynamic AMM', 'DLMM pools, dynamic fees'],
                ['Pump.fun', 'Token Launch', 'New token trading, bonding curves'],
              ]}
            />

            <Subsection title="Configuration">
              <CodeBlock title=".env">
{`SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=your_base58_private_key`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>Automatic best route finding</li>
                <li>Slippage protection (default: 0.5%)</li>
                <li>Priority fee support for faster execution</li>
                <li>Token list caching</li>
                <li>Versioned transaction support</li>
              </ul>
            </Subsection>
          </Section>

          {/* x402 Payments */}
          <Section id="x402-payments" title="x402 Payment Protocol">
            <p className="text-slate-400 mb-4">Machine-to-machine USDC payments using HTTP 402 Payment Required.</p>

            <Alert type="info">x402 enables AI agents to pay for services automatically without human intervention.</Alert>

            <Subsection title="Supported Networks">
              <Table
                headers={['Network', 'Type', 'USDC Address']}
                rows={[
                  ['Base', 'EVM L2', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],
                  ['Base Sepolia', 'EVM Testnet', '0x036CbD53842c5426634e7929541eC2318f3dCF7e'],
                  ['Solana', 'Native', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
                  ['Solana Devnet', 'Testnet', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'],
                ]}
              />
            </Subsection>

            <Subsection title="Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li><strong>Auto-Approval:</strong> Configurable limit (default: $1.00)</li>
                <li><strong>Fee-Free:</strong> Via Coinbase facilitator</li>
                <li><strong>Dry-Run Mode:</strong> Test without real transactions</li>
                <li><strong>Payment History:</strong> Full transaction logging</li>
                <li><strong>Replay Protection:</strong> Nonce-based validation</li>
                <li><strong>Signing:</strong> EIP-712 (EVM) + Ed25519 (Solana)</li>
              </ul>
            </Subsection>

            <Subsection title="Configuration">
              <CodeBlock title=".env">
{`X402_NETWORK=base              # base, base-sepolia, solana, solana-devnet
X402_AUTO_APPROVE_LIMIT=1.00   # Auto-approve payments under this amount
X402_DRY_RUN=false             # Set true for testing`}
              </CodeBlock>
            </Subsection>

            <Subsection title="How It Works">
              <ol className="list-decimal list-inside text-slate-400 space-y-2">
                <li>Client requests resource from server</li>
                <li>Server returns HTTP 402 with payment requirements</li>
                <li>Client signs USDC transfer authorization</li>
                <li>Server verifies signature and executes transfer</li>
                <li>Server returns requested resource</li>
              </ol>
            </Subsection>
          </Section>

          {/* Wormhole Bridge */}
          <Section id="wormhole-bridge" title="Wormhole Cross-Chain Bridge">
            <p className="text-slate-400 mb-4">Transfer tokens between chains using Wormhole's bridge infrastructure.</p>

            <Subsection title="Supported Routes">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>Ethereum ↔ Solana</li>
                <li>Polygon ↔ Base</li>
                <li>Avalanche ↔ Optimism</li>
                <li>Arbitrum ↔ Any supported chain</li>
              </ul>
            </Subsection>

            <Subsection title="Protocols">
              <Table
                headers={['Protocol', 'Best For', 'Speed']}
                rows={[
                  ['Token Bridge', 'General tokens', '~15 minutes'],
                  ['CCTP', 'Native USDC', '~5 minutes'],
                  ['Native', 'Chain-specific', 'Varies'],
                ]}
              />
            </Subsection>

            <Subsection title="Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>Quote generation before bridging</li>
                <li>Auto-route selection (cheapest/fastest)</li>
                <li>Automatic redeem on destination</li>
                <li>Native gas provisioning</li>
                <li>Human-readable or atomic amounts</li>
              </ul>
            </Subsection>
          </Section>

          {/* Cron Jobs */}
          <Section id="cron-jobs" title="Cron Jobs">
            <p className="text-slate-400 mb-4">Schedule automated tasks with flexible scheduling.</p>

            <Subsection title="Job Types">
              <Table
                headers={['Type', 'Description']}
                rows={[
                  ['system_event', 'Arbitrary system messages'],
                  ['agent_turn', 'Wake agent with message'],
                  ['alert_scan', 'Check all price alerts'],
                  ['portfolio_sync', 'Update positions across platforms'],
                  ['market_check', 'Check specific market'],
                  ['daily_digest', 'Generate daily summary'],
                  ['stoploss_scan', 'Check stop-loss triggers'],
                ]}
              />
            </Subsection>

            <Subsection title="Schedule Types">
              <CodeBlock>
{`// Run once at specific time
{ "kind": "at", "atMs": 1706540400000 }

// Run every N milliseconds
{ "kind": "every", "everyMs": 3600000 }  // Every hour

// Cron expression
{ "kind": "cron", "expr": "0 9 * * *", "tz": "America/New_York" }  // 9 AM ET daily`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Webhooks */}
          <Section id="webhooks" title="Webhooks">
            <Subsection title="Supported Events">
              <FeatureGrid items={['trade.executed', 'position.opened', 'position.closed', 'alert.triggered', 'bot.signal', 'price.update', 'error.occurred']} />
            </Subsection>

            <Subsection title="Features">
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                <li>HTTP POST callbacks</li>
                <li>Retry logic with exponential backoff</li>
                <li>Signature verification (HMAC)</li>
                <li>Event filtering</li>
                <li>Webhook testing endpoint</li>
              </ul>
            </Subsection>
          </Section>

          {/* Extensions */}
          <Section id="extensions" title="Extensions (10)">
            <Table
              headers={['Extension', 'Purpose']}
              rows={[
                ['diagnostics-otel', 'OpenTelemetry tracing and metrics'],
                ['lobster', 'Advanced request/response tracing'],
                ['copilot-proxy', 'GitHub Copilot integration'],
                ['google-auth', 'Google OAuth for Gemini/Vertex'],
                ['qwen-portal', 'Alibaba Qwen model integration'],
                ['memory-lancedb', 'Vector database for semantic memory'],
                ['llm-task', 'LLM task orchestration'],
                ['open-prose', 'Document editing operations'],
                ['task-runner', 'AI-powered task planning and execution'],
                ['base-adapter', 'Production-grade channel adapters'],
              ]}
            />
          </Section>

          {/* Authentication - OAuth */}
          <Section id="auth-oauth" title="OAuth Authentication">
            <p className="text-slate-400 mb-4">Unified OAuth 2.0 authentication for AI providers with Authorization Code + PKCE and Device Code flows.</p>

            <Subsection title="Supported Providers">
              <Table
                headers={['Provider', 'Auth Code', 'Device Code', 'Refresh']}
                rows={[
                  ['Anthropic', '✅', '✅', '✅'],
                  ['OpenAI', '✅', '✅', '✅'],
                  ['Google', '✅', '✅', '✅'],
                  ['GitHub', '✅', '✅', '❌'],
                  ['Azure AD', '✅', '✅', '✅'],
                ]}
              />
            </Subsection>

            <Subsection title="CLI Commands">
              <CodeBlock>
{`# Interactive OAuth login
clodds auth login anthropic
clodds auth login openai
clodds auth login google

# Check authentication status
clodds auth status

# Revoke tokens
clodds auth logout
clodds auth logout anthropic`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Programmatic Usage">
              <CodeBlock title="TypeScript">
{`import { OAuthClient, interactiveOAuth } from 'clodds/auth';

// Interactive authentication (CLI)
const tokens = await interactiveOAuth({
  provider: 'anthropic',
  clientId: 'your-client-id',
  scopes: ['api:read', 'api:write'],
});

// Get access token (auto-refreshes if expired)
const client = new OAuthClient({ provider: 'anthropic', clientId: '...' });
const accessToken = await client.getAccessToken();

// Revoke tokens
await client.revokeTokens();`}
              </CodeBlock>
            </Subsection>

            <Alert type="info">Tokens are stored securely at <code>~/.clodds/tokens/&lt;provider&gt;.json</code> with 0600 permissions.</Alert>
          </Section>

          {/* Authentication - Copilot */}
          <Section id="auth-copilot" title="GitHub Copilot Authentication">
            <p className="text-slate-400 mb-4">Use GitHub Copilot API for code completions and chat.</p>

            <Subsection title="Setup">
              <CodeBlock>
{`# Authenticate with GitHub Copilot
clodds auth copilot

# Follow the device code flow
# Visit https://github.com/login/device
# Enter the code shown in terminal`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Programmatic Usage">
              <CodeBlock title="TypeScript">
{`import { CopilotAuthClient, CopilotCompletionClient } from 'clodds/auth';

const auth = new CopilotAuthClient();
const copilot = new CopilotCompletionClient(auth);

// Code completion
const completion = await copilot.complete('function add(a, b) {');

// Chat completion
const response = await copilot.chat([
  { role: 'user', content: 'Explain this code...' }
], { model: 'gpt-4o' });`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Authentication - Google */}
          <Section id="auth-google" title="Google/Gemini Authentication">
            <p className="text-slate-400 mb-4">Multiple authentication methods for Google AI services.</p>

            <Subsection title="API Key (Simplest)">
              <CodeBlock title=".env">
{`GOOGLE_API_KEY=your-api-key
# Or
GEMINI_API_KEY=your-api-key`}
              </CodeBlock>
            </Subsection>

            <Subsection title="OAuth (User Auth)">
              <CodeBlock>
{`clodds auth login google`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Service Account (Server-to-Server)">
              <CodeBlock title="TypeScript">
{`import { GoogleAuthClient } from 'clodds/auth';

const client = new GoogleAuthClient({
  serviceAccountPath: '/path/to/service-account.json',
});

// Access token is automatically obtained via JWT
const headers = await client.getGeminiHeaders();`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Gemini Client">
              <CodeBlock title="TypeScript">
{`import { GeminiClient } from 'clodds/auth';

const gemini = new GeminiClient();
const response = await gemini.generateContent('gemini-pro', 'Hello!');`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Authentication - Qwen */}
          <Section id="auth-qwen" title="Qwen/DashScope Authentication">
            <p className="text-slate-400 mb-4">Alibaba Cloud AI services authentication.</p>

            <Subsection title="API Key">
              <CodeBlock title=".env">
{`DASHSCOPE_API_KEY=your-key
# Or
QWEN_API_KEY=your-key`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Alibaba Cloud Credentials">
              <CodeBlock title="TypeScript">
{`import { QwenAuthClient, QwenClient } from 'clodds/auth';

// API key auth
const auth = new QwenAuthClient({ apiKey: 'your-key' });

// Or Alibaba Cloud credentials
const auth = new QwenAuthClient({
  accessKeyId: 'your-access-key',
  accessKeySecret: 'your-secret',
});

// Sign API requests
const signedParams = auth.signAliyunRequest('GET', url, params);

// Use Qwen client
const qwen = new QwenClient();
const response = await qwen.generate('qwen-turbo', 'Hello!');
const embeddings = await qwen.embed('text-embedding-v2', ['text1', 'text2']);`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Telemetry - Overview */}
          <Section id="telemetry-overview" title="OpenTelemetry Integration">
            <p className="text-slate-400 mb-4">Comprehensive observability with distributed tracing and metrics.</p>

            <Subsection title="Configuration">
              <CodeBlock title="clodds.json">
{`{
  "telemetry": {
    "enabled": true,
    "serviceName": "clodds",
    "serviceVersion": "0.1.0",
    "environment": "production",
    "otlpEndpoint": "http://localhost:4318",
    "jaegerEndpoint": "http://localhost:14268",
    "zipkinEndpoint": "http://localhost:9411",
    "metricsPort": 9090,
    "sampleRate": 1.0
  }
}`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Supported Exporters">
              <Table
                headers={['Exporter', 'Endpoint Config', 'Compatible With']}
                rows={[
                  ['OTLP', 'otlpEndpoint', 'OpenTelemetry Collector, Grafana Tempo, Honeycomb'],
                  ['Jaeger', 'jaegerEndpoint', 'Jaeger all-in-one'],
                  ['Zipkin', 'zipkinEndpoint', 'Zipkin server'],
                  ['Prometheus', 'metricsPort', 'Prometheus scraping'],
                ]}
              />
            </Subsection>
          </Section>

          {/* Telemetry - Metrics */}
          <Section id="telemetry-metrics" title="Metrics & Prometheus">
            <p className="text-slate-400 mb-4">Prometheus-compatible metrics for monitoring LLM usage and system health.</p>

            <Subsection title="Built-in LLM Metrics">
              <Table
                headers={['Metric', 'Type', 'Description']}
                rows={[
                  ['llm_requests_total', 'Counter', 'LLM requests by provider/model/status'],
                  ['llm_request_duration_ms', 'Histogram', 'Request latency distribution'],
                  ['llm_tokens_input_total', 'Counter', 'Input tokens used'],
                  ['llm_tokens_output_total', 'Counter', 'Output tokens used'],
                  ['llm_tokens_by_user', 'Counter', 'Tokens by user ID'],
                ]}
              />
            </Subsection>

            <Subsection title="Custom Metrics">
              <CodeBlock title="TypeScript">
{`import { getTelemetry } from 'clodds/telemetry';

const telemetry = getTelemetry();

// Counter
telemetry.recordCounter('api_requests_total', 1, {
  endpoint: '/markets',
  method: 'GET',
});

// Gauge
telemetry.recordGauge('active_connections', 42, {
  channel: 'telegram',
});

// Histogram
telemetry.recordHistogram('request_duration_ms', 150, {
  endpoint: '/api/search',
});`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Prometheus Endpoint">
              <p className="text-slate-400">Access metrics at <code className="text-cyan-400">http://localhost:9090/metrics</code></p>
              <CodeBlock title="prometheus.yml">
{`scrape_configs:
  - job_name: 'clodds'
    static_configs:
      - targets: ['localhost:9090']`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Telemetry - Tracing */}
          <Section id="telemetry-tracing" title="Distributed Tracing">
            <p className="text-slate-400 mb-4">Track requests across services with OpenTelemetry tracing.</p>

            <Subsection title="Basic Tracing">
              <CodeBlock title="TypeScript">
{`import { initTelemetry, getTelemetry } from 'clodds/telemetry';

// Initialize
const telemetry = initTelemetry({ enabled: true, serviceName: 'clodds' });

// Create trace
const span = telemetry.startTrace('my-operation', {
  'custom.attribute': 'value'
});

// Add events
telemetry.addEvent(span, 'checkpoint-reached', { step: 1 });

// End span
telemetry.endSpan(span, 'ok'); // or 'error'`}
              </CodeBlock>
            </Subsection>

            <Subsection title="LLM Instrumentation">
              <CodeBlock title="TypeScript">
{`import { createLLMInstrumentation } from 'clodds/telemetry';

const llmInstr = createLLMInstrumentation();

// Trace completion
const { result, span } = await llmInstr.traceCompletion(
  'anthropic',          // provider
  'claude-3-5-sonnet',  // model
  async () => {
    return await client.complete({ messages });
  },
  { inputTokens: 100, promptLength: 500, userId: 'user-123' }
);

// Record token usage
llmInstr.recordTokenUsage('anthropic', 'claude-3-5-sonnet', 100, 500);

// Trace tool calls
const toolSpan = llmInstr.traceToolCall(parentSpan, 'search_markets');
// ... execute tool ...
telemetry.endSpan(toolSpan, 'ok');`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Docker Compose Example">
              <CodeBlock title="docker-compose.yml">
{`version: '3'
services:
  clodds:
    build: .
    environment:
      - TELEMETRY_ENABLED=true
      - TELEMETRY_OTLP_ENDPOINT=http://collector:4318

  collector:
    image: otel/opentelemetry-collector:latest
    ports:
      - "4318:4318"

  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9091:9090"`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Deployment Options */}
          <Section id="deploy-options" title="Deployment Options">
            <p className="text-slate-400 mb-4">Choose the deployment method that fits your needs:</p>
            <Table
              headers={['Option', 'Best For', 'Features', 'Infrastructure']}
              rows={[
                ['Self-Hosted', 'Full control, all features', '22 channels, trading, DeFi, bots', 'VPS/Server'],
                ['Docker', 'Containerized environments', 'All features', 'Docker host'],
                ['Cloudflare Worker', 'Lightweight edge deployment', '3 channels, market data, alerts', 'Cloudflare free tier'],
              ]}
            />
            <Alert type="info">
              For most users, the self-hosted option provides the full experience. Use the Cloudflare Worker for a quick, lightweight deployment without dedicated hardware.
            </Alert>
          </Section>

          {/* Self-Hosted */}
          <Section id="deploy-self-hosted" title="Self-Hosted Deployment">
            <Subsection title="Node.js">
              <CodeBlock title="Terminal">
{`npm ci
npm run build
node dist/index.js`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Docker">
              <CodeBlock title="Terminal">
{`docker build -t clodds .
docker run --rm -p 18789:18789 \\
  -e ANTHROPIC_API_KEY=... \\
  -e TELEGRAM_BOT_TOKEN=... \\
  -v clodds_data:/data \\
  clodds`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Docker Compose">
              <CodeBlock title="Terminal">
{`docker compose up -d --build`}
              </CodeBlock>
            </Subsection>

            <Subsection title="systemd (Linux)">
              <CodeBlock title="/etc/systemd/system/clodds.service">
{`[Unit]
Description=Clodds Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/clodds
EnvironmentFile=/etc/clodds/clodds.env
ExecStart=/usr/bin/node /opt/clodds/dist/index.js
Restart=on-failure
User=clodds

[Install]
WantedBy=multi-user.target`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Cloudflare Worker */}
          <Section id="deploy-worker" title="Cloudflare Worker">
            <p className="text-slate-400 mb-4">
              Lightweight edge deployment for webhook-based channels. No dedicated server required.
            </p>

            <Subsection title="Features">
              <FeatureGrid items={[
                'Telegram Webhook',
                'Discord Interactions',
                'Slack Events API',
                'Market Search',
                'Price Alerts',
                'Arbitrage Scanning',
                'REST API',
                'D1 Database',
              ]} />
            </Subsection>

            <Subsection title="Limitations vs Full">
              <Table
                headers={['Feature', 'Full', 'Worker']}
                rows={[
                  ['Channels', '22', '3 (webhook-based)'],
                  ['Markets', '9', '3 (Poly, Kalshi, Manifold)'],
                  ['Trading', 'Full execution', 'Read-only'],
                  ['Real-time', 'WebSocket feeds', 'Polling/cron'],
                  ['DeFi', 'Solana integration', 'None'],
                  ['Tools', '21', '10'],
                ]}
              />
            </Subsection>

            <Subsection title="Quick Setup">
              <CodeBlock title="Terminal">
{`cd apps/clodds-worker
npm install

# Create Cloudflare resources
npx wrangler d1 create clodds
npx wrangler kv:namespace create CACHE

# Update wrangler.toml with returned IDs

# Run migrations
npx wrangler d1 migrations apply clodds

# Set secrets
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN  # optional

# Deploy
npx wrangler deploy`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Set Up Telegram Webhook">
              <CodeBlock title="Terminal">
{`curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://clodds-worker.<account>.workers.dev/webhook/telegram"`}
              </CodeBlock>
            </Subsection>

            <Subsection title="REST API Endpoints">
              <Table
                headers={['Endpoint', 'Description']}
                rows={[
                  ['GET /api/health', 'Health check with service status'],
                  ['GET /api/markets/search?q=...', 'Search markets across platforms'],
                  ['GET /api/markets/:platform/:id', 'Get specific market details'],
                  ['GET /api/markets/:platform/:id/orderbook', 'Get orderbook (Poly/Kalshi)'],
                  ['GET /api/arbitrage/scan', 'Scan for arbitrage opportunities'],
                  ['GET /api/arbitrage/recent', 'Get recent opportunities from DB'],
                ]}
              />
            </Subsection>

            <Alert type="info">
              See <a href="https://github.com/alsk1992/CloddsBot/tree/main/apps/clodds-worker" className="text-cyan-400 hover:underline">apps/clodds-worker/README.md</a> for full documentation.
            </Alert>
          </Section>

          {/* Architecture */}
          <Section id="architecture" title="Architecture">
            <CodeBlock>
{`┌────────────────────────────────────────────────────────────┐
│                        GATEWAY                              │
│          HTTP • WebSocket • Auth • Rate Limiting            │
│                    1000 connections                         │
└────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
     ┌────▼─────┐       ┌────▼─────┐       ┌────▼─────┐
     │ CHANNELS │       │  AGENTS  │       │  FEEDS   │
     │   (22)   │       │   (4)    │       │  (9+)    │
     │          │       │          │       │          │
     │ Telegram │       │  Main    │       │Polymarket│
     │ Discord  │       │ Trading  │       │ Kalshi   │
     │ Slack    │       │ Research │       │ Betfair  │
     │ +19 more │       │ Alerts   │       │ Crypto   │
     └──────────┘       └──────────┘       └──────────┘
          │                   │                   │
          └───────────────────┼───────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
     ┌────▼─────┐       ┌────▼─────┐       ┌────▼─────┐
     │ TRADING  │       │  SOLANA  │       │   x402   │
     │          │       │   DeFi   │       │ PAYMENTS │
     │Execution │       │          │       │          │
     │Portfolio │       │ Jupiter  │       │ Base     │
     │  Bots    │       │ Raydium  │       │ Solana   │
     │  Risk    │       │ Orca     │       │ USDC     │
     │          │       │ Meteora  │       │          │
     │          │       │ Pump.fun │       │ Wormhole │
     └──────────┘       └──────────┘       └──────────┘
                              │
     ┌────────────────────────▼───────────────────────────┐
     │              DATABASE & MEMORY                      │
     │     SQLite • LanceDB • Embeddings • Semantic       │
     └────────────────────────────────────────────────────┘`}
            </CodeBlock>
          </Section>

          {/* Database Schema */}
          <Section id="database" title="Database Schema">
            <Subsection title="Core Tables">
              <CodeBlock title="SQLite">
{`-- Sessions & Conversations
sessions (id, userId, channel, createdAt, updatedAt, context_json)
conversation_history (id, sessionId, role, content, createdAt)

-- Memory
user_memory (id, userId, channel, type, key, value, createdAt, expiresAt)
daily_logs (id, userId, channel, date, summary, messageCount)

-- Trading
trades (id, platform, marketId, outcome, side, price, size, filled, status, pnl)
positions (id, platform, marketId, outcome, shares, avgPrice, unrealizedPnL)
bot_state (strategy_id, status, started_at, last_check, last_signal_json)

-- Markets & Arbitrage
market_cache (id, platform, marketId, question_json, updated_at)
arbitrage_matches (id, markets_json, similarity, matched_by)
arbitrage_opportunities (id, buy_platform, sell_platform, spread, confidence)

-- Alerts & Automation
alerts (id, userId, platform, marketId, condition, threshold, active)
cron_jobs (id, name, enabled, schedule_json, payload_json)
webhooks (id, event, url, active, secret)`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Environment Variables */}
          <Section id="env-vars" title="All Environment Variables">
            <Subsection title="Required">
              <CodeBlock>
{`ANTHROPIC_API_KEY=sk-ant-...    # Required for Claude`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Channels">
              <CodeBlock>
{`TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
SLACK_BOT_TOKEN=...
SLACK_APP_TOKEN=...
WHATSAPP_SESSION_PATH=...
MATRIX_HOMESERVER=...
MATRIX_ACCESS_TOKEN=...
NOSTR_PRIVATE_KEY=...
TWITCH_OAUTH_TOKEN=...
LINE_CHANNEL_ACCESS_TOKEN=...
TEAMS_APP_ID=...
TEAMS_APP_PASSWORD=...`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Markets">
              <CodeBlock>
{`POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_FUNDER_ADDRESS=...
KALSHI_API_KEY=...
KALSHI_PRIVATE_KEY_PEM=...
BETFAIR_APP_KEY=...
BETFAIR_SESSION_TOKEN=...
SMARKETS_API_KEY=...
MANIFOLD_API_KEY=...`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Blockchain">
              <CodeBlock>
{`SOLANA_RPC_URL=...
SOLANA_PRIVATE_KEY=...
ETHEREUM_RPC_URL=...
ETHEREUM_PRIVATE_KEY=...
X402_NETWORK=base
X402_AUTO_APPROVE_LIMIT=1.00
WORMHOLE_NETWORK=Mainnet`}
              </CodeBlock>
            </Subsection>

            <Subsection title="Features">
              <CodeBlock>
{`MARKET_INDEX_ENABLED=true
OPPORTUNITY_FINDER_ENABLED=true
CLODDS_STREAM_RESPONSES=1
CLODDS_STREAM_TOOL_CALLS=1
CLODDS_MEMORY_EXTRACT_MODEL=claude-3-5-haiku-20241022`}
              </CodeBlock>
            </Subsection>
          </Section>

          {/* Summary */}
          <Section id="summary" title="Summary">
            <Table
              headers={['Category', 'Count']}
              rows={[
                ['Messaging Channels', '22'],
                ['Prediction Markets', '9'],
                ['AI Tools', '21'],
                ['Bundled Skills', '61'],
                ['LLM Providers', '6'],
                ['Solana DEX Protocols', '5'],
                ['EVM Chains', '5'],
                ['Trading Strategies', '3'],
                ['Extensions', '8'],
                ['Agent Types', '4'],
                ['Crypto Assets', '10'],
                ['x402 Networks', '4'],
              ]}
            />
          </Section>

          {/* Glossary */}
          <Section id="glossary" title="Glossary (150+ Terms)">
            <p className="text-slate-400 mb-6">Comprehensive glossary of trading, DeFi, and platform terminology used throughout Clodds.</p>

            <Subsection title="Trading & Orders">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['Limit Order', 'Order to buy/sell at a specific price or better'],
                  ['Market Order', 'Order that executes immediately at best available price'],
                  ['Maker Order', 'Order that adds liquidity. Polymarket makers get -0.5% rebate'],
                  ['Taker Order', 'Order that removes liquidity by crossing spread. Pays fees'],
                  ['Post-Only', 'Order rejected if would take liquidity instead of making'],
                  ['GTC', 'Good-Till-Cancelled. Remains open until filled or cancelled'],
                  ['FOK', 'Fill-Or-Kill. Must execute fully immediately or cancel'],
                  ['FAK / IOC', 'Fill-And-Kill. Fills available, cancels remainder'],
                  ['Fill', 'Execution of an order. Fill price = execution price'],
                  ['Orderbook', 'List of all open buy (bid) and sell (ask) orders'],
                  ['Bid', 'Highest price a buyer will pay'],
                  ['Ask', 'Lowest price a seller will accept'],
                  ['Spread', 'Difference between best bid and best ask'],
                  ['Mid Price', 'Average of bid and ask: (bid + ask) / 2'],
                  ['Tick Size', 'Minimum price increment (e.g., 0.01)'],
                ]}
              />
            </Subsection>

            <Subsection title="Slippage & Execution">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['Slippage', 'Difference between expected and actual fill price'],
                  ['Price Impact', 'Price change from large order consuming multiple levels'],
                  ['Orderbook Depth', 'Liquidity available at different price levels'],
                  ['Liquidity', 'Volume of orders at competitive prices. Thin = high slippage'],
                  ['TWAP', 'Time-Weighted Average Price. Splits orders across time'],
                  ['Order Splitting', 'Breaking large order into pieces to reduce slippage'],
                  ['Fill Rate', 'Percentage of orders that execute completely'],
                  ['Smart Routing', 'Auto-routing to best platform for price/liquidity/fees'],
                ]}
              />
            </Subsection>

            <Subsection title="Arbitrage">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['Arbitrage', 'Exploiting price differences for guaranteed profit'],
                  ['Cross-Platform', 'Buy low on one platform, sell high on another'],
                  ['Internal Arb', 'Exploit YES + NO = $1 when total < $1'],
                  ['Combinatorial', 'Exploit logical violations (P(Trump) ≤ P(Republican))'],
                  ['Edge', 'Mathematical advantage: Estimated Prob - Market Price'],
                  ['Fair Value', 'Correct price based on models or arbitrage-free pricing'],
                  ['Semantic Matching', 'AI finding equivalent markets across platforms'],
                ]}
              />
            </Subsection>

            <Subsection title="Risk Management">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['Kelly Criterion', 'Optimal sizing: f* = (p × b - q) / b'],
                  ['Fractional Kelly', 'Using 1/2 or 1/4 Kelly for safer growth'],
                  ['Bankroll', 'Total capital available for trading'],
                  ['Drawdown', 'Peak-to-trough portfolio decline'],
                  ['Circuit Breaker', 'Auto halt when risk limits exceeded'],
                  ['Stop-Loss', 'Exit price below entry to limit losses'],
                  ['Take-Profit', 'Exit price above entry to lock gains'],
                  ['Trailing Stop', 'Stop that moves up with price'],
                  ['Sharpe Ratio', 'Risk-adjusted return: (Return - RF) / Volatility'],
                  ['Profit Factor', 'Gross profit / gross loss. >1.5 is good'],
                  ['Win Rate', 'Percentage of profitable trades'],
                  ['Expectancy', '(Win% × Avg Win) - (Loss% × Avg Loss)'],
                  ['VaR', 'Value at Risk. Max expected loss at confidence level'],
                ]}
              />
            </Subsection>

            <Subsection title="Prediction Markets">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['YES/NO Shares', 'Tokens paying $1 if outcome occurs, $0 if not'],
                  ['Outcome Token', 'Token representing specific market outcome'],
                  ['Resolution', 'Official determination of market outcome'],
                  ['CLOB', 'Central Limit Order Book (vs AMM)'],
                  ['Implied Probability', 'Probability from price. 0.55 = 55%'],
                  ['Negative Risk', 'Short bets without doubling capital'],
                  ['Heartbeat', 'Keepalive signal. Polymarket: every 10s'],
                ]}
              />
            </Subsection>

            <Subsection title="Perpetual Futures">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['Perpetual', 'Futures contract that never expires'],
                  ['Long', 'Betting price goes up'],
                  ['Short', 'Betting price goes down'],
                  ['Leverage', 'Position/capital ratio. 10x = $100 controls $1000'],
                  ['Margin', 'Capital required for leveraged position'],
                  ['Cross Margin', 'All positions share margin pool'],
                  ['Isolated Margin', 'Each position has own margin'],
                  ['Funding Rate', 'Payment between longs/shorts'],
                  ['Liquidation', 'Forced closure when margin insufficient'],
                  ['Mark Price', 'Price for P&L and liquidation calc'],
                  ['Index Price', 'Reference price from spot markets'],
                ]}
              />
            </Subsection>

            <Subsection title="DeFi & Crypto">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['AMM', 'Automated Market Maker using pools vs orderbooks'],
                  ['Liquidity Pool', 'Smart contract with paired tokens for trading'],
                  ['LP', 'Liquidity Provider. Deposits tokens, earns fees'],
                  ['Swap', 'Trading one token for another on DEX'],
                  ['Yield Farming', 'Earning yield from fees and incentives'],
                  ['Gas', 'Transaction cost on blockchain'],
                  ['Whale', 'Large wallet that can move markets'],
                ]}
              />
            </Subsection>

            <Subsection title="MEV (Maximal Extractable Value)">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['MEV', 'Profit from reordering/inserting transactions'],
                  ['Sandwich Attack', 'Frontrun + backrun user tx for profit'],
                  ['Front-Running', 'Placing tx ahead of pending tx'],
                  ['Backrunning', 'Placing tx after pending tx'],
                  ['Private Mempool', 'Hiding pending txs from public'],
                  ['Flashbots', 'Ethereum MEV protection via private relay'],
                  ['MEV Blocker', 'CoW Protocol returning captured value'],
                  ['Jito', 'Solana MEV protection with bundles'],
                  ['Bundle', 'Grouped txs submitted atomically'],
                ]}
              />
            </Subsection>

            <Subsection title="Blockchain & Tokens">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['ERC-20', 'Standard fungible token (USDC, etc.)'],
                  ['ERC-1155', 'Multi-token for YES/NO outcome tokens'],
                  ['EOA', 'Externally Owned Account. Standard wallet'],
                  ['Proxy Wallet', 'Smart contract wallet (Gnosis Safe)'],
                  ['Wormhole', 'Cross-chain bridge protocol'],
                ]}
              />
            </Subsection>

            <Subsection title="Strategy & Backtesting">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['Strategy', 'Rule-based plan with entry/exit/risk conditions'],
                  ['Signal', 'Condition triggering trade action'],
                  ['Backtest', 'Simulating strategy on historical data'],
                  ['Walk-Forward', 'Train on one period, test on next'],
                  ['Overfitting', 'Works on history, fails live'],
                  ['Monte Carlo', '1000s of randomized simulations'],
                  ['Momentum', 'Trading following price trends'],
                  ['Mean Reversion', 'Trading towards the average'],
                  ['CAGR', 'Compound Annual Growth Rate'],
                ]}
              />
            </Subsection>

            <Subsection title="Copy Trading & Whales">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['Copy Trading', 'Auto-mirroring trades from wallets'],
                  ['Whale Tracking', 'Monitoring large trades from key wallets'],
                  ['Sizing Mode', 'How copies scale: fixed, proportional, portfolio'],
                  ['Trade Delay', 'Delay before copying to avoid detection'],
                ]}
              />
            </Subsection>

            <Subsection title="Portfolio & Performance">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['Portfolio', 'All open positions and trades'],
                  ['Position', 'An open trade/exposure'],
                  ['Cost Basis', 'Average entry price'],
                  ['Exposure', 'Total capital deployed'],
                  ['Correlation', 'Statistical relationship between assets'],
                  ['Attribution', 'Breaking down P&L by source'],
                  ['P&L', 'Profit & Loss'],
                ]}
              />
            </Subsection>

            <Subsection title="Technical & Platform">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['WebSocket', 'Real-time bidirectional data protocol'],
                  ['REST API', 'HTTP-based API for requests'],
                  ['API Key', 'Authentication credential'],
                  ['MCP', 'Model Context Protocol for Claude tools'],
                  ['Webhook', 'HTTP callback on events'],
                  ['Rate Limiting', 'Max API requests per time period'],
                  ['Basis Points', '0.01%. 100 bps = 1%'],
                  ['Rebate', 'Payment for making. Polymarket: -0.5%'],
                ]}
              />
            </Subsection>

            <Subsection title="Additional Order Types">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['OCO', 'One-Cancels-Other. Two linked orders, filling one cancels other'],
                  ['DCA', 'Dollar Cost Averaging. Fixed amounts at regular intervals'],
                  ['Grid Trading', 'Orders at intervals above/below price for range profits'],
                  ['Iceberg', 'Large order split into visible and hidden portions'],
                ]}
              />
            </Subsection>

            <Subsection title="Additional DeFi Terms">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['Impermanent Loss', 'LP loss when prices diverge from deposit ratio'],
                  ['TVL', 'Total Value Locked in a DeFi protocol'],
                  ['APY', 'Annual Percentage Yield (with compounding)'],
                  ['APR', 'Annual Percentage Rate (without compounding)'],
                  ['Bonding Curve', 'Math curve setting price by supply (Pump.fun)'],
                  ['Airdrop', 'Free token distribution to wallet holders'],
                  ['Staking', 'Locking tokens to earn rewards'],
                  ['Vesting', 'Gradual token unlock schedule'],
                  ['Rug Pull', 'Creators abandon project and steal funds'],
                ]}
              />
            </Subsection>

            <Subsection title="Payment & Bridge Terms">
              <Table
                headers={['Term', 'Definition']}
                rows={[
                  ['x402', 'HTTP 402 protocol for machine-to-machine USDC payments'],
                  ['Facilitator', 'x402 intermediary enabling fee-free payments'],
                  ['CCTP', 'Circle Cross-Chain Transfer Protocol for USDC'],
                  ['VAA', 'Verified Action Approval. Wormhole cross-chain proof'],
                  ['Guardian', 'Wormhole validator signing cross-chain messages'],
                ]}
              />
            </Subsection>

            <Subsection title="Key Formulas">
              <Table
                headers={['Formula', 'Calculation']}
                rows={[
                  ['Kelly Criterion', 'f* = (p × b - q) / b'],
                  ['Sharpe Ratio', '(Return - Risk-Free) / Volatility'],
                  ['Profit Factor', 'Gross Profit / Gross Loss'],
                  ['Expectancy', '(Win% × AvgWin) - (Loss% × AvgLoss)'],
                  ['Edge', 'Estimated Probability - Market Price'],
                  ['Spread', '(Ask - Bid) / Mid Price'],
                ]}
              />
            </Subsection>
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
