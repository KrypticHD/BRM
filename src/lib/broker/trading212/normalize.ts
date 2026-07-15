import type { TransactionKind } from "@/lib/ledger/types";
import type { T212Dividend, T212Order, T212Transaction } from "./types";

/**
 * DB-ready leg description — plain numbers (not Decimal), matching what
 * gets written to the transaction_legs table. The gbp_value column is
 * currently populated with the value in the account's own base_currency
 * as a same-currency passthrough (confirmed against a real demo account
 * denominated in AUD, not GBP) — true conversion to GBP is deferred
 * until fx_rates exists (Session 6+). This is fine for internal
 * consistency (holdings/cash/reconciliation math all stays in one
 * currency) but the column is not literally GBP for non-GBP accounts yet.
 */
export interface NormalizedLeg {
  legType: "asset" | "cash" | "fee";
  /** Ticker string (e.g. "AAPL_US_EQ") for asset legs; null otherwise. */
  ticker: string | null;
  /** ISIN, when the source provides one — preferred over ticker for asset
   * matching per ARCHITECTURE.md (a ticker alone isn't a stable identity
   * across brokers/exchanges). Only the CSV export and order fills carry it. */
  isin: string | null;
  currency: string;
  quantityDelta: number | null;
  cashDelta: number | null;
  gbpValue: number;
}

export interface NormalizedTransaction {
  externalRef: string;
  transactionType: TransactionKind;
  executedAt: string;
  legs: NormalizedLeg[];
}

/**
 * Only orders with a fill have an economic effect (cancelled/rejected
 * orders have none). Direction comes from order.side. Quantity is read
 * from fill.quantity, not order.filledQuantity — VALUE-strategy orders
 * (buy £X of something) don't carry a quantity on the order at all, only
 * on the fill.
 *
 * fill.walletImpact.netValue is the actual net-of-fees cash impact —
 * verified against a real demo account by reconciling the ending cash
 * balance. Gross value (used for cost basis / sell proceeds, before fees)
 * is derived back out: netValue - fees for a buy (fees are additional
 * cost on top of the shares), netValue + fees for a sell (fees are
 * deducted from gross proceeds).
 */
export function normalizeOrder(
  item: T212Order,
  currency?: string,
): NormalizedTransaction | null {
  const { order, fill } = item;
  if (order.status !== "FILLED" || !fill) {
    return null;
  }

  const isBuy = order.side === "BUY";
  const legCurrency = currency ?? order.currency;
  const feeTotal = fill.walletImpact.taxes.reduce(
    (sum, tax) => sum + Math.abs(tax.quantity),
    0,
  );
  const netValue = Math.abs(fill.walletImpact.netValue);
  const grossValue = isBuy ? netValue - feeTotal : netValue + feeTotal;

  const legs: NormalizedLeg[] = [
    {
      legType: "asset",
      ticker: order.ticker,
      isin: order.instrument.isin,
      currency: legCurrency,
      quantityDelta: fill.quantity,
      cashDelta: null,
      gbpValue: grossValue,
    },
    {
      legType: "cash",
      ticker: null,
      isin: null,
      currency: legCurrency,
      quantityDelta: null,
      cashDelta: isBuy ? -grossValue : grossValue,
      gbpValue: grossValue,
    },
  ];

  if (feeTotal > 0) {
    legs.push({
      legType: "fee",
      ticker: null,
      isin: null,
      currency: legCurrency,
      quantityDelta: null,
      cashDelta: -feeTotal,
      gbpValue: feeTotal,
    });
  }

  return {
    externalRef: String(order.id),
    transactionType: isBuy ? "buy" : "sell",
    executedAt: fill.filledAt,
    legs,
  };
}

/**
 * Dividend-endpoint items also cover interest income (DIVIDEND_TYPE
 * includes INTEREST/INTEREST_PAID_BY_US_OBLIGORS/etc.) — no asset leg
 * (a dividend doesn't change quantity, so it must never be picked up by
 * computeHoldings' asset-leg filter). The ticker is still attached to
 * the cash leg as informational metadata only, purely so the asset gets
 * resolved and the Dividends UI can show which stock paid it —
 * writeNormalizedTransaction resolves an asset_id for any leg carrying
 * a ticker/isin regardless of legType, but the ledger engine only reads
 * asset_id off legType==='asset' legs, so this has no effect on holdings.
 *
 * Confirmed against a real account: the dividends endpoint reports
 * tickers with an exchange suffix (e.g. "NVDA_US_EQ") that the
 * orders/portfolio endpoints don't ("NVDA") for the exact same
 * instrument — a genuine T212 API inconsistency, not a typo. Stripping
 * the suffix here means dividends resolve to the same asset orders
 * already created instead of spawning a duplicate.
 */
export function normalizeDividend(
  dividend: T212Dividend,
  currency = "GBP",
): NormalizedTransaction {
  const transactionType: TransactionKind = dividend.type.startsWith("INTEREST")
    ? "interest"
    : "dividend";

  return {
    externalRef: dividend.reference,
    transactionType,
    executedAt: dividend.paidOn,
    legs: [
      {
        legType: "cash",
        ticker: dividend.ticker.split("_")[0],
        isin: null,
        currency,
        quantityDelta: null,
        cashDelta: dividend.amount,
        gbpValue: Math.abs(dividend.amount),
      },
    ],
  };
}

/**
 * Cash-only entries: deposits, withdrawals, standalone fees, and generic
 * transfers. TRANSFER's direction isn't in the type name, so it's read
 * from the sign of amount like the others.
 */
export function normalizeTransaction(
  transaction: T212Transaction,
  currency = "GBP",
): NormalizedTransaction {
  const typeMap: Record<T212Transaction["type"], TransactionKind> = {
    DEPOSIT: "transfer_in",
    WITHDRAW: "transfer_out",
    FEE: "fee",
    TRANSFER: transaction.amount >= 0 ? "transfer_in" : "transfer_out",
  };

  return {
    externalRef: transaction.reference,
    transactionType: typeMap[transaction.type],
    executedAt: transaction.dateTime,
    legs: [
      {
        legType: transaction.type === "FEE" ? "fee" : "cash",
        ticker: null,
        isin: null,
        currency,
        quantityDelta: null,
        cashDelta: transaction.amount,
        gbpValue: Math.abs(transaction.amount),
      },
    ],
  };
}
