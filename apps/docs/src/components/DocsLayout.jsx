import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const navigation = [
  {
    title: 'Getting Started',
    items: [
      { name: 'Quick Start', href: '#quickstart' },
      { name: 'Configuration', href: '#config' },
      { name: 'Commands', href: '#commands' },
    ],
  },
  {
    title: 'Opportunity Finder',
    items: [
      { name: 'Overview', href: '#opportunity-overview' },
      { name: 'Opportunity Types', href: '#opportunity-types' },
      { name: 'Scoring System', href: '#scoring' },
      { name: 'Market Matching', href: '#matching' },
      { name: 'Analytics', href: '#analytics' },
    ],
  },
  {
    title: 'Trading System',
    items: [
      { name: 'Trade Execution', href: '#execution' },
      { name: 'Bot Manager', href: '#bots' },
      { name: 'Strategies', href: '#strategies' },
      { name: 'Safety Controls', href: '#safety' },
      { name: 'A/B Testing', href: '#abtesting' },
    ],
  },
  {
    title: 'Advanced',
    items: [
      { name: 'Custom Tracking', href: '#tracking' },
      { name: 'Backtesting', href: '#backtest' },
      { name: 'DevTools', href: '#devtools' },
      { name: 'API Reference', href: '#api' },
    ],
  },
];

export default function DocsLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0
      `}>
        <div className="h-full overflow-y-auto px-4 py-6">
          <div className="mb-8">
            <Link to="/" className="flex items-center gap-2 mb-2 text-gray-600 hover:text-gray-900 text-sm">
              <span>&larr;</span> Back to Home
            </Link>
            <h1 className="text-xl font-bold text-gray-900">Clodds Docs</h1>
            <p className="text-sm text-gray-500">Trading & Opportunity Finding</p>
          </div>

          <nav className="space-y-6">
            {navigation.map((section) => (
              <div key={section.title}>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  {section.title}
                </h2>
                <ul className="space-y-1">
                  {section.items.map((item) => (
                    <li key={item.name}>
                      <a
                        href={item.href}
                        className="block px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                      >
                        {item.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main className="lg:pl-64">
        <div className="max-w-4xl mx-auto px-6 py-12">
          {children}
        </div>
      </main>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
