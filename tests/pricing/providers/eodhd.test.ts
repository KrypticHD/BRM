import { afterEach, describe, expect, it, vi } from "vitest";
import { createEodhdProvider } from "@/lib/pricing/providers/eodhd";

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce({
      ok,
      status: ok ? 200 : 500,
      statusText: ok ? "OK" : "Error",
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createEodhdProvider", () => {
  it("prefers the exact ISIN match over the first search result", async () => {
    mockFetchOnce([
      { Code: "WRONG", Exchange: "US", Currency: "USD", ISIN: "US0000000000" },
      { Code: "AAPL", Exchange: "US", Currency: "USD", ISIN: "US0378331005" },
    ]);
    const provider = createEodhdProvider("key");
    const resolved = await provider.resolveSymbol({
      ticker: null,
      isin: "US0378331005",
      providerSymbol: null,
    });
    expect(resolved).toEqual({ symbol: "AAPL.US", currency: "USD" });
  });

  it("falls back to the top result when no exact ISIN match exists", async () => {
    mockFetchOnce([{ Code: "AAPL", Exchange: "US", Currency: "USD" }]);
    const provider = createEodhdProvider("key");
    const resolved = await provider.resolveSymbol({
      ticker: "AAPL",
      isin: null,
      providerSymbol: null,
    });
    expect(resolved).toEqual({ symbol: "AAPL.US", currency: "USD" });
  });

  it("returns null for an empty search result", async () => {
    mockFetchOnce([]);
    const provider = createEodhdProvider("key");
    const resolved = await provider.resolveSymbol({
      ticker: "NOPE",
      isin: null,
      providerSymbol: null,
    });
    expect(resolved).toBeNull();
  });

  it("takes the most recent (first) row from the EOD history for a quote", async () => {
    mockFetchOnce([
      { date: "2024-01-02", close: 151.0 },
      { date: "2024-01-01", close: 150.0 },
    ]);
    const provider = createEodhdProvider("key");
    const quote = await provider.getQuote("AAPL.US");
    expect(quote).toEqual({ price: 151.0, asOf: "2024-01-02" });
  });
});
