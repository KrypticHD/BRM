"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { storeBrokerCredential } from "@/lib/server/broker-credentials";
import {
  Trading212Client,
  Trading212ApiError,
  encodeTrading212Credential,
} from "@/lib/broker/trading212/client";
import { syncTrading212Connection } from "@/lib/broker/trading212/sync";
import type { SyncResult } from "@/lib/broker/trading212/sync";
import {
  reconcileTrading212Connection,
  type ReconciliationResult,
} from "@/lib/broker/trading212/reconcile";

export type ConnectState = {
  status: "idle" | "error" | "success";
  message?: string;
};

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

export async function connectTrading212(
  _prevState: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const apiKeyId = String(formData.get("apiKeyId") ?? "").trim();
  const secretKey = String(formData.get("secretKey") ?? "").trim();
  const environment = String(formData.get("environment") ?? "live") as "live" | "demo";

  if (!apiKeyId || !secretKey) {
    return { status: "error", message: "Enter both the API Key ID and Secret Key." };
  }

  const userId = await requireUserId();

  let accountInfo;
  try {
    const client = new Trading212Client(apiKeyId, secretKey, environment);
    accountInfo = await client.getAccountInfo();
  } catch (err) {
    const message =
      err instanceof Trading212ApiError
        ? err.message
        : "Could not reach Trading 212 with that key.";
    return { status: "error", message };
  }

  const admin = createAdminClient();
  const vaultSecretId = await storeBrokerCredential(
    encodeTrading212Credential(apiKeyId, secretKey),
    `t212-${userId}-${Date.now()}`,
  );

  const { data: connection, error: connectionError } = await admin
    .from("broker_connections")
    .insert({
      user_id: userId,
      broker: "trading212",
      status: "active",
      vault_secret_id: vaultSecretId,
      environment,
    })
    .select()
    .single();
  if (connectionError) {
    return { status: "error", message: connectionError.message };
  }

  const { error: accountError } = await admin.from("accounts").insert({
    user_id: userId,
    broker_connection_id: connection.id,
    broker: "trading212",
    external_account_id: String(accountInfo.id),
    account_type: "gia",
    name: `Trading 212 (${environment === "demo" ? "Practice" : "Live"})`,
    base_currency: accountInfo.currencyCode,
  });
  if (accountError) {
    return { status: "error", message: accountError.message };
  }

  revalidatePath("/settings");
  return { status: "success", message: "Connected. You can sync now." };
}

export async function syncConnectionAction(
  connectionId: string,
): Promise<{ ok: boolean; message: string; result?: SyncResult }> {
  // syncTrading212Connection uses the admin client internally (required
  // for Vault access), which bypasses RLS — so ownership must be checked
  // here, against the caller's own RLS-scoped session, before it runs.
  const supabase = await createClient();
  const { data: owned } = await supabase
    .from("broker_connections")
    .select("id")
    .eq("id", connectionId)
    .maybeSingle();
  if (!owned) {
    return { ok: false, message: "Connection not found." };
  }

  try {
    const result = await syncTrading212Connection(connectionId);
    revalidatePath("/settings");
    return {
      ok: true,
      message: `Synced ${result.ordersSynced} orders, ${result.dividendsSynced} dividends, ${result.transactionsSynced} cash transactions (${result.skippedDuplicates} already synced).`,
      result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed.";
    return { ok: false, message };
  }
}

export async function reconcileConnectionAction(
  connectionId: string,
): Promise<{ ok: boolean; message: string; result?: ReconciliationResult }> {
  const supabase = await createClient();
  const { data: owned } = await supabase
    .from("broker_connections")
    .select("id")
    .eq("id", connectionId)
    .maybeSingle();
  if (!owned) {
    return { ok: false, message: "Connection not found." };
  }

  try {
    const result = await reconcileTrading212Connection(connectionId);
    return { ok: true, message: "Reconciliation complete.", result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reconciliation failed.";
    return { ok: false, message };
  }
}
