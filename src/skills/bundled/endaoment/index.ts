/**
 * Endaoment Skill - Charity Donations on Base
 *
 * OrgFundFactory: 0x10fd9348136dcea154f752fe0b6db45fc298a589
 * USDC: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
 *
 * Commands:
 * /donate search <query>      Search for charities
 * /donate info <EIN>          Get charity info
 * /donate <EIN> <amount>      Donate USDC
 * /donate approve <amount>    Approve USDC
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, stringToHex, padHex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const ORG_FUND_FACTORY = '0x10fd9348136dcea154f752fe0b6db45fc298a589' as Address;
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Address;
const REGISTRY = '0x237b53bcfbd3a114b549dfec96a9856808f45c94' as Address;

const ENDAOMENT_ABI = [
  {
    inputs: [{ name: 'orgId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }],
    name: 'deployOrgAndDonate',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    name: 'approve',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    name: 'allowance',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Popular charities database
const POPULAR_CHARITIES: Record<string, { name: string; ein: string; description: string }> = {
  '27-1661997': { name: 'GiveDirectly', ein: '27-1661997', description: 'Direct cash transfers to people in poverty' },
  '53-0196605': { name: 'American Red Cross', ein: '53-0196605', description: 'Disaster relief and humanitarian aid' },
  '13-3433452': { name: 'Doctors Without Borders', ein: '13-3433452', description: 'Medical humanitarian organization' },
  '13-1623829': { name: 'ASPCA', ein: '13-1623829', description: 'Animal welfare organization' },
  '11-1666852': { name: 'North Shore Animal League', ein: '11-1666852', description: 'Animal rescue and adoption' },
  '13-1644147': { name: 'Feeding America', ein: '13-1644147', description: 'Hunger relief organization' },
  '94-1696494': { name: 'Wikimedia Foundation', ein: '94-1696494', description: 'Free knowledge for all' },
  '26-2148653': { name: 'Khan Academy', ein: '26-2148653', description: 'Free education for anyone' },
};

function getPublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
  });
}

function getWalletClient() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error('PRIVATE_KEY not set');
  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey as `0x${string}` : `0x${privateKey}`);
  return createWalletClient({
    account,
    chain: base,
    transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
  });
}

function encodeEIN(ein: string): `0x${string}` {
  // Remove any dashes and convert to bytes32
  const normalized = ein.replace(/-/g, '-');
  const hex = stringToHex(normalized, { size: 32 });
  return hex;
}

async function handleSearch(query: string): Promise<string> {
  if (!query) {
    return 'Usage: /donate search <name or EIN>';
  }

  const queryLower = query.toLowerCase();
  const results = Object.values(POPULAR_CHARITIES).filter(
    (c) => c.name.toLowerCase().includes(queryLower) || c.ein.includes(query)
  );

  if (results.length === 0) {
    return `No charities found for "${query}".\n\nTry searching on https://endaoment.org/explore`;
  }

  let output = `**Charity Search Results**\n\n`;
  for (const charity of results) {
    output += `**${charity.name}**\n`;
    output += `  EIN: ${charity.ein}\n`;
    output += `  ${charity.description}\n\n`;
  }

  output += `\nDonate: \`/donate <EIN> <amount>\``;
  return output;
}

async function handleInfo(ein: string): Promise<string> {
  if (!ein) {
    return 'Usage: /donate info <EIN>';
  }

  const charity = POPULAR_CHARITIES[ein];
  if (charity) {
    return `**${charity.name}**

EIN: ${charity.ein}
${charity.description}

**To Donate:**
\`/donate ${charity.ein} <amount>\`

**Fee:** 1.5% (e.g., $100 donation = $1.50 fee, $98.50 to charity)

More info: https://endaoment.org`;
  }

  return `Charity with EIN ${ein} not in local database.

You can still donate if it's a valid 501(c)(3):
\`/donate ${ein} <amount>\`

Search on https://endaoment.org/explore`;
}

async function handleDonate(ein: string, amountStr: string): Promise<string> {
  if (!ein || !amountStr) {
    return `Usage: /donate <EIN> <amount>

Example: /donate 27-1661997 10    (Donate $10 to GiveDirectly)

**Popular Charities:**
- 27-1661997 (GiveDirectly)
- 53-0196605 (American Red Cross)
- 13-3433452 (Doctors Without Borders)`;
  }

  try {
    const publicClient = getPublicClient();
    const walletClient = getWalletClient();

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      return 'Invalid amount. Enter a positive number (USDC).';
    }

    const amountWei = parseUnits(amountStr, 6);

    // Check allowance
    const allowance = await publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [walletClient.account.address, ORG_FUND_FACTORY],
    });

    if (allowance < amountWei) {
      return `Insufficient USDC allowance.\n\nRun: /donate approve ${Math.ceil(amount * 1.1)}\n\nThen try donating again.`;
    }

    // Encode EIN to bytes32
    const orgId = encodeEIN(ein);

    // Execute donation
    const hash = await walletClient.writeContract({
      address: ORG_FUND_FACTORY,
      abi: ENDAOMENT_ABI,
      functionName: 'deployOrgAndDonate',
      args: [orgId, amountWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    const charity = POPULAR_CHARITIES[ein];
    const charityName = charity?.name || ein;
    const fee = (amount * 0.015).toFixed(2);
    const netAmount = (amount * 0.985).toFixed(2);

    return `**Donation Complete!**

**Charity:** ${charityName}
**Gross Amount:** $${amount} USDC
**Fee (1.5%):** $${fee}
**Net to Charity:** $${netAmount}

TX: \`${hash}\`
Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}

Thank you for your donation!`;
  } catch (error) {
    return `Donation failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function handleApprove(amountStr: string): Promise<string> {
  if (!amountStr) {
    return 'Usage: /donate approve <amount>\nExample: /donate approve 100';
  }

  try {
    const publicClient = getPublicClient();
    const walletClient = getWalletClient();

    const amountWei = parseUnits(amountStr, 6);

    const hash = await walletClient.writeContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ORG_FUND_FACTORY, amountWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return `**USDC Approved**

Amount: ${amountStr} USDC
Spender: Endaoment
TX: \`${hash}\`
Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}

You can now make donations!`;
  } catch (error) {
    return `Approve failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';

  switch (command) {
    case 'search':
      return handleSearch(parts.slice(1).join(' '));
    case 'info':
      return handleInfo(parts[1]);
    case 'approve':
      return handleApprove(parts[1]);
    case 'help':
      return getHelp();
    default:
      // Try to parse as EIN + amount
      if (parts[0]?.includes('-') && parts[1]) {
        return handleDonate(parts[0], parts[1]);
      }
      return getHelp();
  }
}

function getHelp(): string {
  return `**Endaoment - Crypto Donations**

/donate search <query>       Search charities
/donate info <EIN>           Charity info
/donate <EIN> <amount>       Donate USDC
/donate approve <amount>     Approve USDC

**Popular Charities:**
- 27-1661997 - GiveDirectly
- 53-0196605 - American Red Cross
- 13-3433452 - Doctors Without Borders
- 13-1623829 - ASPCA

**Example:**
/donate 27-1661997 10        Donate $10 to GiveDirectly

**Fee:** 1.5% | All donations are tax-deductible
Platform: https://endaoment.org`;
}

export const tools = [
  {
    name: 'endaoment_search',
    description: 'Search for charities to donate to via Endaoment',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Charity name or EIN' } },
      required: ['query'],
    },
    execute: async ({ query }: { query: string }) => handleSearch(query),
  },
  {
    name: 'endaoment_donate',
    description: 'Donate USDC to a 501(c)(3) charity via Endaoment',
    parameters: {
      type: 'object',
      properties: {
        ein: { type: 'string', description: 'Charity EIN (e.g., 27-1661997)' },
        amount: { type: 'string', description: 'Amount in USDC' },
      },
      required: ['ein', 'amount'],
    },
    execute: async ({ ein, amount }: { ein: string; amount: string }) => handleDonate(ein, amount),
  },
];

export default {
  name: 'endaoment',
  description: 'Endaoment - Donate USDC to 501(c)(3) charities on Base',
  commands: ['/endaoment', '/donate'],
  requires: { env: ['PRIVATE_KEY'] },
  handle: execute,
  tools,
};
