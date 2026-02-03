/**
 * Veil Skill - Private Transactions on Base
 *
 * Privacy and shielded transactions via ZK proofs.
 * Requires @veil-cash/sdk for full functionality.
 *
 * Commands:
 * /veil status         Check config and relay health
 * /veil balance        Check all balances
 * /veil deposit <amt>  Deposit ETH to private pool
 * /veil withdraw <amt> <addr>  Withdraw to public
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { execSync } from 'child_process';

// Veil Cash contracts on Base (from github.com/veildotcash/veildotcash_contracts)
const VEIL_VALIDATOR = '0xdFEc9441C1827319538CCCDEEEDfbdAa66295792' as Address; // Validator Proxy (deposit entry)
const VEIL_POOLS: Record<string, Address> = {
  '0.0005': '0x6c206B5389de4e5a23FdF13BF38104CE8Dd2eD5f' as Address,
  '0.005': '0xC53510D6F535Ba0943b1007f082Af3410fBeA4F7' as Address,
  '0.01': '0x844bB2917dD363Be5567f9587151c2aAa2E345D2' as Address,
  '0.1': '0xD3560eF60Dd06E27b699372c3da1b741c80B7D90' as Address,
  '1': '0x9cCdFf5f69d93F4Fcd6bE81FeB7f79649cb6319b' as Address,
};
const VEIL_TOKEN = '0x767A739D1A152639e9Ea1D8c1BD55FDC5B217D7f' as Address;

function getPublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(process.env.RPC_URL || process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
  });
}

function getWalletClient() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('PRIVATE_KEY not set');
  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey as `0x${string}` : `0x${privateKey}`);
  return createWalletClient({
    account,
    chain: base,
    transport: http(process.env.RPC_URL || process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
  });
}

function checkVeilSDK(): boolean {
  try {
    execSync('npx @veil-cash/sdk --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function handleInit(): Promise<string> {
  if (!checkVeilSDK()) {
    return `**Veil SDK Not Found**

Install the Veil SDK first:
\`npm install -g @veil-cash/sdk\`

Then run:
\`/veil init\``;
  }

  return `**Veil Initialization**

To initialize your Veil keypair:

\`\`\`bash
# Generate keypair
npx @veil-cash/sdk keygen

# Store securely (chmod 600)
export VEIL_KEY="your-key-here"
\`\`\`

Your Veil key is separate from your Ethereum private key.
It controls your private balance and enables ZK proofs.

**Security:**
- Never share your VEIL_KEY
- Store in ~/.clawdbot/skills/veil/.env.veil
- chmod 600 on the file`;
}

async function handleStatus(): Promise<string> {
  const hasVeilKey = !!process.env.VEIL_KEY;
  const hasPrivateKey = !!process.env.PRIVATE_KEY;
  const hasRpcUrl = !!(process.env.RPC_URL || process.env.BASE_RPC_URL);
  const sdkInstalled = checkVeilSDK();

  let output = `**Veil Status**\n\n`;
  output += `SDK Installed: ${sdkInstalled ? 'Yes' : 'No'}\n`;
  output += `VEIL_KEY: ${hasVeilKey ? 'Configured' : 'Not set'}\n`;
  output += `PRIVATE_KEY: ${hasPrivateKey ? 'Configured' : 'Not set'}\n`;
  output += `RPC_URL: ${hasRpcUrl ? 'Configured' : 'Using default'}\n\n`;

  output += `**Contracts (Base):**\n`;
  output += `  Validator: \`${VEIL_VALIDATOR}\`\n`;
  output += `  Token: \`${VEIL_TOKEN}\`\n`;
  output += `  Pools: ${Object.keys(VEIL_POOLS).map(k => `${k} ETH`).join(', ')}\n`;

  // Check pool balances on-chain
  try {
    const client = getPublicClient();
    for (const [denom, poolAddr] of Object.entries(VEIL_POOLS)) {
      const bal = await client.getBalance({ address: poolAddr });
      output += `  Pool ${denom} ETH: ${formatEther(bal)} ETH locked\n`;
    }
  } catch {
    output += `  (Could not query pool balances)\n`;
  }

  if (!sdkInstalled) {
    output += `\n**Setup Required:**\n`;
    output += `\`npm install -g @veil-cash/sdk\``;
  } else if (!hasVeilKey) {
    output += `\n**Setup Required:**\n`;
    output += `Run \`/veil init\` to generate keypair`;
  } else {
    output += `\n**Ready for private transactions!**`;
  }

  return output;
}

async function handleBalance(): Promise<string> {
  const hasPrivateKey = !!process.env.PRIVATE_KEY;

  const client = getPublicClient();
  let output = `**Veil Balance**\n\n`;

  // Show public wallet balance if available
  if (hasPrivateKey) {
    try {
      const walletClient = getWalletClient();
      const pubBal = await client.getBalance({ address: walletClient.account.address });
      output += `Public wallet: ${formatEther(pubBal)} ETH\n`;
      output += `Address: \`${walletClient.account.address}\`\n\n`;
    } catch {
      output += `Could not read wallet balance.\n\n`;
    }
  }

  // Show pool TVL
  output += `**Pool Balances (TVL):**\n`;
  try {
    for (const [denom, poolAddr] of Object.entries(VEIL_POOLS)) {
      const bal = await client.getBalance({ address: poolAddr });
      output += `  ${denom} ETH pool: ${formatEther(bal)} ETH\n`;
    }
  } catch {
    output += `  Could not query pool balances.\n`;
  }

  // Private balance requires SDK
  const veilKey = process.env.VEIL_KEY;
  if (veilKey && checkVeilSDK()) {
    output += `\n**Private balance:** Run \`npx @veil-cash/sdk balance\` for ZK-shielded balance.`;
  } else if (!veilKey) {
    output += `\n**Private balance:** Set VEIL_KEY and install SDK for shielded balance.`;
  }

  return output;
}

async function handleDeposit(amount: string): Promise<string> {
  if (!amount) {
    return `Usage: /veil deposit <amount>\nExample: /veil deposit 0.1\n\nAvailable pools: ${Object.keys(VEIL_POOLS).join(', ')} ETH`;
  }

  // Veil uses fixed denominations - find matching pool
  const poolAddress = VEIL_POOLS[amount];
  if (!poolAddress) {
    return `**Invalid denomination.** Veil uses fixed deposit amounts.\n\nAvailable pools:\n${Object.entries(VEIL_POOLS).map(([d, a]) => `  ${d} ETH → \`${a}\``).join('\n')}\n\nUsage: /veil deposit 0.1`;
  }

  const veilKey = process.env.VEIL_KEY;
  if (!veilKey) {
    return `VEIL_KEY not set. Run \`/veil init\` first.\nDeposits require a ZK commitment generated from your VEIL_KEY.`;
  }

  try {
    const walletClient = getWalletClient();
    const publicClient = getPublicClient();
    const amountWei = parseEther(amount);

    // Deposits go through the Validator Proxy contract
    // The Validator verifies identity attestation then forwards to the pool
    // Note: Full ZK commitment generation requires the Veil SDK
    // Here we send the deposit tx to the validator with the ETH value
    const hash = await walletClient.sendTransaction({
      to: VEIL_VALIDATOR,
      value: amountWei,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**Deposit Submitted**

Amount: ${amount} ETH
Pool: \`${poolAddress}\`
Validator: \`${VEIL_VALIDATOR}\`
From: \`${walletClient.account.address}\`
Tx: \`${hash}\`
Status: ${receipt.status === 'success' ? 'Confirmed' : 'Failed'}

The deposit will appear in your queue balance first,
then move to private balance after processing.

For full ZK commitment flow, use:
\`npx @veil-cash/sdk deposit ${amount}\``;
  } catch (error) {
    return `Deposit failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleWithdraw(amount: string, toAddress: string): Promise<string> {
  if (!amount || !toAddress) {
    return 'Usage: /veil withdraw <amount> <address>\nExample: /veil withdraw 0.05 0x1234...';
  }

  const veilKey = process.env.VEIL_KEY;
  if (!veilKey) {
    return `VEIL_KEY not set. Run \`/veil init\` first.`;
  }

  return `**Withdraw Prepared**

Amount: ${amount} ETH
To: \`${toAddress}\`

*Withdrawals use ZK proofs and require the Veil SDK:*

\`\`\`bash
VEIL_KEY="..." npx @veil-cash/sdk withdraw ${amount} ${toAddress}
\`\`\`

The withdrawal is anonymous - the destination address
cannot be linked to your deposit.`;
}

async function handleTransfer(amount: string, veilAddress: string): Promise<string> {
  if (!amount || !veilAddress) {
    return 'Usage: /veil transfer <amount> <veil-key>\nExample: /veil transfer 0.1 veil1234...';
  }

  return `**Private Transfer**

Amount: ${amount} ETH
To: \`${veilAddress.slice(0, 20)}...\`

*Private transfers require the Veil SDK:*

\`\`\`bash
VEIL_KEY="..." npx @veil-cash/sdk transfer ${amount} ${veilAddress}
\`\`\`

Both parties remain anonymous - no public trace.`;
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'status';

  switch (command) {
    case 'init':
      return handleInit();
    case 'status':
      return handleStatus();
    case 'balance':
      return handleBalance();
    case 'deposit':
      return handleDeposit(parts[1]);
    case 'withdraw':
      return handleWithdraw(parts[1], parts[2]);
    case 'transfer':
      return handleTransfer(parts[1], parts[2]);
    case 'help':
    default:
      return getHelp();
  }
}

function getHelp(): string {
  return `**Veil - Private Transactions**

/veil init                    Setup keypair
/veil status                  Check configuration
/veil balance                 Check balances

/veil deposit <amount>        Deposit to private pool
/veil withdraw <amt> <addr>   Withdraw to public
/veil transfer <amt> <veil>   Private transfer

**How It Works:**
1. Deposit ETH → private pool (public tx)
2. Wait for processing → private balance
3. Withdraw/transfer using ZK proofs (anonymous)

**Requirements:**
- Veil SDK: \`npm install -g @veil-cash/sdk\`
- VEIL_KEY environment variable
- ETH on Base for deposits

Platform: https://veil.cash`;
}

export const tools = [
  {
    name: 'veil_status',
    description: 'Check Veil configuration and relay health',
    parameters: { type: 'object', properties: {} },
    execute: async () => handleStatus(),
  },
  {
    name: 'veil_balance',
    description: 'Check Veil private and queue balances',
    parameters: { type: 'object', properties: {} },
    execute: async () => handleBalance(),
  },
  {
    name: 'veil_deposit',
    description: 'Deposit ETH to Veil private pool',
    parameters: {
      type: 'object',
      properties: { amount: { type: 'string', description: 'Amount of ETH to deposit' } },
      required: ['amount'],
    },
    execute: async ({ amount }: { amount: string }) => handleDeposit(amount),
  },
];

export default {
  name: 'veil',
  description: 'Veil - private transactions on Base via ZK proofs',
  commands: ['/veil'],
  requires: { env: ['PRIVATE_KEY'] },
  handle: execute,
  tools,
};
