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
 * Account value = base-currency cash + market value of positions. Cash
 * balances in currencies other than baseCurrency are not converted here —
 * FX-aware valuation is out of scope until price_snapshots/fx_rates exist
 * (Session 6+); callers with genuinely multi-currency cash should convert
 * to baseCurrency before calling this. baseCurrency defaults to "GBP" but
 * must be passed explicitly for accounts denominated in another currency
 * (e.g. a non-UK Trading 212 demo account) — otherwise their cash is
 * silently excluded and the total comes out as just the market value.
 */
export function computeAccountValueGbp(
  cashBalances: CashBalance[],
  holdings: HoldingPosition[],
  prices: PriceMap,
  baseCurrency: string = "GBP",
): Decimal {
  const cashInBaseCurrency = cashBalances
    .filter((balance) => balance.currency === baseCurrency)
    .reduce((total, balance) => total.plus(balance.amount), new Decimal(0));

  return cashInBaseCurrency.plus(computeMarketValueGbp(holdings, prices));
}
