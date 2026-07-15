import "server-only";
import { unstable_cache } from "next/cache";
import { getConfiguredEquityProvider } from "./providerFactory";

/**
 * Short-cached on-demand price, for a "live" widget rather than the daily
 * snapshot. 15 minutes, not shorter — the underlying providers' free
 * tiers can't support per-request fetching for a page view, and the
 * chosen equities API is EOD-oriented in the first place (see
 * CLAUDE.md: don't imply intraday granularity the data doesn't support).
 * Not wired into any UI yet — the dashboard that would use this is
 * Session 7's scope, not this one.
 */
export const getLivePrice = unstable_cache(
  async (providerSymbol: string) => {
    const provider = getConfiguredEquityProvider();
    return provider.getQuote(providerSymbol);
  },
  ["live-price"],
  { revalidate: 900 },
);
