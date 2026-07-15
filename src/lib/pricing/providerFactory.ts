import "server-only";
import { createEodhdProvider } from "./providers/eodhd";
import { createTwelveDataProvider } from "./providers/twelvedata";
import type { PriceProvider } from "./types";

/**
 * Which provider is "confirmed" (Session 6's own gate) is a config flip,
 * not a code change — PRICE_PROVIDER selects between the two adapters
 * built during the coverage check.
 */
export function getConfiguredEquityProvider(): PriceProvider {
  const choice = process.env.PRICE_PROVIDER ?? "twelvedata";

  if (choice === "eodhd") {
    const key = process.env.EODHD_API_KEY;
    if (!key) throw new Error("EODHD_API_KEY is not set.");
    return createEodhdProvider(key);
  }

  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error("TWELVEDATA_API_KEY is not set.");
  return createTwelveDataProvider(key);
}
