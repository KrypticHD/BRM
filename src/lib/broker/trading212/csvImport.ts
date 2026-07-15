import "server-only";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { normalizeCsvRow } from "./normalizeCsv";
import {
  writeSourceEvent,
  writeNormalizedTransaction,
  findPossibleDuplicateTransaction,
} from "./writeHelpers";
import type { T212CsvRow } from "./csvTypes";

export interface CsvImportResult {
  imported: number;
  duplicatesSkipped: number;
  flaggedForReview: number;
  unparseable: number;
  total: number;
}

function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * source is "trading212" — the same value the API sync path uses — not a
 * CSV-specific tag. The dedup unique index is on (account_id, source,
 * external_id); if this were tagged differently, a CSV-imported order and
 * the same order later synced via the API would never collide and the
 * account would silently double-count. event_type carries the
 * csv-vs-api/row-type distinction instead, which isn't part of the index.
 */
export async function commitCsvImport(
  accountId: string,
  filename: string,
  rows: T212CsvRow[],
): Promise<CsvImportResult> {
  const admin = createAdminClient();

  const { data: account, error: accountError } = await admin
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .single();
  if (accountError || !account) {
    throw new Error(`Account not found: ${accountError?.message}`);
  }

  const { data: importRow, error: importError } = await admin
    .from("imports")
    .insert({
      account_id: accountId,
      broker: "trading212",
      filename,
      row_count: rows.length,
      status: "pending",
    })
    .select()
    .single();
  if (importError) throw importError;

  const result: CsvImportResult = {
    imported: 0,
    duplicatesSkipped: 0,
    flaggedForReview: 0,
    unparseable: 0,
    total: rows.length,
  };

  try {
    for (const row of rows) {
      const normalized = normalizeCsvRow(row, account.base_currency);
      if (!normalized) {
        result.unparseable += 1;
        continue;
      }

      const rawId = row.ID.trim();
      const externalId = rawId.startsWith("EOF")
        ? rawId.slice(3)
        : nullIfEmpty(rawId);

      // Rows with no reliable external id (CSV dividends have none) get a
      // fuzzy near-duplicate check before insert, rather than being
      // trusted blindly — surfaced as "flagged for review", not silently
      // imported or silently skipped.
      if (!externalId) {
        const cashLegValue = normalized.legs.find((l) => l.legType === "cash")?.gbpValue ?? 0;
        const isPossibleDuplicate = await findPossibleDuplicateTransaction(admin, {
          accountId,
          transactionType: normalized.transactionType,
          executedAt: normalized.executedAt,
          gbpValue: cashLegValue,
        });
        if (isPossibleDuplicate) {
          result.flaggedForReview += 1;
          continue;
        }
      }

      const sourceEventId = await writeSourceEvent(admin, {
        accountId,
        connectionId: null,
        importId: importRow.id,
        source: "trading212",
        externalId,
        eventType: `csv_${normalized.transactionType}`,
        rawPayload: row,
        occurredAt: normalized.executedAt,
      });

      if (!sourceEventId) {
        result.duplicatesSkipped += 1;
        continue;
      }

      await writeNormalizedTransaction(admin, { accountId, sourceEventId, normalized });
      result.imported += 1;
    }

    await admin.from("imports").update({ status: "committed" }).eq("id", importRow.id);
    return result;
  } catch (err) {
    await admin.from("imports").update({ status: "failed" }).eq("id", importRow.id);
    throw err;
  }
}
