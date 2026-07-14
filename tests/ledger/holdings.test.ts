import { describe, expect, it } from "vitest";
import { computeHoldings } from "@/lib/ledger/holdings";
import { mkAssetLeg } from "./helpers";

describe("computeHoldings", () => {
  it("computes quantity and average cost from a single buy", () => {
    const { holdings, realisedPlEvents } = computeHoldings([
      mkAssetLeg({
        transactionId: "t1",
        transactionType: "buy",
        executedAt: new Date("2024-01-01"),
        assetId: "asset-1",
        quantityDelta: "10",
        gbpValue: "800",
      }),
    ]);

    expect(holdings).toHaveLength(1);
    expect(holdings[0].quantity.toFixed(2)).toBe("10.00");
    expect(holdings[0].costBasisGbp.toFixed(2)).toBe("800.00");
    expect(holdings[0].averageCostGbp.toFixed(2)).toBe("80.00");
    expect(realisedPlEvents).toHaveLength(0);
  });

  it("computes a weighted average cost across multiple buys at different prices", () => {
    const { holdings } = computeHoldings([
      mkAssetLeg({
        transactionId: "t1",
        transactionType: "buy",
        executedAt: new Date("2024-01-01"),
        assetId: "asset-1",
        quantityDelta: "10",
        gbpValue: "800", // £80/share
      }),
      mkAssetLeg({
        transactionId: "t2",
        transactionType: "buy",
        executedAt: new Date("2024-02-01"),
        assetId: "asset-1",
        quantityDelta: "10",
        gbpValue: "1000", // £100/share
      }),
    ]);

    expect(holdings[0].quantity.toFixed(2)).toBe("20.00");
    expect(holdings[0].costBasisGbp.toFixed(2)).toBe("1800.00");
    expect(holdings[0].averageCostGbp.toFixed(2)).toBe("90.00");
  });

  it("realises P/L on a sell at the average cost per unit, leaving average cost unchanged", () => {
    const { holdings, realisedPlEvents } = computeHoldings([
      mkAssetLeg({
        transactionId: "t1",
        transactionType: "buy",
        executedAt: new Date("2024-01-01"),
        assetId: "asset-1",
        quantityDelta: "10",
        gbpValue: "800", // £80/share
      }),
      mkAssetLeg({
        transactionId: "t2",
        transactionType: "sell",
        executedAt: new Date("2024-03-01"),
        assetId: "asset-1",
        quantityDelta: "-4",
        gbpValue: "500", // proceeds
      }),
    ]);

    expect(realisedPlEvents).toHaveLength(1);
    expect(realisedPlEvents[0].costBasisRemovedGbp.toFixed(2)).toBe("320.00"); // 4 * 80
    expect(realisedPlEvents[0].realisedPlGbp.toFixed(2)).toBe("180.00"); // 500 - 320

    expect(holdings[0].quantity.toFixed(2)).toBe("6.00");
    expect(holdings[0].costBasisGbp.toFixed(2)).toBe("480.00"); // 800 - 320
    expect(holdings[0].averageCostGbp.toFixed(2)).toBe("80.00"); // unchanged
  });

  it("does not realise P/L on a transfer_out, only carries cost basis forward", () => {
    const { holdings, realisedPlEvents } = computeHoldings([
      mkAssetLeg({
        transactionId: "t1",
        transactionType: "buy",
        executedAt: new Date("2024-01-01"),
        assetId: "asset-1",
        quantityDelta: "10",
        gbpValue: "800",
      }),
      mkAssetLeg({
        transactionId: "t2",
        transactionType: "transfer_out",
        executedAt: new Date("2024-03-01"),
        assetId: "asset-1",
        quantityDelta: "-4",
        gbpValue: "320", // carried cost basis, not a market-value "sale"
      }),
    ]);

    expect(realisedPlEvents).toHaveLength(0);
    expect(holdings[0].quantity.toFixed(2)).toBe("6.00");
    expect(holdings[0].costBasisGbp.toFixed(2)).toBe("480.00");
  });

  it("processes legs in execution order regardless of input array order", () => {
    const buyLater = mkAssetLeg({
      transactionId: "t2",
      transactionType: "buy",
      executedAt: new Date("2024-02-01"),
      assetId: "asset-1",
      quantityDelta: "10",
      gbpValue: "1000",
    });
    const buyEarlier = mkAssetLeg({
      transactionId: "t1",
      transactionType: "buy",
      executedAt: new Date("2024-01-01"),
      assetId: "asset-1",
      quantityDelta: "10",
      gbpValue: "800",
    });

    const { holdings } = computeHoldings([buyLater, buyEarlier]);
    expect(holdings[0].costBasisGbp.toFixed(2)).toBe("1800.00");
    expect(holdings[0].averageCostGbp.toFixed(2)).toBe("90.00");
  });
});
