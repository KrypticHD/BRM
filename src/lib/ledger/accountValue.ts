import Decimal from "decimal.js";
import type { CashBalance, HoldingPosition } from "./types";

/**
 * Current price per unit in GBP, keyed by assetId. Injected rather than
 * fetched — this module stays pure and has no knowledge of price_snapshots
 * or any API.
 */
export type PriceMap = Record<string, Decimal>;

export function computeMarketValueGbp(
  holdings: HoldingPosition[],
  prices: PriceMap,
): Decimal {
  return holdings.reduce((total, holding) => {
    const price = prices[holding.assetId];
    if (!price) return total;
    return total.plus(holding.quantity.times(price));
  }, new Decimal(0));
}

export function computeUnrealisedPlGbp(
  holdings: HoldingPosition[],
  prices: PriceMap,
): Decimal {
  return holdings.reduce((total, holding) => {
    const price = prices[holding.assetId];
    if (!price) return total;
    const marketValue = holding.quantity.times(price);
    return total.plus(marketValue.minus(holding.costBasisGbp));
  }, new Decimal(0));
}

/**
 * Account value = GBP cash + market value of positions. Cash balances in
 * other currencies are not converted here — FX-aware valuation is out of
 * scope until price_snapshots/fx_rates exist (Session 6+); callers with
 * multi-currency cash should convert to GBP before calling this.
 */
export function computeAccountValueGbp(
  cashBalances: CashBalance[],
  holdings: HoldingPosition[],
  prices: PriceMap,
): Decimal {
  const cashGbp = cashBalances
    .filter((balance) => balance.currency === "GBP")
    .reduce((total, balance) => total.plus(balance.amount), new Decimal(0));

  return cashGbp.plus(computeMarketValueGbp(holdings, prices));
}
