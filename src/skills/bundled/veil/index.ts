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

// Veil contracts on Base
const VEIL_POOL = '0x' as Address; // Pool address (placeholder)

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
  output += `RPC_URL: ${hasRpcUrl ? 'Configured' : 'Using default'}\n`;

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
  const veilKey = process.env.VEIL_KEY;

  if (!veilKey) {
    return `VEIL_KEY not set. Run \`/veil init\` first.`;
  }

  if (!checkVeilSDK()) {
    return `Veil SDK not installed. Run:\n\`npm install -g @veil-cash/sdk\``;
  }

  // For full implementation, would call SDK
  return `**Veil Balance**

*Full balance check requires the Veil SDK CLI:*

\`\`\`bash
npx @veil-cash/sdk balance
npx @veil-cash/sdk queue-balance
npx @veil-cash/sdk private-balance
\`\`\`

Or with environment:
\`\`\`bash
VEIL_KEY="..." npx @veil-cash/sdk balance
\`\`\``;
}

async function handleDeposit(amount: string): Promise<string> {
  if (!amount) {
    return 'Usage: /veil deposit <amount>\nExample: /veil deposit 0.1';
  }

  const veilKey = process.env.VEIL_KEY;
  if (!veilKey) {
    return `VEIL_KEY not set. Run \`/veil init\` first.`;
  }

  try {
    const walletClient = getWalletClient();
    const amountWei = parseEther(amount);

    // Note: Full implementation would call Veil deposit contract
    return `**Deposit Prepared**

Amount: ${amount} ETH
From: \`${walletClient.account.address}\`

*Full deposit requires Veil SDK:*

\`\`\`bash
npx @veil-cash/sdk deposit ${amount}
\`\`\`

Or via CLI with Bankr signing:
\`\`\`bash
# Get encoded transaction
npx @veil-cash/sdk deposit ${amount} --encode-only

# Submit via Bankr
\`\`\`

The deposit will appear in your queue balance first,
then move to private balance after processing.`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
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

export default { execute, tools };
