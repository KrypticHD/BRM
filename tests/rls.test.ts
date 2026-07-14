import { config } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { TEST_USER_A, TEST_USER_B } from "../supabase/testUsers";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function signInAs(email: string, password: string) {
  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

describe("RLS isolation between users", () => {
  let clientA: Awaited<ReturnType<typeof signInAs>>;
  let clientB: Awaited<ReturnType<typeof signInAs>>;
  let accountAId: string;
  let accountBId: string;

  beforeAll(async () => {
    clientA = await signInAs(TEST_USER_A.email, TEST_USER_A.password);
    clientB = await signInAs(TEST_USER_B.email, TEST_USER_B.password);

    const { data: accountsA } = await admin
      .from("accounts")
      .select("id")
      .eq("name", "Test User A GIA")
      .limit(1)
      .single();
    const { data: accountsB } = await admin
      .from("accounts")
      .select("id")
      .eq("name", "Test User B GIA")
      .limit(1)
      .single();

    accountAId = accountsA!.id;
    accountBId = accountsB!.id;
  });

  it("lets user A see only their own account", async () => {
    const { data, error } = await clientA.from("accounts").select("id");
    expect(error).toBeNull();
    const ids = data!.map((row) => row.id);
    expect(ids).toContain(accountAId);
    expect(ids).not.toContain(accountBId);
  });

  it("lets user B see only their own account", async () => {
    const { data, error } = await clientB.from("accounts").select("id");
    expect(error).toBeNull();
    const ids = data!.map((row) => row.id);
    expect(ids).toContain(accountBId);
    expect(ids).not.toContain(accountAId);
  });

  it("blocks user A from reading user B's account by id directly", async () => {
    const { data, error } = await clientA
      .from("accounts")
      .select("id")
      .eq("id", accountBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("blocks user A from reading user B's transactions", async () => {
    const { data: bTransactions } = await admin
      .from("transactions")
      .select("id")
      .eq("account_id", accountBId);
    const bTransactionId = bTransactions![0].id;

    const { data, error } = await clientA
      .from("transactions")
      .select("id")
      .eq("id", bTransactionId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("blocks user A from reading user B's transaction legs", async () => {
    const { data: bLegs } = await admin
      .from("transaction_legs")
      .select("id, transaction_id, transactions!inner(account_id)")
      .eq("transactions.account_id", accountBId);
    const bLegId = bLegs![0].id;

    const { data, error } = await clientA
      .from("transaction_legs")
      .select("id")
      .eq("id", bLegId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("blocks user A from reading user B's cash ledger entries", async () => {
    const { data, error } = await clientA
      .from("cash_ledger_entries")
      .select("id")
      .eq("account_id", accountBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("blocks an anonymous (unauthenticated) client from reading any accounts", async () => {
    const anon = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anon.from("accounts").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("Vault broker-credential functions", () => {
  it("round-trips a secret through insert_broker_credential / get_broker_credential via service_role", async () => {
    const plaintext = `test-secret-${Date.now()}`;

    const { data: vaultId, error: insertError } = await admin.rpc(
      "insert_broker_credential",
      { p_secret: plaintext, p_name: "vitest-rls-test" },
    );
    expect(insertError).toBeNull();
    expect(vaultId).toBeTruthy();

    const { data: retrieved, error: getError } = await admin.rpc(
      "get_broker_credential",
      { p_vault_secret_id: vaultId },
    );
    expect(getError).toBeNull();
    expect(retrieved).toBe(plaintext);
  });

  it("blocks a regular authenticated user from calling the vault functions", async () => {
    const clientA = await signInAs(TEST_USER_A.email, TEST_USER_A.password);

    const { error: insertError } = await clientA.rpc(
      "insert_broker_credential",
      { p_secret: "should-not-work", p_name: "vitest-should-fail" },
    );
    expect(insertError).not.toBeNull();

    const { error: getError } = await clientA.rpc("get_broker_credential", {
      p_vault_secret_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(getError).not.toBeNull();
  });
});
