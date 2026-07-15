import "server-only";
import type { AssetIdentity, PriceProvider, PriceQuote, ResolvedSymbol } from "../types";

/**
 * Twelve Data (twelvedata.com). Free tier is 800 requests/day but only
 * 8/minute — confirmed the hard way: an unpaced coverage run against 60
 * holdings (120 requests: resolve + quote per asset) got almost every
 * quote rate-limited after the first handful, even for obviously-covered
 * symbols like MSFT/GOOGL/AMZN. Every request is paced to stay safely
 * under that per-minute cap.
 */
const MIN_REQUEST_INTERVAL_MS = 8000; // ~7.5 req/min, under the 8/min cap

export function createTwelveDataProvider(apiKey: string): PriceProvider {
  let lastRequestAt = 0;

  async function pace() {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed),
      );
    }
    lastRequestAt = Date.now();
  }

  async function resolveSymbol(identity: AssetIdentity): Promise<ResolvedSymbol | null> {
    const query = identity.isin ?? identity.ticker;
    if (!query) return null;

    await pace();
    const response = await fetch(
      `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(query)}&apikey=${apiKey}`,
    );
    if (!response.ok) return null;

    const body = (await response.json()) as {
      data?: Array<{ symbol: string; currency: string; instrument_type: string }>;
    };
    if (!body.data || body.data.length === 0) return null;

    const match = body.data[0];
    return { symbol: match.symbol, currency: match.currency };
  }

  async function getQuote(providerSymbol: string): Promise<PriceQuote | null> {
    await pace();
    const response = await fetch(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(providerSymbol)}&apikey=${apiKey}`,
    );
    if (!response.ok) return null;

    const body = (await response.json()) as {
      close?: string;
      datetime?: string;
      status?: string;
    };
    if (body.status === "error" || !body.close || !body.datetime) return null;

    return { price: Number(body.close), asOf: body.datetime };
  }

  return { name: "twelvedata", resolveSymbol, getQuote };
}
