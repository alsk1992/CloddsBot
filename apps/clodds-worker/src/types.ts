/**
 * Shared types for Clodds Worker
 */

export type Platform = 'polymarket' | 'kalshi' | 'manifold' | 'metaculus' | 'predictit';

export interface Outcome {
  id: string;
  tokenId?: string;
  name: string;
  price: number;
}

export interface Market {
  id: string;
  platform: Platform;
  slug: string;
  question: string;
  description?: string;
  outcomes: Outcome[];
  volume24h: number;
  liquidity: number;
  endDate?: string;
  resolved: boolean;
  url: string;
}

export interface Orderbook {
  platform: Platform;
  marketId: string;
  bids: Array<[number, number]>; // [price, size]
  asks: Array<[number, number]>;
  spread: number;
  midPrice: number;
  timestamp: number;
}

export interface PriceUpdate {
  platform: Platform;
  marketId: string;
  outcomeId: string;
  price: number;
  previousPrice?: number;
  timestamp: number;
}

export interface Alert {
  id: string;
  userId: string;
  platform: Platform;
  marketId: string;
  marketName?: string;
  conditionType: 'price_above' | 'price_below' | 'price_change_pct';
  threshold: number;
  triggered: boolean;
  triggeredAt?: number;
  createdAt: number;
}

export interface Position {
  id: string;
  userId: string;
  platform: Platform;
  marketId: string;
  marketQuestion?: string;
  outcome: string;
  side: 'YES' | 'NO';
  shares: number;
  avgPrice: number;
  createdAt: number;
  updatedAt: number;
}

export interface User {
  id: string;
  platform: string;
  platformUserId: string;
  username?: string;
  settings: UserSettings;
  createdAt: number;
  lastActiveAt: number;
}

export interface UserSettings {
  alertsEnabled?: boolean;
  defaultPlatforms?: Platform[];
}

export interface ArbitrageOpportunity {
  id: string;
  platform: Platform;
  marketId: string;
  marketQuestion?: string;
  yesPrice: number;
  noPrice: number;
  edgePct: number;
  mode: 'internal' | 'cross';
  foundAt: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface SessionState {
  userId: string;
  platform: string;
  chatId: string;
  history: ConversationMessage[];
  lastActivity: number;
  messageCount: number;
}

// Telegram types
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: TelegramVoice;
  caption?: string;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

export interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

// Discord types
export interface DiscordInteraction {
  id: string;
  type: number;
  application_id: string;
  data?: DiscordInteractionData;
  guild_id?: string;
  channel_id?: string;
  member?: DiscordMember;
  user?: DiscordUser;
  token: string;
}

export interface DiscordInteractionData {
  id: string;
  name: string;
  type: number;
  options?: DiscordOption[];
}

export interface DiscordOption {
  name: string;
  type: number;
  value?: string | number | boolean;
}

export interface DiscordMember {
  user: DiscordUser;
  nick?: string;
}

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
}

// Slack types
export interface SlackEvent {
  token: string;
  team_id?: string;
  type: string;
  challenge?: string;
  event?: SlackEventPayload;
}

export interface SlackEventPayload {
  type: string;
  user: string;
  channel: string;
  text?: string;
  ts: string;
  thread_ts?: string;
}
