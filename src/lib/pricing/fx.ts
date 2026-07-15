import "server-only";

export interface FxRate {
  date: string;
  fromCcy: string;
  toCcy: string;
  rate: number;
}

/**
 * Frankfurter (ECB-based, free, no key). Current working host is
 * api.frankfurter.dev — the older api.frankfurter.app now 301-redirects.
 * Fetches base -> each symbol, then also stores the inverse pair computed
 * directly rather than making a second round of requests, since the
 * ledger/reconciliation code needs to convert both directions.
 */
export async function fetchFxRates(
  base: string,
  symbols: string[],
): Promise<FxRate[]> {
  const url = `https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${symbols.join(",")}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Frankfurter request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    date: string;
    base: string;
    rates: Record<string, number>;
  };

  const rates: FxRate[] = [];
  for (const [toCcy, rate] of Object.entries(data.rates)) {
    rates.push({ date: data.date, fromCcy: base, toCcy, rate });
    rates.push({ date: data.date, fromCcy: toCcy, toCcy: base, rate: 1 / rate });
  }
  return rates;
}
