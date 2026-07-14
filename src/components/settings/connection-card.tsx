"use client";

import { useState, useTransition } from "react";
import {
  reconcileConnectionAction,
  syncConnectionAction,
} from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ReconciliationResult } from "@/lib/broker/trading212/reconcile";

interface ConnectionCardProps {
  connection: {
    id: string;
    environment: string;
    status: string;
    last_synced_at: string | null;
    last_successful_sync_at: string | null;
    last_error_message: string | null;
  };
}

export function ConnectionCard({ connection }: ConnectionCardProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(
    null,
  );

  function handleSync() {
    startTransition(async () => {
      setMessage(null);
      const res = await syncConnectionAction(connection.id);
      setMessage(res.message);
    });
  }

  function handleReconcile() {
    startTransition(async () => {
      setMessage(null);
      const res = await reconcileConnectionAction(connection.id);
      if (res.ok && res.result) {
        setReconciliation(res.result);
      } else {
        setMessage(res.message);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          Trading 212 —{" "}
          <span className="font-normal text-muted-foreground">
            {connection.environment === "demo" ? "Practice" : "Live"}
          </span>
        </CardTitle>
        <Badge variant={connection.status === "active" ? "default" : "secondary"}>
          {connection.status}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Last synced:{" "}
          {connection.last_synced_at
            ? new Date(connection.last_synced_at).toLocaleString()
            : "never"}
        </p>

        <div className="flex gap-2">
          <Button size="sm" onClick={handleSync} disabled={isPending}>
            {isPending ? "Working…" : "Sync now"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleReconcile}
            disabled={isPending}
          >
            Reconcile
          </Button>
        </div>

        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        {connection.last_error_message && (
          <p className="text-sm text-destructive">
            Last error: {connection.last_error_message}
          </p>
        )}

        {reconciliation && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Broker-reported total</span>
              <span className="font-medium">£{reconciliation.brokerReportedTotalGbp}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">BRM-computed total</span>
              <span className="font-medium">£{reconciliation.brmComputedTotalGbp}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-border pt-1">
              <span className="text-muted-foreground">Delta</span>
              <span
                className={
                  reconciliation.deltaGbp === "0.00"
                    ? "font-semibold text-primary"
                    : "font-semibold text-destructive"
                }
              >
                £{reconciliation.deltaGbp}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
