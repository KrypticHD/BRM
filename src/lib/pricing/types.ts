export interface PriceQuote {
  price: number;
  /** ISO date of the quote (close date, or today for a live/intraday quote). */
  asOf: string;
}

export interface ResolvedSymbol {
  symbol: string;
  /** The currency the provider actually quotes this symbol in — not
   * necessarily the same as the asset's canonical currency (e.g. EODHD
   * often quotes LSE-listed instruments in GBX pence, not GBP). Captured
   * once at resolve time so getQuote never has to guess it per call. */
  currency: string;
}

export interface AssetIdentity {
  ticker: string | null;
  isin: string | null;
  /** Provider-resolved symbol, when one has already been found (e.g. by
   * the coverage-check script and persisted as a vendor_symbol identifier). */
  providerSymbol: string | null;
}

export interface PriceProvider {
  name: string;
  /** Resolves a provider-specific symbol (+ its quote currency) for an
   * asset, by ISIN preferably, falling back to ticker. Used by the
   * coverage-check script to build the mapping the cron job later trusts. */
  resolveSymbol(identity: AssetIdentity): Promise<ResolvedSymbol | null>;
  /** Fetches the latest close for an already-resolved provider symbol. */
  getQuote(providerSymbol: string): Promise<PriceQuote | null>;
}
