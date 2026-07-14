import { z } from "zod";

/**
 * Schemas mirror Trading 212's public API response shapes. Verified
 * against a real demo account on 2026-07-14 — the community-maintained
 * bennycode/trading212-api client this was originally based on turned out
 * stale for the orders endpoint specifically (wrong auth scheme entirely,
 * and a flat order shape instead of the real {order, fill} wrapper).
 * account/cash, account/info, transactions, and the pagination envelope
 * matched the reference client and are confirmed correct. Dividends is
 * still unverified — no dividend events existed on the test account.
 */

export const T212AccountCashSchema = z.object({
  blocked: z.number().nullable(),
  free: z.number(),
  invested: z.number(),
  pieCash: z.number(),
  ppl: z.number(),
  result: z.number(),
  total: z.number(),
});
export type T212AccountCash = z.infer<typeof T212AccountCashSchema>;

export const T212AccountInfoSchema = z.object({
  currencyCode: z.string(),
  id: z.number(),
});
export type T212AccountInfo = z.infer<typeof T212AccountInfoSchema>;

export const T212PositionSchema = z.object({
  averagePrice: z.number(),
  currentPrice: z.number(),
  fxPpl: z.number().nullable(),
  initialFillDate: z.string(),
  maxBuy: z.number(),
  maxSell: z.number(),
  pieQuantity: z.number(),
  ppl: z.number(),
  quantity: z.number(),
  /** e.g. "AAPL_US_EQ" */
  ticker: z.string(),
});
export type T212Position = z.infer<typeof T212PositionSchema>;

export const T212OrderDetailSchema = z.object({
  id: z.number(),
  strategy: z.enum(["QUANTITY", "VALUE"]),
  type: z.string(),
  ticker: z.string(),
  /** Present for QUANTITY-strategy orders; VALUE-strategy orders only have value/filledValue. */
  quantity: z.number().nullable().optional(),
  filledQuantity: z.number().nullable().optional(),
  value: z.number().nullable().optional(),
  filledValue: z.number().nullable().optional(),
  status: z.string(),
  currency: z.string(),
  side: z.enum(["BUY", "SELL"]),
  createdAt: z.string(),
  instrument: z.object({
    ticker: z.string(),
    name: z.string(),
    isin: z.string(),
    currency: z.string(),
  }),
});

export const T212FillTaxSchema = z.object({
  name: z.string(),
  /** Negative — the amount charged. */
  quantity: z.number(),
  currency: z.string(),
  chargedAt: z.string(),
});

export const T212WalletImpactSchema = z.object({
  currency: z.string(),
  /** Net cash impact in account currency, already inclusive of fees/taxes. */
  netValue: z.number(),
  realisedProfitLoss: z.number().nullable().optional(),
  fxRate: z.number().nullable().optional(),
  taxes: z.array(T212FillTaxSchema),
});

export const T212FillSchema = z.object({
  id: z.number(),
  /** Signed — matches order.side's direction. The authoritative filled quantity, including for VALUE-strategy orders where order.filledQuantity is absent. */
  quantity: z.number(),
  price: z.number(),
  type: z.string(),
  tradingMethod: z.string(),
  filledAt: z.string(),
  walletImpact: T212WalletImpactSchema,
});

/**
 * Each history item wraps the order and its fill separately — not a flat
 * object. fill is absent for orders that never executed (cancelled,
 * rejected, etc.).
 */
export const T212OrderSchema = z.object({
  order: T212OrderDetailSchema,
  fill: T212FillSchema.nullable().optional(),
});
export type T212Order = z.infer<typeof T212OrderSchema>;

export const T212DividendSchema = z.object({
  amount: z.number(),
  amountInEuro: z.number(),
  grossAmountPerShare: z.number(),
  paidOn: z.string(),
  quantity: z.number(),
  reference: z.string(),
  ticker: z.string(),
  type: z.string(),
});
export type T212Dividend = z.infer<typeof T212DividendSchema>;

export const T212TransactionSchema = z.object({
  amount: z.number(),
  dateTime: z.string(),
  reference: z.string(),
  type: z.string(),
});
export type T212Transaction = z.infer<typeof T212TransactionSchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextPagePath: z.string().nullable(),
  });
}
