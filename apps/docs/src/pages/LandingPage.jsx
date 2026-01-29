import React from 'react';

const features = [
  {
    icon: '🔗',
    title: '22 Messaging Channels',
    description: 'Telegram, Discord, WhatsApp, Slack, Teams, Matrix, Signal, iMessage, Nostr, and more.',
  },
  {
    icon: '📊',
    title: '9 Prediction Markets',
    description: 'Polymarket, Kalshi, Betfair, Smarkets, Drift, Manifold, Metaculus, PredictIt.',
  },
  {
    icon: '🎯',
    title: 'Arbitrage Detection',
    description: 'Cross-platform, internal, and combinatorial arbitrage based on arXiv:2508.03474.',
  },
  {
    icon: '🤖',
    title: '21 AI Tools',
    description: 'Trading, research, browser automation, code execution, and more.',
  },
  {
    icon: '⚡',
    title: 'Solana DeFi',
    description: 'Jupiter, Raydium, Orca, Meteora, Pump.fun integration for token swaps.',
  },
  {
    icon: '🛡️',
    title: 'Safety Controls',
    description: 'Circuit breakers, drawdown limits, position limits, and kill switches.',
  },
];

const stats = [
  { value: '22', label: 'Channels' },
  { value: '9', label: 'Markets' },
  { value: '21', label: 'Tools' },
  { value: '$40M+', label: 'Arb Found*' },
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

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 bg-slate-900/80 backdrop-blur-sm border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎲</span>
            <span className="text-xl font-bold text-white">Clodds</span>
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
              href="/docs#quickstart"
              className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-medium rounded-lg transition-colors"
            >
              Get Started
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-cyan-400 text-sm mb-8">
            <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>
            Open Source & Self-Hosted
          </div>

          <h1 className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
            AI Trading Assistant for
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400"> Prediction Markets</span>
          </h1>

          <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto">
            Chat via any platform. Find arbitrage across 9 markets. Execute trades.
            Powered by Claude. Free and open source.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="/docs#quickstart"
              className="px-8 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold rounded-lg transition-colors text-lg"
            >
              Quick Start
            </a>
            <a
              href="https://github.com/alsk1992/CloddsBot"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-colors text-lg flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 border-y border-slate-700/50">
        <div className="max-w-4xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl md:text-4xl font-bold text-cyan-400">{stat.value}</div>
                <div className="text-slate-400 text-sm mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
          <p className="text-center text-slate-500 text-xs mt-4">
            *Based on arXiv:2508.03474 research on Polymarket arbitrage
          </p>
        </div>
      </section>

      {/* Code Example */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">
            Up and running in 2 minutes
          </h2>
          <p className="text-slate-400 text-center mb-10">
            Clone, configure, run. No complex setup required.
          </p>

          <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-slate-800 border-b border-slate-700">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="ml-2 text-slate-400 text-sm">Terminal</span>
            </div>
            <pre className="p-6 overflow-x-auto">
              <code className="text-sm text-slate-300 font-mono whitespace-pre">{codeExample}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 bg-slate-800/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">
            Everything you need
          </h2>
          <p className="text-slate-400 text-center mb-12 max-w-2xl mx-auto">
            A complete platform for prediction market trading, research, and automation.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="p-6 bg-slate-800/50 rounded-xl border border-slate-700 hover:border-cyan-500/50 transition-colors"
              >
                <div className="text-3xl mb-4">{feature.icon}</div>
                <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-slate-400 text-sm">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Channels */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">
            Chat from anywhere
          </h2>
          <p className="text-slate-400 text-center mb-10">
            Connect via your favorite messaging platform.
          </p>

          <div className="flex flex-wrap justify-center gap-3">
            {['Telegram', 'Discord', 'WhatsApp', 'Slack', 'Teams', 'Matrix', 'Signal', 'iMessage', 'LINE', 'Nostr', 'Twitch', 'IRC', 'WebChat', 'Email', 'SMS'].map((channel) => (
              <span
                key={channel}
                className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-full text-slate-300 text-sm hover:border-cyan-500/50 transition-colors"
              >
                {channel}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Markets */}
      <section className="py-20 px-6 bg-slate-800/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">
            Trade on any market
          </h2>
          <p className="text-slate-400 text-center mb-10">
            Unified interface for all major prediction market platforms.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: 'Polymarket', status: 'Execute' },
              { name: 'Kalshi', status: 'Execute' },
              { name: 'Betfair', status: 'Execute' },
              { name: 'Smarkets', status: 'Execute' },
              { name: 'Drift', status: 'Execute' },
              { name: 'Manifold', status: 'Read' },
              { name: 'Metaculus', status: 'Read' },
              { name: 'PredictIt', status: 'Read' },
            ].map((market) => (
              <div
                key={market.name}
                className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 text-center"
              >
                <div className="text-white font-medium">{market.name}</div>
                <div className={`text-xs mt-1 ${market.status === 'Execute' ? 'text-green-400' : 'text-slate-500'}`}>
                  {market.status}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
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
            <span className="text-xl">🎲</span>
            <span className="text-white font-semibold">Clodds</span>
            <span className="text-slate-500 text-sm">Claude + Odds</span>
          </div>
          <div className="flex items-center gap-6 text-slate-400 text-sm">
            <a href="/docs" className="hover:text-white transition-colors">Docs</a>
            <a href="https://github.com/alsk1992/CloddsBot" className="hover:text-white transition-colors">GitHub</a>
            <span>MIT License</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
