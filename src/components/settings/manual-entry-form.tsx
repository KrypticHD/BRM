"use client";

import { useActionState, useState } from "react";
import { submitManualEntry, type ManualEntryState } from "@/app/(app)/settings/manualEntryActions";
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

const TYPE_OPTIONS = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "dividend", label: "Dividend" },
  { value: "transfer_in", label: "Deposit" },
  { value: "transfer_out", label: "Withdrawal" },
  { value: "fee", label: "Fee" },
  { value: "interest", label: "Interest" },
];

const NEEDS_QUANTITY = new Set(["buy", "sell"]);

const initialState: ManualEntryState = { status: "idle" };

export function ManualEntryForm({ accounts }: { accounts: Account[] }) {
  const [state, formAction, pending] = useActionState(submitManualEntry, initialState);
  const [type, setType] = useState("buy");
  const needsQuantity = NEEDS_QUANTITY.has(type);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add transaction manually</CardTitle>
        <CardDescription>
          For brokers without a usable export (e.g. AJ Bell) — enter a trade,
          dividend, or cash movement directly.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="accountId">Account</Label>
              <Select name="accountId" defaultValue={accounts[0]?.id}>
                <SelectTrigger id="accountId" className="w-full">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="type">Type</Label>
              <Select name="type" value={type} onValueChange={(v) => setType(v ?? "buy")}>
                <SelectTrigger id="type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" name="currency" defaultValue="GBP" required />
            </div>
          </div>

          {(needsQuantity || type === "dividend") && (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ticker">Ticker</Label>
                <Input id="ticker" name="ticker" placeholder="e.g. AAPL" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="isin">ISIN (optional)</Label>
                <Input id="isin" name="isin" placeholder="e.g. US0378331005" />
              </div>
            </div>
          )}

          {needsQuantity && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input id="quantity" name="quantity" type="number" step="any" min="0" required />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="amount">
              {needsQuantity ? "Total value" : "Amount"}
            </Label>
            <Input id="amount" name="amount" type="number" step="any" required />
          </div>

          <Button type="submit" disabled={pending || accounts.length === 0}>
            {pending ? "Adding…" : "Add transaction"}
          </Button>

          {accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Connect or import an account first.
            </p>
          )}
          {state.status !== "idle" && (
            <p
              className={
                state.status === "error"
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {state.message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
