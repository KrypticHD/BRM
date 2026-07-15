"use client";

import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import { importCsvAction } from "@/app/(app)/settings/csvImportActions";
import { normalizeCsvRow } from "@/lib/broker/trading212/normalizeCsv";
import { T212CsvRowSchema, type T212CsvRow } from "@/lib/broker/trading212/csvTypes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Account {
  id: string;
  name: string;
}

const NEW_ACCOUNT_VALUE = "__new__";

function inferBaseCurrency(rows: T212CsvRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const currency = row["Currency (Total)"].trim();
    if (!currency) continue;
    counts.set(currency, (counts.get(currency) ?? 0) + 1);
  }
  let best = "GBP";
  let bestCount = 0;
  for (const [currency, count] of counts) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best;
}

export function CsvImportForm({ accounts }: { accounts: Account[] }) {
  const [isPending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<T212CsvRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>(
    accounts[0]?.id ?? NEW_ACCOUNT_VALUE,
  );
  const [newAccountName, setNewAccountName] = useState("Trading 212 (CSV Import)");
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (!rows) return null;
    const currency = inferBaseCurrency(rows);
    const normalized = rows.map((row) => ({
      row,
      normalized: normalizeCsvRow(row, currency),
    }));
    return {
      currency,
      willImport: normalized.filter((r) => r.normalized !== null).length,
      needsReview: normalized.filter((r) => r.normalized === null).length,
      sample: normalized.slice(0, 15),
    };
  }, [rows]);

  function handleFile(file: File) {
    setResultMessage(null);
    setParseError(null);
    setFileName(file.name);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedRows: T212CsvRow[] = [];
        for (const raw of results.data) {
          const validated = T212CsvRowSchema.safeParse(raw);
          if (validated.success) {
            parsedRows.push(validated.data);
          }
        }
        if (parsedRows.length === 0) {
          setParseError(
            "Couldn't read any valid rows — check this is a Trading 212 export CSV.",
          );
          setRows(null);
          return;
        }
        setRows(parsedRows);
      },
      error: (err) => {
        setParseError(err.message);
      },
    });
  }

  function handleCommit() {
    if (!rows || !preview) return;
    startTransition(async () => {
      const usingNewAccount = selectedAccount === NEW_ACCOUNT_VALUE;
      const res = await importCsvAction({
        accountId: usingNewAccount ? null : selectedAccount,
        newAccountName: usingNewAccount ? newAccountName : null,
        baseCurrency: preview.currency,
        filename: fileName ?? "import.csv",
        rows,
      });
      setResultMessage(res.message);
      if (res.ok) {
        setRows(null);
        setFileName(null);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Trading 212 CSV</CardTitle>
        <CardDescription>
          Upload a CSV export (History &gt; export, in the app) to backfill
          history — including trades older than the API returns. Preview
          before committing; rows already synced via the API connection are
          skipped automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="csvFile">CSV file</Label>
          <Input
            id="csvFile"
            type="file"
            accept=".csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>

        {parseError && <p className="text-sm text-destructive">{parseError}</p>}

        {preview && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="account">Import into</Label>
              <Select value={selectedAccount} onValueChange={(v) => setSelectedAccount(v ?? NEW_ACCOUNT_VALUE)}>
                <SelectTrigger id="account" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_ACCOUNT_VALUE}>+ New account</SelectItem>
                </SelectContent>
              </Select>
              {selectedAccount === NEW_ACCOUNT_VALUE && (
                <Input
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="Account name"
                />
              )}
            </div>

            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p>
                <span className="font-medium text-foreground">{rows!.length}</span>{" "}
                rows parsed, inferred currency{" "}
                <span className="font-medium text-foreground">{preview.currency}</span>.
              </p>
              <p className="text-muted-foreground">
                {preview.willImport} will be imported, {preview.needsReview} need
                manual review (unrecognised row type).
              </p>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5">Date</th>
                    <th className="px-2 py-1.5">Action</th>
                    <th className="px-2 py-1.5">Ticker</th>
                    <th className="px-2 py-1.5">Amount</th>
                    <th className="px-2 py-1.5">Parsed as</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map(({ row, normalized }, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1.5">{row["Time (UTC)"].slice(0, 10)}</td>
                      <td className="px-2 py-1.5">{row.Action}</td>
                      <td className="px-2 py-1.5">{row.Ticker || "—"}</td>
                      <td className="px-2 py-1.5">
                        {row.Total} {row["Currency (Total)"]}
                      </td>
                      <td className="px-2 py-1.5">
                        {normalized ? (
                          normalized.transactionType
                        ) : (
                          <span className="text-destructive">needs review</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows!.length > preview.sample.length && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  +{rows!.length - preview.sample.length} more rows not shown
                </p>
              )}
            </div>

            <Button onClick={handleCommit} disabled={isPending}>
              {isPending ? "Importing…" : `Import ${preview.willImport} transactions`}
            </Button>
          </>
        )}

        {resultMessage && <p className="text-sm text-muted-foreground">{resultMessage}</p>}
      </CardContent>
    </Card>
  );
}
