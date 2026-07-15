import "server-only";
import type { AssetIdentity, PriceProvider, PriceQuote, ResolvedSymbol } from "../types";

/**
 * CoinGecko free API — no key needed at low volume. resolveSymbol here
 * finds a CoinGecko coin id (asset_identifiers.coingecko_id) by ticker,
 * not ISIN (crypto doesn't have one). No crypto holdings exist yet, so
 * this is unverified against real data — built because it's explicitly
 * in Session 6's scope, not because it's been exercised.
 */
export function createCoinGeckoProvider(): PriceProvider {
  async function resolveSymbol(identity: AssetIdentity): Promise<ResolvedSymbol | null> {
    if (!identity.ticker) return null;

    const response = await fetch("https://api.coingecko.com/api/v3/coins/list");
    if (!response.ok) return null;

    const coins = (await response.json()) as Array<{ id: string; symbol: string; name: string }>;
    const match = coins.find(
      (c) => c.symbol.toLowerCase() === identity.ticker!.toLowerCase(),
    );
    if (!match) return null;

    return { symbol: match.id, currency: "USD" };
  }

  async function getQuote(providerSymbol: string): Promise<PriceQuote | null> {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(providerSymbol)}&vs_currencies=usd`,
    );
    if (!response.ok) return null;

    const body = (await response.json()) as Record<string, { usd?: number }>;
    const price = body[providerSymbol]?.usd;
    if (price === undefined) return null;

    return { price, asOf: new Date().toISOString().slice(0, 10) };
  }

  return { name: "coingecko", resolveSymbol, getQuote };
}
