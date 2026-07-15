import "server-only";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { fetchFxRates } from "./fx";
import type { PriceProvider } from "./types";

export interface SnapshotResult {
  pricesWritten: number;
  pricesSkippedNoSymbol: number;
  pricesFailed: number;
  pricesDeferred: number;
  fxRatesWritten: number;
}

/**
 * Vercel Hobby caps Serverless Function duration at 300s, and Twelve
 * Data's free tier paces to ~8s/request — a holdings list bigger than
 * ~35 assets can't be fully refreshed in a single run. Rather than fail
 * outright or always process the same prefix of the list (starving
 * whatever sorts last), stop with time to spare and process the
 * *stalest* assets first each run, so multi-day rotation still reaches
 * full coverage instead of some assets never updating.
 */
const TIME_BUDGET_MS = 270_000; // 270s, leaving headroom under the 300s cap

export async function runPriceSnapshot(provider: PriceProvider): Promise<SnapshotResult> {
  const admin = createAdminClient();
  const startedAt = Date.now();
  const result: SnapshotResult = {
    pricesWritten: 0,
    pricesSkippedNoSymbol: 0,
    pricesFailed: 0,
    pricesDeferred: 0,
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

  const priceableAssetIds = assetIds.filter((id) => symbolByAssetId.has(id));
  result.pricesSkippedNoSymbol = assetIds.length - priceableAssetIds.length;

  // Oldest (or never-priced) snapshot first, so a time-budget cutoff
  // rotates through the full list across runs instead of always
  // processing the same assets and starving the rest.
  const { data: latestSnapshots } = await admin
    .from("price_snapshots")
    .select("asset_id, date")
    .in("asset_id", priceableAssetIds.length > 0 ? priceableAssetIds : ["00000000-0000-0000-0000-000000000000"])
    .order("date", { ascending: false });

  const lastPricedDate = new Map<string, string>();
  for (const row of latestSnapshots ?? []) {
    if (!lastPricedDate.has(row.asset_id as string)) {
      lastPricedDate.set(row.asset_id as string, row.date as string);
    }
  }

  const orderedAssetIds = [...priceableAssetIds].sort((a, b) => {
    const dateA = lastPricedDate.get(a) ?? "";
    const dateB = lastPricedDate.get(b) ?? "";
    return dateA.localeCompare(dateB); // "" (never priced) sorts first
  });

  for (const assetId of orderedAssetIds) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      result.pricesDeferred += 1;
      continue;
    }

    const symbol = symbolByAssetId.get(assetId)!;

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
