import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { TEST_USER_A } from "../../supabase/testUsers";

config({ path: ".env.local" });

/**
 * "Importing identical source data twice changes nothing" is enforced at
 * the source_events dedup boundary (unique indexes from the Session 2
 * migration), not inside the ledger math itself — the engine trusts that
 * whatever legs it's given are already deduplicated. This test proves the
 * boundary actually rejects duplicates, which is what makes that invariant
 * true in practice.
 */
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let userId: string;
let accountId: string;

beforeAll(async () => {
  const { data } = await admin.auth.admin.listUsers();
  const user = data.users.find((u) => u.email === TEST_USER_A.email);
  if (!user) throw new Error("Run `npm run db:seed` before this test suite.");
  userId = user.id;

  const { data: account, error } = await admin
    .from("accounts")
    .insert({
      user_id: userId,
      broker: "trading212",
      account_type: "gia",
      name: "Idempotency test account",
      base_currency: "GBP",
    })
    .select()
    .single();
  if (error) throw error;
  accountId = account.id;
});

afterAll(async () => {
  if (accountId) {
    await admin.from("accounts").delete().eq("id", accountId);
  }
});

describe("source_events dedup constraints", () => {
  it("rejects a second insert with the same (account_id, source, external_id)", async () => {
    const row = {
      account_id: accountId,
      source: "trading212",
      external_id: "ext-dedup-test-1",
      event_type: "order",
      raw_payload: { foo: "bar" },
      occurred_at: new Date().toISOString(),
      payload_hash: "hash-a",
    };

    const first = await admin.from("source_events").insert(row);
    expect(first.error).toBeNull();

    const second = await admin
      .from("source_events")
      .insert({ ...row, payload_hash: "hash-b" }); // even with a different hash
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505"); // unique_violation
  });

  it("rejects a second insert with the same (account_id, payload_hash)", async () => {
    const row = {
      account_id: accountId,
      source: "trading212",
      external_id: null,
      event_type: "order",
      raw_payload: { foo: "bar" },
      occurred_at: new Date().toISOString(),
      payload_hash: "hash-shared",
    };

    const first = await admin.from("source_events").insert(row);
    expect(first.error).toBeNull();

    const second = await admin
      .from("source_events")
      .insert({ ...row, external_id: null });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505");
  });
});
