import type { HandlerContext, HandlerResult } from './types';
import { errorResult } from './types';
import { validatePreTrade } from '../../trading/pre-trade';

export function guardTrade(
  context: HandlerContext,
  label: string,
  notionalUsd?: number,
  options: { requireNotional?: boolean; skipSizeLimit?: boolean } = {}
): HandlerResult | null {
  const error = validatePreTrade({
    label,
    notionalUsd,
    maxOrderSize: context.tradingContext?.maxOrderSize,
    requireNotional: options.requireNotional,
    skipSizeLimit: options.skipSizeLimit,
  });
  return error ? errorResult(error) : null;
}

