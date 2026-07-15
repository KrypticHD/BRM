import { Layers } from "lucide-react";
import Decimal from "decimal.js";
import { getAggregatedHoldings } from "@/lib/portfolio/getAggregatedHoldings";

function money(amount: Decimal, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    amount.toNumber(),
  );
}

export default async function Holdings() {
  const holdings = await getAggregatedHoldings();

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground">Holdings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything you hold, merged across accounts.
        </p>
      </header>

      {holdings.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-border bg-card px-8 py-10 text-center shadow-sm">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary/40 text-primary">
              <Layers className="h-6 w-6" strokeWidth={1.75} />
            </div>
            <h2 className="text-base font-semibold text-foreground">No holdings yet</h2>
            <p className="text-sm text-muted-foreground">
              Connect or import a broker account to see your positions here.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-8">
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Asset</th>
                  <th className="px-6 py-3">Quantity</th>
                  <th className="px-6 py-3">Avg cost</th>
                  <th className="px-6 py-3">Price</th>
                  <th className="px-6 py-3">Market value</th>
                  <th className="px-6 py-3">Unrealised P/L</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((holding) => (
                  <tr key={holding.assetId} className="border-t border-border align-top">
                    <td className="px-6 py-3">
                      <div className="font-medium text-foreground">{holding.name}</div>
                      {holding.byAccount.length > 1 ? (
                        <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                          {holding.byAccount.map((contribution) => (
                            <span key={contribution.accountId}>
                              {contribution.accountName}: {contribution.quantity.toFixed(4)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {holding.byAccount[0].accountName}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {holding.totalQuantity.toFixed(4)}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {money(holding.averageCost, holding.currency)}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {holding.currentPrice ? money(holding.currentPrice, holding.currency) : "—"}
                      {holding.priceDate && (
                        <span className="ml-1 text-xs text-muted-foreground/70">
                          ({holding.priceDate})
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {holding.marketValue ? money(holding.marketValue, holding.currency) : "—"}
                    </td>
                    <td
                      className={`px-6 py-3 ${
                        holding.unrealisedPl?.isNegative() ? "text-destructive" : "text-primary"
                      }`}
                    >
                      {holding.unrealisedPl ? money(holding.unrealisedPl, holding.currency) : "—"}
                    </td>
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
