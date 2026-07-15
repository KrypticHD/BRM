import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { runPriceSnapshot } from "@/lib/pricing/snapshot";
import type { PriceProvider } from "@/lib/pricing/types";
import { TEST_USER_A } from "../../supabase/testUsers";

config({ path: ".env.local" });

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const STUB_PROVIDER_NAME = "vitest-stub-provider";

function makeStubProvider(price: number): PriceProvider {
  return {
    name: STUB_PROVIDER_NAME,
    resolveSymbol: async () => ({ symbol: "STUB", currency: "GBP" }),
    getQuote: async () => ({ price, asOf: new Date().toISOString().slice(0, 10) }),
  };
}

let accountId: string;
let assetId: string;

beforeAll(async () => {
  const { data } = await admin.auth.admin.listUsers();
  const user = data.users.find((u) => u.email === TEST_USER_A.email);
  if (!user) throw new Error("Run `npm run db:seed` before this test suite.");

  const { data: account, error: accountError } = await admin
    .from("accounts")
    .insert({
      user_id: user.id,
      broker: "trading212",
      account_type: "gia",
      name: "Price snapshot test account",
      base_currency: "GBP",
    })
    .select()
    .single();
  if (accountError) throw accountError;
  accountId = account.id;

  const { data: asset, error: assetError } = await admin
    .from("assets")
    .insert({ canonical_name: "Snapshot Test Asset", asset_type: "equity", primary_currency: "GBP" })
    .select()
    .single();
  if (assetError) throw assetError;
  assetId = asset.id;

  const { error: identifierError } = await admin.from("asset_identifiers").insert({
    asset_id: assetId,
    identifier_type: "vendor_symbol",
    identifier_value: "STUB",
    source: STUB_PROVIDER_NAME,
  });
  if (identifierError) throw identifierError;

  const { data: transaction, error: txError } = await admin
    .from("transactions")
    .insert({
      account_id: accountId,
      type: "buy",
      executed_at: new Date().toISOString(),
      status: "settled",
    })
    .select()
    .single();
  if (txError) throw txError;

  const { error: legError } = await admin.from("transaction_legs").insert({
    transaction_id: transaction.id,
    asset_id: assetId,
    currency: "GBP",
    quantity_delta: "10",
    gbp_value: "1000",
    leg_type: "asset",
  });
  if (legError) throw legError;
});

afterAll(async () => {
  if (accountId) await admin.from("accounts").delete().eq("id", accountId);
  if (assetId) await admin.from("assets").delete().eq("id", assetId);
});

describe("runPriceSnapshot", () => {
  it("writes a price_snapshots row for a held asset with a resolved vendor symbol", async () => {
    const result = await runPriceSnapshot(makeStubProvider(123.45));
    expect(result.pricesWritten).toBeGreaterThanOrEqual(1);

    const { data: snapshot } = await admin
      .from("price_snapshots")
      .select("close_price")
      .eq("asset_id", assetId)
      .single();
    expect(Number(snapshot!.close_price)).toBe(123.45);
  });

  it("is idempotent: re-running with an updated price upserts rather than erroring or duplicating", async () => {
    await runPriceSnapshot(makeStubProvider(200));
    const result = await runPriceSnapshot(makeStubProvider(999.99));
    expect(result.pricesWritten).toBeGreaterThanOrEqual(1);

    const { data: snapshots } = await admin
      .from("price_snapshots")
      .select("close_price")
      .eq("asset_id", assetId);
    expect(snapshots).toHaveLength(1); // one row per (asset_id, date), not accumulating
    expect(Number(snapshots![0].close_price)).toBe(999.99);
  }, 15000); // two real Frankfurter round-trips + DB writes

  it("also writes GBP/USD/EUR fx_rates", async () => {
    await runPriceSnapshot(makeStubProvider(1));
    const { data: fx } = await admin
      .from("fx_rates")
      .select("from_ccy, to_ccy")
      .in("from_ccy", ["GBP", "USD", "EUR"]);
    expect(fx!.length).toBeGreaterThanOrEqual(4);
  });
});
