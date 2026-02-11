/**
 * Trading Futures CLI Skill
 *
 * Full perpetual futures trading on Binance, Bybit, Hyperliquid, MEXC.
 * Supports market/limit/stop orders, position management, and account info.
 */

const SUPPORTED_EXCHANGES = ['binance', 'bybit', 'hyperliquid', 'mexc'] as const;
type Exchange = typeof SUPPORTED_EXCHANGES[number];
type Side = 'BUY' | 'SELL';
type Margin = 'ISOLATED' | 'CROSS';

function helpText(): string {
  return `**Futures Trading Commands**

  **Orders:**
  /futures open <symbol> <side> <size> [--leverage N] [--exchange X]      - Open position
  /futures long <symbol> <size> [--leverage N] [--exchange X]             - Open long
  /futures short <symbol> <size> [--leverage N] [--exchange X]            - Open short
  /futures close <symbol> [--exchange X]                                  - Close position
  /futures closeall [--exchange X]                                        - Close ALL positions
  /futures limit <symbol> <long|short> <size> <price> [--leverage N]     - Limit order
  /futures stop <symbol> <price> [--size N] [--side sell] [--exchange X] - Stop loss/entry
  /futures tp <symbol> <price> [--size N] [--exchange X]               - Take profit
  /futures cancel <symbol> <orderId> [--exchange X]                      - Cancel order
  /futures cancelall <symbol> [--exchange X]                             - Cancel all orders

  **Info:**
  /futures positions [--exchange X]                                       - View positions
  /futures orders [--symbol SYM] [--exchange X]                          - Open/pending orders
  /futures balance [--exchange X]                                        - Account balances
  /futures account [--exchange X]                                        - Detailed account info
  /futures price <symbol> [--exchange X]                                 - Current price
  /futures book <symbol> [--exchange X]                                  - Order book (top 5)
  /futures markets [--exchange X] [--search BTC]                         - Available markets
  /futures funding <symbol> [--exchange X]                               - Funding rates
  /futures pnl [--exchange X]                                            - P&L summary
  /futures history [--symbol SYM] [--exchange X] [--limit 20]           - Income history
  /futures trades [symbol] [--exchange X] [--limit 20]                  - Trade history
  /futures orderhistory [symbol] [--exchange X] [--limit 20]            - Order history

  **Config:**
  /futures leverage <symbol> <multiplier> [--exchange X]                 - Set leverage
  /futures margin <isolated|cross> --symbol <SYM> [--exchange X]        - Set margin type
  /futures exchanges                                                     - Configured exchanges

Exchanges: binance, bybit, hyperliquid, mexc`;
}

function parseFlag(parts: string[], flag: string, defaultVal: string): string {
  const idx = parts.indexOf(flag);
  if (idx === -1 || !parts[idx + 1]) return defaultVal;
  // Don't treat another flag as a value
  const val = parts[idx + 1];
  if (val.startsWith('--')) return defaultVal;
  return val;
}

function validateExchange(exchange: string, configured: string[]): string | null {
  if (exchange === 'all') return null;
  if (!(SUPPORTED_EXCHANGES as readonly string[]).includes(exchange)) {
    return `Unknown exchange '${exchange}'. Supported: ${SUPPORTED_EXCHANGES.join(', ')}`;
  }
  if (!configured.includes(exchange)) {
    return `Exchange '${exchange}' not configured. Configured: ${configured.join(', ')}`;
  }
  return null;
}

function validateLeverage(leverageStr: string): number | null {
  const lev = parseInt(leverageStr, 10);
  if (isNaN(lev) || lev < 1 || lev > 200) return null;
  return lev;
}

/**
 * Normalize symbol for exchange compatibility.
 * Hyperliquid uses bare coin names (BTC, ETH, SOL) while others use BTCUSDT etc.
 * This strips common quote suffixes when targeting Hyperliquid.
 */
function normalizeSymbol(symbol: string, exchange: string): string {
  if (exchange === 'hyperliquid') {
    // Strip common quote suffixes for Hyperliquid
    return symbol
      .replace(/USDT$/, '')
      .replace(/USDC$/, '')
      .replace(/USD$/, '')
      .replace(/PERP$/, '')
      .replace(/-PERP$/, '');
  }
  return symbol;
}

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const futuresMod = await import('../../../trading/futures/index');

    // Try to set up from env vars
    const { service } = await futuresMod.setupFromEnv();
    const configuredExchanges = service.getExchanges();

    if (configuredExchanges.length === 0 && cmd !== 'help' && cmd !== 'exchanges') {
      return 'No exchanges configured. Set API keys in env vars:\n  BINANCE_API_KEY + BINANCE_API_SECRET\n  BYBIT_API_KEY + BYBIT_API_SECRET\n  HYPERLIQUID_WALLET + HYPERLIQUID_PRIVATE_KEY\n  MEXC_API_KEY + MEXC_API_SECRET';
    }

    const defaultExchange = configuredExchanges[0] || 'binance';

    switch (cmd) {
      case 'open': {
        const symbol = parts[1]?.toUpperCase();
        const side = parts[2]?.toUpperCase() as 'LONG' | 'SHORT';
        const size = parseFloat(parts[3]);
        if (!symbol || !side || isNaN(size)) return 'Usage: /futures open <symbol> <long|short> <size> [--leverage N] [--exchange X]';
        if (side !== 'LONG' && side !== 'SHORT') return 'Side must be LONG or SHORT';

        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;
        const leverage = validateLeverage(parseFlag(parts, '--leverage', '10'));
        if (!leverage) return 'Leverage must be a number between 1 and 200.';

        const sym = normalizeSymbol(symbol, exchange);
        const order = side === 'LONG'
          ? await service.openLong(exchange, sym, size, leverage)
          : await service.openShort(exchange, sym, size, leverage);

        return `**Position Opened**

Exchange: ${exchange}
Symbol: ${order.symbol}
Side: ${side}
Size: ${order.size}
Leverage: ${order.leverage}x
Type: ${order.type}
Status: ${order.status}
Fill Price: ${order.avgFillPrice > 0 ? order.avgFillPrice : 'pending'}
Order ID: ${order.id}`;
      }

      case 'long': {
        const symbol = parts[1]?.toUpperCase();
        const size = parseFloat(parts[2]);
        if (!symbol || isNaN(size)) return 'Usage: /futures long <symbol> <size> [--leverage N] [--exchange X]';

        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;
        const leverage = validateLeverage(parseFlag(parts, '--leverage', '10'));
        if (!leverage) return 'Leverage must be a number between 1 and 200.';

        const sym = normalizeSymbol(symbol, exchange);
        const order = await service.openLong(exchange, sym, size, leverage);

        return `**Long Position Opened**

Exchange: ${exchange}
Symbol: ${order.symbol}
Size: ${order.size}
Leverage: ${order.leverage}x
Status: ${order.status}
Fill Price: ${order.avgFillPrice > 0 ? order.avgFillPrice : 'pending'}
Order ID: ${order.id}`;
      }

      case 'short': {
        const symbol = parts[1]?.toUpperCase();
        const size = parseFloat(parts[2]);
        if (!symbol || isNaN(size)) return 'Usage: /futures short <symbol> <size> [--leverage N] [--exchange X]';

        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;
        const leverage = validateLeverage(parseFlag(parts, '--leverage', '10'));
        if (!leverage) return 'Leverage must be a number between 1 and 200.';

        const sym = normalizeSymbol(symbol, exchange);
        const order = await service.openShort(exchange, sym, size, leverage);

        return `**Short Position Opened**

Exchange: ${exchange}
Symbol: ${order.symbol}
Size: ${order.size}
Leverage: ${order.leverage}x
Status: ${order.status}
Fill Price: ${order.avgFillPrice > 0 ? order.avgFillPrice : 'pending'}
Order ID: ${order.id}`;
      }

      case 'close': {
        const symbol = parts[1]?.toUpperCase();
        if (!symbol) return 'Usage: /futures close <symbol> [--exchange X]';

        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;
        const sym = normalizeSymbol(symbol, exchange);
        const result = await service.closePosition(exchange, sym);

        if (!result) return `No open position found for ${symbol} on ${exchange}.`;

        return `**Position Closed**

Exchange: ${exchange}
Symbol: ${result.symbol}
Size: ${result.size}
Fill Price: ${result.avgFillPrice > 0 ? result.avgFillPrice : 'N/A'}
Status: ${result.status}
Order ID: ${result.id}`;
      }

      case 'closeall':
      case 'close-all': {
        const exchangeInput = parseFlag(parts, '--exchange', 'all');
        const exErr = validateExchange(exchangeInput, configuredExchanges);
        if (exErr) return exErr;

        let results: Array<{ symbol: string; exchange?: string }> = [];
        if (exchangeInput === 'all') {
          for (const ex of configuredExchanges) {
            try {
              const closed = await service.closeAllPositions(ex);
              results.push(...closed.map(r => ({ symbol: r.symbol, exchange: ex })));
            } catch {
              results.push({ symbol: `[${ex}: error]` });
            }
          }
        } else {
          const closed = await service.closeAllPositions(exchangeInput as Exchange);
          results = closed.map(r => ({ symbol: r.symbol, exchange: exchangeInput }));
        }

        if (results.length === 0) return 'No open positions to close.';

        const lines = ['**Closed All Positions**', ''];
        for (const r of results) {
          lines.push(`  ${r.symbol} (${r.exchange})`);
        }
        return lines.join('\n');
      }

      case 'positions':
      case 'pos': {
        const exchangeInput = parseFlag(parts, '--exchange', 'all');
        const exErr = validateExchange(exchangeInput, configuredExchanges);
        if (exErr) return exErr;

        let positions: Awaited<ReturnType<typeof service.getPositions>> = [];
        const errors: string[] = [];
        if (exchangeInput === 'all') {
          for (const ex of configuredExchanges) {
            try {
              const p = await service.getPositions(ex);
              positions.push(...p);
            } catch {
              errors.push(ex);
            }
          }
        } else {
          positions = await service.getPositions(exchangeInput as Exchange);
        }

        if (positions.length === 0) {
          return `No open positions${exchangeInput !== 'all' ? ` on ${exchangeInput}` : ''}.`;
        }

        const lines = ['**Open Futures Positions**', ''];
        let totalPnl = 0;

        for (const pos of positions) {
          const pnlSign = pos.unrealizedPnl >= 0 ? '+' : '';
          totalPnl += pos.unrealizedPnl;
          lines.push(`**${pos.symbol}** (${pos.exchange})`);
          lines.push(`  Side: ${pos.side} | Size: ${pos.size} | Leverage: ${pos.leverage}x`);
          lines.push(`  Entry: ${pos.entryPrice} | Mark: ${pos.markPrice} | Liq: ${pos.liquidationPrice}`);
          lines.push(`  PnL: ${pnlSign}$${pos.unrealizedPnl.toFixed(2)} (${pnlSign}${pos.unrealizedPnlPct.toFixed(2)}%)`);
          lines.push('');
        }

        const totalSign = totalPnl >= 0 ? '+' : '';
        lines.push(`**Total Unrealized PnL: ${totalSign}$${totalPnl.toFixed(2)}**`);
        if (errors.length > 0) {
          lines.push('', `_Failed to fetch: ${errors.join(', ')}_`);
        }

        return lines.join('\n');
      }

      case 'funding': {
        const symbol = parts[1]?.toUpperCase();
        if (!symbol) return 'Usage: /futures funding <symbol> [--exchange binance]';

        const exchangeInput = parseFlag(parts, '--exchange', 'all');
        const exErr = validateExchange(exchangeInput, configuredExchanges);
        if (exErr) return exErr;

        if (exchangeInput === 'all') {
          const lines = [`**Funding Rates for ${symbol}**`, ''];
          for (const ex of configuredExchanges) {
            try {
              const funding = await service.getFundingRate(ex, normalizeSymbol(symbol, ex));
              const ratePct = (funding.rate * 100).toFixed(4);
              const nextTime = new Date(funding.nextFundingTime).toLocaleTimeString();
              lines.push(`  ${ex}: ${ratePct}% (next: ${nextTime})`);
            } catch {
              lines.push(`  ${ex}: N/A`);
            }
          }
          return lines.join('\n');
        }

        const funding = await service.getFundingRate(exchangeInput as Exchange, normalizeSymbol(symbol, exchangeInput));
        const ratePct = (funding.rate * 100).toFixed(4);
        const nextTime = new Date(funding.nextFundingTime).toLocaleTimeString();

        return `**Funding Rate: ${symbol} (${exchangeInput})**

Rate: ${ratePct}%
Next Funding: ${nextTime}
Annualized: ${(funding.rate * 100 * 3 * 365).toFixed(2)}%`;
      }

      case 'leverage': {
        const symbol = parts[1]?.toUpperCase();
        const leverage = validateLeverage(parts[2] || '');
        if (!symbol || !leverage) return 'Usage: /futures leverage <symbol> <multiplier> [--exchange X]\nLeverage must be between 1 and 200.';

        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;
        const sym = normalizeSymbol(symbol, exchange);
        await service.setLeverage(exchange, sym, leverage);

        return `Leverage set to ${leverage}x for ${sym} on ${exchange}.`;
      }

      case 'pnl': {
        const exchangeInput = parseFlag(parts, '--exchange', 'all');
        const exErr = validateExchange(exchangeInput, configuredExchanges);
        if (exErr) return exErr;

        const balances: Awaited<ReturnType<typeof service.getBalance>>[] = [];
        const errors: string[] = [];
        if (exchangeInput === 'all') {
          for (const ex of configuredExchanges) {
            try {
              balances.push(await service.getBalance(ex));
            } catch {
              errors.push(ex);
            }
          }
        } else {
          balances.push(await service.getBalance(exchangeInput as Exchange));
        }

        const lines = ['**Futures P&L Summary**', ''];

        let totalBalance = 0;
        let totalUnrealized = 0;

        for (const bal of balances) {
          totalBalance += bal.total;
          totalUnrealized += bal.unrealizedPnl;
          const pnlSign = bal.unrealizedPnl >= 0 ? '+' : '';
          lines.push(`**${bal.exchange}** (${bal.asset})`);
          lines.push(`  Balance: $${bal.total.toFixed(2)} (available: $${bal.available.toFixed(2)})`);
          lines.push(`  Unrealized PnL: ${pnlSign}$${bal.unrealizedPnl.toFixed(2)}`);
          lines.push(`  Margin Balance: $${bal.marginBalance.toFixed(2)}`);
          lines.push('');
        }

        const totalSign = totalUnrealized >= 0 ? '+' : '';
        lines.push(`**Total Balance: $${totalBalance.toFixed(2)}**`);
        lines.push(`**Total Unrealized: ${totalSign}$${totalUnrealized.toFixed(2)}**`);
        if (errors.length > 0) {
          lines.push('', `_Failed to fetch: ${errors.join(', ')}_`);
        }

        return lines.join('\n');
      }

      case 'exchanges': {
        if (configuredExchanges.length === 0) {
          return '**No exchanges configured.**\n\nSet API keys:\n  BINANCE_API_KEY + BINANCE_API_SECRET\n  BYBIT_API_KEY + BYBIT_API_SECRET\n  HYPERLIQUID_WALLET + HYPERLIQUID_PRIVATE_KEY\n  MEXC_API_KEY + MEXC_API_SECRET';
        }

        const lines = ['**Configured Exchanges**', ''];
        for (const ex of configuredExchanges) {
          lines.push(`  - ${ex}`);
        }
        lines.push('', 'Supported: binance, bybit, hyperliquid, mexc');
        return lines.join('\n');
      }

      case 'margin': {
        const marginMode = parts[1]?.toUpperCase();
        if (!marginMode || (marginMode !== 'ISOLATED' && marginMode !== 'CROSS')) {
          return 'Usage: /futures margin <isolated|cross> --symbol <BTCUSDT> [--exchange X]';
        }
        const symbol = parseFlag(parts, '--symbol', '').toUpperCase();
        if (!symbol) return 'Symbol required. Usage: /futures margin <isolated|cross> --symbol <BTCUSDT>';
        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;

        try {
          const sym = normalizeSymbol(symbol, exchange);
          await service.setMarginType(exchange, sym, marginMode as Margin);
          return `Margin mode set to **${marginMode}** for ${sym} on ${exchange}.`;
        } catch (err: unknown) {
          return `Failed to set margin mode on ${exchange}: ${(err as Error)?.message || 'unknown error'}`;
        }
      }

      case 'limit': {
        const symbol = parts[1]?.toUpperCase();
        const side = parts[2]?.toUpperCase() as 'LONG' | 'SHORT';
        const size = parseFloat(parts[3]);
        const price = parseFloat(parts[4]);
        if (!symbol || !side || isNaN(size) || isNaN(price)) {
          return 'Usage: /futures limit <symbol> <long|short> <size> <price> [--leverage N] [--exchange X]';
        }
        if (side !== 'LONG' && side !== 'SHORT') return 'Side must be LONG or SHORT';

        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;
        const leverage = validateLeverage(parseFlag(parts, '--leverage', '10'));
        if (!leverage) return 'Leverage must be a number between 1 and 200.';

        const sym = normalizeSymbol(symbol, exchange);
        const order = await service.placeOrder(exchange, {
          symbol: sym,
          side: side === 'LONG' ? 'BUY' : 'SELL',
          type: 'LIMIT',
          size,
          price,
          leverage,
        });

        return `**Limit Order Placed**

Exchange: ${exchange}
Symbol: ${order.symbol}
Side: ${side}
Size: ${order.size}
Price: ${price}
Leverage: ${order.leverage}x
Status: ${order.status}
Order ID: ${order.id}`;
      }

      case 'stop':
      case 'sl': {
        const symbol = parts[1]?.toUpperCase();
        const triggerPrice = parseFloat(parts[2]);
        if (!symbol || isNaN(triggerPrice)) {
          return 'Usage: /futures stop <symbol> <trigger_price> [--size N] [--side sell|buy] [--exchange X]';
        }

        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;
        const sizeStr = parseFlag(parts, '--size', '');
        const sideOverride = parseFlag(parts, '--side', '').toUpperCase();

        if (sizeStr && isNaN(parseFloat(sizeStr))) {
          return 'Invalid --size value. Must be a number.';
        }

        // Get current position to determine side and size
        const sym = normalizeSymbol(symbol, exchange);
        const positions = await service.getPositions(exchange);
        const position = positions.find(p => p.symbol === sym);

        if (!position && !sizeStr) {
          return `No open position for ${sym} on ${exchange}. Specify --size and --side to place stop without position.`;
        }

        const stopSize = sizeStr ? parseFloat(sizeStr) : (position?.size ?? 0);
        let stopSide: Side;
        if (sideOverride === 'BUY' || sideOverride === 'SELL') {
          stopSide = sideOverride;
        } else if (position) {
          stopSide = position.side === 'LONG' ? 'SELL' : 'BUY';
        } else {
          return 'No position found. Specify --side buy or --side sell.';
        }

        const order = await service.placeOrder(exchange, {
          symbol: sym,
          side: stopSide,
          type: 'STOP_MARKET',
          size: stopSize,
          stopPrice: triggerPrice,
          reduceOnly: !sideOverride, // Only reduce-only if auto-detected from position
        });

        return `**Stop Order Placed**

Exchange: ${exchange}
Symbol: ${order.symbol}
Trigger: ${triggerPrice}
Size: ${stopSize}
Side: ${stopSide}
Status: ${order.status}
Order ID: ${order.id}`;
      }

      case 'history': {
        const exchangeInput = parseFlag(parts, '--exchange', 'all');
        const exErr = validateExchange(exchangeInput, configuredExchanges);
        if (exErr) return exErr;
        const symbol = parseFlag(parts, '--symbol', '').toUpperCase() || undefined;
        const limitStr = parseFlag(parts, '--limit', '20');
        const parsed = parseInt(limitStr, 10);
        const limit = isNaN(parsed) ? 20 : parsed;

        const lines: string[] = [];
        let totalAmount = 0;
        const exchanges = exchangeInput === 'all' ? configuredExchanges : [exchangeInput];

        for (const ex of exchanges) {
          try {
            const sym = symbol ? normalizeSymbol(symbol, ex) : undefined;
            const records = await service.getIncomeHistory(ex as Exchange, { symbol: sym, limit });
            if (records.length === 0) continue;

            lines.push(`**${ex}**`);
            for (const rec of records) {
              totalAmount += rec.income;
              const sign = rec.income >= 0 ? '+' : '';
              const time = new Date(rec.timestamp).toLocaleDateString();
              lines.push(`  ${time} | ${rec.symbol} | ${rec.incomeType} | ${sign}$${rec.income.toFixed(4)} ${rec.asset}`);
            }
            lines.push('');
          } catch {
            lines.push(`**${ex}**: _failed to fetch_`, '');
          }
        }

        if (lines.length === 0) {
          return `No income history found${symbol ? ` for ${symbol}` : ''}.`;
        }

        const totalSign = totalAmount >= 0 ? '+' : '';
        lines.unshift(`**Income History**${symbol ? ` (${symbol})` : ''}`, '');
        lines.push(`**Total: ${totalSign}$${totalAmount.toFixed(4)}**`);

        return lines.join('\n');
      }

      case 'cancel': {
        const symbol = parts[1]?.toUpperCase();
        const orderId = parts[2];
        if (!symbol || !orderId) return 'Usage: /futures cancel <symbol> <orderId> [--exchange X]';

        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;

        const sym = normalizeSymbol(symbol, exchange);
        await service.cancelOrder(exchange, sym, orderId);
        return `Order ${orderId} canceled for ${sym} on ${exchange}.`;
      }

      case 'cancelall': {
        const symbol = parts[1]?.toUpperCase();
        if (!symbol) return 'Usage: /futures cancelall <symbol> [--exchange X]';

        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;

        // Cancel all open orders for the symbol
        const sym = normalizeSymbol(symbol, exchange);
        const openOrders = await service.getOpenOrders(exchange, sym);
        if (openOrders.length === 0) return `No open orders for ${sym} on ${exchange}.`;

        let canceled = 0;
        for (const order of openOrders) {
          try {
            await service.cancelOrder(exchange, sym, order.id);
            canceled++;
          } catch { /* continue */ }
        }
        return `Canceled ${canceled}/${openOrders.length} orders for ${sym} on ${exchange}.`;
      }

      case 'orders': {
        const exchangeInput = parseFlag(parts, '--exchange', 'all');
        const exErr = validateExchange(exchangeInput, configuredExchanges);
        if (exErr) return exErr;
        const symbol = parseFlag(parts, '--symbol', '').toUpperCase() || undefined;

        const allOrders: Awaited<ReturnType<typeof service.getOpenOrders>> = [];
        const errors: string[] = [];
        const exchanges = exchangeInput === 'all' ? configuredExchanges : [exchangeInput];

        for (const ex of exchanges) {
          try {
            const sym = symbol ? normalizeSymbol(symbol, ex) : undefined;
            const orders = await service.getOpenOrders(ex as Exchange, sym);
            allOrders.push(...orders);
          } catch {
            errors.push(ex);
          }
        }

        if (allOrders.length === 0) {
          const msg = `No open orders${symbol ? ` for ${symbol}` : ''}.`;
          return errors.length > 0 ? `${msg}\n_Failed to fetch: ${errors.join(', ')}_` : msg;
        }

        const lines = ['**Open Orders**', ''];
        for (const o of allOrders) {
          lines.push(`**${o.symbol}** (${o.exchange})`);
          lines.push(`  ${o.type} ${o.side} | Size: ${o.size} | Price: ${o.price || 'market'}${o.stopPrice ? ` | Trigger: ${o.stopPrice}` : ''}`);
          lines.push(`  Status: ${o.status} | Leverage: ${o.leverage}x | ID: ${o.id}`);
          lines.push('');
        }
        if (errors.length > 0) {
          lines.push(`_Failed to fetch: ${errors.join(', ')}_`);
        }

        return lines.join('\n');
      }

      case 'price': {
        const symbol = parts[1]?.toUpperCase();
        if (!symbol) return 'Usage: /futures price <symbol> [--exchange X]';

        const exchangeInput = parseFlag(parts, '--exchange', 'all');
        const exErr = validateExchange(exchangeInput, configuredExchanges);
        if (exErr) return exErr;

        if (exchangeInput === 'all') {
          const lines = [`**Price: ${symbol}**`, ''];
          for (const ex of configuredExchanges) {
            try {
              const sym = normalizeSymbol(symbol, ex);
              const tickers = await service.getTickerPrice(ex, sym);
              const ticker = tickers[0];
              if (ticker) {
                lines.push(`  ${ex}: $${ticker.price}`);
              } else {
                lines.push(`  ${ex}: N/A`);
              }
            } catch {
              lines.push(`  ${ex}: N/A`);
            }
          }
          return lines.join('\n');
        }

        const sym = normalizeSymbol(symbol, exchangeInput);
        const tickers = await service.getTickerPrice(exchangeInput as Exchange, sym);
        const ticker = tickers[0];
        if (!ticker) return `No price data for ${sym} on ${exchangeInput}.`;

        return `**${symbol}** (${exchangeInput}): $${ticker.price}`;
      }

      case 'markets': {
        const exchangeInput = parseFlag(parts, '--exchange', defaultExchange);
        const exErr = validateExchange(exchangeInput, configuredExchanges);
        if (exErr) return exErr;
        const search = parseFlag(parts, '--search', '').toUpperCase();

        let markets = await service.getMarkets(exchangeInput as Exchange);

        if (search) {
          markets = markets.filter(m =>
            m.symbol.includes(search) || m.baseAsset.includes(search)
          );
        }

        if (markets.length === 0) {
          return `No markets found${search ? ` matching "${search}"` : ''} on ${exchangeInput}.`;
        }

        // Show first 30 to avoid flooding
        const shown = markets.slice(0, 30);
        const lines = [`**Markets on ${exchangeInput}** (${markets.length} total${search ? `, filtered by "${search}"` : ''})`, ''];

        for (const m of shown) {
          lines.push(`  ${m.symbol} | ${m.baseAsset}/${m.quoteAsset} | Max ${m.maxLeverage}x`);
        }

        if (markets.length > 30) {
          lines.push('', `_...and ${markets.length - 30} more. Use --search to filter._`);
        }

        return lines.join('\n');
      }

      case 'balance':
      case 'bal': {
        const exchangeInput = parseFlag(parts, '--exchange', 'all');
        const exErr = validateExchange(exchangeInput, configuredExchanges);
        if (exErr) return exErr;

        const balances: Awaited<ReturnType<typeof service.getBalance>>[] = [];
        const errors: string[] = [];
        const exchanges = exchangeInput === 'all' ? configuredExchanges : [exchangeInput];

        for (const ex of exchanges) {
          try {
            balances.push(await service.getBalance(ex as Exchange));
          } catch {
            errors.push(ex);
          }
        }

        if (balances.length === 0) {
          return errors.length > 0 ? `Failed to fetch balances: ${errors.join(', ')}` : 'No balances found.';
        }

        const lines = ['**Futures Balances**', ''];
        for (const bal of balances) {
          lines.push(`**${bal.exchange}** (${bal.asset})`);
          lines.push(`  Total: $${bal.total.toFixed(2)}`);
          lines.push(`  Available: $${bal.available.toFixed(2)}`);
          lines.push(`  Margin: $${bal.marginBalance.toFixed(2)}`);
          lines.push(`  Unrealized PnL: $${bal.unrealizedPnl.toFixed(2)}`);
          lines.push('');
        }
        if (errors.length > 0) {
          lines.push(`_Failed to fetch: ${errors.join(', ')}_`);
        }
        return lines.join('\n');
      }

      case 'account': {
        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;

        const info = await service.getAccountInfo(exchange);
        const lines = [`**Account Info (${exchange})**`, ''];
        lines.push(`  Total Balance: $${info.totalWalletBalance.toFixed(2)}`);
        lines.push(`  Available: $${info.availableBalance.toFixed(2)}`);
        lines.push(`  Margin Used: $${info.totalPositionInitialMargin.toFixed(2)}`);
        lines.push(`  Unrealized PnL: $${info.totalUnrealizedProfit.toFixed(2)}`);

        if (info.positions && info.positions.length > 0) {
          lines.push('', '  **Positions:**');
          for (const p of info.positions) {
            lines.push(`    ${p.symbol}: ${p.side} ${p.size} @ ${p.entryPrice} (PnL: $${p.unrealizedPnl.toFixed(2)})`);
          }
        }
        return lines.join('\n');
      }

      case 'trades': {
        const symbol = parts[1]?.toUpperCase();
        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;
        const limitStr = parseFlag(parts, '--limit', '20');
        const parsedLimit = parseInt(limitStr, 10);
        const limit = isNaN(parsedLimit) ? 20 : parsedLimit;

        const sym = symbol ? normalizeSymbol(symbol, exchange) : undefined;
        const trades = await service.getTradeHistory(exchange, sym, limit);

        if (trades.length === 0) {
          return `No trade history${sym ? ` for ${sym}` : ''} on ${exchange}.`;
        }

        const lines = [`**Trade History (${exchange})**${sym ? ` - ${sym}` : ''}`, ''];
        for (const t of trades.slice(0, 30)) {
          const time = new Date(t.timestamp).toLocaleString();
          const pnl = t.realizedPnl ? ` | PnL: $${t.realizedPnl.toFixed(4)}` : '';
          lines.push(`  ${time} | ${t.symbol} | ${t.side} ${t.quantity} @ $${t.price}${pnl}`);
        }
        if (trades.length > 30) {
          lines.push(`  _...and ${trades.length - 30} more_`);
        }
        return lines.join('\n');
      }

      case 'orderhistory': {
        const symbol = parts[1]?.toUpperCase();
        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;
        const limitStr = parseFlag(parts, '--limit', '20');
        const parsedLimit = parseInt(limitStr, 10);
        const limit = isNaN(parsedLimit) ? 20 : parsedLimit;

        const sym = symbol ? normalizeSymbol(symbol, exchange) : undefined;
        const orders = await service.getOrderHistory(exchange, sym, limit);

        if (orders.length === 0) {
          return `No order history${sym ? ` for ${sym}` : ''} on ${exchange}.`;
        }

        const lines = [`**Order History (${exchange})**${sym ? ` - ${sym}` : ''}`, ''];
        for (const o of orders.slice(0, 30)) {
          const time = new Date(o.timestamp).toLocaleString();
          const fill = o.avgFillPrice > 0 ? ` filled @ $${o.avgFillPrice}` : '';
          lines.push(`  ${time} | ${o.symbol} | ${o.type} ${o.side} ${o.size}${fill} | ${o.status}`);
        }
        if (orders.length > 30) {
          lines.push(`  _...and ${orders.length - 30} more_`);
        }
        return lines.join('\n');
      }

      case 'book': {
        const symbol = parts[1]?.toUpperCase();
        if (!symbol) return 'Usage: /futures book <symbol> [--exchange X]';

        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;

        const sym = normalizeSymbol(symbol, exchange);
        const book = await service.getOrderBook(exchange, sym);

        const lines = [`**Order Book: ${sym} (${exchange})**`, ''];
        lines.push('  **Asks (Sell)**');
        const topAsks = (book.asks || []).slice(0, 5).reverse();
        for (const [price, size] of topAsks) {
          lines.push(`    $${price} | ${size}`);
        }
        lines.push('  ---');
        const topBids = (book.bids || []).slice(0, 5);
        lines.push('  **Bids (Buy)**');
        for (const [price, size] of topBids) {
          lines.push(`    $${price} | ${size}`);
        }

        const spread = topAsks.length > 0 && topBids.length > 0
          ? (topAsks[topAsks.length - 1][0] - topBids[0][0]).toFixed(4)
          : 'N/A';
        lines.push('', `  Spread: $${spread}`);
        return lines.join('\n');
      }

      case 'tp': {
        const symbol = parts[1]?.toUpperCase();
        const triggerPrice = parseFloat(parts[2]);
        if (!symbol || isNaN(triggerPrice)) {
          return 'Usage: /futures tp <symbol> <trigger_price> [--size N] [--side sell|buy] [--exchange X]';
        }

        const exchange = parseFlag(parts, '--exchange', defaultExchange) as Exchange;
        const exErr = validateExchange(exchange, configuredExchanges);
        if (exErr) return exErr;
        const sizeStr = parseFlag(parts, '--size', '');
        const sideOverride = parseFlag(parts, '--side', '').toUpperCase();

        const sym = normalizeSymbol(symbol, exchange);
        const positions = await service.getPositions(exchange);
        const position = positions.find(p => p.symbol === sym);

        if (!position && !sizeStr) {
          return `No open position for ${sym} on ${exchange}. Specify --size and --side.`;
        }

        const tpSize = sizeStr ? parseFloat(sizeStr) : position!.size;
        let tpSide: Side;
        if (sideOverride === 'BUY' || sideOverride === 'SELL') {
          tpSide = sideOverride;
        } else if (position) {
          tpSide = position.side === 'LONG' ? 'SELL' : 'BUY';
        } else {
          return 'No position found. Specify --side buy or --side sell.';
        }

        const order = await service.placeOrder(exchange, {
          symbol: sym,
          side: tpSide,
          type: 'TAKE_PROFIT_MARKET',
          size: tpSize,
          stopPrice: triggerPrice,
          reduceOnly: true,
        });

        return `**Take Profit Order Placed**

Exchange: ${exchange}
Symbol: ${order.symbol}
Trigger: ${triggerPrice}
Size: ${tpSize}
Side: ${tpSide}
Status: ${order.status}
Order ID: ${order.id}`;
      }

      default:
        return helpText();
    }
  } catch (err: unknown) {
    if (cmd === 'help' || cmd === '') return helpText();
    return `Error: ${(err as Error)?.message || 'Failed to load futures module'}\n\n${helpText()}`;
  }
}

export default {
  name: 'trading-futures',
  description: 'Perpetual futures trading on Binance, Bybit, Hyperliquid, MEXC',
  commands: ['/futures', '/trading-futures'],
  handle: execute,
};
