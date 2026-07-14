import { describe, expect, it } from "vitest";
import {
  normalizeDividend,
  normalizeOrder,
  normalizeTransaction,
} from "@/lib/broker/trading212/normalize";
import type { T212Dividend, T212Order, T212Transaction } from "@/lib/broker/trading212/types";

type FillOverrides = Partial<Omit<NonNullable<T212Order["fill"]>, "walletImpact">> & {
  walletImpact?: Partial<NonNullable<T212Order["fill"]>["walletImpact"]>;
};

function mkOrder(overrides: {
  order?: Partial<T212Order["order"]>;
  fill?: FillOverrides | null;
}): T212Order {
  const fillOverrides = overrides.fill;
  return {
    order: {
      id: 12345,
      strategy: "QUANTITY",
      type: "MARKET",
      ticker: "AAPL_US_EQ",
      quantity: 10,
      filledQuantity: 10,
      status: "FILLED",
      currency: "GBP",
      side: "BUY",
      createdAt: "2024-01-01T10:00:00.000Z",
      instrument: {
        ticker: "AAPL_US_EQ",
        name: "Apple",
        isin: "US0378331005",
        currency: "USD",
      },
      ...overrides.order,
    },
    fill:
      fillOverrides === null
        ? null
        : {
            id: fillOverrides?.id ?? 1,
            quantity: fillOverrides?.quantity ?? 10,
            price: fillOverrides?.price ?? 150,
            type: fillOverrides?.type ?? "TRADE",
            tradingMethod: fillOverrides?.tradingMethod ?? "OTC",
            filledAt: fillOverrides?.filledAt ?? "2024-01-01T10:00:01.000Z",
            walletImpact: {
              currency: fillOverrides?.walletImpact?.currency ?? "GBP",
              netValue: fillOverrides?.walletImpact?.netValue ?? 1500,
              realisedProfitLoss: fillOverrides?.walletImpact?.realisedProfitLoss ?? null,
              fxRate: fillOverrides?.walletImpact?.fxRate ?? null,
              taxes: fillOverrides?.walletImpact?.taxes ?? [],
            },
          },
  };
}

describe("normalizeOrder", () => {
  it("returns null for orders with no fill (cancelled/rejected/pending)", () => {
    expect(normalizeOrder(mkOrder({ order: { status: "CANCELLED" }, fill: null }))).toBeNull();
    expect(normalizeOrder(mkOrder({ order: { status: "NEW" }, fill: null }))).toBeNull();
  });

  it("normalizes a filled buy order into asset + cash legs", () => {
    const result = normalizeOrder(
      mkOrder({
        order: { side: "BUY" },
        fill: { quantity: 10, walletImpact: { netValue: 1500 } },
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("buy");
    expect(result!.externalRef).toBe("12345");
    expect(result!.legs).toHaveLength(2);

    const assetLeg = result!.legs.find((l) => l.legType === "asset")!;
    expect(assetLeg.ticker).toBe("AAPL_US_EQ");
    expect(assetLeg.quantityDelta).toBe(10);
    expect(assetLeg.gbpValue).toBe(1500);

    const cashLeg = result!.legs.find((l) => l.legType === "cash")!;
    expect(cashLeg.cashDelta).toBe(-1500); // buying reduces cash
    expect(cashLeg.gbpValue).toBe(1500);
  });

  it("normalizes a filled sell order with cash increasing", () => {
    const result = normalizeOrder(
      mkOrder({
        order: { side: "SELL" },
        fill: { quantity: -5, walletImpact: { netValue: 800 } },
      }),
    );

    expect(result!.transactionType).toBe("sell");
    const assetLeg = result!.legs.find((l) => l.legType === "asset")!;
    expect(assetLeg.quantityDelta).toBe(-5);

    const cashLeg = result!.legs.find((l) => l.legType === "cash")!;
    expect(cashLeg.cashDelta).toBe(800); // selling increases cash
  });

  it("reads quantity from fill, not order, for VALUE-strategy orders (order.quantity absent)", () => {
    const result = normalizeOrder(
      mkOrder({
        order: {
          strategy: "VALUE",
          side: "BUY",
          quantity: undefined,
          filledQuantity: undefined,
          value: 5000,
          filledValue: 5000,
        },
        fill: { quantity: 23.15668799, walletImpact: { netValue: 5000 } },
      }),
    );

    const assetLeg = result!.legs.find((l) => l.legType === "asset")!;
    expect(assetLeg.quantityDelta).toBe(23.15668799);
  });

  it("derives gross value from net-of-fee walletImpact.netValue: buy subtracts fees, sell adds them back", () => {
    // Buy: netValue is the total cash that left the wallet, inclusive of
    // the fee — gross share cost is netValue minus the fee.
    const buy = normalizeOrder(
      mkOrder({
        order: { side: "BUY" },
        fill: {
          quantity: 10,
          walletImpact: {
            netValue: 5000,
            taxes: [{ name: "CURRENCY_CONVERSION_FEE", quantity: -20, currency: "GBP", chargedAt: "2024-01-01T10:00:01.000Z" }],
          },
        },
      }),
    );
    const buyAssetLeg = buy!.legs.find((l) => l.legType === "asset")!;
    const buyCashLeg = buy!.legs.find((l) => l.legType === "cash")!;
    const buyFeeLeg = buy!.legs.find((l) => l.legType === "fee")!;
    expect(buyAssetLeg.gbpValue).toBe(4980); // 5000 - 20
    expect(buyCashLeg.cashDelta).toBe(-4980);
    expect(buyFeeLeg.cashDelta).toBe(-20);
    // Combined cash impact must equal the actual net wallet change.
    expect(buyCashLeg.cashDelta! + buyFeeLeg.cashDelta!).toBe(-5000);

    // Sell: netValue is what was credited after the fee was already taken
    // out — gross proceeds are netValue plus the fee.
    const sell = normalizeOrder(
      mkOrder({
        order: { side: "SELL" },
        fill: {
          quantity: -23.15668799,
          walletImpact: {
            netValue: 5021.3,
            taxes: [{ name: "CURRENCY_CONVERSION_FEE", quantity: -20.17, currency: "GBP", chargedAt: "2024-01-01T10:00:01.000Z" }],
          },
        },
      }),
    );
    const sellAssetLeg = sell!.legs.find((l) => l.legType === "asset")!;
    const sellCashLeg = sell!.legs.find((l) => l.legType === "cash")!;
    const sellFeeLeg = sell!.legs.find((l) => l.legType === "fee")!;
    expect(sellAssetLeg.gbpValue).toBeCloseTo(5041.47, 2); // 5021.30 + 20.17
    expect(sellCashLeg.cashDelta).toBeCloseTo(5041.47, 2);
    expect(sellFeeLeg.cashDelta).toBeCloseTo(-20.17, 2);
    expect(sellCashLeg.cashDelta! + sellFeeLeg.cashDelta!).toBeCloseTo(5021.3, 2);
  });

  it("uses fill.filledAt (not order.createdAt) as executedAt", () => {
    const result = normalizeOrder(
      mkOrder({
        order: { createdAt: "2024-01-01T09:00:00.000Z" },
        fill: { filledAt: "2024-01-01T10:30:00.000Z" },
      }),
    );
    expect(result!.executedAt).toBe("2024-01-01T10:30:00.000Z");
  });
});

describe("normalizeDividend", () => {
  function mkDividend(overrides: Partial<T212Dividend>): T212Dividend {
    return {
      amount: 12.34,
      amountInEuro: 14.5,
      grossAmountPerShare: 0.5,
      paidOn: "2024-03-01T00:00:00.000Z",
      quantity: 24.68,
      reference: "div-ref-1",
      ticker: "AAPL_US_EQ",
      type: "DIVIDEND",
      ...overrides,
    };
  }

  it("normalizes a plain dividend as cash-only, type dividend", () => {
    const result = normalizeDividend(mkDividend({}));
    expect(result.transactionType).toBe("dividend");
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0].legType).toBe("cash");
    expect(result.legs[0].cashDelta).toBe(12.34);
  });

  it("classifies INTEREST_* dividend types as interest", () => {
    const result = normalizeDividend(
      mkDividend({ type: "INTEREST_PAID_BY_US_OBLIGORS", amount: 3.2 }),
    );
    expect(result.transactionType).toBe("interest");
    expect(result.legs[0].cashDelta).toBe(3.2);
  });
});

describe("normalizeTransaction", () => {
  function mkTx(overrides: Partial<T212Transaction>): T212Transaction {
    return {
      amount: 500,
      dateTime: "2024-01-01T00:00:00.000Z",
      reference: "tx-ref-1",
      type: "DEPOSIT",
      ...overrides,
    };
  }

  it("maps DEPOSIT to transfer_in", () => {
    const result = normalizeTransaction(mkTx({ type: "DEPOSIT", amount: 500 }));
    expect(result.transactionType).toBe("transfer_in");
    expect(result.legs[0].cashDelta).toBe(500);
    expect(result.legs[0].legType).toBe("cash");
  });

  it("maps WITHDRAW to transfer_out", () => {
    const result = normalizeTransaction(mkTx({ type: "WITHDRAW", amount: -200 }));
    expect(result.transactionType).toBe("transfer_out");
    expect(result.legs[0].cashDelta).toBe(-200);
  });

  it("maps FEE to a fee leg", () => {
    const result = normalizeTransaction(mkTx({ type: "FEE", amount: -1.5 }));
    expect(result.transactionType).toBe("fee");
    expect(result.legs[0].legType).toBe("fee");
    expect(result.legs[0].cashDelta).toBe(-1.5);
  });

  it("maps TRANSFER direction from the sign of amount", () => {
    const inbound = normalizeTransaction(mkTx({ type: "TRANSFER", amount: 100 }));
    expect(inbound.transactionType).toBe("transfer_in");

    const outbound = normalizeTransaction(mkTx({ type: "TRANSFER", amount: -100 }));
    expect(outbound.transactionType).toBe("transfer_out");
  });
});
