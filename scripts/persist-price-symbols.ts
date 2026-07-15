/**
 * One-time (well, re-runnable/idempotent) persistence step following the
 * coverage check: resolves every held asset against the confirmed
 * provider and stores the result as an asset_identifiers row
 * (identifier_type='vendor_symbol', source=<provider name>), so the
 * daily cron just looks the symbol up instead of re-resolving it (and
 * burning API quota) every run.
 *
 *   TWELVEDATA_API_KEY=... npx tsx scripts/persist-price-symbols.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createTwelveDataProvider } from "../src/lib/pricing/providers/twelvedata";
import type { AssetIdentity } from "../src/lib/pricing/types";

config({ path: ".env.local" });

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: legs, error: legsError } = await admin
    .from("transaction_legs")
    .select("asset_id")
    .eq("leg_type", "asset")
    .not("asset_id", "is", null);
  if (legsError) throw legsError;

  const assetIds = [...new Set((legs ?? []).map((l) => l.asset_id as string))];

  const { data: assets, error: assetsError } = await admin
    .from("assets")
    .select("id, canonical_name")
    .in("id", assetIds);
  if (assetsError) throw assetsError;

  const { data: identifiers } = await admin
    .from("asset_identifiers")
    .select("asset_id, identifier_type, identifier_value")
    .in("asset_id", assetIds)
    .in("identifier_type", ["isin", "t212_ticker"]);

  const byAsset = new Map<string, { isin?: string; ticker?: string }>();
  for (const row of identifiers ?? []) {
    const entry = byAsset.get(row.asset_id as string) ?? {};
    if (row.identifier_type === "isin") entry.isin = row.identifier_value as string;
    if (row.identifier_type === "t212_ticker") entry.ticker = row.identifier_value as string;
    byAsset.set(row.asset_id as string, entry);
  }

  const provider = createTwelveDataProvider(process.env.TWELVEDATA_API_KEY!);
  let persisted = 0;
  let skipped = 0;

  for (const asset of assets ?? []) {
    const known = byAsset.get(asset.id as string) ?? {};
    const identity: AssetIdentity = {
      ticker: known.ticker ?? null,
      isin: known.isin ?? null,
      providerSymbol: null,
    };

    const resolved = await provider.resolveSymbol(identity);
    if (!resolved) {
      console.log(`skip: ${asset.canonical_name} — no symbol resolved`);
      skipped += 1;
      continue;
    }

    const { data: existing } = await admin
      .from("asset_identifiers")
      .select("id")
      .eq("asset_id", asset.id)
      .eq("identifier_type", "vendor_symbol")
      .eq("source", provider.name)
      .maybeSingle();

    if (existing) {
      await admin
        .from("asset_identifiers")
        .update({ identifier_value: resolved.symbol })
        .eq("id", existing.id);
    } else {
      await admin.from("asset_identifiers").insert({
        asset_id: asset.id,
        identifier_type: "vendor_symbol",
        identifier_value: resolved.symbol,
        source: provider.name,
      });
    }

    console.log(`persisted: ${asset.canonical_name} -> ${resolved.symbol} (${resolved.currency})`);
    persisted += 1;
  }

  console.log(`\nDone. Persisted ${persisted}, skipped ${skipped}.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
