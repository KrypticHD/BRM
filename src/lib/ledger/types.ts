import Decimal from "decimal.js";

export type LegType = "asset" | "cash" | "fee";

export type TransactionKind =
  | "buy"
  | "sell"
  | "dividend"
  | "transfer_in"
  | "transfer_out"
  | "fee"
  | "interest"
  | "fx"
  | "other";

/**
 * Sign convention for legs fed into the ledger engine:
 *  - quantityDelta / cashDelta carry the signed, native-unit change
 *    (positive = increases the position/cash, negative = decreases it).
 *  - gbpValue is always a non-negative magnitude, never signed. Direction
 *    for GBP math is derived from quantityDelta/cashDelta's sign and from
 *    transactionType (e.g. only a "sell" realises a gain; a transfer_out
 *    carries cost basis onward without booking one).
 *  - A transfer_in leg's gbpValue must equal the cost basis carried over
 *    from the paired transfer_out (not a fresh market-value cost basis) so
 *    that combined holdings across accounts are conserved.
 */
export interface TransactionLeg {
  transactionId: string;
  transactionType: TransactionKind;
  executedAt: Date;
  assetId: string | null;
  currency: string;
  quantityDelta: Decimal | null;
  cashDelta: Decimal | null;
  gbpValue: Decimal;
  legType: LegType;
}

export interface HoldingPosition {
  assetId: string;
  quantity: Decimal;
  costBasisGbp: Decimal;
  /** Per-unit average cost in GBP. Zero when quantity is zero. */
  averageCostGbp: Decimal;
}

export interface RealisedPlEvent {
  transactionId: string;
  assetId: string;
  quantitySold: Decimal;
  proceedsGbp: Decimal;
  costBasisRemovedGbp: Decimal;
  realisedPlGbp: Decimal;
}

export interface CashBalance {
  currency: string;
  amount: Decimal;
}
