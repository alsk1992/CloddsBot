import type { Platform, Position, UserSettings, User } from '../types';

export interface RiskContext {
  tradingContext?: {
    maxOrderSize?: number;
  } | null;
  db: {
    getUser: (userId: string) => User | undefined;
    getPositions: (userId: string) => Position[];
  };
}

export function enforceMaxOrderSize(
  context: RiskContext,
  notional: number,
  label: string
): string | null {
  const maxOrderSize = context.tradingContext?.maxOrderSize;
  if (!maxOrderSize || !Number.isFinite(notional)) return null;
  if (notional <= maxOrderSize) return null;
  return JSON.stringify({
    error: 'Order exceeds maxOrderSize',
    maxOrderSize,
    notional: Number(notional.toFixed(2)),
    currency: 'USD',
    detail: label,
    hint: 'Reduce size or update maxOrderSize in user settings.',
  });
}

export function enforceExposureLimits(
  context: RiskContext,
  userId: string,
  params: {
    platform: Platform;
    marketId?: string;
    outcomeId?: string;
    notional: number;
    label: string;
  }
): string | null {
  if (!Number.isFinite(params.notional) || params.notional <= 0) return null;

  const user = context.db.getUser(userId);
  const settings: Partial<UserSettings> = user?.settings ?? {};
  let maxPositionValue = typeof settings.maxPositionValue === 'number' ? settings.maxPositionValue : undefined;
  const maxTotalExposure = typeof settings.maxTotalExposure === 'number' ? settings.maxTotalExposure : undefined;
  let stopLossPct = typeof settings.stopLossPct === 'number' ? settings.stopLossPct : undefined;

  if (!maxPositionValue && !maxTotalExposure && !stopLossPct) return null;

  if (stopLossPct && stopLossPct >= 1) {
    stopLossPct = stopLossPct / 100;
  }

  const positions = context.db.getPositions(userId);
  let totalExposure = 0;
  let positionExposure = 0;
  let positionAvgPrice: number | null = null;
  let positionCurrentPrice: number | null = null;

  for (const pos of positions) {
    const exposure = pos.shares * pos.avgPrice;
    totalExposure += exposure;

    const matchesPlatform = pos.platform === params.platform;
    const matchesOutcome = params.outcomeId ? pos.outcomeId === params.outcomeId : true;
    const matchesMarket = params.marketId ? pos.marketId === params.marketId : true;

    if (matchesPlatform && matchesOutcome && matchesMarket) {
      positionExposure += exposure;
      positionAvgPrice = pos.avgPrice;
      if (Number.isFinite(pos.currentPrice)) {
        positionCurrentPrice = pos.currentPrice;
      }
    }
  }

  if (maxTotalExposure && totalExposure + params.notional > maxTotalExposure) {
    return JSON.stringify({
      error: 'Order exceeds maxTotalExposure',
      maxTotalExposure,
      totalExposure: Number(totalExposure.toFixed(2)),
      proposedExposure: Number((totalExposure + params.notional).toFixed(2)),
      currency: 'USD',
      detail: params.label,
    });
  }

  if (maxPositionValue && (params.marketId || params.outcomeId)) {
    const nextExposure = positionExposure + params.notional;
    if (nextExposure > maxPositionValue) {
      return JSON.stringify({
        error: 'Order exceeds maxPositionValue',
        maxPositionValue,
        positionExposure: Number(positionExposure.toFixed(2)),
        proposedExposure: Number(nextExposure.toFixed(2)),
        currency: 'USD',
        detail: params.label,
      });
    }
  }

  if (stopLossPct && positionAvgPrice && positionCurrentPrice) {
    const threshold = positionAvgPrice * (1 - stopLossPct);
    if (positionCurrentPrice <= threshold) {
      return JSON.stringify({
        error: 'Stop-loss threshold breached',
        stopLossPct,
        avgPrice: Number(positionAvgPrice.toFixed(4)),
        currentPrice: Number(positionCurrentPrice.toFixed(4)),
        threshold: Number(threshold.toFixed(4)),
        detail: params.label,
        hint: 'Reduce exposure or update stopLossPct in user settings.',
      });
    }
  }

  return null;
}
