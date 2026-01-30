import React, { useState } from 'react';
import {
  MessageCircle,
  Building2,
  Link,
  Wrench,
  Infinity,
  Github,
  Server,
  Scale,
  Radar,
  Copy,
  CreditCard,
  Mic,
  Globe,
  Cpu,
  Mail,
  MessageSquare,
  Monitor,
  TrendingUp,
  BarChart2,
  Activity,
  Target,
  Zap,
  LineChart,
  DollarSign,
  PieChart,
  Shield,
  Users,
  Route,
  Bell,
  Bot,
  Database,
  Lock,
  Wallet,
  ChevronLeft,
  ChevronRight,
  Clock,
  Calculator,
  FileText,
  Settings,
  Eye,
  Layers,
  Triangle,
  ArrowLeftRight,
  Rocket,
  Sparkles,
  Droplets,
} from 'lucide-react';
import {
  SiTelegram,
  SiDiscord,
  SiWhatsapp,
  SiSlack,
  SiMatrix,
  SiSignal,
  SiLine,
  SiTwitch,
  SiBetfair,
  SiEthereum,
  SiPolygon,
  SiSolana,
  SiOptimism,
  SiCoinbase,
} from '@icons-pack/react-simple-icons';

const features = [
  {
    color: 'cyan',
    title: '22 Messaging Channels',
    description: 'Telegram, Discord, WhatsApp, Slack, Teams, Matrix, Signal, iMessage, Nostr, and more.',
  },
  {
    color: 'green',
    title: '9 Prediction Markets',
    description: 'Polymarket, Kalshi, Betfair, Smarkets, Drift, Manifold, Metaculus, PredictIt.',
  },
  {
    color: 'purple',
    title: 'Arbitrage Detection',
    description: 'Cross-platform, internal, and combinatorial arbitrage scanning.',
  },
  {
    color: 'blue',
    title: 'Whale Tracking & Copy Trading',
    description: 'Monitor large trades on Polymarket and crypto chains (Solana, ETH, Polygon, ARB, Base), follow whales, and auto-copy positions.',
  },
  {
    color: 'orange',
    title: 'Multi-Chain DeFi',
    description: 'Solana (Jupiter, Raydium) + EVM (Uniswap, 1inch) with MEV protection.',
  },
  {
    color: 'pink',
    title: 'Smart Order Routing',
    description: 'Auto-route to best price/liquidity. Maker rebates. Auto-arbitrage execution.',
  },
  {
    color: 'red',
    title: 'Safety Controls',
    description: 'Circuit breakers, drawdown limits, position limits, and kill switches.',
  },
  {
    color: 'yellow',
    title: 'External Data Feeds',
    description: 'CME FedWatch, 538, Silver Bulletin, RCP polls for edge detection.',
  },
];

const stats = [
  { value: '22', label: 'Channels', icon: MessageCircle },
  { value: '9', label: 'Platforms', icon: Building2 },
  { value: '10', label: 'Chains', icon: Link },
  { value: '50+', label: 'Tools', icon: Wrench },
  { value: '∞', label: 'Markets', icon: Infinity },
  { icon: Github, label: 'Open Source' },
  { icon: Server, label: 'Self-Hosted' },
  { icon: Scale, label: 'Arbitrage' },
  { icon: Radar, label: 'Whale Tracking' },
  { icon: Copy, label: 'Copy Trading' },
  { icon: CreditCard, label: 'x402 Payments' },
  { icon: Mic, label: 'Voice Chat' },
  { icon: Globe, label: 'Browser Control' },
  { icon: Cpu, label: 'MCP Servers' },
];

const codeExample = `# Install
git clone https://github.com/alsk1992/CloddsBot.git
cd CloddsBot && npm install

# Configure
cp .env.example .env
# Add ANTHROPIC_API_KEY

# Run
npm run build && npm start

# Chat at http://localhost:18789/webchat`;

const workerCodeExample = `# Cloudflare Workers (no server needed)
git clone -b clodds-worker-only https://github.com/alsk1992/CloddsBot.git
cd CloddsBot && npm install
npx wrangler d1 create clodds
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy

# Set Telegram webhook
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://clodds-worker.<account>.workers.dev/webhook/telegram"`;

const advancedFeatures = [
  { icon: Radar, title: 'Whale Tracking', desc: 'Polymarket + multi-chain crypto (Solana, ETH, Polygon, ARB, Base, OP)', color: 'cyan' },
  { icon: Users, title: 'Copy Trading', desc: 'Auto-mirror positions with configurable sizing', color: 'green' },
  { icon: Route, title: 'Smart Routing', desc: 'Best price routing, maker rebates, liquidity-aware', color: 'purple' },
  { icon: Shield, title: 'MEV Protection', desc: 'Flashbots, Jito bundles, sequencer protection', color: 'red' },
  { icon: Bell, title: 'Real-time Alerts', desc: 'Price alerts, whale moves, arbitrage opportunities', color: 'yellow' },
  { icon: Bot, title: 'Trading Bots', desc: 'Mean reversion, momentum, arbitrage strategies', color: 'blue' },
  { icon: Calculator, title: 'Kelly Criterion', desc: 'Optimal position sizing based on edge', color: 'pink' },
  { icon: Lock, title: 'Risk Management', desc: 'Circuit breakers, drawdown limits, kill switches', color: 'orange' },
  { icon: TrendingUp, title: 'Sharpe Ratio', desc: 'Risk-adjusted return metrics and analytics', color: 'cyan' },
  { icon: Activity, title: 'Backtesting', desc: 'Test strategies against historical data', color: 'green' },
  { icon: Scale, title: 'Arbitrage Detection', desc: 'Cross-platform and internal arb scanning', color: 'purple' },
  { icon: Target, title: 'Stop Loss / Take Profit', desc: 'Automated exit strategies and trailing stops', color: 'red' },
  { icon: Database, title: 'Trade Logging', desc: 'Auto-log all trades to SQLite with analytics', color: 'yellow' },
  { icon: Eye, title: 'Portfolio Tracking', desc: 'Real-time P&L, position history, performance', color: 'blue' },
  { icon: Wallet, title: 'Multi-Wallet', desc: 'Manage multiple wallets across chains', color: 'pink' },
  { icon: Clock, title: 'Scheduled Orders', desc: 'Time-based orders, DCA, recurring buys', color: 'orange' },
  { icon: FileText, title: 'Market Research', desc: 'External data feeds, polls, sentiment', color: 'cyan' },
  { icon: Settings, title: 'Custom Strategies', desc: 'Build your own with the strategy builder', color: 'green' },
  { icon: Layers, title: 'Multi-Platform', desc: 'Execute across 9 platforms simultaneously', color: 'purple' },
  { icon: Zap, title: 'Low Latency', desc: 'WebSocket feeds, optimized execution', color: 'red' },
];

function MarketsSection() {
  const [marketSlide, setMarketSlide] = useState(0);

  const predictionMarkets = [
    { name: 'Polymarket', icon: TrendingUp, status: 'Execute' },
    { name: 'Kalshi', icon: BarChart2, status: 'Execute' },
    { name: 'Betfair', icon: SiBetfair, status: 'Execute' },
    { name: 'Smarkets', icon: Activity, status: 'Execute' },
    { name: 'Drift', icon: Zap, status: 'Execute' },
    { name: 'Lighter', icon: LineChart, status: 'Execute' },
    { name: 'Manifold', icon: PieChart, status: 'Read' },
    { name: 'Metaculus', icon: Target, status: 'Read' },
  ];

  const defiMarkets = [
    { name: 'Jupiter', icon: Rocket, status: 'Execute', chain: 'Solana' },
    { name: 'Meteora', icon: Droplets, status: 'Execute', chain: 'Solana' },
    { name: 'Pump.fun', icon: TrendingUp, status: 'Execute', chain: 'Solana' },
    { name: 'Bags', icon: Sparkles, status: 'Execute', chain: 'Solana' },
    { name: 'Uniswap', icon: ArrowLeftRight, status: 'Execute', chain: 'EVM' },
    { name: '1inch', icon: Layers, status: 'Execute', chain: 'EVM' },
    { name: 'Virtuals', icon: Bot, status: 'Execute', chain: 'Base' },
    { name: 'PancakeSwap', icon: PieChart, status: 'Execute', chain: 'EVM' },
  ];

  const slides = [
    { title: 'Prediction Markets', subtitle: 'Unified interface for all major prediction platforms', markets: predictionMarkets },
    { title: 'DeFi & Crypto', subtitle: 'Trade any token on Solana and EVM chains with MEV protection', markets: defiMarkets },
  ];

  const currentSlide = slides[marketSlide];

  return (
    <section className="py-20 px-6 bg-slate-800/30">
      <div className="max-w-4xl mx-auto">
        <h2
          className="text-3xl md:text-4xl font-bold text-center mb-2"
          style={{
            background: 'linear-gradient(180deg, #ffffff 0%, #22d3ee 50%, #0891b2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 15px rgba(34, 211, 238, 0.4))',
          }}
        >
          Trade on any market
        </h2>
        <p className="text-slate-400 text-center mb-4">
          {currentSlide.subtitle}
        </p>

        {/* Slide indicator pills */}
        <div className="flex justify-center gap-2 mb-8">
          {slides.map((slide, idx) => (
            <button
              key={idx}
              onClick={() => setMarketSlide(idx)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                idx === marketSlide
                  ? 'bg-cyan-500 text-slate-900'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {slide.title}
            </button>
          ))}
        </div>

        <div className="relative">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {currentSlide.markets.map((market) => {
              const Icon = market.icon;
              return (
                <div
                  key={market.name}
                  className="flex flex-col items-center gap-2 p-5 bg-slate-800/50 border border-slate-700 rounded-xl hover:border-cyan-500/50 transition-colors"
                >
                  <Icon size={36} className="text-cyan-400" />
                  <span className="text-white font-medium">{market.name}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${market.status === 'Execute' ? 'text-green-400' : 'text-slate-500'}`}>
                      {market.status}
                    </span>
                    {market.chain && (
                      <span className="text-xs text-slate-500">• {market.chain}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Navigation arrows */}
          <div className="absolute top-1/2 -translate-y-1/2 -left-12 hidden md:block">
            <button
              onClick={() => setMarketSlide((p) => (p === 0 ? slides.length - 1 : p - 1))}
              className="p-2 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-cyan-400 hover:border-cyan-400/50 transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
          </div>
          <div className="absolute top-1/2 -translate-y-1/2 -right-12 hidden md:block">
            <button
              onClick={() => setMarketSlide((p) => (p === slides.length - 1 ? 0 : p + 1))}
              className="p-2 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-cyan-400 hover:border-cyan-400/50 transition-colors"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Dot indicators */}
        <div className="flex justify-center gap-2 mt-6">
          {slides.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setMarketSlide(idx)}
              className={`w-2 h-2 rounded-full transition-colors ${
                idx === marketSlide ? 'bg-cyan-400' : 'bg-slate-600 hover:bg-slate-500'
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function AdvancedFeaturesSection() {
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 4;
  const totalPages = Math.ceil(advancedFeatures.length / itemsPerPage);

  const colorMap = {
    cyan: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30',
    green: 'text-green-400 bg-green-400/10 border-green-400/30',
    purple: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
    red: 'text-red-400 bg-red-400/10 border-red-400/30',
    yellow: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
    blue: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
    pink: 'text-pink-400 bg-pink-400/10 border-pink-400/30',
    orange: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  };

  const currentFeatures = advancedFeatures.slice(
    currentPage * itemsPerPage,
    (currentPage + 1) * itemsPerPage
  );

  return (
    <section className="py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <h2
          className="text-3xl md:text-4xl font-bold text-center mb-2"
          style={{
            background: 'linear-gradient(180deg, #ffffff 0%, #22d3ee 50%, #0891b2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 15px rgba(34, 211, 238, 0.4))',
          }}
        >
          Advanced Trading Features
        </h2>
        <p className="text-slate-400 text-center mb-10">
          Professional-grade tools for serious traders.
        </p>

        <div className="relative">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {currentFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className={`p-5 rounded-xl border transition-all hover:scale-105 ${colorMap[feature.color]}`}
                >
                  <Icon size={28} className="mb-3" />
                  <h3 className="text-sm font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-xs text-slate-400">{feature.desc}</p>
                </div>
              );
            })}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="p-2 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-cyan-400 hover:border-cyan-400/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={20} />
            </button>

            <div className="flex gap-2">
              {Array.from({ length: totalPages }).map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentPage(idx)}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    idx === currentPage ? 'bg-cyan-400' : 'bg-slate-600 hover:bg-slate-500'
                  }`}
                />
              ))}
            </div>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage === totalPages - 1}
              className="p-2 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-cyan-400 hover:border-cyan-400/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Chains */}
        <div className="mt-12">
          <h3 className="text-lg font-semibold text-white text-center mb-4">Supported Chains</h3>
          <div className="flex flex-wrap justify-center gap-4">
            {[
              { name: 'Ethereum', icon: SiEthereum },
              { name: 'Arbitrum', icon: Triangle },
              { name: 'Optimism', icon: SiOptimism },
              { name: 'Base', icon: SiCoinbase },
              { name: 'Polygon', icon: SiPolygon },
              { name: 'Solana', icon: SiSolana },
            ].map((chain) => {
              const Icon = chain.icon;
              return (
                <div
                  key={chain.name}
                  className="flex flex-col items-center gap-2 p-4 bg-slate-800/50 border border-slate-700 rounded-xl hover:border-cyan-500/50 transition-colors"
                >
                  <Icon size={28} className="text-cyan-400" />
                  <span className="text-slate-300 text-sm">{chain.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 bg-black/90 backdrop-blur-sm border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Clodds" className="w-8 h-8" />
            <span
              className="text-xl font-bold"
              style={{
                background: 'linear-gradient(180deg, #ffffff 0%, #22d3ee 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Clodds
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a href="/docs" className="text-slate-300 hover:text-white transition-colors">Docs</a>
            <a
              href="https://github.com/alsk1992/CloddsBot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-300 hover:text-white transition-colors"
            >
              GitHub
            </a>
            <a
              href="https://x.com/cloddsbot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-300 hover:text-white transition-colors"
            >
              X
            </a>
            <a
              href="/docs#quickstart"
              className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-medium rounded-lg transition-colors"
            >
              Get Started
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 pb-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Left - Text */}
            <div>
              <h1
                className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4 leading-tight"
                style={{
                  background: 'linear-gradient(180deg, #ffffff 0%, #22d3ee 50%, #0891b2 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  filter: 'drop-shadow(0 0 20px rgba(34, 211, 238, 0.5))',
                }}
              >
                The Intelligence Layer<br />for Odds Markets
              </h1>
              <p className="text-xl text-slate-300 mb-8" style={{ textShadow: '0 0 10px rgba(34, 211, 238, 0.3)' }}>
                Chat anywhere. Trade everywhere. Powered by Claude.
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href="/docs#quickstart"
                  className="px-8 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold rounded-lg transition-colors text-lg text-center"
                >
                  Quick Start
                </a>
                <a
                  href="https://github.com/alsk1992/CloddsBot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-8 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-colors text-lg flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                  </svg>
                  View on GitHub
                </a>
              </div>
            </div>

            {/* Right - Logo */}
            <div className="flex justify-center md:justify-end">
              <img
                src="/logo.png"
                alt="Clodds - Predict the Future"
                className="w-80 md:w-96 lg:w-[450px] h-auto drop-shadow-2xl"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-8 border-y border-slate-700/50 overflow-hidden">
        <div
          className="flex gap-16 animate-scroll-stats"
          style={{ width: 'max-content' }}
        >
          {[...stats, ...stats].map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div key={`stat-${idx}`} className="text-center flex-shrink-0">
                <div className="text-3xl md:text-4xl font-bold text-cyan-400 flex justify-center">
                  {stat.value ? stat.value : <Icon size={36} strokeWidth={1.5} />}
                </div>
                <div className="text-slate-400 text-sm mt-1">{stat.label}</div>
              </div>
            );
          })}
        </div>
        <style>{`
          @keyframes scroll-stats {
            0% { transform: translateX(0); }
            100% { transform: translateX(-25%); }
          }
          .animate-scroll-stats {
            animation: scroll-stats 20s linear infinite;
          }
        `}</style>
      </section>

      {/* Demo */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2
            className="text-3xl md:text-4xl font-bold mb-4"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #22d3ee 50%, #0891b2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 15px rgba(34, 211, 238, 0.4))',
            }}
          >
            See it in action
          </h2>
          <p className="text-slate-400 mb-8">
            Chat naturally, get market data, find arbitrage, execute trades.
          </p>
          <div className="rounded-xl overflow-hidden border border-slate-700 shadow-2xl">
            <img
              src="/demo.gif"
              alt="Clodds Demo"
              className="w-full"
            />
          </div>
        </div>
      </section>

      {/* Deployment Options */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2
            className="text-3xl md:text-4xl font-bold text-center mb-2"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #22d3ee 50%, #0891b2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 15px rgba(34, 211, 238, 0.4))',
            }}
          >
            Two ways to deploy
          </h2>
          <p className="text-slate-400 text-center mb-10">
            Full self-hosted or lightweight edge deployment. Choose what fits your needs.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Self-hosted */}
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
              <div className="px-6 py-4 bg-slate-800 border-b border-slate-700">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Self-Hosted</h3>
                    <p className="text-slate-400 text-sm">Full features, your server</p>
                  </div>
                  <span className="px-3 py-1 bg-cyan-500/20 text-cyan-400 text-xs rounded-full">Recommended</span>
                </div>
              </div>
              <pre className="p-4 overflow-x-auto">
                <code className="text-xs text-slate-300 font-mono whitespace-pre">{codeExample}</code>
              </pre>
              <div className="px-6 py-3 bg-slate-800/50 border-t border-slate-700 text-xs text-slate-400">
                22 channels • 9 markets • Trading • DeFi • Bots
              </div>
            </div>

            {/* Cloudflare Worker */}
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
              <div className="px-6 py-4 bg-slate-800 border-b border-slate-700">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Cloudflare Worker</h3>
                    <p className="text-slate-400 text-sm">Edge deployment, no server</p>
                  </div>
                  <span className="px-3 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-full">Lightweight</span>
                </div>
              </div>
              <pre className="p-4 overflow-x-auto">
                <code className="text-xs text-slate-300 font-mono whitespace-pre">{workerCodeExample}</code>
              </pre>
              <div className="px-6 py-3 bg-slate-800/50 border-t border-slate-700 text-xs text-slate-400">
                3 webhook channels • Market search • Arbitrage • Alerts
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features - Conveyor Belt */}
      <section className="mt-8 pb-0 bg-slate-800/30 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 text-center mb-4">
          <h2
            className="text-3xl md:text-4xl font-bold mb-2"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #22d3ee 50%, #0891b2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 15px rgba(34, 211, 238, 0.4))',
            }}
          >
            Everything you need
          </h2>
          <p className="text-slate-400">
            A complete platform for prediction market trading, research, and automation.
          </p>
        </div>

        {/* Row 1 - scrolls left */}
        <div className="relative mb-6">
          <div
            className="flex gap-6 animate-scroll-left"
            style={{ width: 'max-content' }}
          >
            {[...features, ...features].map((feature, idx) => (
              <div
                key={`row1-${idx}`}
                className="relative flex-shrink-0"
                style={{ width: '520px' }}
              >
                <img
                  src="/whale-card.png"
                  alt=""
                  className="w-full h-auto"
                />
                <div
                  className="absolute flex flex-col justify-start overflow-hidden"
                  style={{ top: '30%', left: '26%', right: '30%', bottom: '26%' }}
                >
                  <h3 className="text-base font-semibold text-white mb-1 leading-tight">{feature.title}</h3>
                  <p className="text-slate-300 text-sm leading-snug">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Row 2 - scrolls right */}
        <div className="relative">
          <div
            className="flex gap-6 animate-scroll-right"
            style={{ width: 'max-content' }}
          >
            {[...features, ...features].map((feature, idx) => (
              <div
                key={`row2-${idx}`}
                className="relative flex-shrink-0"
                style={{ width: '520px' }}
              >
                <img
                  src="/whale-card.png"
                  alt=""
                  className="w-full h-auto"
                />
                <div
                  className="absolute flex flex-col justify-start overflow-hidden"
                  style={{ top: '30%', left: '26%', right: '30%', bottom: '26%' }}
                >
                  <h3 className="text-base font-semibold text-white mb-1 leading-tight">{feature.title}</h3>
                  <p className="text-slate-300 text-sm leading-snug">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <style>{`
          @keyframes scroll-left {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
          @keyframes scroll-right {
            0% { transform: translateX(-50%); }
            100% { transform: translateX(0); }
          }
          .animate-scroll-left {
            animation: scroll-left 30s linear infinite;
          }
          .animate-scroll-right {
            animation: scroll-right 30s linear infinite;
          }
        `}</style>
      </section>

      {/* Channels */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2
            className="text-3xl md:text-4xl font-bold text-center mb-2"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #22d3ee 50%, #0891b2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 15px rgba(34, 211, 238, 0.4))',
            }}
          >
            Chat from anywhere
          </h2>
          <p className="text-slate-400 text-center mb-10">
            Connect via your favorite messaging platform.
          </p>

        </div>
        <div className="overflow-hidden mt-8">
          <div
            className="flex gap-6 animate-scroll-channels"
            style={{ width: 'max-content' }}
          >
            {[...Array(2)].flatMap((_, setIdx) => [
              { name: 'Telegram', icon: SiTelegram },
              { name: 'Discord', icon: SiDiscord },
              { name: 'WhatsApp', icon: SiWhatsapp },
              { name: 'Slack', icon: SiSlack },
              { name: 'Matrix', icon: SiMatrix },
              { name: 'Signal', icon: SiSignal },
              { name: 'LINE', icon: SiLine },
              { name: 'Twitch', icon: SiTwitch },
              { name: 'IRC', icon: MessageSquare },
              { name: 'WebChat', icon: Monitor },
              { name: 'Email', icon: Mail },
            ].map((channel, idx) => {
              const Icon = channel.icon;
              return (
                <div
                  key={`${setIdx}-${channel.name}`}
                  className="flex flex-col items-center gap-2 p-4 bg-slate-800/50 border border-slate-700 rounded-xl flex-shrink-0"
                >
                  <Icon size={32} className="text-cyan-400" />
                  <span className="text-slate-400 text-xs">{channel.name}</span>
                </div>
              );
            }))}
          </div>
        </div>
        <style>{`
          @keyframes scroll-channels {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
          .animate-scroll-channels {
            animation: scroll-channels 25s linear infinite;
          }
        `}</style>
      </section>

      {/* Markets */}
      <MarketsSection />

      {/* Advanced Trading */}
      <AdvancedFeaturesSection />

      {/* FAQ & Security */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h2
            className="text-3xl md:text-4xl font-bold text-center mb-2"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #22d3ee 50%, #0891b2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 15px rgba(34, 211, 238, 0.4))',
            }}
          >
            FAQ & Security
          </h2>
          <p className="text-slate-400 text-center mb-10">
            Your keys, your data, your control.
          </p>

          <div className="space-y-4">
            {[
              {
                q: 'Is my API key secure?',
                a: 'Yes. Clodds runs entirely on your machine. Your API keys never leave your server - they\'re stored locally and only used to authenticate with the services you configure.',
              },
              {
                q: 'Do you store my trading data?',
                a: 'No. All trade logs are stored in a local SQLite database on your machine. We have no access to your data, positions, or trading history.',
              },
              {
                q: 'Is Clodds open source?',
                a: 'Yes, 100% open source under MIT license. You can audit every line of code, fork it, modify it, or self-host it however you want.',
              },
              {
                q: 'What markets can I trade?',
                a: 'Execute on Polymarket, Kalshi, Betfair, Smarkets, Drift, and Lighter. Read-only support for Manifold and Metaculus. More coming soon.',
              },
              {
                q: 'Which messaging platforms work?',
                a: 'Telegram, Discord, WhatsApp, Slack, Matrix, Signal, LINE, Twitch, IRC, Email, WebChat, and more. 22 channels total.',
              },
              {
                q: 'Can I run trading bots?',
                a: 'Yes. Built-in strategies include mean reversion, momentum, and arbitrage. Or build custom strategies with the strategy builder.',
              },
            ].map((faq, idx) => (
              <div
                key={idx}
                className="p-5 bg-slate-800/50 rounded-xl border border-slate-700"
              >
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <Shield size={18} className="text-cyan-400" />
                  {faq.q}
                </h3>
                <p className="text-slate-400 text-sm">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 bg-slate-800/30">
        <div className="max-w-2xl mx-auto text-center">
          <h2
            className="text-3xl md:text-4xl font-bold mb-2"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #22d3ee 50%, #0891b2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 15px rgba(34, 211, 238, 0.4))',
            }}
          >
            Ready to start trading?
          </h2>
          <p className="text-slate-400 mb-8">
            Clodds is free, open source, and self-hosted. Your keys, your data.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="/docs"
              className="px-8 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold rounded-lg transition-colors"
            >
              Read the Docs
            </a>
            <a
              href="https://github.com/alsk1992/CloddsBot"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-colors"
            >
              Star on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-slate-700">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Clodds" className="w-6 h-6" />
            <span className="text-white font-semibold">Clodds</span>
            <span className="text-slate-500 text-sm">Claude + Odds</span>
          </div>
          <div className="flex items-center gap-6 text-slate-400 text-sm">
            <a href="/docs" className="hover:text-white transition-colors">Docs</a>
            <a href="https://github.com/alsk1992/CloddsBot" className="hover:text-white transition-colors">GitHub</a>
            <a href="https://x.com/cloddsbot" className="hover:text-white transition-colors">X</a>
            <span>MIT License</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
