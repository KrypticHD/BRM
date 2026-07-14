import { describe, expect, it } from "vitest";
import fc from "fast-check";
import Decimal from "decimal.js";
import { computeHoldings } from "@/lib/ledger/holdings";
import { computeCashBalances } from "@/lib/ledger/cash";
import { computeAccountValueGbp } from "@/lib/ledger/accountValue";
import { applySplit } from "@/lib/ledger/corporateActions";
import type {
  CashBalance,
  HoldingPosition,
  TransactionKind,
  TransactionLeg,
} from "@/lib/ledger/types";
import { mkAssetLeg, mkCashLeg } from "./helpers";

const ASSET_IDS = ["asset-1", "asset-2", "asset-3"];
const CURRENCIES = ["GBP", "USD", "EUR"];
const TX_TYPES: TransactionKind[] = ["buy", "sell", "transfer_in", "transfer_out"];

const pence = fc.integer({ min: -1_000_000, max: 1_000_000 });
const positivePence = fc.integer({ min: 1, max: 1_000_000 });

function toDecimal(p: number) {
  return new Decimal(p).dividedBy(100);
}

describe("invariant: position quantity = sum of quantity legs", () => {
  it("holds for arbitrary mixed buy/sell/transfer sequences across assets", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            assetId: fc.constantFrom(...ASSET_IDS),
            transactionType: fc.constantFrom(...TX_TYPES),
            quantityDeltaPence: pence,
            gbpValuePence: positivePence,
            dayOffset: fc.integer({ min: 0, max: 1000 }),
          }),
          { minLength: 0, maxLength: 30 },
        ),
        (records) => {
          const legs: TransactionLeg[] = records.map((r, i) =>
            mkAssetLeg({
              transactionId: `t${i}`,
              transactionType: r.transactionType,
              executedAt: new Date(2024, 0, 1 + r.dayOffset),
              assetId: r.assetId,
              quantityDelta: toDecimal(r.quantityDeltaPence),
              gbpValue: toDecimal(r.gbpValuePence),
            }),
          );

          const { holdings } = computeHoldings(legs);

          const expectedByAsset = new Map<string, Decimal>();
          for (const leg of legs) {
            const current = expectedByAsset.get(leg.assetId!) ?? new Decimal(0);
            expectedByAsset.set(leg.assetId!, current.plus(leg.quantityDelta!));
          }

          for (const holding of holdings) {
            expect(holding.quantity.eq(expectedByAsset.get(holding.assetId)!)).toBe(true);
          }
        },
      ),
    );
  });
});

describe("invariant: cash by currency = sum of cash legs", () => {
  it("holds for arbitrary legs with cash deltas across currencies", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            currency: fc.constantFrom(...CURRENCIES),
            cashDeltaPence: pence,
            dayOffset: fc.integer({ min: 0, max: 1000 }),
          }),
          { minLength: 0, maxLength: 30 },
        ),
        (records) => {
          const legs: TransactionLeg[] = records.map((r, i) =>
            mkCashLeg({
              transactionId: `t${i}`,
              transactionType: "other",
              executedAt: new Date(2024, 0, 1 + r.dayOffset),
              currency: r.currency,
              cashDelta: toDecimal(r.cashDeltaPence),
              gbpValue: toDecimal(Math.abs(r.cashDeltaPence)),
            }),
          );

          const balances = computeCashBalances(legs);

          const expectedByCurrency = new Map<string, Decimal>();
          for (const leg of legs) {
            const current = expectedByCurrency.get(leg.currency) ?? new Decimal(0);
            expectedByCurrency.set(leg.currency, current.plus(leg.cashDelta!));
          }

          expect(balances.length).toBe(expectedByCurrency.size);
          for (const balance of balances) {
            expect(balance.amount.eq(expectedByCurrency.get(balance.currency)!)).toBe(true);
          }
        },
      ),
    );
  });
});

describe("invariant: computed account value = cash + market value of positions", () => {
  it("holds for arbitrary GBP cash and holdings/price combinations", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            assetId: fc.constantFrom(...ASSET_IDS),
            quantityPence: fc.integer({ min: 0, max: 100_000 }),
            costBasisPence: fc.integer({ min: 0, max: 10_000_000 }),
            pricePence: fc.integer({ min: 0, max: 100_000 }),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        positivePence,
        (rows, cashPence) => {
          const seen = new Set<string>();
          const holdings: HoldingPosition[] = [];
          const prices: Record<string, Decimal> = {};

          for (const row of rows) {
            if (seen.has(row.assetId)) continue;
            seen.add(row.assetId);
            const quantity = toDecimal(row.quantityPence);
            const costBasisGbp = toDecimal(row.costBasisPence);
            holdings.push({
              assetId: row.assetId,
              quantity,
              costBasisGbp,
              averageCostGbp: quantity.isZero()
                ? new Decimal(0)
                : costBasisGbp.dividedBy(quantity),
            });
            prices[row.assetId] = toDecimal(row.pricePence);
          }

          const cashBalances: CashBalance[] = [
            { currency: "GBP", amount: toDecimal(cashPence) },
          ];

          const accountValue = computeAccountValueGbp(cashBalances, holdings, prices);

          const expectedMarketValue = holdings.reduce(
            (total, h) => total.plus(h.quantity.times(prices[h.assetId])),
            new Decimal(0),
          );
          const expected = toDecimal(cashPence).plus(expectedMarketValue);

          expect(accountValue.eq(expected)).toBe(true);
        },
      ),
    );
  });
});

describe("invariant: a stock split changes quantity and unit cost but not total cost basis", () => {
  it("holds for arbitrary positions and positive split ratios", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (quantityPence, costBasisPence, ratioNum, ratioDenom) => {
          const quantity = toDecimal(quantityPence);
          const costBasisGbp = toDecimal(costBasisPence);
          const position: HoldingPosition = {
            assetId: "asset-1",
            quantity,
            costBasisGbp,
            averageCostGbp: costBasisGbp.dividedBy(quantity),
          };
          const ratio = new Decimal(ratioNum).dividedBy(ratioDenom);

          const after = applySplit(position, ratio);

          expect(after.costBasisGbp.eq(costBasisGbp)).toBe(true);
          expect(after.quantity.eq(quantity.times(ratio))).toBe(true);
          expect(
            after.averageCostGbp
              .times(after.quantity)
              .minus(costBasisGbp)
              .abs()
              .lt("0.0000001"),
          ).toBe(true);
        },
      ),
    );
  });
});

describe("invariant: an internal transfer between accounts creates no performance impact", () => {
  it("conserves combined quantity and cost basis with zero realised P/L", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 100_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 99 }),
        (quantityPence, costBasisPence, transferPct) => {
          const boughtQuantity = toDecimal(quantityPence);
          const totalCost = toDecimal(costBasisPence);
          const transferQuantity = boughtQuantity.times(transferPct).dividedBy(100);
          const carriedCost = totalCost.times(transferPct).dividedBy(100);

          const accountALegs: TransactionLeg[] = [
            mkAssetLeg({
              transactionId: "buy-1",
              transactionType: "buy",
              executedAt: new Date("2024-01-01"),
              assetId: "asset-1",
              quantityDelta: boughtQuantity,
              gbpValue: totalCost,
            }),
            mkAssetLeg({
              transactionId: "transfer-out-1",
              transactionType: "transfer_out",
              executedAt: new Date("2024-02-01"),
              assetId: "asset-1",
              quantityDelta: transferQuantity.negated(),
              gbpValue: carriedCost,
            }),
          ];

          const accountBLegs: TransactionLeg[] = [
            mkAssetLeg({
              transactionId: "transfer-in-1",
              transactionType: "transfer_in",
              executedAt: new Date("2024-02-01"),
              assetId: "asset-1",
              quantityDelta: transferQuantity,
              gbpValue: carriedCost,
            }),
          ];

          const resultA = computeHoldings(accountALegs);
          const resultB = computeHoldings(accountBLegs);

          expect(resultA.realisedPlEvents).toHaveLength(0);
          expect(resultB.realisedPlEvents).toHaveLength(0);

          const combinedQuantity = resultA.holdings[0].quantity.plus(
            resultB.holdings[0]?.quantity ?? new Decimal(0),
          );
          const combinedCostBasis = resultA.holdings[0].costBasisGbp.plus(
            resultB.holdings[0]?.costBasisGbp ?? new Decimal(0),
          );

          expect(combinedQuantity.minus(boughtQuantity).abs().lt("0.0000001")).toBe(true);
          expect(combinedCostBasis.minus(totalCost).abs().lt("0.0000001")).toBe(true);
        },
      ),
    );
  });
});
