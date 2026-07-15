import { Coins } from "lucide-react";
import Decimal from "decimal.js";
import { getDividends } from "@/lib/portfolio/getDividends";

function money(amount: Decimal, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    amount.toNumber(),
  );
}

export default async function Dividends() {
  const { rows, ytdTotalsByCurrency } = await getDividends();

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground">Dividends</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dividend and interest income across your accounts.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-border bg-card px-8 py-10 text-center shadow-sm">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary/40 text-primary">
              <Coins className="h-6 w-6" strokeWidth={1.75} />
            </div>
            <h2 className="text-base font-semibold text-foreground">No income yet</h2>
            <p className="text-sm text-muted-foreground">
              Dividends and interest will show up here once they arrive.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6 p-8">
          <div className="flex flex-wrap gap-4">
            {ytdTotalsByCurrency.map(({ currency, total }) => (
              <div
                key={currency}
                className="rounded-2xl border border-border bg-card px-6 py-4 shadow-sm"
              >
                <p className="text-xs text-muted-foreground">
                  {currency} received (YTD {new Date().getFullYear()})
                </p>
                <p className="mt-1 text-xl font-semibold text-primary">
                  {money(total, currency)}
                </p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Account</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Asset</th>
                  <th className="px-6 py-3">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-6 py-2.5 text-muted-foreground">
                      {new Date(row.executedAt).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-6 py-2.5 text-muted-foreground">{row.accountName}</td>
                    <td className="px-6 py-2.5 font-medium text-foreground">
                      {row.type === "dividend" ? "Dividend" : "Interest"}
                    </td>
                    <td className="px-6 py-2.5 text-muted-foreground">
                      {row.assetName ?? "—"}
                    </td>
                    <td className="px-6 py-2.5 text-primary">{money(row.amount, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
