/**
 * Percolator instruction encoders — subset for trading operations.
 * Adapted from percolator-cli/src/abi/instructions.ts
 */

import { encU8, encU16, encU64, encI128 } from './encode.js';

const IX_TAG = {
  InitUser: 1,
  DepositCollateral: 3,
  WithdrawCollateral: 4,
  KeeperCrank: 5,
  TradeCpi: 10,
} as const;

export interface InitUserArgs {
  feePayment: bigint | string;
}

export function encodeInitUser(args: InitUserArgs): Buffer {
  return Buffer.concat([encU8(IX_TAG.InitUser), encU64(args.feePayment)]);
}

export interface DepositCollateralArgs {
  userIdx: number;
  amount: bigint | string;
}

export function encodeDepositCollateral(args: DepositCollateralArgs): Buffer {
  return Buffer.concat([
    encU8(IX_TAG.DepositCollateral),
    encU16(args.userIdx),
    encU64(args.amount),
  ]);
}

export interface WithdrawCollateralArgs {
  userIdx: number;
  amount: bigint | string;
}

export function encodeWithdrawCollateral(args: WithdrawCollateralArgs): Buffer {
  return Buffer.concat([
    encU8(IX_TAG.WithdrawCollateral),
    encU16(args.userIdx),
    encU64(args.amount),
  ]);
}

export interface KeeperCrankArgs {
  callerIdx: number;
  allowPanic: boolean;
}

export function encodeKeeperCrank(args: KeeperCrankArgs): Buffer {
  return Buffer.concat([
    encU8(IX_TAG.KeeperCrank),
    encU16(args.callerIdx),
    encU8(args.allowPanic ? 1 : 0),
  ]);
}

export interface TradeCpiArgs {
  lpIdx: number;
  userIdx: number;
  size: bigint | string;
}

export function encodeTradeCpi(args: TradeCpiArgs): Buffer {
  return Buffer.concat([
    encU8(IX_TAG.TradeCpi),
    encU16(args.lpIdx),
    encU16(args.userIdx),
    encI128(args.size),
  ]);
}
