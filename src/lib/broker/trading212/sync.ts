import "server-only";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { getBrokerCredential } from "@/lib/server/broker-credentials";
import { Trading212Client, decodeTrading212Credential } from "./client";
import {
  normalizeDividend,
  normalizeOrder,
  normalizeTransaction,
  type NormalizedTransaction,
} from "./normalize";

type AdminClient = ReturnType<typeof createAdminClient>;

function hashPayload(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function resolveAssetId(admin: AdminClient, ticker: string): Promise<string> {
  const { data: existing } = await admin
    .from("asset_identifiers")
    .select("asset_id")
    .eq("identifier_type", "t212_ticker")
    .eq("identifier_value", ticker)
    .maybeSingle();

  if (existing) return existing.asset_id as string;

  const { data: asset, error: assetError } = await admin
    .from("assets")
    .insert({ canonical_name: ticker, asset_type: "equity", primary_currency: "GBP" })
    .select()
    .single();
  if (assetError) throw assetError;

  const { error: identifierError } = await admin.from("asset_identifiers").insert({
    asset_id: asset.id,
    identifier_type: "t212_ticker",
    identifier_value: ticker,
    source: "trading212",
  });
  if (identifierError) throw identifierError;

  return asset.id as string;
}

/**
 * Writes the raw broker payload before any normalisation, per CLAUDE.md's
 * data-integrity rule. Returns null (not an error) when the dedup unique
 * indexes from the Session 2 migration reject the insert as a duplicate —
 * that's the mechanism that makes re-syncing idempotent.
 */
async function writeSourceEvent(
  admin: AdminClient,
  params: {
    accountId: string;
    connectionId: string;
    externalId: string | null;
    eventType: string;
    rawPayload: unknown;
    occurredAt: string;
  },
): Promise<string | null> {
  const { data, error } = await admin
    .from("source_events")
    .insert({
      account_id: params.accountId,
      connection_id: params.connectionId,
      source: "trading212",
      external_id: params.externalId,
      event_type: params.eventType,
      raw_payload: params.rawPayload,
      occurred_at: params.occurredAt,
      payload_hash: hashPayload(params.rawPayload),
      processing_status: "pending",
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return null;
    throw error;
  }

  return data.id as string;
}

async function writeNormalizedTransaction(
  admin: AdminClient,
  params: { accountId: string; sourceEventId: string; normalized: NormalizedTransaction },
): Promise<void> {
  const { data: transaction, error: txError } = await admin
    .from("transactions")
    .insert({
      account_id: params.accountId,
      type: params.normalized.transactionType,
      executed_at: params.normalized.executedAt,
      source_event_id: params.sourceEventId,
      external_ref: params.normalized.externalRef,
      status: "settled",
    })
    .select()
    .single();
  if (txError) throw txError;

  const legRows = await Promise.all(
    params.normalized.legs.map(async (leg) => ({
      transaction_id: transaction.id,
      asset_id: leg.ticker ? await resolveAssetId(admin, leg.ticker) : null,
      currency: leg.currency,
      quantity_delta: leg.quantityDelta,
      cash_delta: leg.cashDelta,
      gbp_value: leg.gbpValue,
      leg_type: leg.legType,
    })),
  );

  const { error: legsError } = await admin.from("transaction_legs").insert(legRows);
  if (legsError) throw legsError;
}

export interface SyncResult {
  ordersSynced: number;
  dividendsSynced: number;
  transactionsSynced: number;
  skippedDuplicates: number;
}

export async function syncTrading212Connection(connectionId: string): Promise<SyncResult> {
  const admin = createAdminClient();

  const { data: connection, error: connectionError } = await admin
    .from("broker_connections")
    .select("*")
    .eq("id", connectionId)
    .single();
  if (connectionError || !connection) {
    throw new Error(`Connection not found: ${connectionError?.message}`);
  }

  const { data: account, error: accountError } = await admin
    .from("accounts")
    .select("*")
    .eq("broker_connection_id", connectionId)
    .single();
  if (accountError || !account) {
    throw new Error(`No account found for connection: ${accountError?.message}`);
  }

  const { data: syncRun, error: syncRunError } = await admin
    .from("sync_runs")
    .insert({ connection_id: connectionId, status: "running" })
    .select()
    .single();
  if (syncRunError) throw syncRunError;

  const result: SyncResult = {
    ordersSynced: 0,
    dividendsSynced: 0,
    transactionsSynced: 0,
    skippedDuplicates: 0,
  };

  try {
    const credential = await getBrokerCredential(connection.vault_secret_id);
    const { apiKeyId, secretKey } = decodeTrading212Credential(credential);
    const client = new Trading212Client(apiKeyId, secretKey, connection.environment);

    // Sequential, not Promise.all — each endpoint has its own rate-limit
    // bucket, but firing requests concurrently would race the client's
    // per-bucket wait logic before either response's headers land.
    const cash = await client.getAccountCash();
    const positions = await client.getPositions();
    await writeSourceEvent(admin, {
      accountId: account.id,
      connectionId,
      externalId: null,
      eventType: "account_snapshot",
      rawPayload: { cash, positions },
      occurredAt: new Date().toISOString(),
    });

    for await (const order of client.getOrders()) {
      const sourceEventId = await writeSourceEvent(admin, {
        accountId: account.id,
        connectionId,
        externalId: String(order.order.id),
        eventType: "order",
        rawPayload: order,
        occurredAt: order.fill?.filledAt ?? order.order.createdAt,
      });
      if (!sourceEventId) {
        result.skippedDuplicates += 1;
        continue;
      }
      const normalized = normalizeOrder(order, account.base_currency);
      if (normalized) {
        await writeNormalizedTransaction(admin, {
          accountId: account.id,
          sourceEventId,
          normalized,
        });
        result.ordersSynced += 1;
      }
    }

    for await (const dividend of client.getDividends()) {
      const sourceEventId = await writeSourceEvent(admin, {
        accountId: account.id,
        connectionId,
        externalId: dividend.reference,
        eventType: "dividend",
        rawPayload: dividend,
        occurredAt: dividend.paidOn,
      });
      if (!sourceEventId) {
        result.skippedDuplicates += 1;
        continue;
      }
      const normalized = normalizeDividend(dividend, account.base_currency);
      await writeNormalizedTransaction(admin, {
        accountId: account.id,
        sourceEventId,
        normalized,
      });
      result.dividendsSynced += 1;
    }

    for await (const transaction of client.getTransactions()) {
      const sourceEventId = await writeSourceEvent(admin, {
        accountId: account.id,
        connectionId,
        externalId: transaction.reference,
        eventType: "cash_transaction",
        rawPayload: transaction,
        occurredAt: transaction.dateTime,
      });
      if (!sourceEventId) {
        result.skippedDuplicates += 1;
        continue;
      }
      const normalized = normalizeTransaction(transaction, account.base_currency);
      await writeNormalizedTransaction(admin, {
        accountId: account.id,
        sourceEventId,
        normalized,
      });
      result.transactionsSynced += 1;
    }

    await admin
      .from("sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        records_synced:
          result.ordersSynced + result.dividendsSynced + result.transactionsSynced,
      })
      .eq("id", syncRun.id);

    await admin
      .from("broker_connections")
      .update({
        last_synced_at: new Date().toISOString(),
        last_successful_sync_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
      })
      .eq("id", connectionId);

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_detail: message,
      })
      .eq("id", syncRun.id);
    await admin
      .from("broker_connections")
      .update({
        last_synced_at: new Date().toISOString(),
        last_error_message: message,
      })
      .eq("id", connectionId);
    throw err;
  }
}
