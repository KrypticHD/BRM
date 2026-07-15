import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoinGeckoProvider } from "@/lib/pricing/providers/coingecko";

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

describe("createCoinGeckoProvider", () => {
  it("resolves a coin id by matching ticker symbol case-insensitively", async () => {
    mockFetchOnce([
      { id: "bitcoin", symbol: "btc", name: "Bitcoin" },
      { id: "ethereum", symbol: "eth", name: "Ethereum" },
    ]);
    const provider = createCoinGeckoProvider();
    const resolved = await provider.resolveSymbol({
      ticker: "BTC",
      isin: null,
      providerSymbol: null,
    });
    expect(resolved).toEqual({ symbol: "bitcoin", currency: "USD" });
  });

  it("returns null when no matching symbol is found", async () => {
    mockFetchOnce([{ id: "bitcoin", symbol: "btc", name: "Bitcoin" }]);
    const provider = createCoinGeckoProvider();
    const resolved = await provider.resolveSymbol({
      ticker: "NOPE",
      isin: null,
      providerSymbol: null,
    });
    expect(resolved).toBeNull();
  });

  it("parses a simple/price quote", async () => {
    mockFetchOnce({ bitcoin: { usd: 65000.5 } });
    const provider = createCoinGeckoProvider();
    const quote = await provider.getQuote("bitcoin");
    expect(quote?.price).toBe(65000.5);
  });
});
