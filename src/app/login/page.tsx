"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signInWithEmail, type SignInState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const initialState: SignInState = { status: "idle" };

export default function LoginPage() {
  const searchParams = useSearchParams();
  const notAllowed = searchParams.get("error") === "not_allowed";
  const [state, formAction, pending] = useActionState(
    signInWithEmail,
    initialState,
  );

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-primary">
            BRM
          </CardTitle>
          <CardDescription>Sign in with your email to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Sending link…" : "Send sign-in link"}
            </Button>
            {notAllowed && (
              <p className="text-sm text-destructive">
                That account isn&apos;t authorized for this app.
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
    </main>
  );
}
