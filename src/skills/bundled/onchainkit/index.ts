/**
 * OnchainKit Skill - Build Onchain Apps
 *
 * Coinbase's React component library for building onchain applications.
 *
 * Commands:
 * /onchainkit create <name>     Create new project
 * /onchainkit template <type>   Get template code
 * /onchainkit docs <topic>      Get documentation
 */

async function handleCreate(projectName: string): Promise<string> {
  if (!projectName) {
    return `Usage: /onchainkit create <project-name>

Example: /onchainkit create my-onchain-app`;
  }

  try {
    const proc = await import('../../../process/index');
    if (proc.commandExists('npm')) {
      const result = await proc.execute(`npm create onchain@latest ${projectName}`, { timeout: 60000 });
      if (result.exitCode === 0) {
        return `**Project Created: ${projectName}**\n\n${result.stdout.slice(0, 1500)}\n\n**Next steps:**\n1. \`cd ${projectName}\`\n2. Set environment variables\n3. \`npm run dev\`\n\nSee \`/onchainkit docs setup\` for configuration details.`;
      }
      // Fall through to manual instructions if command fails
    }
  } catch {
    // Fall through to manual instructions
  }

  return `**Create OnchainKit Project**

Run these commands to create "${projectName}":

\`\`\`bash
# Option 1: Official starter (recommended)
npm create onchain@latest ${projectName}

# Option 2: Manual setup
mkdir ${projectName} && cd ${projectName}
npm init -y
npm install @coinbase/onchainkit wagmi viem @tanstack/react-query
\`\`\`

**After creation:**
1. Set environment variables
2. Configure providers
3. Start building!

See \`/onchainkit docs setup\` for configuration details.`;
}

async function handleTemplate(templateType: string): Promise<string> {
  const templates: Record<string, string> = {
    wallet: `**Wallet Connection Template**

\`\`\`tsx
import { Wallet, ConnectWallet, WalletDropdown } from '@coinbase/onchainkit/wallet';
import { Identity, Avatar, Name, Address } from '@coinbase/onchainkit/identity';

function WalletButton() {
  return (
    <Wallet>
      <ConnectWallet>
        <Avatar className="h-6 w-6" />
        <Name />
      </ConnectWallet>
      <WalletDropdown>
        <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick>
          <Avatar />
          <Name />
          <Address />
        </Identity>
      </WalletDropdown>
    </Wallet>
  );
}
\`\`\``,

    swap: `**Token Swap Template**

\`\`\`tsx
import { Swap, SwapAmountInput, SwapToggleButton, SwapButton, SwapMessage } from '@coinbase/onchainkit/swap';
import type { Token } from '@coinbase/onchainkit/token';

const ETH: Token = { name: 'Ethereum', address: '', symbol: 'ETH', decimals: 18, chainId: 8453 };
const USDC: Token = { name: 'USDC', address: '0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913', symbol: 'USDC', decimals: 6, chainId: 8453 };

function TokenSwap() {
  return (
    <Swap>
      <SwapAmountInput label="Sell" swappableTokens={[ETH, USDC]} token={ETH} type="from" />
      <SwapToggleButton />
      <SwapAmountInput label="Buy" swappableTokens={[ETH, USDC]} token={USDC} type="to" />
      <SwapButton />
      <SwapMessage />
    </Swap>
  );
}
\`\`\``,

    identity: `**Identity Display Template**

\`\`\`tsx
import { Identity, Avatar, Name, Badge, Address } from '@coinbase/onchainkit/identity';

function UserProfile({ address }: { address: \`0x\${string}\` }) {
  return (
    <Identity address={address} schemaId="0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9">
      <Avatar />
      <Name>
        <Badge />
      </Name>
      <Address />
    </Identity>
  );
}
\`\`\``,

    transaction: `**Transaction Template**

\`\`\`tsx
import { Transaction, TransactionButton, TransactionStatus, TransactionStatusLabel, TransactionStatusAction } from '@coinbase/onchainkit/transaction';
import type { ContractFunctionParameters } from 'viem';

const calls: ContractFunctionParameters[] = [
  {
    address: '0x...',
    abi: [...],
    functionName: 'mint',
    args: [],
  },
];

function MintButton() {
  return (
    <Transaction calls={calls} chainId={8453}>
      <TransactionButton />
      <TransactionStatus>
        <TransactionStatusLabel />
        <TransactionStatusAction />
      </TransactionStatus>
    </Transaction>
  );
}
\`\`\``,

    checkout: `**Checkout/Payment Template**

\`\`\`tsx
import { Checkout, CheckoutButton, CheckoutStatus } from '@coinbase/onchainkit/checkout';

function PaymentButton() {
  return (
    <Checkout productId="your-product-id">
      <CheckoutButton coinbaseBranded />
      <CheckoutStatus />
    </Checkout>
  );
}
\`\`\``,

    provider: `**Provider Setup Template**

\`\`\`tsx
// app/providers.tsx
'use client';

import { OnchainKitProvider } from '@coinbase/onchainkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { base } from 'wagmi/chains';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from './wagmi';

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <OnchainKitProvider
          apiKey={process.env.NEXT_PUBLIC_CDP_API_KEY}
          chain={base}
        >
          {children}
        </OnchainKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
\`\`\``,
  };

  if (!templateType) {
    return `Usage: /onchainkit template <type>

Available templates:
- wallet      Wallet connection
- swap        Token swap
- identity    User identity display
- transaction Transaction building
- checkout    Payment processing
- provider    Provider setup`;
  }

  const template = templates[templateType.toLowerCase()];
  if (!template) {
    return `Unknown template: ${templateType}\n\nAvailable: wallet, swap, identity, transaction, checkout, provider`;
  }

  return template;
}

async function handleDocs(topic: string): Promise<string> {
  const docs: Record<string, string> = {
    setup: `**OnchainKit Setup**

**1. Install Dependencies:**
\`\`\`bash
npm install @coinbase/onchainkit wagmi viem @tanstack/react-query
\`\`\`

**2. Environment Variables:**
\`\`\`bash
NEXT_PUBLIC_CDP_API_KEY="..."        # Coinbase Developer Platform
NEXT_PUBLIC_WC_PROJECT_ID="..."      # WalletConnect (optional)
\`\`\`

**3. Add to layout.tsx:**
\`\`\`tsx
import '@coinbase/onchainkit/styles.css';
\`\`\`

**4. Wrap with Providers:**
See \`/onchainkit template provider\`

**Get API Key:**
https://portal.cdp.coinbase.com`,

    wallet: `**Wallet Integration**

OnchainKit provides ready-to-use wallet components:

**ConnectWallet** - Button to connect
**WalletDropdown** - Dropdown menu after connect
**WalletDropdownDisconnect** - Disconnect option

Components auto-detect:
- Coinbase Wallet
- MetaMask
- WalletConnect
- Rainbow
- And more...

See \`/onchainkit template wallet\` for code.`,

    identity: `**Identity Components**

Display blockchain identities with:

**Avatar** - Profile picture (ENS, Basenames, etc.)
**Name** - Display name
**Badge** - Verification badge
**Address** - Formatted address

Supports:
- ENS names
- Basenames
- CB.ID
- Custom attestations

See \`/onchainkit template identity\` for code.`,

    swap: `**Token Swap**

Built-in swap functionality:

**SwapAmountInput** - Token amount inputs
**SwapToggleButton** - Switch tokens
**SwapButton** - Execute swap
**SwapMessage** - Status messages

Features:
- Best price routing
- Slippage protection
- Gas estimation
- Transaction tracking

See \`/onchainkit template swap\` for code.`,

    transaction: `**Transaction Building**

Build and execute transactions:

**Transaction** - Container component
**TransactionButton** - Submit button
**TransactionStatus** - Progress tracking
**TransactionToast** - Notifications

Features:
- Gas estimation
- Batched transactions
- Error handling
- Confirmation tracking

See \`/onchainkit template transaction\` for code.`,
  };

  if (!topic) {
    return `Usage: /onchainkit docs <topic>

Available topics:
- setup        Installation & config
- wallet       Wallet connection
- identity     Identity display
- swap         Token swaps
- transaction  Transaction building

Full docs: https://onchainkit.xyz`;
  }

  const doc = docs[topic.toLowerCase()];
  if (!doc) {
    return `Unknown topic: ${topic}\n\nAvailable: setup, wallet, identity, swap, transaction`;
  }

  return doc;
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';

  switch (command) {
    case 'create':
      return handleCreate(parts[1]);
    case 'template':
      return handleTemplate(parts[1]);
    case 'docs':
      return handleDocs(parts[1]);
    case 'help':
    default:
      return getHelp();
  }
}

function getHelp(): string {
  return `**OnchainKit - Build Onchain Apps**

/onchainkit create <name>      Create new project
/onchainkit template <type>    Get template code
/onchainkit docs <topic>       Documentation

**Templates:**
- wallet      Wallet connection
- swap        Token swap
- identity    User identity
- transaction Transaction building
- checkout    Payment processing
- provider    Provider setup

**Quick Start:**
\`\`\`bash
npm create onchain@latest my-app
\`\`\`

**Resources:**
- Docs: https://onchainkit.xyz
- GitHub: github.com/coinbase/onchainkit
- Examples: /onchainkit template wallet`;
}

export const tools = [
  {
    name: 'onchainkit_template',
    description: 'Get OnchainKit React component templates',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['wallet', 'swap', 'identity', 'transaction', 'checkout', 'provider'],
          description: 'Template type',
        },
      },
      required: ['type'],
    },
    execute: async ({ type }: { type: string }) => handleTemplate(type),
  },
  {
    name: 'onchainkit_docs',
    description: 'Get OnchainKit documentation',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: ['setup', 'wallet', 'identity', 'swap', 'transaction'],
          description: 'Documentation topic',
        },
      },
      required: ['topic'],
    },
    execute: async ({ topic }: { topic: string }) => handleDocs(topic),
  },
];

export default {
  name: 'onchainkit',
  description: 'Coinbase OnchainKit - React components for building onchain apps on Base',
  commands: ['/onchainkit', '/ock'],
  handle: execute,
  tools,
};
