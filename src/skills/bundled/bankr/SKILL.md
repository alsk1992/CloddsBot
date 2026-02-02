---
name: bankr
description: "AI-powered crypto trading via natural language through Bankr API"
command: bankr
emoji: "🏦"
gates:
  envs:
    - BANKR_API_KEY
---

# Bankr

Execute crypto trading and DeFi operations using natural language through Bankr's AI agent API.

## Setup

Get your API key from [bankr.bot/api](https://bankr.bot/api) and set:

```bash
export BANKR_API_KEY=bk_your_key_here
```

## Commands

```
/bankr <prompt>              Execute any trading command
/bankr status <jobId>        Check job status
/bankr cancel <jobId>        Cancel pending job
```

## Examples

### Trading
```
/bankr Buy $50 of ETH on Base
/bankr Swap 0.1 ETH for USDC
/bankr Sell 50% of my PEPE
/bankr Bridge 100 USDC from Polygon to Base
```

### Portfolio
```
/bankr Show my portfolio
/bankr What's my ETH balance?
/bankr Holdings on Base
```

### Market Research
```
/bankr What's the price of Bitcoin?
/bankr Analyze ETH price
/bankr Trending tokens on Base
```

### Transfers
```
/bankr Send 0.1 ETH to vitalik.eth
/bankr Transfer $20 USDC to @friend
```

### NFTs
```
/bankr Show Bored Ape floor price
/bankr Buy cheapest Pudgy Penguin
/bankr Show my NFTs
```

### Polymarket
```
/bankr What are the odds Trump wins?
/bankr Bet $10 on Yes for [market]
/bankr Show my Polymarket positions
```

### Leverage (Avantis)
```
/bankr Open 5x long on ETH with $100
/bankr Short BTC 10x with stop loss at $45k
```

### Automation
```
/bankr DCA $100 into ETH weekly
/bankr Set limit order to buy ETH at $3,000
/bankr Stop loss for all holdings at -20%
```

### Token Deployment
```
/bankr Deploy a token called BankrFan with symbol BFAN on Base
/bankr Launch a token called MOON on Solana
```

### Raw Transactions
```
/bankr Submit this transaction: {"to": "0x...", "data": "0x...", "value": "0", "chainId": 8453}
```

## Supported Chains

| Chain | Native Token | Best For |
|-------|--------------|----------|
| Base | ETH | Memecoins, low fees |
| Polygon | MATIC | Gaming, NFTs |
| Ethereum | ETH | Blue chips |
| Solana | SOL | High-speed trading |
| Unichain | ETH | Newer L2 |

## Tips

- Specify chain for lesser-known tokens: "Buy PEPE on Base"
- Use Base/Polygon for small amounts (lower gas)
- Check balance before trades
- Start small, scale up after testing
