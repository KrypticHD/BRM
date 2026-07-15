import { afterEach, describe, expect, it, vi } from "vitest";
import { createTwelveDataProvider } from "@/lib/pricing/providers/twelvedata";

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

describe("createTwelveDataProvider", () => {
  it("resolves a symbol from a search match", async () => {
    mockFetchOnce({
      data: [{ symbol: "AAPL", currency: "USD", instrument_type: "Common Stock" }],
    });
    const provider = createTwelveDataProvider("key");
    const resolved = await provider.resolveSymbol({
      ticker: "AAPL",
      isin: null,
      providerSymbol: null,
    });
    expect(resolved).toEqual({ symbol: "AAPL", currency: "USD" });
  });

  it("returns null when search finds nothing", async () => {
    mockFetchOnce({ data: [] });
    const provider = createTwelveDataProvider("key");
    const resolved = await provider.resolveSymbol({
      ticker: "NOPE",
      isin: null,
      providerSymbol: null,
    });
    expect(resolved).toBeNull();
  });

  it("parses a successful quote", async () => {
    mockFetchOnce({ close: "150.25", datetime: "2024-01-01", status: "ok" });
    const provider = createTwelveDataProvider("key");
    const quote = await provider.getQuote("AAPL");
    expect(quote).toEqual({ price: 150.25, asOf: "2024-01-01" });
  });

  it("returns null when the API reports an error status", async () => {
    mockFetchOnce({ code: 400, status: "error", message: "symbol not found" });
    const provider = createTwelveDataProvider("key");
    const quote = await provider.getQuote("BADSYM");
    expect(quote).toBeNull();
  });
});
