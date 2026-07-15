import "server-only";
import type { AssetIdentity, PriceProvider, PriceQuote, ResolvedSymbol } from "../types";

/**
 * Twelve Data (twelvedata.com). Free tier is 800 requests/day, 8/minute —
 * generous enough to run a full coverage check against a real holdings
 * list in one go, unlike EODHD's 20/day.
 */
export function createTwelveDataProvider(apiKey: string): PriceProvider {
  async function resolveSymbol(identity: AssetIdentity): Promise<ResolvedSymbol | null> {
    const query = identity.isin ?? identity.ticker;
    if (!query) return null;

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
