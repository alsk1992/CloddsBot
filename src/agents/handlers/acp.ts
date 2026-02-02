/**
 * ACP (Agent Commerce Protocol) Handlers
 *
 * Handlers for agent-to-agent commerce:
 * - Agent registration and service listing
 * - Service discovery and search
 * - Agreement creation and signing
 * - Escrow management
 * - Ratings and reputation
 */

import type { ToolInput, HandlerResult, HandlerContext, HandlersMap } from './types';
import { safeHandler, errorResult } from './types';
import {
  getRegistryService,
  getAgreementService,
  getDiscoveryService,
  type ServiceCategory,
} from '../../acp';
import { getEscrowService, initEscrowService, createEscrowId } from '../../acp/escrow';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

// ============================================================================
// Agent Registration Handlers
// ============================================================================

async function acpRegisterAgentHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const name = toolInput.name as string;
  const address = toolInput.address as string;
  const description = toolInput.description as string | undefined;

  if (!name || !address) {
    return errorResult('name and address are required');
  }

  return safeHandler(async () => {
    const registry = getRegistryService();
    const agent = await registry.registerAgent({
      address,
      name,
      description,
      capabilities: [],
      services: [],
      status: 'active',
    });
    return {
      id: agent.id,
      name: agent.name,
      address: agent.address,
      status: agent.status,
    };
  });
}

async function acpListServiceHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const agentId = toolInput.agent_id as string;
  const name = toolInput.name as string;
  const category = (toolInput.category as ServiceCategory) || 'other';
  const price = toolInput.price as string || '0';
  const currency = toolInput.currency as string || 'SOL';
  const description = toolInput.description as string || name;

  if (!agentId || !name) {
    return errorResult('agent_id and name are required');
  }

  return safeHandler(async () => {
    const registry = getRegistryService();
    const service = await registry.listService(agentId, {
      capability: {
        id: `cap_${Date.now()}`,
        name,
        description,
        category,
      },
      pricing: {
        model: 'per_request',
        amount: price,
        currency,
      },
      description,
      enabled: true,
    });
    return {
      id: service.id,
      name: service.capability.name,
      category: service.capability.category,
      price: service.pricing.amount,
      currency: service.pricing.currency,
    };
  });
}

async function acpGetAgentHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const agentId = toolInput.agent_id as string;

  if (!agentId) {
    return errorResult('agent_id is required');
  }

  return safeHandler(async () => {
    const registry = getRegistryService();
    const agent = await registry.getAgent(agentId);
    if (!agent) {
      return { error: 'Agent not found' };
    }
    return {
      id: agent.id,
      name: agent.name,
      address: agent.address,
      status: agent.status,
      description: agent.description,
      services: agent.services.length,
      reputation: agent.reputation,
    };
  });
}

// ============================================================================
// Discovery Handlers
// ============================================================================

async function acpSearchServicesHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const category = toolInput.category as ServiceCategory | undefined;
  const maxPrice = toolInput.max_price as string | undefined;
  const minRating = toolInput.min_rating as number | undefined;
  const query = toolInput.query as string | undefined;

  return safeHandler(async () => {
    const registry = getRegistryService();
    const services = await registry.searchServices({
      category,
      maxPrice,
      minRating,
      query,
    });
    return {
      count: services.length,
      services: services.slice(0, 10).map(s => ({
        id: s.id,
        name: s.capability.name,
        category: s.capability.category,
        price: s.pricing.amount,
        currency: s.pricing.currency,
        agentId: s.agentId,
      })),
    };
  });
}

async function acpDiscoverHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const need = toolInput.need as string;
  const buyerAddress = toolInput.buyer_address as string;
  const maxPrice = toolInput.max_price as string | undefined;

  if (!need || !buyerAddress) {
    return errorResult('need and buyer_address are required');
  }

  return safeHandler(async () => {
    const discovery = getDiscoveryService();
    const matches = await discovery.discover({
      need,
      buyerAddress,
      maxPrice,
    });
    return {
      count: matches.length,
      matches: matches.slice(0, 5).map(m => ({
        serviceId: m.service.id,
        serviceName: m.service.capability.name,
        agentId: m.agent.id,
        agentName: m.agent.name,
        score: Math.round(m.score * 10) / 10,
        estimatedCost: m.estimatedCost,
        reasons: m.reasons,
      })),
    };
  });
}

async function acpQuickHireHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const need = toolInput.need as string;
  const buyerAddress = toolInput.buyer_address as string;
  const maxPrice = toolInput.max_price as string | undefined;

  if (!need || !buyerAddress) {
    return errorResult('need and buyer_address are required');
  }

  return safeHandler(async () => {
    const discovery = getDiscoveryService();
    const result = await discovery.autoNegotiate({
      need,
      buyerAddress,
      maxPrice,
    });

    if (!result) {
      return { success: false, message: 'No matching services found' };
    }

    if (result.accepted && result.agreement) {
      return {
        success: true,
        accepted: true,
        agreement: {
          id: result.agreement.id,
          title: result.agreement.title,
          status: result.agreement.status,
        },
      };
    }

    if (result.counterOffer) {
      return {
        success: true,
        accepted: false,
        counterOffer: result.counterOffer,
      };
    }

    return { success: false, message: 'Negotiation failed' };
  });
}

// ============================================================================
// Agreement Handlers
// ============================================================================

async function acpCreateAgreementHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const title = toolInput.title as string;
  const buyer = toolInput.buyer as string;
  const seller = toolInput.seller as string;
  const price = toolInput.price as string;
  const currency = toolInput.currency as string || 'SOL';
  const description = toolInput.description as string || title;

  if (!title || !buyer || !seller || !price) {
    return errorResult('title, buyer, seller, and price are required');
  }

  return safeHandler(async () => {
    const agreements = getAgreementService();
    const agreement = await agreements.create({
      title,
      description,
      parties: [
        { address: buyer, role: 'buyer' },
        { address: seller, role: 'seller' },
      ],
      terms: [
        {
          id: `term_${Date.now()}`,
          type: 'payment',
          description: `Payment of ${price} ${currency}`,
          value: price,
        },
      ],
      totalValue: price,
      currency,
      endDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    return {
      id: agreement.id,
      title: agreement.title,
      status: agreement.status,
      hash: agreement.hash.slice(0, 32) + '...',
    };
  });
}

async function acpSignAgreementHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const agreementId = toolInput.agreement_id as string;
  const privateKey = toolInput.private_key as string;

  if (!agreementId || !privateKey) {
    return errorResult('agreement_id and private_key are required');
  }

  return safeHandler(async () => {
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    const agreements = getAgreementService();
    const agreement = await agreements.sign(agreementId, keypair);
    const signedCount = agreement.parties.filter(p => p.signature).length;
    return {
      id: agreement.id,
      status: agreement.status,
      signedCount,
      totalParties: agreement.parties.length,
    };
  });
}

async function acpGetAgreementHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const agreementId = toolInput.agreement_id as string;

  if (!agreementId) {
    return errorResult('agreement_id is required');
  }

  return safeHandler(async () => {
    const agreements = getAgreementService();
    const agreement = await agreements.get(agreementId);
    if (!agreement) {
      return { error: 'Agreement not found' };
    }
    return {
      id: agreement.id,
      title: agreement.title,
      status: agreement.status,
      totalValue: agreement.totalValue,
      currency: agreement.currency,
      parties: agreement.parties.map(p => ({
        address: p.address.slice(0, 8) + '...',
        role: p.role,
        signed: !!p.signature,
      })),
    };
  });
}

async function acpListAgreementsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const address = toolInput.address as string;

  if (!address) {
    return errorResult('address is required');
  }

  return safeHandler(async () => {
    const agreements = getAgreementService();
    const list = await agreements.list(address);
    return {
      count: list.length,
      agreements: list.slice(0, 10).map(a => ({
        id: a.id,
        title: a.title,
        status: a.status,
        totalValue: a.totalValue,
        currency: a.currency,
      })),
    };
  });
}

// ============================================================================
// Escrow Handlers
// ============================================================================

async function acpCreateEscrowHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const buyer = toolInput.buyer as string;
  const seller = toolInput.seller as string;
  const amount = toolInput.amount as string;
  const arbiter = toolInput.arbiter as string | undefined;
  const rpcUrl = toolInput.rpc_url as string || 'https://api.mainnet-beta.solana.com';

  if (!buyer || !seller || !amount) {
    return errorResult('buyer, seller, and amount (in lamports) are required');
  }

  return safeHandler(async () => {
    const connection = new Connection(rpcUrl);
    initEscrowService(connection);

    const escrowService = getEscrowService();
    const escrow = await escrowService.create({
      id: createEscrowId(),
      chain: 'solana',
      buyer,
      seller,
      arbiter,
      amount,
      releaseConditions: [],
      refundConditions: [],
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    const solAmount = (Number(escrow.amount) / LAMPORTS_PER_SOL).toFixed(4);
    return {
      id: escrow.id,
      amount: solAmount,
      amountLamports: escrow.amount,
      escrowAddress: escrow.escrowAddress,
      status: escrow.status,
    };
  });
}

async function acpFundEscrowHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const escrowId = toolInput.escrow_id as string;
  const privateKey = toolInput.private_key as string;

  if (!escrowId || !privateKey) {
    return errorResult('escrow_id and private_key are required');
  }

  return safeHandler(async () => {
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    const escrowService = getEscrowService();
    const result = await escrowService.fund(escrowId, keypair);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      signature: result.signature,
    };
  });
}

async function acpReleaseEscrowHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const escrowId = toolInput.escrow_id as string;
  const privateKey = toolInput.private_key as string;

  if (!escrowId || !privateKey) {
    return errorResult('escrow_id and private_key are required');
  }

  return safeHandler(async () => {
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    const escrowService = getEscrowService();
    const result = await escrowService.release(escrowId, keypair);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      signature: result.signature,
      message: 'Funds released to seller',
    };
  });
}

async function acpRefundEscrowHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const escrowId = toolInput.escrow_id as string;
  const privateKey = toolInput.private_key as string;

  if (!escrowId || !privateKey) {
    return errorResult('escrow_id and private_key are required');
  }

  return safeHandler(async () => {
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    const escrowService = getEscrowService();
    const result = await escrowService.refund(escrowId, keypair);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      signature: result.signature,
      message: 'Funds refunded to buyer',
    };
  });
}

async function acpGetEscrowHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const escrowId = toolInput.escrow_id as string;

  if (!escrowId) {
    return errorResult('escrow_id is required');
  }

  return safeHandler(async () => {
    const escrowService = getEscrowService();
    const escrow = await escrowService.get(escrowId);

    if (!escrow) {
      return { error: 'Escrow not found' };
    }

    const solAmount = (Number(escrow.amount) / LAMPORTS_PER_SOL).toFixed(4);
    return {
      id: escrow.id,
      status: escrow.status,
      amount: solAmount,
      buyer: escrow.buyer.slice(0, 8) + '...',
      seller: escrow.seller.slice(0, 8) + '...',
      escrowAddress: escrow.escrowAddress,
    };
  });
}

async function acpListEscrowsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const address = toolInput.address as string;

  if (!address) {
    return errorResult('address is required');
  }

  return safeHandler(async () => {
    const escrowService = getEscrowService();
    const list = await escrowService.list(address);
    return {
      count: list.length,
      escrows: list.slice(0, 10).map(e => {
        const solAmount = (Number(e.amount) / LAMPORTS_PER_SOL).toFixed(4);
        return {
          id: e.id,
          status: e.status,
          amount: solAmount,
          buyer: e.buyer.slice(0, 8) + '...',
          seller: e.seller.slice(0, 8) + '...',
        };
      }),
    };
  });
}

// ============================================================================
// Identity Handlers
// ============================================================================

import { getIdentityService, validateHandle } from '../../acp/identity';

async function acpRegisterHandleHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const handle = toolInput.handle as string;
  const agentId = toolInput.agent_id as string;
  const ownerAddress = toolInput.owner_address as string;

  if (!handle || !agentId || !ownerAddress) {
    return errorResult('handle, agent_id, and owner_address are required');
  }

  return safeHandler(async () => {
    const identity = getIdentityService();
    const result = await identity.handles.register(handle, agentId, ownerAddress);
    return {
      handle: `@${result.handle}`,
      agentId: result.agentId,
      ownerAddress: result.ownerAddress.slice(0, 8) + '...',
      url: `https://clodds.com/@${result.handle}`,
    };
  });
}

async function acpGetHandleHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const handle = toolInput.handle as string;

  if (!handle) {
    return errorResult('handle is required');
  }

  return safeHandler(async () => {
    const identity = getIdentityService();
    const result = await identity.handles.get(handle);
    if (!result) {
      return { error: 'Handle not found' };
    }
    return {
      handle: `@${result.handle}`,
      agentId: result.agentId,
      ownerAddress: result.ownerAddress.slice(0, 8) + '...',
      createdAt: new Date(result.createdAt).toISOString(),
      transferred: !!result.transferredAt,
    };
  });
}

async function acpCheckHandleHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const handle = toolInput.handle as string;

  if (!handle) {
    return errorResult('handle is required');
  }

  return safeHandler(async () => {
    const validation = validateHandle(handle);
    if (!validation.valid) {
      return { available: false, reason: validation.error };
    }

    const identity = getIdentityService();
    const available = await identity.handles.isAvailable(handle);
    return {
      handle: handle.toLowerCase().replace(/^@/, ''),
      available,
      suggestion: available ? null : `${handle}_${Date.now() % 1000}`,
    };
  });
}

async function acpCreateBidHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const handle = toolInput.handle as string;
  const bidderAddress = toolInput.bidder_address as string;
  const amount = toolInput.amount as string;
  const currency = toolInput.currency as string || 'SOL';

  if (!handle || !bidderAddress || !amount) {
    return errorResult('handle, bidder_address, and amount are required');
  }

  return safeHandler(async () => {
    const identity = getIdentityService();
    const bid = await identity.takeovers.createBid(handle, bidderAddress, amount, currency);
    return {
      id: bid.id,
      handle: `@${bid.handle}`,
      amount: bid.amount,
      currency: bid.currency,
      status: bid.status,
      expiresAt: new Date(bid.expiresAt).toISOString(),
      escrowId: bid.escrowId,
    };
  });
}

async function acpAcceptBidHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const bidId = toolInput.bid_id as string;
  const ownerAddress = toolInput.owner_address as string;

  if (!bidId || !ownerAddress) {
    return errorResult('bid_id and owner_address are required');
  }

  return safeHandler(async () => {
    const identity = getIdentityService();
    const { bid, handle } = await identity.takeovers.acceptBid(bidId, ownerAddress);
    return {
      success: true,
      handle: `@${handle.handle}`,
      newOwner: handle.ownerAddress.slice(0, 8) + '...',
      amount: bid.amount,
      currency: bid.currency,
    };
  });
}

async function acpRejectBidHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const bidId = toolInput.bid_id as string;
  const ownerAddress = toolInput.owner_address as string;

  if (!bidId || !ownerAddress) {
    return errorResult('bid_id and owner_address are required');
  }

  return safeHandler(async () => {
    const identity = getIdentityService();
    const bid = await identity.takeovers.rejectBid(bidId, ownerAddress);
    return {
      id: bid.id,
      status: bid.status,
      message: 'Bid rejected, funds refunded to bidder',
    };
  });
}

async function acpListBidsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const handle = toolInput.handle as string | undefined;
  const bidderAddress = toolInput.bidder_address as string | undefined;

  if (!handle && !bidderAddress) {
    return errorResult('Either handle or bidder_address is required');
  }

  return safeHandler(async () => {
    const identity = getIdentityService();
    let bids;

    if (handle) {
      bids = await identity.takeovers.getBidsForHandle(handle);
    } else {
      bids = await identity.takeovers.getBidsByBidder(bidderAddress!);
    }

    return {
      count: bids.length,
      bids: bids.slice(0, 10).map(b => ({
        id: b.id,
        handle: `@${b.handle}`,
        amount: b.amount,
        currency: b.currency,
        status: b.status,
        expiresAt: new Date(b.expiresAt).toISOString(),
      })),
    };
  });
}

async function acpGetReferralCodeHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const referrerAddress = toolInput.referrer_address as string;

  if (!referrerAddress) {
    return errorResult('referrer_address is required');
  }

  return safeHandler(async () => {
    const identity = getIdentityService();
    const code = await identity.referrals.createCode(referrerAddress);
    return {
      code,
      shareUrl: `https://clodds.com/join?ref=${code}`,
      feeShare: '5%',
    };
  });
}

async function acpUseReferralCodeHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const code = toolInput.code as string;
  const agentId = toolInput.agent_id as string;

  if (!code || !agentId) {
    return errorResult('code and agent_id are required');
  }

  return safeHandler(async () => {
    const identity = getIdentityService();
    const referral = await identity.referrals.useCode(code, agentId);
    return {
      success: true,
      referrerAddress: referral.referrerAddress.slice(0, 8) + '...',
      feeShare: `${referral.feeShareBps / 100}%`,
    };
  });
}

async function acpGetReferralStatsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const referrerAddress = toolInput.referrer_address as string;

  if (!referrerAddress) {
    return errorResult('referrer_address is required');
  }

  return safeHandler(async () => {
    const identity = getIdentityService();
    const stats = await identity.referrals.getReferralStats(referrerAddress);
    return {
      totalReferred: stats.totalReferred,
      totalEarned: stats.totalEarned,
    };
  });
}

async function acpGetProfileHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const agentId = toolInput.agent_id as string | undefined;
  const handle = toolInput.handle as string | undefined;

  if (!agentId && !handle) {
    return errorResult('Either agent_id or handle is required');
  }

  return safeHandler(async () => {
    const identity = getIdentityService();
    let profile;

    if (handle) {
      profile = await identity.profiles.getByHandle(handle);
    } else {
      profile = await identity.profiles.get(agentId!);
    }

    if (!profile) {
      return { error: 'Profile not found' };
    }

    return {
      agentId: profile.agentId,
      handle: profile.handle ? `@${profile.handle}` : null,
      displayName: profile.displayName,
      bio: profile.bio,
      verified: profile.verified,
      featured: profile.featured,
      totalRevenue: profile.totalRevenue,
      totalTransactions: profile.totalTransactions,
      socials: {
        twitter: profile.twitterHandle,
        github: profile.githubHandle,
        website: profile.websiteUrl,
      },
    };
  });
}

async function acpUpdateProfileHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const agentId = toolInput.agent_id as string;
  const displayName = toolInput.display_name as string | undefined;
  const bio = toolInput.bio as string | undefined;
  const avatarUrl = toolInput.avatar_url as string | undefined;
  const websiteUrl = toolInput.website_url as string | undefined;
  const twitterHandle = toolInput.twitter_handle as string | undefined;
  const githubHandle = toolInput.github_handle as string | undefined;

  if (!agentId) {
    return errorResult('agent_id is required');
  }

  return safeHandler(async () => {
    const identity = getIdentityService();
    const profile = await identity.profiles.update(agentId, {
      displayName,
      bio,
      avatarUrl,
      websiteUrl,
      twitterHandle,
      githubHandle,
    });
    return {
      agentId: profile.agentId,
      displayName: profile.displayName,
      updated: true,
    };
  });
}

async function acpGetLeaderboardHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const count = toolInput.count as number || 10;
  const period = toolInput.period as string || 'all_time';

  return safeHandler(async () => {
    const identity = getIdentityService();
    const entries = await identity.leaderboard.getTop(count, period);
    return {
      period,
      entries: entries.map((e, i) => ({
        rank: i + 1,
        agentId: e.agentId,
        handle: e.handle ? `@${e.handle}` : null,
        score: Math.round(e.score * 1000) / 1000,
        rankRevenue: e.rankRevenue,
        rankTransactions: e.rankTransactions,
        rankRating: e.rankRating,
      })),
    };
  });
}

// ============================================================================
// Prediction Handlers
// ============================================================================

import { getPredictionService, interpretBrierScore, type MarketCategory } from '../../acp/predictions';

async function acpSubmitPredictionHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const agentId = toolInput.agent_id as string;
  const marketSlug = toolInput.market_slug as string;
  const marketTitle = toolInput.market_title as string;
  const marketCategory = toolInput.market_category as MarketCategory | undefined;
  const probability = toolInput.probability as number;
  const rationale = toolInput.rationale as string;

  if (!agentId || !marketSlug || !marketTitle || probability === undefined || !rationale) {
    return errorResult('agent_id, market_slug, market_title, probability, and rationale are required');
  }

  return safeHandler(async () => {
    const predictions = getPredictionService();
    const prediction = await predictions.submit(
      agentId,
      { slug: marketSlug, title: marketTitle, category: marketCategory },
      probability,
      rationale
    );
    return {
      id: prediction.id,
      marketSlug: prediction.marketSlug,
      probability: prediction.probability,
      probabilityPct: `${Math.round(prediction.probability * 100)}%`,
      rationalePreview: prediction.rationale.slice(0, 100) + (prediction.rationale.length > 100 ? '...' : ''),
    };
  });
}

async function acpGetPredictionHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const predictionId = toolInput.prediction_id as string;

  if (!predictionId) {
    return errorResult('prediction_id is required');
  }

  return safeHandler(async () => {
    const predictions = getPredictionService();
    const prediction = await predictions.get(predictionId);
    if (!prediction) {
      return { error: 'Prediction not found' };
    }
    return {
      id: prediction.id,
      agentId: prediction.agentId,
      market: {
        slug: prediction.marketSlug,
        title: prediction.marketTitle,
        category: prediction.marketCategory,
      },
      probability: prediction.probability,
      probabilityPct: `${Math.round(prediction.probability * 100)}%`,
      rationale: prediction.rationale,
      resolved: prediction.outcome !== undefined,
      outcome: prediction.outcome === 1 ? 'YES' : prediction.outcome === 0 ? 'NO' : null,
      brierContribution: prediction.brierContribution,
      createdAt: new Date(prediction.createdAt).toISOString(),
    };
  });
}

async function acpGetPredictionsByAgentHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const agentId = toolInput.agent_id as string;
  const limit = toolInput.limit as number || 20;

  if (!agentId) {
    return errorResult('agent_id is required');
  }

  return safeHandler(async () => {
    const predictions = getPredictionService();
    const list = await predictions.getByAgent(agentId, limit);
    return {
      count: list.length,
      predictions: list.map(p => ({
        id: p.id,
        market: p.marketTitle,
        probability: `${Math.round(p.probability * 100)}%`,
        resolved: p.outcome !== undefined,
        outcome: p.outcome === 1 ? 'YES' : p.outcome === 0 ? 'NO' : null,
        brierContribution: p.brierContribution,
      })),
    };
  });
}

async function acpGetPredictionsByMarketHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketSlug = toolInput.market_slug as string;

  if (!marketSlug) {
    return errorResult('market_slug is required');
  }

  return safeHandler(async () => {
    const predictions = getPredictionService();
    const list = await predictions.getByMarket(marketSlug);
    return {
      marketSlug,
      count: list.length,
      predictions: list.map(p => ({
        id: p.id,
        agentId: p.agentId,
        probability: `${Math.round(p.probability * 100)}%`,
        rationalePreview: p.rationale.length > 80 ? p.rationale.slice(0, 80) + '...' : p.rationale,
        createdAt: new Date(p.createdAt).toISOString(),
      })),
      consensus: list.length > 0
        ? `${Math.round(list.reduce((sum, p) => sum + p.probability, 0) / list.length * 100)}%`
        : null,
    };
  });
}

async function acpGetPredictionFeedHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const limit = toolInput.limit as number || 20;
  const category = toolInput.category as MarketCategory | undefined;

  return safeHandler(async () => {
    const predictions = getPredictionService();
    const feed = await predictions.getFeed(limit, category);
    return {
      count: feed.length,
      feed: feed.map(p => ({
        id: p.id,
        agent: p.agentHandle ? `@${p.agentHandle}` : p.agentId.slice(0, 8) + '...',
        market: p.marketTitle,
        category: p.marketCategory,
        probability: `${Math.round(p.probability * 100)}%`,
        rationalePreview: p.rationale.length > 100 ? p.rationale.slice(0, 100) + '...' : p.rationale,
        time: new Date(p.createdAt).toISOString(),
      })),
    };
  });
}

async function acpResolveMarketHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const marketSlug = toolInput.market_slug as string;
  const outcome = toolInput.outcome as number;

  if (!marketSlug || (outcome !== 0 && outcome !== 1)) {
    return errorResult('market_slug and outcome (0 or 1) are required');
  }

  return safeHandler(async () => {
    const predictions = getPredictionService();
    const count = await predictions.resolve(marketSlug, outcome as 0 | 1);
    return {
      marketSlug,
      outcome: outcome === 1 ? 'YES' : 'NO',
      predictionsResolved: count,
    };
  });
}

async function acpGetPredictionStatsHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const agentId = toolInput.agent_id as string;

  if (!agentId) {
    return errorResult('agent_id is required');
  }

  return safeHandler(async () => {
    const predictions = getPredictionService();
    const stats = await predictions.getStats(agentId);
    if (!stats) {
      return { error: 'No prediction stats found for agent' };
    }
    return {
      agentId: stats.agentId,
      totalPredictions: stats.totalPredictions,
      resolvedPredictions: stats.resolvedPredictions,
      correctPredictions: stats.correctPredictions,
      accuracy: stats.accuracy ? `${Math.round(stats.accuracy * 100)}%` : null,
      brierScore: stats.brierScore,
      brierRating: stats.brierScore ? interpretBrierScore(stats.brierScore) : null,
      bestCategory: stats.bestCategory,
      worstCategory: stats.worstCategory,
      streak: {
        current: stats.streakCurrent,
        best: stats.streakBest,
      },
    };
  });
}

async function acpGetPredictionLeaderboardHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const limit = toolInput.limit as number || 10;

  return safeHandler(async () => {
    const predictions = getPredictionService();
    const leaders = await predictions.getLeaderboard(limit);
    return {
      minResolved: 5,
      count: leaders.length,
      leaderboard: leaders.map((l, i) => ({
        rank: i + 1,
        agent: l.handle ? `@${l.handle}` : l.agentId.slice(0, 12) + '...',
        brierScore: l.brierScore ? Math.round(l.brierScore * 1000) / 1000 : null,
        brierRating: l.brierScore ? interpretBrierScore(l.brierScore) : null,
        accuracy: l.accuracy ? `${Math.round(l.accuracy * 100)}%` : null,
        resolved: l.resolvedPredictions,
        total: l.totalPredictions,
      })),
    };
  });
}

// ============================================================================
// Rating Handlers
// ============================================================================

async function acpRateServiceHandler(toolInput: ToolInput): Promise<HandlerResult> {
  const serviceId = toolInput.service_id as string;
  const raterAddress = toolInput.rater_address as string;
  const rating = toolInput.rating as number;
  const review = toolInput.review as string | undefined;

  if (!serviceId || !raterAddress || rating === undefined) {
    return errorResult('service_id, rater_address, and rating are required');
  }

  if (rating < 1 || rating > 5) {
    return errorResult('rating must be between 1 and 5');
  }

  return safeHandler(async () => {
    const registry = getRegistryService();
    const result = await registry.rateService(serviceId, raterAddress, rating, review);
    return {
      id: result.id,
      serviceId: result.serviceId,
      rating: result.rating,
      hasReview: !!result.review,
    };
  });
}

// ============================================================================
// Export Handlers Map
// ============================================================================

export const acpHandlers: HandlersMap = {
  // Agent registration
  acp_register_agent: acpRegisterAgentHandler,
  acp_list_service: acpListServiceHandler,
  acp_get_agent: acpGetAgentHandler,

  // Discovery
  acp_search_services: acpSearchServicesHandler,
  acp_discover: acpDiscoverHandler,
  acp_quick_hire: acpQuickHireHandler,

  // Agreements
  acp_create_agreement: acpCreateAgreementHandler,
  acp_sign_agreement: acpSignAgreementHandler,
  acp_get_agreement: acpGetAgreementHandler,
  acp_list_agreements: acpListAgreementsHandler,

  // Escrow
  acp_create_escrow: acpCreateEscrowHandler,
  acp_fund_escrow: acpFundEscrowHandler,
  acp_release_escrow: acpReleaseEscrowHandler,
  acp_refund_escrow: acpRefundEscrowHandler,
  acp_get_escrow: acpGetEscrowHandler,
  acp_list_escrows: acpListEscrowsHandler,

  // Ratings
  acp_rate_service: acpRateServiceHandler,

  // Identity - Handles
  acp_register_handle: acpRegisterHandleHandler,
  acp_get_handle: acpGetHandleHandler,
  acp_check_handle: acpCheckHandleHandler,

  // Identity - Takeovers
  acp_create_bid: acpCreateBidHandler,
  acp_accept_bid: acpAcceptBidHandler,
  acp_reject_bid: acpRejectBidHandler,
  acp_list_bids: acpListBidsHandler,

  // Identity - Referrals
  acp_get_referral_code: acpGetReferralCodeHandler,
  acp_use_referral_code: acpUseReferralCodeHandler,
  acp_get_referral_stats: acpGetReferralStatsHandler,

  // Identity - Profiles
  acp_get_profile: acpGetProfileHandler,
  acp_update_profile: acpUpdateProfileHandler,

  // Identity - Leaderboard
  acp_get_leaderboard: acpGetLeaderboardHandler,

  // Predictions
  acp_submit_prediction: acpSubmitPredictionHandler,
  acp_get_prediction: acpGetPredictionHandler,
  acp_get_predictions_by_agent: acpGetPredictionsByAgentHandler,
  acp_get_predictions_by_market: acpGetPredictionsByMarketHandler,
  acp_get_prediction_feed: acpGetPredictionFeedHandler,
  acp_resolve_market: acpResolveMarketHandler,
  acp_get_prediction_stats: acpGetPredictionStatsHandler,
  acp_get_prediction_leaderboard: acpGetPredictionLeaderboardHandler,
};
