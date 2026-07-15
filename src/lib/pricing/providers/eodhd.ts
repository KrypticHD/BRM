import "server-only";
import type { AssetIdentity, PriceProvider, PriceQuote, ResolvedSymbol } from "../types";

/**
 * EODHD (eodhistoricaldata.com). Free tier is 20 requests/day, which is
 * far too tight to resolve+quote a real holdings list in one run — the
 * coverage-check script samples a handful of holdings against this
 * provider rather than checking all of them, and says so explicitly.
 *
 * Confirmed against the real API: the real-time quote endpoint's response
 * (/api/real-time/{symbol}) has no currency field at all — currency has
 * to come from the search endpoint at resolve time and be trusted from
 * then on, not re-derived per quote.
 */
export function createEodhdProvider(apiKey: string): PriceProvider {
  async function resolveSymbol(identity: AssetIdentity): Promise<ResolvedSymbol | null> {
    const query = identity.isin ?? identity.ticker;
    if (!query) return null;

    const response = await fetch(
      `https://eodhd.com/api/search/${encodeURIComponent(query)}?api_token=${apiKey}&fmt=json`,
    );
    if (!response.ok) return null;

    const results = (await response.json()) as Array<{
      Code: string;
      Exchange: string;
      Currency: string;
      ISIN?: string;
    }>;
    if (!Array.isArray(results) || results.length === 0) return null;

    // Prefer an exact ISIN match when we searched by ISIN; otherwise take
    // the top result.
    const match =
      (identity.isin ? results.find((r) => r.ISIN === identity.isin) : undefined) ??
      results[0];

    return { symbol: `${match.Code}.${match.Exchange}`, currency: match.Currency };
  }

  async function getQuote(providerSymbol: string): Promise<PriceQuote | null> {
    const response = await fetch(
      `https://eodhd.com/api/eod/${providerSymbol}?api_token=${apiKey}&fmt=json&period=d&order=d`,
    );
    if (!response.ok) return null;

    const rows = (await response.json()) as Array<{ date: string; close: number }>;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    return { price: rows[0].close, asOf: rows[0].date };
  }

  return { name: "eodhd", resolveSymbol, getQuote };
}
