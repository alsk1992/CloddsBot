# EVM Wallet Integration

Self-custody wallet management and multi-chain trading.

## Overview

The EVM module provides complete wallet and trading capabilities:

```
┌─────────────────────────────────────────────────────────────┐
│                     EVM Wallet Suite                        │
├─────────────────┬─────────────────┬─────────────────────────┤
│   Wallet        │    Trading      │      Multi-Chain        │
├─────────────────┼─────────────────┼─────────────────────────┤
│ • Generation    │ • Odos swaps    │ • 7 chains supported    │
│ • Mnemonic      │ • Token sends   │ • Balance checking      │
│ • Keystore      │ • ETH transfers │ • Common tokens         │
│ • Encryption    │ • Contract calls│ • Gas estimation        │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## Quick Start

### 1. Generate Wallet

```bash
# Via CLI
/wallet create

# Or programmatically
import { generateWallet } from './evm/wallet';
const wallet = generateWallet();
console.log(wallet.address, wallet.privateKey);
```

### 2. Configure

```bash
# Set wallet key for trading
export EVM_PRIVATE_KEY="0x..."

# Optional: Custom RPC endpoints
export ETH_RPC_URL="https://your-eth-rpc.com"
export BASE_RPC_URL="https://your-base-rpc.com"
```

### 3. Check Balances

```bash
/wallet balance 0x1234...
```

### 4. Swap & Send

```bash
/swap base ETH USDC 0.1      # Swap via Odos
/send base 0x123... 0.1      # Send ETH
```

## Commands

### Wallet Management

| Command | Description |
|---------|-------------|
| `/wallet create [name]` | Generate new wallet |
| `/wallet list` | List saved wallets |
| `/wallet balance <address>` | Check balances across all chains |
| `/chains` | List supported chains |

### Trading

| Command | Description |
|---------|-------------|
| `/swap <chain> <from> <to> <amount>` | Get swap quote via Odos |
| `/send <chain> <to> <amount> [token]` | Send ETH or tokens |

## Supported Chains

| Chain | ID | Native | Explorer |
|-------|-----|--------|----------|
| Ethereum | 1 | ETH | etherscan.io |
| Base | 8453 | ETH | basescan.org |
| Polygon | 137 | MATIC | polygonscan.com |
| Arbitrum | 42161 | ETH | arbiscan.io |
| BNB Chain | 56 | BNB | bscscan.com |
| Optimism | 10 | ETH | optimistic.etherscan.io |
| Avalanche | 43114 | AVAX | snowtrace.io |

## Programmatic Usage

### Wallet Generation

```typescript
import {
  generateWallet,
  walletFromMnemonic,
  walletFromPrivateKey,
  encryptKeystore,
  decryptKeystore,
  saveWallet,
  loadWallet,
  listWallets,
} from './evm/wallet';

// Generate random wallet
const wallet = generateWallet();
// { address, privateKey, mnemonic, publicKey }

// From mnemonic (with derivation index)
const wallet2 = walletFromMnemonic('word word word...', 0);

// From private key
const info = walletFromPrivateKey('0x...');

// Encrypt and save
const path = saveWallet(wallet.privateKey, 'mypassword', 'main-wallet');

// Load later
const loaded = loadWallet('main-wallet', 'mypassword');

// List saved
const wallets = listWallets();
// [{ name: 'main-wallet', address: '0x...' }]
```

### Multi-Chain Balances

```typescript
import {
  getMultiChainBalances,
  getNativeBalance,
  getTokenBalance,
  getChainBalances,
  CHAINS,
  CHAIN_TOKENS,
} from './evm/multichain';

// All chains at once
const balances = await getMultiChainBalances('0x...');
for (const chain of balances.balances) {
  console.log(chain.chainName, chain.native.balance, chain.native.symbol);
  for (const token of chain.tokens) {
    console.log('  ', token.symbol, token.balance);
  }
}

// Single chain
const ethBal = await getNativeBalance('ethereum', '0x...');

// Specific token
const usdc = await getTokenBalance(
  'base',
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  '0x...'
);

// Common tokens are pre-configured
console.log(CHAIN_TOKENS.base.USDC); // USDC address on Base
```

### Odos Swaps

```typescript
import {
  getOdosQuote,
  executeOdosSwap,
  swapNativeToToken,
  swapTokenToNative,
  swapTokens,
  getSupportedChains,
} from './evm/odos';

// Get quote
const quote = await getOdosQuote({
  chain: 'base',
  inputToken: 'ETH',  // or address
  outputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
  amount: '0.1',
  slippageBps: 50,  // 0.5%
});
console.log('Output:', quote.outputAmount);
console.log('Price impact:', quote.priceImpact);
console.log('Route:', quote.route);

// Execute swap
const result = await executeOdosSwap({
  chain: 'base',
  inputToken: 'ETH',
  outputToken: '0x833589...',
  amount: '0.1',
  privateKey: process.env.EVM_PRIVATE_KEY!,
  slippageBps: 50,
});

if (result.success) {
  console.log('TX:', result.txHash);
  console.log('Received:', result.outputAmount);
}

// Convenience functions
await swapNativeToToken('polygon', '0x2791...', '100', privateKey);
await swapTokenToNative('arbitrum', '0xaf88...', '1000', privateKey);
await swapTokens('base', '0x...', '0x...', '50', privateKey);
```

### Token Transfers

```typescript
import {
  sendNative,
  sendToken,
  sendNativeBatch,
  sendTokenBatch,
  estimateNativeTransferGas,
  estimateTokenTransferGas,
} from './evm/transfers';

// Send ETH
const result = await sendNative({
  chain: 'base',
  to: '0x...',
  amount: '0.1',
  privateKey: '0x...',
});

// Send ERC20
const tokenResult = await sendToken({
  chain: 'polygon',
  to: '0x...',
  amount: '100',
  privateKey: '0x...',
  tokenAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
});

// Batch transfers
const recipients = [
  { to: '0x111...', amount: '0.01' },
  { to: '0x222...', amount: '0.02' },
];
const results = await sendNativeBatch('ethereum', recipients, privateKey);

// Gas estimation
const gas = await estimateNativeTransferGas('ethereum', '0x...', '0.1');
console.log('Estimated cost:', gas.estimatedCost, 'ETH');
```

### Contract Calls

```typescript
import {
  callContract,
  writeContract,
  getEventLogs,
  isContract,
  getContractInfo,
  COMMON_ABIS,
  encodeFunctionData,
  decodeFunctionData,
} from './evm/contracts';

// Read-only call
const result = await callContract({
  chain: 'base',
  contractAddress: '0x...',
  abi: COMMON_ABIS.erc20,
  method: 'balanceOf',
  args: ['0x...'],
});
console.log('Balance:', result.result);

// Write call
const writeResult = await writeContract({
  chain: 'polygon',
  contractAddress: '0x...',
  abi: COMMON_ABIS.erc20,
  method: 'approve',
  args: ['0xspender', '1000000000000'],
  privateKey: '0x...',
});
console.log('TX:', writeResult.txHash);

// Query events
const logs = await getEventLogs({
  chain: 'ethereum',
  contractAddress: '0x...',
  abi: COMMON_ABIS.erc20,
  eventName: 'Transfer',
  fromBlock: 19000000,
  toBlock: 'latest',
});

// Check if contract
const isCtx = await isContract('base', '0x...');

// Use pre-built ABIs
// COMMON_ABIS.erc20, erc721, erc1155, multicall, uniswapV2Pair, uniswapV2Router
```

## Keystore Encryption

Wallets are encrypted using:
- **KDF**: scrypt (N=262144, r=8, p=1)
- **Cipher**: AES-256-CTR
- **MAC**: Keccak256

Storage location: `~/.clodds/wallets/`

```typescript
// Encrypt
const keystore = encryptKeystore(privateKey, 'mypassword');

// Decrypt
const privateKey = decryptKeystore(keystore, 'mypassword');
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `EVM_PRIVATE_KEY` | Wallet private key for trading |
| `ETH_RPC_URL` | Ethereum RPC (default: llamarpc) |
| `BASE_RPC_URL` | Base RPC (default: mainnet.base.org) |
| `POLYGON_RPC_URL` | Polygon RPC |
| `ARBITRUM_RPC_URL` | Arbitrum RPC |
| `BSC_RPC_URL` | BNB Chain RPC |
| `OPTIMISM_RPC_URL` | Optimism RPC |
| `AVALANCHE_RPC_URL` | Avalanche RPC |

### Config File

In `~/.clodds/clodds.json`:

```json
{
  "evm": {
    "defaultChain": "base",
    "slippageBps": 50
  }
}
```

## Security Notes

1. **Self-Custody**: Private keys never leave your machine
2. **Encrypted Storage**: Keystores use scrypt + AES-256
3. **No Cloud**: Nothing sent to external services (except RPC calls)
4. **Validate First**: Always check quotes before executing swaps

## Resources

- [Odos Docs](https://docs.odos.xyz/)
- [ethers.js v6](https://docs.ethers.org/v6/)
- [EIP-2335 Keystore](https://eips.ethereum.org/EIPS/eip-2335)
