"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { commitCsvImport, type CsvImportResult } from "@/lib/broker/trading212/csvImport";
import type { T212CsvRow } from "@/lib/broker/trading212/csvTypes";

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

export async function importCsvAction(params: {
  accountId: string | null;
  newAccountName: string | null;
  baseCurrency: string;
  filename: string;
  rows: T212CsvRow[];
}): Promise<{ ok: boolean; message: string; result?: CsvImportResult }> {
  const userId = await requireUserId();
  const admin = createAdminClient();

  let accountId = params.accountId;

  if (!accountId) {
    if (!params.newAccountName?.trim()) {
      return { ok: false, message: "Enter a name for the new account." };
    }
    const { data: account, error } = await admin
      .from("accounts")
      .insert({
        user_id: userId,
        broker: "trading212",
        account_type: "gia",
        name: params.newAccountName.trim(),
        base_currency: params.baseCurrency,
      })
      .select()
      .single();
    if (error) return { ok: false, message: error.message };
    accountId = account.id;
  } else {
    // Ownership check — accountId came from the client, and commitCsvImport
    // uses the admin client internally (RLS bypassed), so this is the
    // only place ownership actually gets verified.
    const supabase = await createClient();
    const { data: owned } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .maybeSingle();
    if (!owned) {
      return { ok: false, message: "Account not found." };
    }
  }

  if (!accountId) {
    return { ok: false, message: "Could not resolve an account to import into." };
  }

  try {
    const result = await commitCsvImport(accountId, params.filename, params.rows);
    revalidatePath("/settings");
    return {
      ok: true,
      message: `Imported ${result.imported} of ${result.total} rows (${result.duplicatesSkipped} already synced, ${result.flaggedForReview} flagged for review, ${result.unparseable} unrecognised).`,
      result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed.";
    return { ok: false, message };
  }
}
