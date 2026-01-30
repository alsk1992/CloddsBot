# Clodds Technical Glossary

Comprehensive glossary of terms used throughout the Clodds platform for prediction markets, crypto trading, DeFi, and futures.

---

## Trading & Orders

| Term | Definition |
|------|------------|
| **Limit Order** | Order to buy/sell at a specific price or better. Used for price-sensitive entries. |
| **Market Order** | Order that executes immediately at best available price. Priority: speed over price. |
| **Maker Order** | Order that adds liquidity to orderbook. On Polymarket: 0% fees on most markets; eligible for rebates on 15-min crypto markets. |
| **Taker Order** | Order that removes liquidity by crossing the spread. On Polymarket: 0% on most markets, dynamic fees (up to ~3% at 50/50 odds) on 15-min crypto markets. On Kalshi: formula-based fees capped at ~2%. |
| **Post-Only** | Order parameter that ensures order only adds liquidity; rejected if would take. On Polymarket: use `postOnly: true` with GTC/GTD orders. |
| **GTC** | Good-Till-Cancelled. Order remains open until filled or manually cancelled. Supported on Polymarket. |
| **FOK** | Fill-Or-Kill. Must execute in full immediately or be cancelled entirely. Supported on Polymarket for market orders. |
| **FAK** | Fill-And-Kill. Fills what's available immediately, cancels remainder. *Not supported on Polymarket.* |
| **IOC** | Immediate-Or-Cancel. Same as FAK - fills available, cancels rest. *Not supported on Polymarket.* |
| **GTD** | Good-Till-Date. Order expires at specified timestamp. |
| **Fill** | Execution of an order. "Fill price" = price at which order executed. |
| **Orderbook** | List of all open buy (bid) and sell (ask) orders at each price level. |
| **Bid** | Highest price a buyer is willing to pay. |
| **Ask** | Lowest price a seller is willing to accept. Also called "offer". |
| **Spread** | Difference between best bid and best ask. |
| **Mid Price** | Average of best bid and ask: (bid + ask) / 2. |
| **Tick Size** | Minimum price increment allowed (e.g., 0.01, 0.001). |
| **Nonce** | Unique identifier distinguishing between multiple orders. |

---

## Slippage & Execution

| Term | Definition |
|------|------------|
| **Slippage** | Difference between expected and actual fill price due to orderbook depth or market movement. |
| **Price Impact** | Price change caused by executing a large order that consumes multiple price levels. |
| **Orderbook Depth** | Amount of liquidity available at different price levels around best bid/ask. |
| **Liquidity** | Availability and volume of orders at competitive prices. Thin liquidity = high slippage. |
| **TWAP** | Time-Weighted Average Price. Splits large orders across time to minimize impact. |
| **Order Splitting** | Breaking large order into smaller pieces to reduce slippage. |
| **Execution Quality** | How well actual fills match expected prices (slippage, fill rate, speed). |
| **Fill Rate** | Percentage of orders that execute completely without cancellation. |
| **Protected Execution** | Checking slippage before executing; cancels if exceeds threshold. |
| **Smart Order Routing** | Auto-routing orders to best platform for price, liquidity, or fees. |

---

## Arbitrage

| Term | Definition |
|------|------------|
| **Arbitrage** | Exploiting price differences for same asset across platforms for guaranteed profit. |
| **Cross-Platform Arbitrage** | Buying at low price on one platform, selling at higher price on another. *Note: Requires accounts and capital on both platforms; settlement delays and currency differences make execution challenging.* |
| **Internal Arbitrage** | Exploiting YES + NO = $1 constraint. Buy both when total < $1. *Note: Polymarket has zero fees on most markets making this viable; 15-min crypto markets have dynamic fees that may reduce profitability.* |
| **Combinatorial Arbitrage** | Exploiting logical violations between related markets (e.g., P(Trump) ≤ P(Republican)). |
| **Edge** | Mathematical advantage on a trade. Edge = Estimated Probability - Market Price. |
| **Fair Value** | Theoretically correct price based on probability models or arbitrage-free pricing. |
| **Spread (Arb)** | Percentage difference between two market prices: (High - Low) / Low. |
| **Semantic Matching** | Using AI embeddings to find equivalent markets with different question phrasings. |
| **Liquidity Scoring** | Weighing opportunities by orderbook depth to identify truly executable spreads. |

---

## Risk Management

| Term | Definition |
|------|------------|
| **Kelly Criterion** | Optimal position sizing formula: f* = (p × b - q) / b. Maximizes long-term growth. |
| **Fractional Kelly** | Using 1/2 or 1/4 of Kelly size for safer, less volatile growth. |
| **Bankroll** | Total capital available for trading. Base for Kelly calculations. |
| **Position Size** | Dollar or share amount of a single trade. |
| **Drawdown** | Peak-to-trough decline in portfolio value. Max drawdown = worst decline from high. |
| **Circuit Breaker** | Auto trading halt when risk limits exceeded (max loss, consecutive losses, error rate). |
| **Daily Loss Limit** | Maximum allowed loss per day before trading halts. |
| **Max Position** | Cap on exposure to single position ($ or %). |
| **Stop-Loss** | Exit price set below entry to limit losses. |
| **Take-Profit** | Exit price set above entry to lock in gains. |
| **Trailing Stop** | Stop-loss that moves up with price to lock in gains while protecting downside. |
| **Sharpe Ratio** | Risk-adjusted return: (Return - Risk-Free Rate) / Volatility. Higher = better. |
| **Sortino Ratio** | Like Sharpe but only penalizes downside volatility. |
| **Profit Factor** | Gross profit / gross loss. >1.5 is good. |
| **Win Rate** | Percentage of profitable trades. |
| **Expectancy** | Average profit per trade: (Win Rate × Avg Win) - (Loss Rate × Avg Loss). |
| **Volatility** | Standard deviation of returns. Higher = higher risk. |
| **VaR** | Value at Risk. Maximum expected loss at confidence level (e.g., 95% VaR). |

---

## Prediction Markets

| Term | Definition |
|------|------------|
| **YES/NO Shares** | Tokenized outcomes. YES pays $1 if event occurs, $0 if not. |
| **Outcome Token** | Token representing a specific market outcome. |
| **Market** | Prediction market asking binary or multi-outcome question. |
| **Resolution** | Official determination of market outcome (YES or NO). |
| **Conditional Token** | Token that pays based on an outcome. |
| **CLOB** | Central Limit Order Book. Traditional orderbook trading (vs AMM). |
| **Implied Probability** | Probability inferred from price. Price 0.55 = 55% probability. |
| **Negative Risk Market** | Variant allowing short bets without doubling capital. |
| **Heartbeat** | Keepalive signal preventing order cancellation. Polymarket: every 10s. |
| **Scoring** | Polymarket feature where orderbook orders earn rewards. |

---

## Perpetual Futures

| Term | Definition |
|------|------------|
| **Perpetual (Perp)** | Futures contract that doesn't expire, unlike traditional futures. |
| **Long Position** | Betting on price increase. Profits if price goes up. |
| **Short Position** | Betting on price decrease. Profits if price goes down. |
| **Leverage** | Ratio of position size to capital. 10x = $100 controls $1000 position. |
| **Margin** | Capital required to maintain leveraged position. |
| **Cross Margin** | All positions share same margin pool. Higher cascading liquidation risk. |
| **Isolated Margin** | Each position has own margin. Can be liquidated independently. |
| **Funding Rate** | Payment between longs/shorts keeping perp price close to spot. |
| **Liquidation** | Forced position closure when margin falls below maintenance level. |
| **Liquidation Price** | Price at which position will be force-closed. |
| **Mark Price** | Price used to calculate P&L and liquidation. |
| **Index Price** | Reference price, usually median of spot prices. |
| **Premium/Discount** | Difference between perp price and spot price. |
| **Unrealized P&L** | Profit/loss on open position at current price. |
| **Realized P&L** | Profit/loss once position is closed. |
| **USDT-M** | Perpetual futures denominated in USDT stablecoin. |
| **Reduce-Only** | Order flag that only closes position, prevents opening new ones. |
| **Position Mode** | One-way (single direction) or Hedge (both long and short). |

---

## DeFi & Crypto

| Term | Definition |
|------|------------|
| **AMM** | Automated Market Maker. DEX using liquidity pools instead of orderbooks. |
| **Liquidity Pool** | Smart contract with paired tokens used by AMMs for trading. |
| **LP** | Liquidity Provider. Deposits tokens to pools, earns trading fees. |
| **Swap** | Trading one token for another on a DEX. |
| **Yield Farming** | Earning yield from trading fees and token incentives. |
| **Gas** | Transaction cost on blockchain. |
| **Whales** | Large wallets that can move markets. |

---

## MEV (Maximal Extractable Value)

| Term | Definition |
|------|------------|
| **MEV** | Profit bots extract by reordering, inserting, or suppressing transactions. |
| **Sandwich Attack** | Frontrun + backrun user's transaction to extract profit. |
| **Front-Running** | Placing transaction ahead of pending tx to profit from it. |
| **Backrunning** | Placing transaction after pending tx to profit from it. |
| **Private Mempool** | MEV protection hiding pending transactions from public. |
| **Flashbots** | Ethereum MEV protection protocol using private relay. |
| **MEV Blocker** | CoW Protocol MEV protection returning captured value to users. |
| **Jito** | Solana MEV protection using bundle submission and validator tips. |
| **Bundle** | Grouped transactions submitted atomically to avoid sandwiching. |

---

## Blockchain & Tokens

| Term | Definition |
|------|------------|
| **ERC-20** | Standard Ethereum fungible token (e.g., USDC). |
| **ERC-1155** | Ethereum multi-token standard for conditional outcome tokens (YES/NO shares). |
| **Contract Address** | Blockchain address of a smart contract. |
| **EOA** | Externally Owned Account. Standard wallet (MetaMask, hardware). |
| **Proxy Wallet** | Smart contract wallet (Gnosis Safe). Requires signature type 2. |
| **Wormhole** | Cross-chain bridge connecting Ethereum, Solana, Polygon, etc. |

---

## Strategy & Backtesting

| Term | Definition |
|------|------------|
| **Strategy** | Rule-based trading plan with entry, exit, and risk conditions. |
| **Signal** | Condition triggering trade action (BUY/SELL/CLOSE). |
| **Entry Condition** | Rules determining when to enter a trade. |
| **Exit Condition** | Rules determining when to close a trade. |
| **Backtest** | Simulating strategy on historical data to measure performance. |
| **Walk-Forward** | Out-of-sample validation: train on one period, test on next. |
| **Overfitting** | Strategy works on historical data but fails live due to curve-fitting. |
| **Monte Carlo** | Running 1000s of randomized simulations to stress-test strategy. |
| **Momentum Strategy** | Trading following price trends. |
| **Mean Reversion** | Trading towards the average when price deviates. |
| **Breakout Strategy** | Trading when price breaks above/below range. |
| **Pairs Trading** | Trading correlated markets together. |
| **CAGR** | Compound Annual Growth Rate. Annualized return. |

---

## Copy Trading & Whale Tracking

| Term | Definition |
|------|------------|
| **Copy Trading** | Automatically mirroring trades from successful wallets. |
| **Whale Tracking** | Monitoring and alerting on large trades from key wallets. |
| **Sizing Mode** | How copied trades scale: fixed ($), proportional (%), or portfolio-based. |
| **Trade Delay** | Intentional delay before copying to avoid detection. |
| **Followed Wallet** | Wallet whose trades you're copying. |
| **Verified Trader** | Trader with on-chain ERC-8004 identity (see Agent Identity below). |

---

## Agent Identity (ERC-8004)

Mainnet launched **January 29, 2026**. Live on Ethereum, Base, Optimism, Arbitrum, Polygon. 19,000+ agents registered.

| Term | Definition |
|------|------------|
| **ERC-8004** | Ethereum standard for trustless agent identity. Uses NFTs for identity, on-chain reputation, and validation. |
| **Identity Registry** | Contract storing agent identities as ERC-721 NFTs. Address: `0x7177...Dd09A` (same on all chains). |
| **Reputation Registry** | Contract storing feedback/ratings for agents. Score 0-100. Address: `0xB504...e322`. |
| **Validation Registry** | Contract for task verification using staking or cryptographic proofs. Address: `0x662b...6d8`. |
| **Agent Card** | Off-chain JSON metadata describing agent capabilities, endpoints, and trust mechanisms. |
| **Agent ID** | Unique on-chain identifier (NFT token ID) for a registered agent. |
| **Verified Identity** | Agent with registered ERC-8004 identity - proves ownership and builds reputation. |
| **Prompt Injection** | Attack where malicious input manipulates an AI agent. ERC-8004 helps verify authentic agents. |

---

## Portfolio & Performance

| Term | Definition |
|------|------------|
| **Portfolio** | Collection of all open positions and trades. |
| **Position** | An open trade/market exposure. |
| **Cost Basis** | Average entry price. Used to calculate realized P&L. |
| **Exposure** | Total capital or percentage deployed to trades. |
| **Concentration Risk** | Risk of overexposure to single asset/theme. Measured by HHI. |
| **Correlation** | Statistical relationship between assets for diversification. |
| **Hedging** | Offsetting position risk with opposite positions. |
| **Attribution** | Breaking down P&L by source (edge, platform, time, strategy). |
| **P&L** | Profit & Loss. Net gain or loss on trades. |

---

## Technical & Platform

| Term | Definition |
|------|------------|
| **WebSocket** | Real-time bidirectional protocol for live data feeds. |
| **REST API** | HTTP-based API for data requests and commands. |
| **API Key** | Authentication credential for API access. |
| **Signature** | Digital proof you authorized a transaction. Types: 0=EOA, 1=MagicLink, 2=Proxy. |
| **MCP** | Model Context Protocol. Protocol for Claude to use external tools. |
| **Webhook** | HTTP callback sending data when events occur. |
| **Rate Limiting** | Maximum API requests allowed per time period. |
| **Cursor** | Pagination pointer for retrieving next page of results. |
| **Batch Operations** | Executing multiple actions in one API call. |
| **Basis Points (bps)** | Unit = 0.01%. 100 bps = 1%. |
| **Rebate** | Fee discount or payment for providing liquidity. *Polymarket has a Maker Rebates Program for 15-min crypto markets where taker fees are redistributed to liquidity providers.* |

---

## Protocols & Platforms

| Term | Definition |
|------|------------|
| **Polymarket** | Crypto prediction market on Polygon using USDC. Uses CLOB with GTC, GTD, FOK order types. Zero fees on most markets; dynamic fees on 15-min crypto markets. |
| **Kalshi** | US-regulated prediction market (USD, US residents only). Formula-based fees: 0.07 × contracts × price × (1-price), capped at ~2%. |
| **Betfair** | Sports betting exchange. |
| **Drift** | Solana-based perpetual futures DEX. |
| **Jupiter** | Solana DEX aggregator finding best swap routes. |
| **Raydium** | Solana AMM for LP swaps. |
| **Orca** | Solana AMM with concentrated liquidity (Whirlpools). |
| **Uniswap V3** | EVM DEX with concentrated liquidity ranges. |
| **1inch** | EVM DEX aggregator finding best routes across DEXes. |
| **Binance Futures** | CEX perpetual futures with up to 125x leverage. |
| **Bybit** | CEX perpetual futures with up to 100x leverage. |
| **Hyperliquid** | On-chain DEX perpetuals on Arbitrum, up to 50x. |
| **MEXC** | CEX with up to 200x leverage, minimal KYC. |

---

## Additional Trading Terms

| Term | Definition |
|------|------------|
| **OCO** | One-Cancels-Other. Two linked orders where filling one cancels the other. |
| **DCA** | Dollar Cost Averaging. Buying fixed amounts at regular intervals regardless of price. |
| **Grid Trading** | Placing buy/sell orders at intervals above/below price to profit from ranges. |
| **Iceberg Order** | Large order split into visible and hidden portions to mask true size. |

---

## Additional DeFi Terms

| Term | Definition |
|------|------------|
| **Impermanent Loss** | LP loss when token prices diverge from deposit ratio. "Impermanent" if prices return. |
| **TVL** | Total Value Locked. Assets deposited in a DeFi protocol. |
| **APY** | Annual Percentage Yield. Yield with compounding included. |
| **APR** | Annual Percentage Rate. Yield without compounding. |
| **Bonding Curve** | Mathematical curve determining token price based on supply. Used by Pump.fun. |
| **Airdrop** | Free token distribution to wallet holders, often for early users. |
| **Staking** | Locking tokens to earn rewards or secure a network. |
| **Vesting** | Gradual token unlock schedule over time. |
| **Rug Pull** | When project creators abandon and steal funds. |
| **Slippage Tolerance** | Max acceptable slippage before transaction reverts. |

---

## Payment & Protocol Terms

| Term | Definition |
|------|------------|
| **x402** | HTTP 402 Payment Required protocol for machine-to-machine USDC payments. |
| **Facilitator** | x402 intermediary (Coinbase) enabling fee-free payments. |
| **CCTP** | Circle Cross-Chain Transfer Protocol for native USDC bridging. |
| **VAA** | Verified Action Approval. Wormhole message proving cross-chain transfer. |
| **Guardian** | Wormhole validator node signing cross-chain messages. |

---

## Quick Reference: Key Formulas

| Formula | Calculation |
|---------|-------------|
| **Kelly Criterion** | f* = (p × b - q) / b, where p=win prob, q=loss prob, b=odds |
| **Sharpe Ratio** | (Return - Risk-Free Rate) / Volatility |
| **Profit Factor** | Gross Profit / Gross Loss |
| **Expectancy** | (Win Rate × Avg Win) - (Loss Rate × Avg Loss) |
| **Edge** | Estimated Probability - Market Price |
| **Spread** | (Ask - Bid) / Mid Price |
| **Price Impact** | (Execution Price - Mid Price) / Mid Price |

---

---

## Server Security

| Term | Definition |
|------|------------|
| **SSH Hardening** | Disabling password auth, root login, and limiting auth attempts to prevent unauthorized access. |
| **ufw** | Uncomplicated Firewall. Linux firewall frontend for iptables. Clodds uses it to restrict incoming connections. |
| **fail2ban** | Intrusion prevention software that bans IPs after repeated failed login attempts. |
| **sysctl** | Linux kernel parameter configuration. Used for hardening network stack and preventing attacks. |
| **Unattended Upgrades** | Automatic security patch installation on Debian/Ubuntu systems. |
| **MaxAuthTries** | SSH config limiting login attempts per connection (default hardened: 3). |
| **PasswordAuthentication** | SSH config for password login. Should be disabled in favor of key-based auth. |
| **PermitRootLogin** | SSH config allowing direct root login. Should be disabled on production servers. |
| **SYN Cookies** | Kernel protection against SYN flood DoS attacks. |
| **ICMP Redirects** | Network messages that can be abused for MITM attacks. Disabled in hardened configs. |
| **IP Spoofing** | Forging source IP addresses. Prevented via reverse path filtering (rp_filter). |
| **Brute Force Attack** | Automated password guessing. Mitigated by fail2ban and rate limiting. |
| **Command Injection** | Security vulnerability where attacker injects shell commands. Fixed by using execFileSync with array args. |
| **npm Overrides** | package.json feature to force specific versions of transitive dependencies for security fixes. |

---

*This glossary covers 185+ terms used across the Clodds platform.*
