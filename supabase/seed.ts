import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
import { TEST_USER_A, TEST_USER_B } from "./testUsers";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function deleteExistingUser(email: string) {
  const { data } = await admin.auth.admin.listUsers();
  const existing = data.users.find((u) => u.email === email);
  if (existing) {
    await admin.auth.admin.deleteUser(existing.id);
  }
}

async function createTestUser(email: string, password: string) {
  await deleteExistingUser(email);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Failed to create user ${email}: ${error?.message}`);
  }
  return data.user.id;
}

async function seedAccountData(userId: string, label: string) {
  const { data: account, error: accountError } = await admin
    .from("accounts")
    .insert({
      user_id: userId,
      broker: "trading212",
      account_type: "gia",
      name: `${label} GIA`,
      base_currency: "GBP",
    })
    .select()
    .single();
  if (accountError) throw accountError;

  const { data: asset, error: assetError } = await admin
    .from("assets")
    .insert({
      canonical_name: "iShares Core FTSE 100 ETF",
      asset_type: "etf",
      primary_currency: "GBP",
    })
    .select()
    .single();
  if (assetError) throw assetError;

  const { data: transaction, error: txError } = await admin
    .from("transactions")
    .insert({
      account_id: account.id,
      type: "buy",
      executed_at: new Date().toISOString(),
      status: "settled",
    })
    .select()
    .single();
  if (txError) throw txError;

  const { error: legsError } = await admin.from("transaction_legs").insert([
    {
      transaction_id: transaction.id,
      asset_id: asset.id,
      currency: "GBP",
      quantity_delta: "10",
      gbp_value: "800.00",
      leg_type: "asset",
    },
    {
      transaction_id: transaction.id,
      currency: "GBP",
      cash_delta: "-800.00",
      gbp_value: "800.00",
      leg_type: "cash",
    },
  ]);
  if (legsError) throw legsError;

  const { error: cashError } = await admin.from("cash_ledger_entries").insert({
    account_id: account.id,
    currency: "GBP",
    amount: "1000.00",
    entry_type: "deposit",
    occurred_at: new Date().toISOString(),
  });
  if (cashError) throw cashError;

  return account.id;
}

async function main() {
  const userAId = await createTestUser(TEST_USER_A.email, TEST_USER_A.password);
  const userBId = await createTestUser(TEST_USER_B.email, TEST_USER_B.password);

  const accountAId = await seedAccountData(userAId, "Test User A");
  const accountBId = await seedAccountData(userBId, "Test User B");

  console.log("Seeded test users:");
  console.log(`  ${TEST_USER_A.email} -> user ${userAId}, account ${accountAId}`);
  console.log(`  ${TEST_USER_B.email} -> user ${userBId}, account ${accountBId}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
