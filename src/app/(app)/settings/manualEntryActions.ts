"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { writeSourceEvent, writeNormalizedTransaction } from "@/lib/broker/trading212/writeHelpers";
import type { NormalizedTransaction } from "@/lib/broker/trading212/normalize";
import type { TransactionKind } from "@/lib/ledger/types";

export type ManualEntryState = {
  status: "idle" | "error" | "success";
  message?: string;
};

const CASH_ONLY_TYPES: TransactionKind[] = [
  "dividend",
  "transfer_in",
  "transfer_out",
  "fee",
  "interest",
  "other",
];

/**
 * AJ Bell fallback per Session 8 — a clean manual entry flow for brokers
 * without a usable CSV export. Still goes through the same
 * source_events-first, writeNormalizedTransaction path every other
 * import uses (source="manual"), so manual entries are auditable and
 * participate in the same dedup machinery, not a special case bolted on
 * the side.
 */
export async function submitManualEntry(
  _prevState: ManualEntryState,
  formData: FormData,
): Promise<ManualEntryState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Not authenticated." };

  const accountId = String(formData.get("accountId") ?? "");
  const type = String(formData.get("type") ?? "") as TransactionKind;
  const date = String(formData.get("date") ?? "");
  const currency = String(formData.get("currency") ?? "GBP").trim() || "GBP";
  const amount = Number(formData.get("amount"));
  const ticker = String(formData.get("ticker") ?? "").trim() || null;
  const isin = String(formData.get("isin") ?? "").trim() || null;
  const quantityRaw = formData.get("quantity");
  const quantity = quantityRaw ? Number(quantityRaw) : null;

  if (!accountId || !type || !date || Number.isNaN(amount)) {
    return { status: "error", message: "Fill in all required fields." };
  }

  const { data: owned } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .maybeSingle();
  if (!owned) {
    return { status: "error", message: "Account not found." };
  }

  const executedAt = new Date(date).toISOString();
  const externalRef = `manual-${user.id}-${Date.now()}`;
  let normalized: NormalizedTransaction;

  if (type === "buy" || type === "sell") {
    if (!quantity || quantity <= 0) {
      return { status: "error", message: "Enter a quantity for a buy or sell." };
    }
    if (!ticker && !isin) {
      return { status: "error", message: "Enter a ticker or ISIN for a buy or sell." };
    }
    const isBuy = type === "buy";
    const grossValue = Math.abs(amount);
    normalized = {
      externalRef,
      transactionType: type,
      executedAt,
      legs: [
        {
          legType: "asset",
          ticker,
          isin,
          currency,
          quantityDelta: isBuy ? Math.abs(quantity) : -Math.abs(quantity),
          cashDelta: null,
          gbpValue: grossValue,
        },
        {
          legType: "cash",
          ticker: null,
          isin: null,
          currency,
          quantityDelta: null,
          cashDelta: isBuy ? -grossValue : grossValue,
          gbpValue: grossValue,
        },
      ],
    };
  } else if (CASH_ONLY_TYPES.includes(type)) {
    const signedAmount =
      type === "transfer_out" || type === "fee" ? -Math.abs(amount) : amount;
    normalized = {
      externalRef,
      transactionType: type,
      executedAt,
      legs: [
        {
          legType: type === "fee" ? "fee" : "cash",
          ticker,
          isin,
          currency,
          quantityDelta: null,
          cashDelta: signedAmount,
          gbpValue: Math.abs(signedAmount),
        },
      ],
    };
  } else {
    return { status: "error", message: "Unsupported transaction type." };
  }

  const admin = createAdminClient();
  const rawPayload = {
    accountId,
    type,
    date,
    currency,
    amount,
    ticker,
    isin,
    quantity,
    enteredBy: user.email,
  };

  const sourceEventId = await writeSourceEvent(admin, {
    accountId,
    connectionId: null,
    importId: null,
    source: "manual",
    externalId: externalRef,
    eventType: `manual_${type}`,
    rawPayload,
    occurredAt: executedAt,
  });

  if (!sourceEventId) {
    return { status: "error", message: "That looks like a duplicate entry." };
  }

  await writeNormalizedTransaction(admin, { accountId, sourceEventId, normalized });

  revalidatePath("/");
  revalidatePath("/holdings");
  revalidatePath("/transactions");
  revalidatePath("/dividends");

  return { status: "success", message: "Transaction added." };
}
