import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { computeAccountValueGbp } from "@/lib/ledger/accountValue";

describe("computeAccountValueGbp", () => {
  it("defaults to filtering GBP cash", () => {
    const total = computeAccountValueGbp(
      [
        { currency: "GBP", amount: new Decimal(100) },
        { currency: "USD", amount: new Decimal(50) },
      ],
      [],
      {},
    );
    expect(total.toFixed(2)).toBe("100.00");
  });

  it("uses the given baseCurrency for non-GBP accounts (regression: AUD demo account came out £0.00 before this)", () => {
    const total = computeAccountValueGbp(
      [
        { currency: "AUD", amount: new Decimal(5021.3) },
        { currency: "GBP", amount: new Decimal(999) }, // must be ignored
      ],
      [],
      {},
      "AUD",
    );
    expect(total.toFixed(2)).toBe("5021.30");
  });
});
