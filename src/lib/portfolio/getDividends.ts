import "server-only";
import Decimal from "decimal.js";
import { createClient } from "@/lib/supabase/server";

export interface DividendRow {
  id: string;
  accountName: string;
  assetName: string | null;
  executedAt: string;
  type: "dividend" | "interest";
  amount: Decimal;
  currency: string;
}

export interface DividendSummary {
  rows: DividendRow[];
  /** Grouped by currency — not converted/summed across currencies, same
   * scope limitation as the rest of the app until fx_rates-aware
   * aggregation exists. */
  ytdTotalsByCurrency: Array<{ currency: string; total: Decimal }>;
}

export async function getDividends(): Promise<DividendSummary> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, type, executed_at, accounts!inner(name), transaction_legs(cash_delta, currency, assets(canonical_name))",
    )
    .in("type", ["dividend", "interest"])
    .order("executed_at", { ascending: false });
  if (error) throw error;

  const rows: DividendRow[] = (data ?? []).map((row) => {
    const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
    const leg = row.transaction_legs?.[0];
    const asset = leg?.assets ? (Array.isArray(leg.assets) ? leg.assets[0] : leg.assets) : null;

    return {
      id: row.id,
      accountName: account?.name ?? "—",
      assetName: asset?.canonical_name ?? null,
      executedAt: row.executed_at,
      type: row.type as "dividend" | "interest",
      amount: new Decimal(leg?.cash_delta ?? 0),
      currency: leg?.currency ?? "GBP",
    };
  });

  const currentYear = new Date().getFullYear();
  const totalsByCurrency = new Map<string, Decimal>();
  for (const row of rows) {
    if (new Date(row.executedAt).getFullYear() !== currentYear) continue;
    const current = totalsByCurrency.get(row.currency) ?? new Decimal(0);
    totalsByCurrency.set(row.currency, current.plus(row.amount));
  }

  return {
    rows,
    ytdTotalsByCurrency: Array.from(totalsByCurrency.entries()).map(([currency, total]) => ({
      currency,
      total,
    })),
  };
}
