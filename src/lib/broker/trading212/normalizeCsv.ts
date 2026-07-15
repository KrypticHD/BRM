import type { TransactionKind } from "@/lib/ledger/types";
import type { NormalizedLeg, NormalizedTransaction } from "./normalize";
import type { T212CsvRow } from "./csvTypes";

function parseNum(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n;
}

function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * CSV order IDs are "EOF" + the same numeric id the live API reports as
 * order.id (confirmed: CSV "EOF52072234412" corresponds to the same order
 * the API would report as order.id 52072234412) — stripping the prefix
 * means a CSV-imported and later API-synced copy of the same order dedupe
 * against each other via the shared external_id unique index, instead of
 * silently double-counting.
 */
function normalizeExternalId(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("EOF") ? trimmed.slice(3) : trimmed;
}

function feeTotalFor(row: T212CsvRow): number {
  const conversionFee = Math.abs(parseNum(row["Currency conversion fee"]) ?? 0);
  const frenchTax = Math.abs(parseNum(row["French transaction tax"]) ?? 0);
  return conversionFee + frenchTax;
}

/**
 * Parses one row from Trading 212's CSV export into the same
 * NormalizedTransaction shape the API sync produces, so both paths feed
 * the same commit logic. Returns null for row types with no ledger effect
 * or that can't be parsed (caller should flag these for manual review,
 * not silently drop them).
 *
 * Verified against a real export: Total (in Currency (Total), the
 * account's own currency) is already net of fees — the gross value used
 * for cost basis is derived back out the same way as the API path (Total
 * minus fees for a buy, plus fees for a sell), confirmed by hand-tracing
 * real rows where the deposit amount exactly equals the following buy's
 * Total.
 */
export function normalizeCsvRow(
  row: T212CsvRow,
  accountCurrency: string,
): NormalizedTransaction | null {
  const action = row.Action.trim();
  const total = parseNum(row.Total);
  if (total === null) return null;

  const currency = nullIfEmpty(row["Currency (Total)"]) ?? accountCurrency;
  const executedAt = row["Time (UTC)"].trim();
  const externalId = normalizeExternalId(row.ID);
  const externalRef = externalId ?? `csv-${executedAt}-${row.Action}-${total}`;

  if (action === "Deposit") {
    return cashOnlyTransaction(externalRef, "transfer_in", executedAt, currency, total);
  }

  if (action === "Withdrawal") {
    return cashOnlyTransaction(
      externalRef,
      "transfer_out",
      executedAt,
      currency,
      -Math.abs(total),
    );
  }

  if (action.toLowerCase().startsWith("dividend")) {
    const subtypeMatch = action.match(/\(([^)]+)\)/);
    const transactionType: TransactionKind =
      subtypeMatch && subtypeMatch[1].toLowerCase().includes("interest")
        ? "interest"
        : "dividend";
    return cashOnlyTransaction(externalRef, transactionType, executedAt, currency, total);
  }

  if (action.toLowerCase().includes("interest")) {
    return cashOnlyTransaction(externalRef, "interest", executedAt, currency, total);
  }

  const isBuy = action.toLowerCase().endsWith(" buy") || action.toLowerCase() === "buy";
  const isSell = action.toLowerCase().endsWith(" sell") || action.toLowerCase() === "sell";
  if (isBuy || isSell) {
    const quantity = parseNum(row["No. of shares"]);
    if (quantity === null) return null;

    const feeTotal = feeTotalFor(row);
    const netValue = Math.abs(total);
    const grossValue = isBuy ? netValue - feeTotal : netValue + feeTotal;

    const legs: NormalizedLeg[] = [
      {
        legType: "asset",
        ticker: nullIfEmpty(row.Ticker),
        isin: nullIfEmpty(row.ISIN),
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
    ];

    if (feeTotal > 0) {
      legs.push({
        legType: "fee",
        ticker: null,
        isin: null,
        currency,
        quantityDelta: null,
        cashDelta: -feeTotal,
        gbpValue: feeTotal,
      });
    }

    return {
      externalRef,
      transactionType: isBuy ? "buy" : "sell",
      executedAt,
      legs,
    };
  }

  // Unrecognised action (e.g. corporate actions, pie rebalances) — the
  // caller should surface this for manual review rather than treat it as
  // successfully imported.
  return null;
}

function cashOnlyTransaction(
  externalRef: string,
  transactionType: TransactionKind,
  executedAt: string,
  currency: string,
  amount: number,
): NormalizedTransaction {
  return {
    externalRef,
    transactionType,
    executedAt,
    legs: [
      {
        legType: "cash",
        ticker: null,
        isin: null,
        currency,
        quantityDelta: null,
        cashDelta: amount,
        gbpValue: Math.abs(amount),
      },
    ],
  };
}
