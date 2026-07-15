import { describe, expect, it } from "vitest";
import { fetchFxRates } from "@/lib/pricing/fx";

describe("fetchFxRates", () => {
  it("fetches real GBP/USD/EUR rates and computes correct inverse pairs", async () => {
    const rates = await fetchFxRates("GBP", ["USD", "EUR"]);

    expect(rates).toHaveLength(4); // GBP->USD, USD->GBP, GBP->EUR, EUR->GBP

    const gbpToUsd = rates.find((r) => r.fromCcy === "GBP" && r.toCcy === "USD")!;
    const usdToGbp = rates.find((r) => r.fromCcy === "USD" && r.toCcy === "GBP")!;
    expect(gbpToUsd).toBeDefined();
    expect(usdToGbp).toBeDefined();
    expect(usdToGbp.rate).toBeCloseTo(1 / gbpToUsd.rate, 10);

    // Sanity bounds — GBP/USD hasn't been outside roughly 1.0-1.8 in
    // modern history, catches a badly parsed response rather than
    // asserting an exact rate that will drift day to day.
    expect(gbpToUsd.rate).toBeGreaterThan(1.0);
    expect(gbpToUsd.rate).toBeLessThan(1.8);
  });
});
