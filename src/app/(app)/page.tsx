import { Wallet } from "lucide-react";
import { getAccountSnapshots } from "@/lib/portfolio/getAccountSnapshots";
import Decimal from "decimal.js";

function money(amount: Decimal, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    amount.toNumber(),
  );
}

export default async function Overview() {
  const accounts = await getAccountSnapshots();

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground">Portfolio Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your accounts, holdings, and performance in one place.
        </p>
      </header>

      {accounts.length === 0 ? (
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
      ) : (
        <div className="flex flex-col gap-8 p-8">
          {accounts.map((account) => (
            <section
              key={account.accountId}
              className="rounded-2xl border border-border bg-card shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <h2 className="text-lg font-semibold text-foreground">
                  {account.accountName}
                </h2>
                <span className="text-sm text-muted-foreground">{account.currency}</span>
              </div>

              <div className="grid grid-cols-2 gap-4 border-b border-border p-6 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Total value</p>
                  <p className="mt-1 text-xl font-semibold text-foreground">
                    {money(account.totalValue, account.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cash</p>
                  <p className="mt-1 text-xl font-semibold text-foreground">
                    {money(account.cash, account.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Market value</p>
                  <p className="mt-1 text-xl font-semibold text-foreground">
                    {money(account.marketValue, account.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Unrealised P/L</p>
                  <p
                    className={`mt-1 text-xl font-semibold ${
                      account.unrealisedPl.isNegative() ? "text-destructive" : "text-primary"
                    }`}
                  >
                    {money(account.unrealisedPl, account.currency)}
                  </p>
                </div>
              </div>

              {account.holdings.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No open positions.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="px-6 py-2">Asset</th>
                        <th className="px-6 py-2">Quantity</th>
                        <th className="px-6 py-2">Avg cost</th>
                        <th className="px-6 py-2">Price</th>
                        <th className="px-6 py-2">Market value</th>
                        <th className="px-6 py-2">Unrealised P/L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {account.holdings.map((holding) => (
                        <tr key={holding.assetId} className="border-t border-border">
                          <td className="px-6 py-2.5 font-medium text-foreground">
                            {holding.name}
                          </td>
                          <td className="px-6 py-2.5 text-muted-foreground">
                            {holding.quantity.toFixed(4)}
                          </td>
                          <td className="px-6 py-2.5 text-muted-foreground">
                            {money(holding.averageCost, account.currency)}
                          </td>
                          <td className="px-6 py-2.5 text-muted-foreground">
                            {holding.currentPrice
                              ? money(holding.currentPrice, account.currency)
                              : "—"}
                            {holding.priceDate && (
                              <span className="ml-1 text-xs text-muted-foreground/70">
                                ({holding.priceDate})
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-2.5 text-muted-foreground">
                            {holding.marketValue
                              ? money(holding.marketValue, account.currency)
                              : "—"}
                          </td>
                          <td
                            className={`px-6 py-2.5 ${
                              holding.unrealisedPl?.isNegative()
                                ? "text-destructive"
                                : "text-primary"
                            }`}
                          >
                            {holding.unrealisedPl
                              ? money(holding.unrealisedPl, account.currency)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
