import "server-only";
import Decimal from "decimal.js";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { getBrokerCredential } from "@/lib/server/broker-credentials";
import { computeAccountValueGbp } from "@/lib/ledger/accountValue";
import { computeCashBalances } from "@/lib/ledger/cash";
import { computeHoldings } from "@/lib/ledger/holdings";
import type { TransactionKind, TransactionLeg } from "@/lib/ledger/types";
import { Trading212Client, decodeTrading212Credential } from "./client";

export interface ReconciliationResult {
  brokerReportedTotalGbp: string;
  brmComputedTotalGbp: string;
  deltaGbp: string;
}

export async function reconcileTrading212Connection(
  connectionId: string,
): Promise<ReconciliationResult> {
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

  const credential = await getBrokerCredential(connection.vault_secret_id);
  const { apiKeyId, secretKey } = decodeTrading212Credential(credential);
  const client = new Trading212Client(apiKeyId, secretKey, connection.environment);
  const cash = await client.getAccountCash();
  const positions = await client.getPositions();

  const brokerReportedTotal = new Decimal(cash.total);

  // BRM's own computed total, purely from stored transaction_legs — never
  // from a cached/derived table, per CLAUDE.md.
  const { data: legRows, error: legsError } = await admin
    .from("transaction_legs")
    .select(
      "id, asset_id, currency, quantity_delta, cash_delta, gbp_value, leg_type, transactions!inner(id, type, executed_at, account_id)",
    )
    .eq("transactions.account_id", account.id);
  if (legsError) throw legsError;

  const legs: TransactionLeg[] = (legRows ?? []).map((row) => {
    const tx = Array.isArray(row.transactions) ? row.transactions[0] : row.transactions;
    return {
      transactionId: tx.id,
      transactionType: tx.type as TransactionKind,
      executedAt: new Date(tx.executed_at),
      assetId: row.asset_id,
      currency: row.currency,
      quantityDelta: row.quantity_delta === null ? null : new Decimal(row.quantity_delta),
      cashDelta: row.cash_delta === null ? null : new Decimal(row.cash_delta),
      gbpValue: new Decimal(row.gbp_value),
      legType: row.leg_type,
    };
  });

  const { holdings } = computeHoldings(legs);
  const cashBalances = computeCashBalances(legs);

  // Ticker -> assetId, to price holdings using T212's own live prices
  // (price_snapshots doesn't exist yet — that's Session 6).
  const { data: identifiers } = await admin
    .from("asset_identifiers")
    .select("asset_id, identifier_value")
    .eq("identifier_type", "t212_ticker");

  const tickerByAssetId = new Map<string, string>();
  for (const row of identifiers ?? []) {
    tickerByAssetId.set(row.asset_id, row.identifier_value);
  }

  const priceByTicker = new Map(positions.map((p) => [p.ticker, p.currentPrice]));
  const prices: Record<string, Decimal> = {};
  for (const holding of holdings) {
    const ticker = tickerByAssetId.get(holding.assetId);
    const price = ticker ? priceByTicker.get(ticker) : undefined;
    if (price !== undefined) {
      prices[holding.assetId] = new Decimal(price);
    }
  }

  const brmComputedTotal = computeAccountValueGbp(
    cashBalances,
    holdings,
    prices,
    account.base_currency,
  );

  return {
    brokerReportedTotalGbp: brokerReportedTotal.toFixed(2),
    brmComputedTotalGbp: brmComputedTotal.toFixed(2),
    deltaGbp: brokerReportedTotal.minus(brmComputedTotal).toFixed(2),
  };
}
