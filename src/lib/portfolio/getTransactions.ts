import "server-only";
import Decimal from "decimal.js";
import { createClient } from "@/lib/supabase/server";

export interface TransactionLegRow {
  legType: string;
  assetName: string | null;
  quantityDelta: Decimal | null;
  cashDelta: Decimal | null;
  currency: string;
  gbpValue: Decimal;
}

export interface TransactionRow {
  id: string;
  accountName: string;
  type: string;
  executedAt: string;
  netCashDelta: Decimal;
  currency: string;
  legs: TransactionLegRow[];
}

export async function getTransactions(limit = 300): Promise<TransactionRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, type, executed_at, accounts!inner(name), transaction_legs(leg_type, quantity_delta, cash_delta, currency, gbp_value, assets(canonical_name))",
    )
    .order("executed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => {
    const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
    const legs: TransactionLegRow[] = (row.transaction_legs ?? []).map((leg) => {
      const asset = Array.isArray(leg.assets) ? leg.assets[0] : leg.assets;
      return {
        legType: leg.leg_type,
        assetName: asset?.canonical_name ?? null,
        quantityDelta: leg.quantity_delta === null ? null : new Decimal(leg.quantity_delta),
        cashDelta: leg.cash_delta === null ? null : new Decimal(leg.cash_delta),
        currency: leg.currency,
        gbpValue: new Decimal(leg.gbp_value),
      };
    });

    const netCashDelta = legs.reduce(
      (sum, leg) => (leg.cashDelta ? sum.plus(leg.cashDelta) : sum),
      new Decimal(0),
    );

    return {
      id: row.id,
      accountName: account?.name ?? "—",
      type: row.type,
      executedAt: row.executed_at,
      netCashDelta,
      currency: legs[0]?.currency ?? "GBP",
      legs,
    };
  });
}
