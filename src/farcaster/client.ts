/**
 * Farcaster Client (via Neynar API)
 *
 * Full Farcaster interaction: read feeds, search, post casts, follow users.
 * API Docs: https://docs.neynar.com
 */

import { logger } from '../utils/logger';

// =============================================================================
// Types
// =============================================================================

export interface NeynarConfig {
  apiKey: string;
  signerUuid?: string;
  baseUrl?: string;
}

export interface FarcasterUser {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl?: string;
  bio?: string;
  followerCount: number;
  followingCount: number;
  verifiedAddresses?: {
    ethAddresses: string[];
    solAddresses: string[];
  };
  activeStatus?: string;
}

export interface Cast {
  hash: string;
  text: string;
  author: FarcasterUser;
  timestamp: string;
  replies: { count: number };
  reactions: { likes: number; recasts: number };
  embeds?: Array<{ url?: string }>;
  parentHash?: string;
  parentUrl?: string;
  channel?: { id: string; name: string };
}

export interface Channel {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  followerCount: number;
  leadFid?: number;
}

export interface FeedOptions {
  limit?: number;
  cursor?: string;
  channel?: string;
  fid?: number;
}

export interface SearchOptions {
  limit?: number;
  cursor?: string;
}

export interface PostOptions {
  parentHash?: string;
  channelId?: string;
  embeds?: Array<{ url: string }>;
}

// =============================================================================
// Client Implementation
// =============================================================================

export class NeynarClient {
  private apiKey: string;
  private signerUuid?: string;
  private baseUrl: string;

  constructor(config: NeynarConfig) {
    this.apiKey = config.apiKey;
    this.signerUuid = config.signerUuid;
    this.baseUrl = config.baseUrl || 'https://api.neynar.com/v2';
  }

  // ===========================================================================
  // Users
  // ===========================================================================

  async getUserByUsername(username: string): Promise<FarcasterUser> {
    const response = await this.request(`/farcaster/user/by_username?username=${encodeURIComponent(username)}`);
    return this.mapUser(response.user);
  }

  async getUserByFid(fid: number): Promise<FarcasterUser> {
    const response = await this.request(`/farcaster/user/bulk?fids=${fid}`);
    if (!response.users || response.users.length === 0) {
      throw new Error(`User not found: ${fid}`);
    }
    return this.mapUser(response.users[0]);
  }

  async searchUsers(query: string, limit: number = 10): Promise<FarcasterUser[]> {
    const response = await this.request(`/farcaster/user/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    return (response.result?.users || []).map(this.mapUser);
  }

  // ===========================================================================
  // Casts
  // ===========================================================================

  async getCast(hash: string): Promise<Cast> {
    const response = await this.request(`/farcaster/cast?identifier=${hash}&type=hash`);
    return this.mapCast(response.cast);
  }

  async getCastsByFid(fid: number, options: FeedOptions = {}): Promise<Cast[]> {
    const params = new URLSearchParams();
    params.set('fid', fid.toString());
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.cursor) params.set('cursor', options.cursor);

    const response = await this.request(`/farcaster/feed/user/casts?${params}`);
    return (response.casts || []).map(this.mapCast);
  }

  async searchCasts(query: string, options: SearchOptions = {}): Promise<Cast[]> {
    const params = new URLSearchParams();
    params.set('q', query);
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.cursor) params.set('cursor', options.cursor);

    const response = await this.request(`/farcaster/cast/search?${params}`);
    return (response.result?.casts || []).map(this.mapCast);
  }

  // ===========================================================================
  // Feeds
  // ===========================================================================

  async getHomeFeed(fid: number, options: FeedOptions = {}): Promise<Cast[]> {
    const params = new URLSearchParams();
    params.set('fid', fid.toString());
    params.set('feed_type', 'following');
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.cursor) params.set('cursor', options.cursor);

    const response = await this.request(`/farcaster/feed?${params}`);
    return (response.casts || []).map(this.mapCast);
  }

  async getChannelFeed(channelId: string, options: FeedOptions = {}): Promise<Cast[]> {
    const params = new URLSearchParams();
    params.set('channel_id', channelId);
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.cursor) params.set('cursor', options.cursor);

    const response = await this.request(`/farcaster/feed/channel?${params}`);
    return (response.casts || []).map(this.mapCast);
  }

  async getTrendingCasts(options: FeedOptions = {}): Promise<Cast[]> {
    const params = new URLSearchParams();
    params.set('feed_type', 'filter');
    params.set('filter_type', 'global_trending');
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.cursor) params.set('cursor', options.cursor);

    const response = await this.request(`/farcaster/feed?${params}`);
    return (response.casts || []).map(this.mapCast);
  }

  // ===========================================================================
  // Channels
  // ===========================================================================

  async getChannel(channelId: string): Promise<Channel> {
    const response = await this.request(`/farcaster/channel?id=${encodeURIComponent(channelId)}`);
    return this.mapChannel(response.channel);
  }

  async searchChannels(query: string, limit: number = 10): Promise<Channel[]> {
    const response = await this.request(`/farcaster/channel/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    return (response.channels || []).map(this.mapChannel);
  }

  async getTrendingChannels(limit: number = 10): Promise<Channel[]> {
    const response = await this.request(`/farcaster/channel/trending?limit=${limit}`);
    return (response.channels || []).map(this.mapChannel);
  }

  // ===========================================================================
  // Write Operations (require signer)
  // ===========================================================================

  async postCast(text: string, options: PostOptions = {}): Promise<Cast> {
    if (!this.signerUuid) {
      throw new Error('Signer UUID required for posting. Set NEYNAR_SIGNER_UUID.');
    }

    const body: any = {
      signer_uuid: this.signerUuid,
      text,
    };

    if (options.parentHash) {
      body.parent = options.parentHash;
    }
    if (options.channelId) {
      body.channel_id = options.channelId;
    }
    if (options.embeds && options.embeds.length > 0) {
      body.embeds = options.embeds;
    }

    const response = await this.request('/farcaster/cast', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return this.mapCast(response.cast);
  }

  async deleteCast(hash: string): Promise<void> {
    if (!this.signerUuid) {
      throw new Error('Signer UUID required for deleting.');
    }

    await this.request('/farcaster/cast', {
      method: 'DELETE',
      body: JSON.stringify({
        signer_uuid: this.signerUuid,
        target_hash: hash,
      }),
    });
  }

  async likeCast(hash: string): Promise<void> {
    if (!this.signerUuid) {
      throw new Error('Signer UUID required for reactions.');
    }

    await this.request('/farcaster/reaction', {
      method: 'POST',
      body: JSON.stringify({
        signer_uuid: this.signerUuid,
        reaction_type: 'like',
        target: hash,
      }),
    });
  }

  async recastCast(hash: string): Promise<void> {
    if (!this.signerUuid) {
      throw new Error('Signer UUID required for reactions.');
    }

    await this.request('/farcaster/reaction', {
      method: 'POST',
      body: JSON.stringify({
        signer_uuid: this.signerUuid,
        reaction_type: 'recast',
        target: hash,
      }),
    });
  }

  async followUser(targetFid: number): Promise<void> {
    if (!this.signerUuid) {
      throw new Error('Signer UUID required for following.');
    }

    await this.request('/farcaster/user/follow', {
      method: 'POST',
      body: JSON.stringify({
        signer_uuid: this.signerUuid,
        target_fids: [targetFid],
      }),
    });
  }

  async unfollowUser(targetFid: number): Promise<void> {
    if (!this.signerUuid) {
      throw new Error('Signer UUID required for unfollowing.');
    }

    await this.request('/farcaster/user/follow', {
      method: 'DELETE',
      body: JSON.stringify({
        signer_uuid: this.signerUuid,
        target_fids: [targetFid],
      }),
    });
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        accept: 'application/json',
        api_key: this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(error.message || `Neynar API error: ${response.status}`);
    }

    return response.json();
  }

  private mapUser = (u: any): FarcasterUser => ({
    fid: u.fid,
    username: u.username,
    displayName: u.display_name || u.username,
    pfpUrl: u.pfp_url,
    bio: u.profile?.bio?.text,
    followerCount: u.follower_count || 0,
    followingCount: u.following_count || 0,
    verifiedAddresses: u.verified_addresses,
    activeStatus: u.active_status,
  });

  private mapCast = (c: any): Cast => ({
    hash: c.hash,
    text: c.text,
    author: this.mapUser(c.author),
    timestamp: c.timestamp,
    replies: { count: c.replies?.count || 0 },
    reactions: {
      likes: c.reactions?.likes_count || 0,
      recasts: c.reactions?.recasts_count || 0,
    },
    embeds: c.embeds,
    parentHash: c.parent_hash,
    parentUrl: c.parent_url,
    channel: c.channel ? { id: c.channel.id, name: c.channel.name } : undefined,
  });

  private mapChannel = (ch: any): Channel => ({
    id: ch.id,
    name: ch.name,
    description: ch.description,
    imageUrl: ch.image_url,
    followerCount: ch.follower_count || 0,
    leadFid: ch.lead?.fid,
  });
}

// =============================================================================
// Factory
// =============================================================================

let defaultClient: NeynarClient | null = null;

export function getNeynarClient(config?: NeynarConfig): NeynarClient {
  if (config) {
    return new NeynarClient(config);
  }

  if (!defaultClient) {
    const apiKey = process.env.NEYNAR_API_KEY;
    if (!apiKey) {
      throw new Error('NEYNAR_API_KEY environment variable not set');
    }
    defaultClient = new NeynarClient({
      apiKey,
      signerUuid: process.env.NEYNAR_SIGNER_UUID,
    });
  }

  return defaultClient;
}
