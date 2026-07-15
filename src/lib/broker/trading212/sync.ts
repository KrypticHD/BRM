import "server-only";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { getBrokerCredential } from "@/lib/server/broker-credentials";
import { Trading212Client, decodeTrading212Credential } from "./client";
import { normalizeDividend, normalizeOrder, normalizeTransaction } from "./normalize";
import { writeSourceEvent, writeNormalizedTransaction } from "./writeHelpers";

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
      importId: null,
      source: "trading212",
      externalId: null,
      eventType: "account_snapshot",
      rawPayload: { cash, positions },
      occurredAt: new Date().toISOString(),
    });

    for await (const order of client.getOrders()) {
      const sourceEventId = await writeSourceEvent(admin, {
        accountId: account.id,
        connectionId,
        importId: null,
        source: "trading212",
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
        importId: null,
        source: "trading212",
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
        importId: null,
        source: "trading212",
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
