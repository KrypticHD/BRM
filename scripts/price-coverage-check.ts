/**
 * Standalone coverage check: for every real held asset, tries to resolve
 * + quote it against Twelve Data and (a small sample of) EODHD, per
 * Session 6 of docs/SESSION_PLAN.md. Read-only — reports matches/gaps,
 * doesn't write anything. Run with:
 *
 *   TWELVEDATA_API_KEY=... EODHD_API_KEY=... npx tsx scripts/price-coverage-check.ts
 *
 * Either key can be omitted to skip that provider.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createTwelveDataProvider } from "../src/lib/pricing/providers/twelvedata";
import { createEodhdProvider } from "../src/lib/pricing/providers/eodhd";
import type { AssetIdentity, PriceProvider } from "../src/lib/pricing/types";

config({ path: ".env.local" });

// EODHD's free tier is 20 requests/day; resolve+quote is 2 requests per
// asset, so only a small sample is checked against it, not the full list.
const EODHD_SAMPLE_SIZE = 8;

interface HeldAsset {
  assetId: string;
  name: string;
  ticker: string | null;
  isin: string | null;
}

async function loadHeldAssets(): Promise<HeldAsset[]> {
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
  if (assetIds.length === 0) return [];

  const { data: assets, error: assetsError } = await admin
    .from("assets")
    .select("id, canonical_name")
    .in("id", assetIds);
  if (assetsError) throw assetsError;

  const { data: identifiers, error: idError } = await admin
    .from("asset_identifiers")
    .select("asset_id, identifier_type, identifier_value")
    .in("asset_id", assetIds)
    .in("identifier_type", ["isin", "t212_ticker"]);
  if (idError) throw idError;

  const byAsset = new Map<string, { isin?: string; ticker?: string }>();
  for (const row of identifiers ?? []) {
    const entry = byAsset.get(row.asset_id as string) ?? {};
    if (row.identifier_type === "isin") entry.isin = row.identifier_value as string;
    if (row.identifier_type === "t212_ticker") entry.ticker = row.identifier_value as string;
    byAsset.set(row.asset_id as string, entry);
  }

  return (assets ?? []).map((a) => ({
    assetId: a.id as string,
    name: a.canonical_name as string,
    ticker: byAsset.get(a.id as string)?.ticker ?? null,
    isin: byAsset.get(a.id as string)?.isin ?? null,
  }));
}

async function checkProvider(
  provider: PriceProvider,
  assets: HeldAsset[],
): Promise<{ name: string; matches: number; gaps: string[] }> {
  let matches = 0;
  const gaps: string[] = [];

  for (const asset of assets) {
    const identity: AssetIdentity = {
      ticker: asset.ticker,
      isin: asset.isin,
      providerSymbol: null,
    };
    try {
      const resolved = await provider.resolveSymbol(identity);
      if (!resolved) {
        gaps.push(`${asset.name} (${asset.isin ?? asset.ticker ?? "no identifier"}) — no symbol match`);
        continue;
      }
      const quote = await provider.getQuote(resolved.symbol);
      if (!quote) {
        gaps.push(`${asset.name} — resolved to ${resolved.symbol} but quote fetch failed`);
        continue;
      }
      matches += 1;
    } catch (err) {
      gaps.push(`${asset.name} — error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { name: provider.name, matches, gaps };
}

async function main() {
  const assets = await loadHeldAssets();
  console.log(`Loaded ${assets.length} held assets.\n`);

  if (process.env.TWELVEDATA_API_KEY) {
    const provider = createTwelveDataProvider(process.env.TWELVEDATA_API_KEY);
    const report = await checkProvider(provider, assets);
    console.log(`=== Twelve Data: ${report.matches}/${assets.length} matched ===`);
    report.gaps.forEach((g) => console.log(`  gap: ${g}`));
    console.log();
  } else {
    console.log("=== Twelve Data: skipped (no TWELVEDATA_API_KEY) ===\n");
  }

  if (process.env.EODHD_API_KEY) {
    const sample = assets.slice(0, EODHD_SAMPLE_SIZE);
    const provider = createEodhdProvider(process.env.EODHD_API_KEY);
    const report = await checkProvider(provider, sample);
    console.log(
      `=== EODHD: ${report.matches}/${sample.length} matched (sample of ${EODHD_SAMPLE_SIZE} — free tier is 20 req/day) ===`,
    );
    report.gaps.forEach((g) => console.log(`  gap: ${g}`));
    console.log();
  } else {
    console.log("=== EODHD: skipped (no EODHD_API_KEY) ===\n");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
