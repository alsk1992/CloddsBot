/**
 * Trading Types - Type definitions for trading operations
 *
 * Note: Actual trading is done via Python scripts called directly from agents.
 * See /trading/polymarket.py and /trading/kalshi.py for implementations.
 */

import type { Platform } from '../types';

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'GTC' | 'FOK' | 'GTD';

export interface OrderRequest {
  platform: Platform;
  marketId: string;
  tokenId: string;
  side: OrderSide;
  size: number;
  price: number;
  orderType?: OrderType;
  expiration?: number;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  filledSize?: number;
  filledPrice?: number;
  status: 'filled' | 'partial' | 'open' | 'cancelled' | 'failed';
  error?: string;
  transactionHash?: string;
}

export interface TradeExecution {
  orderId: string;
  platform: Platform;
  marketId: string;
  tokenId: string;
  side: OrderSide;
  size: number;
  price: number;
  fee: number;
  timestamp: Date;
  transactionHash?: string;
}

export interface TradingConfig {
  polymarket?: {
    privateKey: string;
    funderAddress: string;
    apiKey: string;
    apiSecret: string;
    apiPassphrase: string;
  };
  kalshi?: {
    email: string;
    password: string;
  };
  manifold?: {
    apiKey: string;
  };
  maxOrderSize: number;
  maxDailyLoss: number;
  dryRun: boolean;
}
