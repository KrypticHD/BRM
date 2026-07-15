import "server-only";
import Decimal from "decimal.js";
import { createClient } from "@/lib/supabase/server";
import { computeHoldings } from "@/lib/ledger/holdings";
import { computeCashBalances } from "@/lib/ledger/cash";
import { computeMarketValueGbp, computeUnrealisedPlGbp } from "@/lib/ledger/accountValue";
import type { TransactionKind, TransactionLeg } from "@/lib/ledger/types";

export interface HoldingRow {
  assetId: string;
  name: string;
  quantity: Decimal;
  averageCost: Decimal;
  costBasis: Decimal;
  currentPrice: Decimal | null;
  marketValue: Decimal | null;
  unrealisedPl: Decimal | null;
  priceDate: string | null;
}

export interface AccountSnapshot {
  accountId: string;
  accountName: string;
  currency: string;
  cash: Decimal;
  marketValue: Decimal;
  unrealisedPl: Decimal;
  totalValue: Decimal;
  holdings: HoldingRow[];
}

/**
 * Per-account snapshot — holdings/cash/P&L are always derived from
 * transaction_legs at query time (per CLAUDE.md), never a stored
 * "current holdings" table. Deliberately does NOT merge holdings across
 * accounts (that's Session 8's cross-broker aggregation) or use
 * portfolio_snapshots for a time series (Session 9) — this is just
 * "what do I actually own right now, per account, priced with whatever
 * price_snapshots data exists."
 */
export async function getAccountSnapshots(): Promise<AccountSnapshot[]> {
  const supabase = await createClient();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, base_currency")
    .order("created_at", { ascending: true });
  if (!accounts || accounts.length === 0) return [];

  const snapshots: AccountSnapshot[] = [];

  for (const account of accounts) {
    const { data: legRows } = await supabase
      .from("transaction_legs")
      .select(
        "id, asset_id, currency, quantity_delta, cash_delta, gbp_value, leg_type, transactions!inner(id, type, executed_at, account_id)",
      )
      .eq("transactions.account_id", account.id);

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
    const openHoldings = holdings.filter((h) => !h.quantity.isZero());
    const cashBalances = computeCashBalances(legs);

    const assetIds = openHoldings.map((h) => h.assetId);

    const [{ data: assets }, { data: priceRows }] = await Promise.all([
      assetIds.length > 0
        ? supabase.from("assets").select("id, canonical_name").in("id", assetIds)
        : Promise.resolve({ data: [] as Array<{ id: string; canonical_name: string }> }),
      assetIds.length > 0
        ? supabase
            .from("price_snapshots")
            .select("asset_id, date, close_price")
            .in("asset_id", assetIds)
            .order("date", { ascending: false })
        : Promise.resolve({ data: [] as Array<{ asset_id: string; date: string; close_price: string }> }),
    ]);

    const nameByAsset = new Map((assets ?? []).map((a) => [a.id, a.canonical_name]));

    const priceByAsset = new Map<string, { price: Decimal; date: string }>();
    for (const row of priceRows ?? []) {
      if (!priceByAsset.has(row.asset_id)) {
        priceByAsset.set(row.asset_id, { price: new Decimal(row.close_price), date: row.date });
      }
    }

    const prices: Record<string, Decimal> = {};
    for (const [assetId, p] of priceByAsset) prices[assetId] = p.price;

    const cash = cashBalances
      .filter((c) => c.currency === account.base_currency)
      .reduce((sum, c) => sum.plus(c.amount), new Decimal(0));
    const marketValue = computeMarketValueGbp(openHoldings, prices);
    const unrealisedPl = computeUnrealisedPlGbp(openHoldings, prices);

    snapshots.push({
      accountId: account.id,
      accountName: account.name,
      currency: account.base_currency,
      cash,
      marketValue,
      unrealisedPl,
      totalValue: cash.plus(marketValue),
      holdings: openHoldings.map((h) => {
        const priceInfo = priceByAsset.get(h.assetId);
        return {
          assetId: h.assetId,
          name: nameByAsset.get(h.assetId) ?? h.assetId,
          quantity: h.quantity,
          averageCost: h.averageCostGbp,
          costBasis: h.costBasisGbp,
          currentPrice: priceInfo?.price ?? null,
          marketValue: priceInfo ? h.quantity.times(priceInfo.price) : null,
          unrealisedPl: priceInfo
            ? h.quantity.times(priceInfo.price).minus(h.costBasisGbp)
            : null,
          priceDate: priceInfo?.date ?? null,
        };
      }),
    });
  }

  return snapshots;
}
