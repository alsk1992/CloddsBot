/**
 * Whale Tracking CLI Skill
 *
 * Commands:
 * /whales - View active whale alerts
 * /whales polymarket - Polymarket whale activity
 * /whales crypto [chain] - On-chain whale movements
 * /whales watch <address> - Watch specific address
 * /whales config - Tracking configuration
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'summary';

  try {
    const polyMod = await import('../../../feeds/polymarket/whale-tracker');
    const cryptoMod = await import('../../../feeds/crypto/whale-tracker');

    const polyTracker = polyMod.createWhaleTracker();
    const cryptoTracker = cryptoMod.createCryptoWhaleTracker();

    switch (cmd) {
      case 'summary':
      case '': {
        // Show combined whale activity across Polymarket and on-chain
        const polyTrades = polyTracker.getRecentTrades(10);
        const cryptoTxs = cryptoTracker.getRecentTransactions(undefined, 10);
        const cryptoStats = cryptoTracker.getStats();
        const polyState = polyTracker.getConnectionState();

        let output = '**Whale Activity Summary**\n\n';
        output += `Polymarket WS: ${polyState}\n`;
        output += `Crypto chains: ${cryptoStats.chains.join(', ') || 'none'}\n`;
        output += `Watched wallets: ${cryptoStats.watchedWallets}\n`;
        output += `Transactions tracked: ${cryptoStats.transactionsTracked}\n`;
        output += `Alerts generated: ${cryptoStats.alertsGenerated}\n\n`;

        if (polyTrades.length > 0) {
          output += `**Recent Polymarket Whale Trades** (${polyTrades.length})\n\n`;
          for (const t of polyTrades) {
            const time = t.timestamp.toLocaleTimeString();
            output += `  [${time}] ${t.side} ${t.outcome} $${t.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} @ ${t.price.toFixed(2)}`;
            if (t.marketQuestion) output += ` - ${t.marketQuestion.slice(0, 60)}`;
            output += '\n';
          }
        } else {
          output += 'No recent Polymarket whale trades.\n';
        }

        if (cryptoTxs.length > 0) {
          output += `\n**Recent On-Chain Whale Txs** (${cryptoTxs.length})\n\n`;
          for (const tx of cryptoTxs) {
            const time = tx.timestamp.toLocaleTimeString();
            const value = tx.amountUsd > 0 ? `$${tx.amountUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `${tx.amount.toLocaleString()} ${tx.tokenSymbol}`;
            output += `  [${time}] ${tx.chain} ${tx.type} ${value} ${tx.tokenSymbol}`;
            output += `\n    ${tx.from.slice(0, 10)}... -> ${tx.to.slice(0, 10)}...\n`;
          }
        } else {
          output += '\nNo recent on-chain whale transactions.\n';
        }

        return output;
      }

      case 'polymarket':
      case 'poly': {
        const subCmd = parts[1]?.toLowerCase();

        if (subCmd === 'market' && parts[2]) {
          // Get whale activity for a specific market
          const marketId = parts[2];
          const activity = await polyMod.getMarketWhaleActivity(marketId);
          let output = `**Market Whale Activity**\n\n`;
          output += `Total whale volume: $${activity.totalWhaleVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n`;
          output += `Buy volume: $${activity.buyVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n`;
          output += `Sell volume: $${activity.sellVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n\n`;
          if (activity.topBuyers.length > 0) {
            output += `Top buyers:\n`;
            for (const addr of activity.topBuyers.slice(0, 5)) {
              output += `  \`${addr}\`\n`;
            }
          }
          if (activity.topSellers.length > 0) {
            output += `\nTop sellers:\n`;
            for (const addr of activity.topSellers.slice(0, 5)) {
              output += `  \`${addr}\`\n`;
            }
          }
          return output;
        }

        // Default: recent Polymarket whale trades
        const limit = parseInt(parts[1] || '20');
        const trades = polyTracker.getRecentTrades(limit);
        const state = polyTracker.getConnectionState();

        let output = `**Polymarket Whale Trades** (WS: ${state})\n\n`;
        if (trades.length === 0) {
          output += 'No whale trades recorded yet. Tracker may need to be started.\n';
          output += 'Use `/whales polymarket market <id>` to check a specific market.\n';
          return output;
        }

        for (const t of trades) {
          const time = t.timestamp.toLocaleTimeString();
          const maker = t.maker !== 'unknown' ? t.maker.slice(0, 8) + '...' : '?';
          const taker = t.taker !== 'unknown' ? t.taker.slice(0, 8) + '...' : '?';
          output += `  [${time}] ${t.side} ${t.outcome} $${t.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} @ ${t.price.toFixed(2)}\n`;
          output += `    Maker: ${maker} | Taker: ${taker}`;
          if (t.marketQuestion) output += `\n    Market: ${t.marketQuestion.slice(0, 70)}`;
          output += '\n';
        }
        return output;
      }

      case 'crypto':
      case 'onchain': {
        const chain = parts[1]?.toLowerCase();
        const validChains = ['solana', 'ethereum', 'polygon', 'arbitrum', 'base', 'optimism'];
        const filterChain = chain && validChains.includes(chain) ? chain as any : undefined;
        const limit = parseInt(parts[2] || '20');

        const txs = cryptoTracker.getRecentTransactions(filterChain, limit);
        const stats = cryptoTracker.getStats();

        let output = `**On-Chain Whale Activity**`;
        if (filterChain) output += ` (${filterChain})`;
        output += `\n\nChains: ${stats.chains.join(', ')}\n`;
        output += `Running: ${stats.running ? 'Yes' : 'No'}\n`;
        output += `Tracked txs: ${stats.transactionsTracked}\n`;
        output += `Alerts: ${stats.alertsGenerated}\n\n`;

        if (txs.length === 0) {
          output += 'No whale transactions recorded yet.\n';
          output += 'Supported chains: ' + validChains.join(', ') + '\n';
          return output;
        }

        for (const tx of txs) {
          const time = tx.timestamp.toLocaleTimeString();
          const value = tx.amountUsd > 0 ? `$${tx.amountUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `${tx.amount.toLocaleString()} ${tx.tokenSymbol}`;
          output += `  [${time}] ${tx.chain} ${tx.type} ${value}\n`;
          output += `    ${tx.from.slice(0, 10)}... -> ${tx.to.slice(0, 10)}...\n`;
          if (tx.swapDetails) {
            output += `    Swap: ${tx.swapDetails.amountIn} ${tx.swapDetails.tokenInSymbol} -> ${tx.swapDetails.amountOut} ${tx.swapDetails.tokenOutSymbol}`;
            if (tx.swapDetails.dex) output += ` (${tx.swapDetails.dex})`;
            output += '\n';
          }
        }
        return output;
      }

      case 'watch': {
        if (!parts[1]) return 'Usage: /whales watch <address> [--chain <chain>]\n\nTracks an address across Polymarket and on-chain.';
        const address = parts[1];
        const chainIdx = parts.indexOf('--chain');
        const chain = chainIdx >= 0 ? parts[chainIdx + 1] : undefined;
        const validChains = ['solana', 'ethereum', 'polygon', 'arbitrum', 'base', 'optimism'];

        // Track on Polymarket
        polyTracker.trackAddress(address);

        // Track on-chain
        if (chain && validChains.includes(chain)) {
          cryptoTracker.watchWallet(address, chain as any);
        } else {
          // Watch on all configured chains
          cryptoTracker.watchWallet(address);
        }

        let output = `**Now Watching** \`${address}\`\n\n`;
        output += `Polymarket: tracking\n`;
        output += `On-chain: ${chain || 'all configured chains'}\n`;

        // Check if it's a known whale on Polymarket
        const isWhale = await polyMod.isWhaleAddress(address);
        if (isWhale) {
          output += `\nThis address is a known Polymarket whale (>$100k volume).\n`;
        }

        // Try to get existing profile
        const profile = polyTracker.getWhaleProfile(address);
        if (profile) {
          output += `\nExisting profile found:\n`;
          output += `  Total value: $${profile.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n`;
          output += `  Win rate: ${profile.winRate.toFixed(1)}%\n`;
          output += `  Positions: ${profile.positions.length}\n`;
          output += `  Recent trades: ${profile.recentTrades.length}\n`;
        }

        return output;
      }

      case 'unwatch': {
        if (!parts[1]) return 'Usage: /whales unwatch <address>';
        const address = parts[1];
        polyTracker.untrackAddress(address);
        cryptoTracker.unwatchWallet(address);
        return `Stopped watching \`${address}\` on all platforms.`;
      }

      case 'top': {
        const subCmd = parts[1]?.toLowerCase();

        if (subCmd === 'crypto' || subCmd === 'onchain') {
          const chain = (parts[2] || 'solana') as any;
          const limit = parseInt(parts[3] || '10');
          const topWhales = await cryptoTracker.getTopWhales(chain, limit);

          if (topWhales.length === 0) {
            return `No tracked whales on ${chain} yet. Watch wallets with \`/whales watch <address> --chain ${chain}\`.`;
          }

          let output = `**Top Crypto Whales** (${chain})\n\n`;
          for (let i = 0; i < topWhales.length; i++) {
            const w = topWhales[i];
            output += `  ${i + 1}. \`${w.address.slice(0, 12)}...\`\n`;
            output += `     Value: $${w.totalValueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
            if (w.labels.length > 0) output += ` [${w.labels.join(', ')}]`;
            output += '\n';
            if (w.holdings.length > 0) {
              const top3 = w.holdings.slice(0, 3);
              output += `     Top: ${top3.map(h => `${h.symbol} $${h.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(', ')}\n`;
            }
          }
          return output;
        }

        // Default: Polymarket top whales
        const limit = parseInt(parts[1] || '10');
        const topWhales = polyTracker.getTopWhales(limit);

        if (topWhales.length === 0) {
          return 'No whale profiles tracked yet. Tracker may need to be started.';
        }

        let output = `**Top Polymarket Whales** (by portfolio value)\n\n`;
        for (let i = 0; i < topWhales.length; i++) {
          const w = topWhales[i];
          output += `  ${i + 1}. \`${w.address.slice(0, 12)}...\`\n`;
          output += `     Value: $${w.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
          output += ` | WR: ${w.winRate.toFixed(1)}%`;
          output += ` | Positions: ${w.positions.length}`;
          output += ` | Trades: ${w.recentTrades.length}\n`;
        }
        return output;
      }

      case 'profitable': {
        const minWR = parseFloat(parts[1] || '55') / 100;
        const minTrades = parseInt(parts[2] || '5');
        const whales = polyTracker.getProfitableWhales(minWR, minTrades);

        if (whales.length === 0) {
          return `No profitable whales found with WR >= ${(minWR * 100).toFixed(0)}% and >= ${minTrades} trades.\nTry lower thresholds: \`/whales profitable 50 3\``;
        }

        let output = `**Profitable Whales** (WR >= ${(minWR * 100).toFixed(0)}%, trades >= ${minTrades})\n\n`;
        for (let i = 0; i < whales.length; i++) {
          const w = whales[i];
          output += `  ${i + 1}. \`${w.address.slice(0, 12)}...\`\n`;
          output += `     WR: ${w.winRate.toFixed(1)}% | Avg return: $${w.avgReturn.toFixed(2)} | Value: $${w.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n`;
        }
        return output;
      }

      case 'profile': {
        if (!parts[1]) return 'Usage: /whales profile <address>';
        const address = parts[1];
        const profile = polyTracker.getWhaleProfile(address);

        if (!profile) {
          // Try on-chain lookup
          const wallet = await cryptoTracker.getWallet(address, 'ethereum');
          const solWallet = await cryptoTracker.getWallet(address, 'solana');
          const found = wallet || solWallet;

          if (!found) {
            return `No profile found for \`${address}\`.\nUse \`/whales watch ${address}\` to start tracking.`;
          }

          let output = `**Wallet Profile** (${found.chain})\n\n`;
          output += `Address: \`${found.address}\`\n`;
          output += `Chain: ${found.chain}\n`;
          output += `Value: $${found.totalValueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n`;
          if (found.labels.length > 0) output += `Labels: ${found.labels.join(', ')}\n`;
          output += `Last active: ${found.lastActive.toLocaleString()}\n`;
          if (found.holdings.length > 0) {
            output += `\nTop Holdings:\n`;
            for (const h of found.holdings.slice(0, 10)) {
              output += `  ${h.symbol}: ${h.amount.toLocaleString()} ($${h.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}) - ${h.pctOfPortfolio.toFixed(1)}%\n`;
            }
          }
          return output;
        }

        let output = `**Whale Profile** (Polymarket)\n\n`;
        output += `Address: \`${profile.address}\`\n`;
        output += `Total value: $${profile.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n`;
        output += `Win rate: ${profile.winRate.toFixed(1)}%\n`;
        output += `Avg return: $${profile.avgReturn.toFixed(2)}\n`;
        output += `First seen: ${profile.firstSeen.toLocaleString()}\n`;
        output += `Last active: ${profile.lastActive.toLocaleString()}\n`;

        if (profile.positions.length > 0) {
          output += `\n**Active Positions** (${profile.positions.length})\n`;
          for (const p of profile.positions.slice(0, 10)) {
            output += `  ${p.outcome} $${p.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} @ ${p.avgEntryPrice.toFixed(2)}`;
            if (p.marketQuestion) output += ` - ${p.marketQuestion.slice(0, 50)}`;
            if (p.unrealizedPnl) output += ` (PnL: $${p.unrealizedPnl.toFixed(2)})`;
            output += '\n';
          }
        }

        if (profile.recentTrades.length > 0) {
          output += `\n**Recent Trades** (${profile.recentTrades.length})\n`;
          for (const t of profile.recentTrades.slice(0, 10)) {
            const time = t.timestamp.toLocaleTimeString();
            output += `  [${time}] ${t.side} ${t.outcome} $${t.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} @ ${t.price.toFixed(2)}\n`;
          }
        }

        // Signal strength
        const strength = polyTracker.calculateSignalStrength(profile);
        output += `\nSignal strength: ${(strength * 100).toFixed(0)}%\n`;

        return output;
      }

      case 'positions': {
        const marketId = parts[1];
        const positions = polyTracker.getActivePositions(marketId);

        if (positions.length === 0) {
          return marketId
            ? `No whale positions found for market \`${marketId}\`.`
            : 'No active whale positions tracked.';
        }

        let output = `**Active Whale Positions**`;
        if (marketId) output += ` (market: ${marketId.slice(0, 20)}...)`;
        output += ` (${positions.length})\n\n`;

        for (const p of positions.slice(0, 20)) {
          output += `  \`${p.address.slice(0, 10)}...\` ${p.outcome} $${p.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} @ ${p.avgEntryPrice.toFixed(2)}`;
          if (p.marketQuestion) output += `\n    ${p.marketQuestion.slice(0, 60)}`;
          if (p.unrealizedPnl) output += ` | PnL: $${p.unrealizedPnl.toFixed(2)}`;
          output += '\n';
        }
        return output;
      }

      case 'watched':
      case 'list': {
        const watched = cryptoTracker.getWatchedWallets();
        const polyWhales = polyTracker.getKnownWhales();

        let output = '**Tracked Wallets**\n\n';

        if (polyWhales.length > 0) {
          output += `Polymarket (${polyWhales.length}):\n`;
          for (const w of polyWhales.slice(0, 15)) {
            output += `  \`${w.address.slice(0, 12)}...\` - $${w.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} | WR: ${w.winRate.toFixed(1)}%\n`;
          }
          if (polyWhales.length > 15) output += `  ...and ${polyWhales.length - 15} more\n`;
        } else {
          output += 'Polymarket: none tracked\n';
        }

        if (watched.size > 0) {
          output += `\nOn-Chain (${watched.size}):\n`;
          let count = 0;
          for (const [key, w] of watched) {
            if (count >= 15) {
              output += `  ...and ${watched.size - 15} more\n`;
              break;
            }
            output += `  \`${w.address.slice(0, 12)}...\` [${w.chain}] - $${w.totalValueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n`;
            count++;
          }
        } else {
          output += '\nOn-Chain: none tracked\n';
        }

        return output;
      }

      case 'config': {
        const stats = cryptoTracker.getStats();
        const polyState = polyTracker.getConnectionState();

        return `**Whale Tracking Config**

Polymarket:
  WebSocket: ${polyState}
  Min trade size: $10,000
  Min position size: $50,000

On-Chain:
  Running: ${stats.running ? 'Yes' : 'No'}
  Chains: ${stats.chains.join(', ') || 'none configured'}
  Min tx value: $50,000
  Min whale value: $1,000,000
  Watched wallets: ${stats.watchedWallets}
  Poll interval: 30s

Use \`/whales watch <address>\` to add wallets.
Use \`/whales polymarket market <id>\` to check specific markets.`;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Whale Tracking Commands**

  /whales                            - Active whale alerts (all platforms)
  /whales polymarket [n]             - Polymarket whale trades
  /whales polymarket market <id>     - Whale activity for a market
  /whales crypto [chain] [n]         - On-chain whale txs
  /whales watch <addr> [--chain c]   - Track an address
  /whales unwatch <addr>             - Stop tracking
  /whales list                       - List tracked wallets
  /whales top [n]                    - Top Polymarket whales
  /whales top crypto [chain] [n]     - Top on-chain whales
  /whales profitable [wr%] [min-n]   - Profitable whales
  /whales profile <addr>             - Whale profile + positions
  /whales positions [market-id]      - Active whale positions
  /whales config                     - Tracking config`;
}

export default {
  name: 'whale-tracking',
  description: 'Whale tracking across Polymarket and on-chain (Solana, EVM)',
  commands: ['/whales', '/whale-tracking'],
  handle: execute,
};
