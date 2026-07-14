import { Wallet } from "lucide-react";

export default function Overview() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground">Portfolio Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your accounts, holdings, and performance in one place.
        </p>
      </header>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-border bg-card px-8 py-10 text-center shadow-sm">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary/40 text-primary">
            <Wallet className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-foreground">
              No accounts connected yet
            </h2>
            <p className="text-sm text-muted-foreground">
              Connect Trading 212, Vanguard, or AJ Bell to start tracking your
              portfolio here.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
