/**
 * ACP Skill - Agent Commerce Protocol
 *
 * Commands for agent-to-agent commerce:
 * - Agent registration and service listing
 * - Service discovery and search
 * - Agreement creation and signing
 * - Escrow management
 * - Ratings and reputation
 */

import { logger } from '../../../utils/logger';
import {
  getRegistryService,
  getAgreementService,
  getDiscoveryService,
  CommonCapabilities,
  type ServiceCategory,
} from '../../../acp';
import { getEscrowService, initEscrowService, createEscrowId } from '../../../acp/escrow';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

// =============================================================================
// SKILL DEFINITION
// =============================================================================

export const name = 'acp';
export const description = 'Agent Commerce Protocol - agent-to-agent transactions';
export const version = '1.0.0';

export const commands = ['/acp'];

// =============================================================================
// MAIN EXECUTE
// =============================================================================

export async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || 'help';
  const cmdArgs = parts.slice(1).join(' ');

  try {
    switch (command) {
      case 'register':
        return await handleRegister(cmdArgs);
      case 'list-service':
        return await handleListService(cmdArgs);
      case 'search':
        return await handleSearch(cmdArgs);
      case 'discover':
        return await handleDiscover(cmdArgs);
      case 'create-agreement':
        return await handleCreateAgreement(cmdArgs);
      case 'sign-agreement':
        return await handleSignAgreement(cmdArgs);
      case 'create-escrow':
        return await handleCreateEscrow(cmdArgs);
      case 'fund-escrow':
        return await handleFundEscrow(cmdArgs);
      case 'release-escrow':
        return await handleReleaseEscrow(cmdArgs);
      case 'refund-escrow':
        return await handleRefundEscrow(cmdArgs);
      case 'rate-service':
        return await handleRateService(cmdArgs);
      case 'my-agents':
        return await handleMyAgents();
      case 'my-agreements':
        return await handleMyAgreements(cmdArgs);
      case 'my-escrows':
        return await handleMyEscrows(cmdArgs);
      case 'quick-hire':
        return await handleQuickHire(cmdArgs);
      case 'help':
      default:
        return showHelp();
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ command, error: msg }, 'ACP command failed');
    return `Error: ${msg}`;
  }
}

// =============================================================================
// REGISTER AGENT
// =============================================================================

async function handleRegister(args: string): Promise<string> {
  const nameMatch = args.match(/^(\S+)/);
  const addressMatch = args.match(/--address\s+(\S+)/);
  const descMatch = args.match(/--desc\s+"([^"]+)"/);

  if (!nameMatch || !addressMatch) {
    return 'Usage: /acp register <name> --address <solana_address> [--desc "description"]';
  }

  const registry = getRegistryService();
  const agent = await registry.registerAgent({
    address: addressMatch[1],
    name: nameMatch[1],
    description: descMatch?.[1],
    capabilities: [CommonCapabilities.llmInference],
    services: [],
    status: 'active',
  });

  return `Agent registered successfully!\n\nID: ${agent.id}\nName: ${agent.name}\nAddress: ${agent.address}\nStatus: ${agent.status}`;
}

// =============================================================================
// LIST SERVICE
// =============================================================================

async function handleListService(args: string): Promise<string> {
  const agentMatch = args.match(/^(\S+)/);
  const nameMatch = args.match(/--name\s+"([^"]+)"/);
  const categoryMatch = args.match(/--category\s+(\S+)/);
  const priceMatch = args.match(/--price\s+(\S+)/);
  const currencyMatch = args.match(/--currency\s+(\S+)/);

  if (!agentMatch || !nameMatch) {
    return 'Usage: /acp list-service <agent_id> --name "Service Name" --category <category> --price <amount> --currency <SOL|USDC>';
  }

  const registry = getRegistryService();
  const category = (categoryMatch?.[1] || 'other') as ServiceCategory;
  const price = priceMatch?.[1] || '0';
  const currency = currencyMatch?.[1] || 'SOL';

  const service = await registry.listService(agentMatch[1], {
    capability: {
      id: `cap_${Date.now()}`,
      name: nameMatch[1],
      description: nameMatch[1],
      category,
    },
    pricing: {
      model: 'per_request',
      amount: price,
      currency,
    },
    description: nameMatch[1],
    enabled: true,
  });

  return `Service listed!\n\nID: ${service.id}\nName: ${service.capability.name}\nCategory: ${category}\nPrice: ${price} ${currency}`;
}

// =============================================================================
// SEARCH
// =============================================================================

async function handleSearch(args: string): Promise<string> {
  const categoryMatch = args.match(/--category\s+(\S+)/);
  const maxPriceMatch = args.match(/--max-price\s+(\S+)/);
  const minRatingMatch = args.match(/--min-rating\s+(\S+)/);
  const queryMatch = args.match(/--query\s+"([^"]+)"/);

  const registry = getRegistryService();
  const services = await registry.searchServices({
    category: categoryMatch?.[1] as ServiceCategory | undefined,
    maxPrice: maxPriceMatch?.[1],
    minRating: minRatingMatch ? parseFloat(minRatingMatch[1]) : undefined,
    query: queryMatch?.[1],
  });

  if (services.length === 0) {
    return 'No services found matching your criteria.';
  }

  const lines = services.slice(0, 10).map((s, i) =>
    `${i + 1}. ${s.capability.name} (${s.capability.category})\n   Price: ${s.pricing.amount} ${s.pricing.currency}\n   ID: ${s.id}`
  );

  return `Found ${services.length} services:\n\n${lines.join('\n\n')}`;
}

// =============================================================================
// DISCOVER (with scoring)
// =============================================================================

async function handleDiscover(args: string): Promise<string> {
  const needMatch = args.match(/"([^"]+)"/);
  const maxPriceMatch = args.match(/--max-price\s+(\S+)/);
  const addressMatch = args.match(/--address\s+(\S+)/);

  if (!needMatch || !addressMatch) {
    return 'Usage: /acp discover "what you need" --address <your_address> [--max-price <amount>]';
  }

  const discovery = getDiscoveryService();
  const matches = await discovery.discover({
    need: needMatch[1],
    buyerAddress: addressMatch[1],
    maxPrice: maxPriceMatch?.[1],
  });

  if (matches.length === 0) {
    return 'No matching services found.';
  }

  const lines = matches.slice(0, 5).map((m, i) =>
    `${i + 1}. ${m.service.capability.name} (Score: ${m.score.toFixed(1)})\n` +
    `   Agent: ${m.agent.name}\n` +
    `   Price: ${m.estimatedCost} ${m.service.pricing.currency}\n` +
    `   Reasons: ${m.reasons.join(', ')}`
  );

  return `Top matches for "${needMatch[1]}":\n\n${lines.join('\n\n')}`;
}

// =============================================================================
// CREATE AGREEMENT
// =============================================================================

async function handleCreateAgreement(args: string): Promise<string> {
  const titleMatch = args.match(/--title\s+"([^"]+)"/);
  const buyerMatch = args.match(/--buyer\s+(\S+)/);
  const sellerMatch = args.match(/--seller\s+(\S+)/);
  const priceMatch = args.match(/--price\s+(\S+)/);
  const currencyMatch = args.match(/--currency\s+(\S+)/);
  const descMatch = args.match(/--desc\s+"([^"]+)"/);

  if (!titleMatch || !buyerMatch || !sellerMatch || !priceMatch) {
    return 'Usage: /acp create-agreement --title "Title" --buyer <address> --seller <address> --price <amount> [--currency SOL] [--desc "description"]';
  }

  const agreements = getAgreementService();
  const agreement = await agreements.create({
    title: titleMatch[1],
    description: descMatch?.[1] || titleMatch[1],
    parties: [
      { address: buyerMatch[1], role: 'buyer' },
      { address: sellerMatch[1], role: 'seller' },
    ],
    terms: [
      {
        id: `term_${Date.now()}`,
        type: 'payment',
        description: `Payment of ${priceMatch[1]} ${currencyMatch?.[1] || 'SOL'}`,
        value: priceMatch[1],
      },
    ],
    totalValue: priceMatch[1],
    currency: currencyMatch?.[1] || 'SOL',
    endDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  return `Agreement created!\n\nID: ${agreement.id}\nTitle: ${agreement.title}\nStatus: ${agreement.status}\nHash: ${agreement.hash.slice(0, 16)}...`;
}

// =============================================================================
// SIGN AGREEMENT
// =============================================================================

async function handleSignAgreement(args: string): Promise<string> {
  const idMatch = args.match(/^(\S+)/);
  const keyMatch = args.match(/--key\s+(\S+)/);

  if (!idMatch || !keyMatch) {
    return 'Usage: /acp sign-agreement <agreement_id> --key <base58_private_key>';
  }

  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(keyMatch[1]));
    const agreements = getAgreementService();
    const agreement = await agreements.sign(idMatch[1], keypair);

    const signedCount = agreement.parties.filter(p => p.signature).length;
    const totalParties = agreement.parties.length;

    return `Agreement signed!\n\nID: ${agreement.id}\nStatus: ${agreement.status}\nSignatures: ${signedCount}/${totalParties}`;
  } catch (error) {
    return `Failed to sign: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// =============================================================================
// CREATE ESCROW
// =============================================================================

async function handleCreateEscrow(args: string): Promise<string> {
  const buyerMatch = args.match(/--buyer\s+(\S+)/);
  const sellerMatch = args.match(/--seller\s+(\S+)/);
  const amountMatch = args.match(/--amount\s+(\S+)/);
  const arbiterMatch = args.match(/--arbiter\s+(\S+)/);
  const rpcMatch = args.match(/--rpc\s+(\S+)/);

  if (!buyerMatch || !sellerMatch || !amountMatch) {
    return 'Usage: /acp create-escrow --buyer <address> --seller <address> --amount <lamports> [--arbiter <address>] [--rpc <url>]';
  }

  const rpcUrl = rpcMatch?.[1] || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl);
  initEscrowService(connection);

  const escrowService = getEscrowService();
  const escrow = await escrowService.create({
    id: createEscrowId(),
    chain: 'solana',
    buyer: buyerMatch[1],
    seller: sellerMatch[1],
    arbiter: arbiterMatch?.[1],
    amount: amountMatch[1],
    releaseConditions: [],
    refundConditions: [],
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  const solAmount = (Number(escrow.amount) / LAMPORTS_PER_SOL).toFixed(4);

  return `Escrow created!\n\nID: ${escrow.id}\nAmount: ${solAmount} SOL\nEscrow Address: ${escrow.escrowAddress}\nStatus: ${escrow.status}\n\nNext: Fund with /acp fund-escrow ${escrow.id} --key <buyer_private_key>`;
}

// =============================================================================
// FUND ESCROW
// =============================================================================

async function handleFundEscrow(args: string): Promise<string> {
  const idMatch = args.match(/^(\S+)/);
  const keyMatch = args.match(/--key\s+(\S+)/);

  if (!idMatch || !keyMatch) {
    return 'Usage: /acp fund-escrow <escrow_id> --key <buyer_private_key>';
  }

  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(keyMatch[1]));
    const escrowService = getEscrowService();
    const result = await escrowService.fund(idMatch[1], keypair);

    if (!result.success) {
      return `Failed: ${result.error}`;
    }

    return `Escrow funded!\n\nSignature: ${result.signature}\n\nNext: Release with /acp release-escrow ${idMatch[1]} --key <buyer_or_arbiter_key>`;
  } catch (error) {
    return `Failed to fund: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// =============================================================================
// RELEASE ESCROW
// =============================================================================

async function handleReleaseEscrow(args: string): Promise<string> {
  const idMatch = args.match(/^(\S+)/);
  const keyMatch = args.match(/--key\s+(\S+)/);

  if (!idMatch || !keyMatch) {
    return 'Usage: /acp release-escrow <escrow_id> --key <buyer_or_arbiter_private_key>';
  }

  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(keyMatch[1]));
    const escrowService = getEscrowService();
    const result = await escrowService.release(idMatch[1], keypair);

    if (!result.success) {
      return `Failed: ${result.error}`;
    }

    return `Escrow released to seller!\n\nSignature: ${result.signature}`;
  } catch (error) {
    return `Failed to release: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// =============================================================================
// REFUND ESCROW
// =============================================================================

async function handleRefundEscrow(args: string): Promise<string> {
  const idMatch = args.match(/^(\S+)/);
  const keyMatch = args.match(/--key\s+(\S+)/);

  if (!idMatch || !keyMatch) {
    return 'Usage: /acp refund-escrow <escrow_id> --key <seller_buyer_or_arbiter_private_key>';
  }

  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(keyMatch[1]));
    const escrowService = getEscrowService();
    const result = await escrowService.refund(idMatch[1], keypair);

    if (!result.success) {
      return `Failed: ${result.error}`;
    }

    return `Escrow refunded to buyer!\n\nSignature: ${result.signature}`;
  } catch (error) {
    return `Failed to refund: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// =============================================================================
// RATE SERVICE
// =============================================================================

async function handleRateService(args: string): Promise<string> {
  const serviceMatch = args.match(/^(\S+)/);
  const ratingMatch = args.match(/--rating\s+(\d)/);
  const reviewMatch = args.match(/--review\s+"([^"]+)"/);
  const addressMatch = args.match(/--address\s+(\S+)/);

  if (!serviceMatch || !ratingMatch || !addressMatch) {
    return 'Usage: /acp rate-service <service_id> --rating <1-5> --address <your_address> [--review "review text"]';
  }

  const rating = parseInt(ratingMatch[1]);
  if (rating < 1 || rating > 5) {
    return 'Rating must be between 1 and 5';
  }

  const registry = getRegistryService();
  await registry.rateService(serviceMatch[1], addressMatch[1], rating, reviewMatch?.[1]);

  return `Service rated ${rating}/5 stars!${reviewMatch ? `\n\nReview: "${reviewMatch[1]}"` : ''}`;
}

// =============================================================================
// MY AGENTS
// =============================================================================

async function handleMyAgents(): Promise<string> {
  const registry = getRegistryService();
  const agents = await registry.getTopAgents(undefined, 20);

  if (agents.length === 0) {
    return 'No agents registered yet.';
  }

  const lines = agents.map((a, i) =>
    `${i + 1}. ${a.name} (${a.status})\n` +
    `   Address: ${a.address}\n` +
    `   Rating: ${a.reputation.averageRating.toFixed(1)}/5 (${a.reputation.totalRatings} reviews)\n` +
    `   Services: ${a.services.length}`
  );

  return `Registered Agents:\n\n${lines.join('\n\n')}`;
}

// =============================================================================
// MY AGREEMENTS
// =============================================================================

async function handleMyAgreements(args: string): Promise<string> {
  const addressMatch = args.match(/--address\s+(\S+)/);

  if (!addressMatch) {
    return 'Usage: /acp my-agreements --address <your_address>';
  }

  const agreements = getAgreementService();
  const list = await agreements.list(addressMatch[1]);

  if (list.length === 0) {
    return 'No agreements found.';
  }

  const lines = list.slice(0, 10).map((a, i) =>
    `${i + 1}. ${a.title} (${a.status})\n` +
    `   ID: ${a.id}\n` +
    `   Value: ${a.totalValue} ${a.currency || 'SOL'}`
  );

  return `Your Agreements:\n\n${lines.join('\n\n')}`;
}

// =============================================================================
// MY ESCROWS
// =============================================================================

async function handleMyEscrows(args: string): Promise<string> {
  const addressMatch = args.match(/--address\s+(\S+)/);

  if (!addressMatch) {
    return 'Usage: /acp my-escrows --address <your_address>';
  }

  try {
    const escrowService = getEscrowService();
    const list = await escrowService.list(addressMatch[1]);

    if (list.length === 0) {
      return 'No escrows found.';
    }

    const lines = list.slice(0, 10).map((e, i) => {
      const solAmount = (Number(e.amount) / LAMPORTS_PER_SOL).toFixed(4);
      return `${i + 1}. ${e.id} (${e.status})\n` +
        `   Amount: ${solAmount} SOL\n` +
        `   Buyer: ${e.buyer.slice(0, 8)}...\n` +
        `   Seller: ${e.seller.slice(0, 8)}...`;
    });

    return `Your Escrows:\n\n${lines.join('\n\n')}`;
  } catch (error) {
    return 'Escrow service not initialized. Create an escrow first.';
  }
}

// =============================================================================
// QUICK HIRE
// =============================================================================

async function handleQuickHire(args: string): Promise<string> {
  const needMatch = args.match(/"([^"]+)"/);
  const addressMatch = args.match(/--address\s+(\S+)/);
  const maxPriceMatch = args.match(/--max-price\s+(\S+)/);

  if (!needMatch || !addressMatch) {
    return 'Usage: /acp quick-hire "what you need" --address <your_address> [--max-price <amount>]';
  }

  const discovery = getDiscoveryService();
  const result = await discovery.autoNegotiate({
    need: needMatch[1],
    buyerAddress: addressMatch[1],
    maxPrice: maxPriceMatch?.[1],
  });

  if (!result) {
    return 'No matching services found for your request.';
  }

  if (result.accepted && result.agreement) {
    return `Agreement created automatically!\n\nID: ${result.agreement.id}\nTitle: ${result.agreement.title}\nStatus: ${result.agreement.status}\n\nNext steps:\n1. Sign with /acp sign-agreement ${result.agreement.id} --key <your_key>\n2. Wait for seller to sign\n3. Create escrow and fund`;
  }

  if (result.counterOffer) {
    return `Counter-offer received:\n\nPrice: ${result.counterOffer.price}\nTerms: ${result.counterOffer.terms?.join(', ') || 'Standard terms'}`;
  }

  return 'Negotiation failed.';
}

// =============================================================================
// HELP
// =============================================================================

function showHelp(): string {
  return `**Agent Commerce Protocol (ACP)**

Agent registration:
  /acp register <name> --address <addr> [--desc "description"]
  /acp list-service <agent_id> --name "Name" --category <cat> --price <amt>
  /acp my-agents

Discovery:
  /acp search [--category <cat>] [--max-price <amt>] [--min-rating <n>]
  /acp discover "what you need" --address <addr> [--max-price <amt>]
  /acp quick-hire "what you need" --address <addr>

Agreements:
  /acp create-agreement --title "Title" --buyer <addr> --seller <addr> --price <amt>
  /acp sign-agreement <id> --key <private_key>
  /acp my-agreements --address <addr>

Escrow:
  /acp create-escrow --buyer <addr> --seller <addr> --amount <lamports>
  /acp fund-escrow <id> --key <buyer_key>
  /acp release-escrow <id> --key <buyer_or_arbiter_key>
  /acp refund-escrow <id> --key <seller_or_arbiter_key>
  /acp my-escrows --address <addr>

Ratings:
  /acp rate-service <service_id> --rating <1-5> --address <addr>

Categories: llm, trading, data, compute, storage, integration, research, automation, other`;
}

export default { name, description, commands, requires: { env: ['SOLANA_PRIVATE_KEY'] }, handle: execute };
