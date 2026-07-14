import Decimal from "decimal.js";
import type { CashBalance, TransactionLeg } from "./types";

/**
 * Cash balance per currency is the sum of cashDelta across every leg that
 * carries one — order-independent by construction (summation is
 * associative), so no chronological sort is needed here.
 */
export function computeCashBalances(legs: TransactionLeg[]): CashBalance[] {
  const totals = new Map<string, Decimal>();

  for (const leg of legs) {
    if (leg.cashDelta === null) continue;
    const current = totals.get(leg.currency) ?? new Decimal(0);
    totals.set(leg.currency, current.plus(leg.cashDelta));
  }

  return Array.from(totals.entries()).map(([currency, amount]) => ({
    currency,
    amount,
  }));
}
