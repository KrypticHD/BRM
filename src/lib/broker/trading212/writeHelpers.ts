import "server-only";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/server/supabase-admin";
import type { NormalizedTransaction } from "./normalize";

export type AdminClient = ReturnType<typeof createAdminClient>;

export function hashPayload(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Resolves (or creates) the asset for a leg. ISIN-first per
 * ARCHITECTURE.md — a ticker alone isn't a stable cross-broker identity.
 * Falls back to ticker-only matching when no ISIN is available (the live
 * API's portfolio/order responses don't always carry one).
 */
export async function resolveAssetId(
  admin: AdminClient,
  identity: { ticker: string | null; isin: string | null },
): Promise<string> {
  if (identity.isin) {
    const { data: byIsin } = await admin
      .from("asset_identifiers")
      .select("asset_id")
      .eq("identifier_type", "isin")
      .eq("identifier_value", identity.isin)
      .maybeSingle();
    if (byIsin) return byIsin.asset_id as string;
  }

  if (identity.ticker) {
    const { data: byTicker } = await admin
      .from("asset_identifiers")
      .select("asset_id")
      .eq("identifier_type", "t212_ticker")
      .eq("identifier_value", identity.ticker)
      .maybeSingle();
    if (byTicker) {
      // Backfill the ISIN identifier if we now have one and didn't before.
      if (identity.isin) {
        await admin.from("asset_identifiers").insert({
          asset_id: byTicker.asset_id,
          identifier_type: "isin",
          identifier_value: identity.isin,
          source: "trading212",
        });
      }
      return byTicker.asset_id as string;
    }
  }

  const canonicalName = identity.ticker ?? identity.isin ?? "unknown";
  const { data: asset, error: assetError } = await admin
    .from("assets")
    .insert({ canonical_name: canonicalName, asset_type: "equity", primary_currency: "GBP" })
    .select()
    .single();
  if (assetError) throw assetError;

  const identifierRows = [];
  if (identity.isin) {
    identifierRows.push({
      asset_id: asset.id,
      identifier_type: "isin",
      identifier_value: identity.isin,
      source: "trading212",
    });
  }
  if (identity.ticker) {
    identifierRows.push({
      asset_id: asset.id,
      identifier_type: "t212_ticker",
      identifier_value: identity.ticker,
      source: "trading212",
    });
  }
  if (identifierRows.length > 0) {
    const { error: identifierError } = await admin
      .from("asset_identifiers")
      .insert(identifierRows);
    if (identifierError) throw identifierError;
  }

  return asset.id as string;
}

/**
 * Writes the raw payload before any normalisation, per CLAUDE.md's
 * data-integrity rule. Returns null (not an error) when the dedup unique
 * indexes from the Session 2 migration reject the insert as a duplicate —
 * that's the mechanism that makes re-syncing / re-importing idempotent.
 */
export async function writeSourceEvent(
  admin: AdminClient,
  params: {
    accountId: string;
    connectionId: string | null;
    importId: string | null;
    source: string;
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
      import_id: params.importId,
      source: params.source,
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

export async function writeNormalizedTransaction(
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
      asset_id:
        leg.ticker || leg.isin
          ? await resolveAssetId(admin, { ticker: leg.ticker, isin: leg.isin })
          : null,
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

/**
 * Fuzzy duplicate check for rows with no reliable external id to dedupe
 * on (e.g. CSV dividend rows — Trading 212's export doesn't include one).
 * Not a replacement for the exact source_events unique indexes — this is
 * the "flag rather than silently overwrite" layer for near-matches:
 * same account, type, day, and amount (within a cent) as an existing
 * transaction already suggests it's the same real-world event surfacing
 * through a different import path.
 */
export async function findPossibleDuplicateTransaction(
  admin: AdminClient,
  params: { accountId: string; transactionType: string; executedAt: string; gbpValue: number },
): Promise<boolean> {
  const day = params.executedAt.slice(0, 10);
  const { data } = await admin
    .from("transactions")
    .select("id, transaction_legs!inner(gbp_value, leg_type)")
    .eq("account_id", params.accountId)
    .eq("type", params.transactionType)
    .gte("executed_at", `${day}T00:00:00Z`)
    .lt("executed_at", `${day}T23:59:59.999Z`);

  if (!data) return false;

  return data.some((tx) => {
    const legs = Array.isArray(tx.transaction_legs) ? tx.transaction_legs : [tx.transaction_legs];
    return legs.some(
      (leg: { gbp_value: number; leg_type: string }) =>
        leg.leg_type === "cash" && Math.abs(leg.gbp_value - params.gbpValue) < 0.01,
    );
  });
}
