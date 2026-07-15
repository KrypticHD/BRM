import "server-only";
import Decimal from "decimal.js";
import { getAccountSnapshots } from "./getAccountSnapshots";

export interface AggregatedHoldingRow {
  assetId: string;
  name: string;
  currency: string;
  totalQuantity: Decimal;
  totalCostBasis: Decimal;
  averageCost: Decimal;
  currentPrice: Decimal | null;
  marketValue: Decimal | null;
  unrealisedPl: Decimal | null;
  priceDate: string | null;
  byAccount: Array<{
    accountId: string;
    accountName: string;
    quantity: Decimal;
    costBasis: Decimal;
  }>;
}

/**
 * Session 8's cross-broker aggregation: the same asset held in more than
 * one account (whichever brokers those turn out to be) merges into one
 * row with a per-account drill-down, rather than appearing as separate
 * rows. Built on top of getAccountSnapshots rather than re-querying, so
 * there's one source of per-account holdings math, not two.
 */
export async function getAggregatedHoldings(): Promise<AggregatedHoldingRow[]> {
  const accounts = await getAccountSnapshots();
  const merged = new Map<string, AggregatedHoldingRow>();

  for (const account of accounts) {
    for (const holding of account.holdings) {
      const existing = merged.get(holding.assetId);
      const contribution = {
        accountId: account.accountId,
        accountName: account.accountName,
        quantity: holding.quantity,
        costBasis: holding.costBasis,
      };

      if (existing) {
        existing.totalQuantity = existing.totalQuantity.plus(holding.quantity);
        existing.totalCostBasis = existing.totalCostBasis.plus(holding.costBasis);
        existing.byAccount.push(contribution);
        // Prefer whichever account has a price for this asset, if any do.
        if (!existing.currentPrice && holding.currentPrice) {
          existing.currentPrice = holding.currentPrice;
          existing.priceDate = holding.priceDate;
        }
      } else {
        merged.set(holding.assetId, {
          assetId: holding.assetId,
          name: holding.name,
          currency: account.currency,
          totalQuantity: holding.quantity,
          totalCostBasis: holding.costBasis,
          averageCost: new Decimal(0),
          currentPrice: holding.currentPrice,
          marketValue: null,
          unrealisedPl: null,
          priceDate: holding.priceDate,
          byAccount: [contribution],
        });
      }
    }
  }

  const rows = Array.from(merged.values()).map((row) => {
    const averageCost = row.totalQuantity.isZero()
      ? new Decimal(0)
      : row.totalCostBasis.dividedBy(row.totalQuantity);
    const marketValue = row.currentPrice ? row.totalQuantity.times(row.currentPrice) : null;
    const unrealisedPl = marketValue ? marketValue.minus(row.totalCostBasis) : null;
    return { ...row, averageCost, marketValue, unrealisedPl };
  });

  return rows.sort((a, b) => {
    const aValue = a.marketValue?.toNumber() ?? 0;
    const bValue = b.marketValue?.toNumber() ?? 0;
    return bValue - aValue;
  });
}
