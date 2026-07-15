import { describe, expect, it } from "vitest";
import { normalizeCsvRow } from "@/lib/broker/trading212/normalizeCsv";
import type { T212CsvRow } from "@/lib/broker/trading212/csvTypes";

/**
 * Fixtures use synthetic values (not the user's real transaction data —
 * this file is committed to a public repo), but the column set, "EOF"
 * order-ID prefix, and fee-currency behaviour are all confirmed against a
 * real Trading 212 CSV export (live AU account, 2026-07-15).
 */
function row(overrides: Partial<T212CsvRow>): T212CsvRow {
  return {
    Action: "",
    "Time (UTC)": "",
    ISIN: "",
    Ticker: "",
    Name: "",
    Notes: "",
    ID: "",
    "No. of shares": "",
    "Price / share": "",
    "Currency (Price / share)": "",
    "Exchange rate": "",
    Total: "",
    "Currency (Total)": "",
    "Withholding tax": "",
    "Currency (Withholding tax)": "",
    "Currency conversion fee": "",
    "Currency (Currency conversion fee)": "",
    "French transaction tax": "",
    "Currency (French transaction tax)": "",
    ...overrides,
  };
}

describe("normalizeCsvRow", () => {
  it("normalizes a Deposit row as transfer_in", () => {
    const result = normalizeCsvRow(
      row({
        Action: "Deposit",
        "Time (UTC)": "2024-01-04 08:18:47+00:00",
        Notes: "Transaction ID: TESTDEPOSIT001",
        ID: "019df211-0000-0000-0000-000000000001",
        Total: "10.00",
        "Currency (Total)": "AUD",
      }),
      "AUD",
    );
    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("transfer_in");
    expect(result!.externalRef).toBe("019df211-0000-0000-0000-000000000001");
    expect(result!.legs).toHaveLength(1);
    expect(result!.legs[0].cashDelta).toBe(10);
  });

  it("normalizes a Market buy row (USD-priced, AUD fee) with EOF-stripped external ref", () => {
    const result = normalizeCsvRow(
      row({
        Action: "Market buy",
        "Time (UTC)": "2024-01-04 13:30:23+00:00",
        ISIN: "US0000000001",
        Ticker: "TEST",
        Name: "Test Corp",
        ID: "EOF99900000001",
        "No. of shares": "0.0358632500",
        "Price / share": "199.5700000000",
        "Currency (Price / share)": "USD",
        "Exchange rate": "0.71859726",
        Total: "10.00",
        "Currency (Total)": "AUD",
        "Currency conversion fee": "0.04",
        "Currency (Currency conversion fee)": "AUD",
      }),
      "AUD",
    );

    expect(result!.transactionType).toBe("buy");
    expect(result!.externalRef).toBe("99900000001"); // "EOF" stripped

    const assetLeg = result!.legs.find((l) => l.legType === "asset")!;
    expect(assetLeg.ticker).toBe("TEST");
    expect(assetLeg.isin).toBe("US0000000001");
    expect(assetLeg.quantityDelta).toBeCloseTo(0.03586325, 8);
    expect(assetLeg.gbpValue).toBeCloseTo(9.96, 2); // 10.00 - 0.04 fee

    const cashLeg = result!.legs.find((l) => l.legType === "cash")!;
    const feeLeg = result!.legs.find((l) => l.legType === "fee")!;
    expect(cashLeg.cashDelta).toBeCloseTo(-9.96, 2);
    expect(feeLeg.cashDelta).toBeCloseTo(-0.04, 2);
    // Combined cash impact must equal the actual Total deducted.
    expect(cashLeg.cashDelta! + feeLeg.cashDelta!).toBeCloseTo(-10.0, 2);
  });

  it("sums both fee columns (currency conversion fee + French transaction tax)", () => {
    const result = normalizeCsvRow(
      row({
        Action: "Market buy",
        "Time (UTC)": "2024-02-11 12:19:05+00:00",
        ISIN: "FR0000000002",
        Ticker: "FRTEST",
        Name: "French Test SA",
        ID: "EOF99900000002",
        "No. of shares": "0.0063720500",
        "Price / share": "236.0000000000",
        "Currency (Price / share)": "EUR",
        Total: "2.50",
        "Currency (Total)": "AUD",
        "Currency conversion fee": "0.01",
        "Currency (Currency conversion fee)": "AUD",
        "French transaction tax": "0.01",
        "Currency (French transaction tax)": "AUD",
      }),
      "AUD",
    );

    const feeLeg = result!.legs.find((l) => l.legType === "fee")!;
    expect(feeLeg.gbpValue).toBeCloseTo(0.02, 2); // 0.01 + 0.01
    const cashLeg = result!.legs.find((l) => l.legType === "cash")!;
    expect(cashLeg.cashDelta! + feeLeg.cashDelta!).toBeCloseTo(-2.5, 2);
  });

  it("normalizes a Dividend row as cash-only, falling back to a synthetic externalRef (CSV dividends have no ID)", () => {
    const result = normalizeCsvRow(
      row({
        Action: "Dividend (Dividend)",
        "Time (UTC)": "2024-03-26 15:39:36+00:00",
        ISIN: "US0000000001",
        Ticker: "TEST",
        Name: "Test Corp",
        ID: "",
        "No. of shares": "0.0358632500",
        "Price / share": "0.212500",
        "Currency (Price / share)": "USD",
        Total: "0.01",
        "Currency (Total)": "AUD",
        "Withholding tax": "0.00",
        "Currency (Withholding tax)": "USD",
      }),
      "AUD",
    );

    expect(result!.transactionType).toBe("dividend");
    expect(result!.legs).toHaveLength(1);
    expect(result!.legs[0].cashDelta).toBeCloseTo(0.01, 2);
    expect(result!.externalRef.startsWith("csv-")).toBe(true);
  });

  it("returns null for rows it can't parse (no Total)", () => {
    expect(normalizeCsvRow(row({ Action: "Market buy" }), "AUD")).toBeNull();
  });

  it("returns null for unrecognised action types (flag for manual review, don't silently drop as success)", () => {
    expect(
      normalizeCsvRow(row({ Action: "Stock split", Total: "0" }), "AUD"),
    ).toBeNull();
  });
});
