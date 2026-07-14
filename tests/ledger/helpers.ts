import Decimal from "decimal.js";
import type { LegType, TransactionKind, TransactionLeg } from "@/lib/ledger/types";

export function mkAssetLeg(params: {
  transactionId: string;
  transactionType: TransactionKind;
  executedAt: Date;
  assetId: string;
  quantityDelta: Decimal.Value;
  gbpValue: Decimal.Value;
  currency?: string;
}): TransactionLeg {
  return {
    transactionId: params.transactionId,
    transactionType: params.transactionType,
    executedAt: params.executedAt,
    assetId: params.assetId,
    currency: params.currency ?? "GBP",
    quantityDelta: new Decimal(params.quantityDelta),
    cashDelta: null,
    gbpValue: new Decimal(params.gbpValue),
    legType: "asset",
  };
}

export function mkCashLeg(params: {
  transactionId: string;
  transactionType: TransactionKind;
  executedAt: Date;
  cashDelta: Decimal.Value;
  gbpValue: Decimal.Value;
  currency?: string;
  legType?: LegType;
}): TransactionLeg {
  return {
    transactionId: params.transactionId,
    transactionType: params.transactionType,
    executedAt: params.executedAt,
    assetId: null,
    currency: params.currency ?? "GBP",
    quantityDelta: null,
    cashDelta: new Decimal(params.cashDelta),
    gbpValue: new Decimal(params.gbpValue),
    legType: params.legType ?? "cash",
  };
}
