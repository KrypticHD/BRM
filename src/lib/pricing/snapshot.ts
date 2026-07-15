import "server-only";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { fetchFxRates } from "./fx";
import type { PriceProvider } from "./types";

export interface SnapshotResult {
  pricesWritten: number;
  pricesSkippedNoSymbol: number;
  pricesFailed: number;
  fxRatesWritten: number;
}

/**
 * Fetches a closing price for every held asset that has a resolved
 * provider symbol (asset_identifiers, identifier_type='vendor_symbol',
 * source=provider.name — populated by the coverage-check script) and
 * upserts into price_snapshots, plus GBP/USD/EUR FX rates into fx_rates.
 * Upsert on the (asset_id, date) / (date, from_ccy, to_ccy) unique keys
 * makes this safe to retry within the scheduled hour, per CLAUDE.md's
 * cron idempotency rule.
 */
export async function runPriceSnapshot(provider: PriceProvider): Promise<SnapshotResult> {
  const admin = createAdminClient();
  const result: SnapshotResult = {
    pricesWritten: 0,
    pricesSkippedNoSymbol: 0,
    pricesFailed: 0,
    fxRatesWritten: 0,
  };

  // Only assets actually held somewhere (a non-zero quantity leg exists)
  // need a daily price — no point spending API quota on everything ever
  // referenced in transaction history.
  const { data: heldAssetIds, error: heldError } = await admin
    .from("transaction_legs")
    .select("asset_id")
    .eq("leg_type", "asset")
    .not("asset_id", "is", null);
  if (heldError) throw heldError;

  const assetIds = [...new Set((heldAssetIds ?? []).map((row) => row.asset_id as string))];

  const { data: identifiers, error: identifierError } = await admin
    .from("asset_identifiers")
    .select("asset_id, identifier_value")
    .eq("identifier_type", "vendor_symbol")
    .eq("source", provider.name)
    .in("asset_id", assetIds.length > 0 ? assetIds : ["00000000-0000-0000-0000-000000000000"]);
  if (identifierError) throw identifierError;

  const symbolByAssetId = new Map(
    (identifiers ?? []).map((row) => [row.asset_id as string, row.identifier_value as string]),
  );

  for (const assetId of assetIds) {
    const symbol = symbolByAssetId.get(assetId);
    if (!symbol) {
      result.pricesSkippedNoSymbol += 1;
      continue;
    }

    const { data: asset } = await admin
      .from("assets")
      .select("primary_currency")
      .eq("id", assetId)
      .single();

    const quote = await provider.getQuote(symbol);
    if (!quote) {
      result.pricesFailed += 1;
      continue;
    }

    const { error: upsertError } = await admin.from("price_snapshots").upsert(
      {
        asset_id: assetId,
        date: quote.asOf,
        close_price: quote.price,
        currency: asset?.primary_currency ?? "GBP",
      },
      { onConflict: "asset_id,date" },
    );
    if (upsertError) throw upsertError;
    result.pricesWritten += 1;
  }

  const fxRates = await fetchFxRates("GBP", ["USD", "EUR"]);
  for (const rate of fxRates) {
    const { error: fxError } = await admin.from("fx_rates").upsert(
      { date: rate.date, from_ccy: rate.fromCcy, to_ccy: rate.toCcy, rate: rate.rate },
      { onConflict: "date,from_ccy,to_ccy" },
    );
    if (fxError) throw fxError;
    result.fxRatesWritten += 1;
  }

  return result;
}
