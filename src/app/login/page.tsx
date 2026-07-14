"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signInWithEmail, type SignInState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { BrmLogo } from "@/components/brm-logo";

const initialState: SignInState = { status: "idle" };

function LoginForm() {
  const searchParams = useSearchParams();
  const notAllowed = searchParams.get("error") === "not_allowed";
  const [state, formAction, pending] = useActionState(
    signInWithEmail,
    initialState,
  );

  return (
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
      <Button type="submit" disabled={pending} className="w-full">
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
  );
}

export default function LoginPage() {
  return (
    <main className="relative flex min-h-full flex-1 items-center justify-center overflow-hidden bg-background p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 15%, color-mix(in oklab, var(--brm-sage) 22%, transparent) 0%, transparent 45%), radial-gradient(circle at 85% 80%, color-mix(in oklab, var(--brm-gold) 18%, transparent) 0%, transparent 45%)",
        }}
      />

      <Card className="relative w-full max-w-sm border-border/70 shadow-lg">
        <CardContent className="flex flex-col items-center gap-6 pt-2 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <BrmLogo className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-primary">
                BRM
              </h1>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Know Your Wealth
              </p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Sign in with your email to continue.
          </p>

          <div className="w-full text-left">
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
