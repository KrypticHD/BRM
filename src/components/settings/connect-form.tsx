"use client";

import { useActionState, useState } from "react";
import { connectTrading212, type ConnectState } from "@/app/(app)/settings/actions";
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

const initialState: ConnectState = { status: "idle" };

export function ConnectTrading212Form() {
  const [state, formAction, pending] = useActionState(
    connectTrading212,
    initialState,
  );
  const [environment, setEnvironment] = useState("live");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect Trading 212</CardTitle>
        <CardDescription>
          Paste the API Key ID and Secret Key from Trading 212 (Settings &gt;
          API, in the app). The secret is only ever shown once when you
          create the key — copy it now. Both are encrypted via Supabase
          Vault and never returned to the browser after this.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="environment">Environment</Label>
            <Select
              name="environment"
              value={environment}
              onValueChange={(value) => setEnvironment(value ?? "live")}
            >
              <SelectTrigger id="environment" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="demo">Practice (Demo)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="apiKeyId">API Key ID</Label>
            <Input
              id="apiKeyId"
              name="apiKeyId"
              type="text"
              autoComplete="off"
              placeholder="e.g. 48793497..."
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="secretKey">Secret Key</Label>
            <Input
              id="secretKey"
              name="secretKey"
              type="password"
              autoComplete="off"
              placeholder="Paste your Trading 212 secret key"
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Connecting…" : "Connect"}
          </Button>
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
