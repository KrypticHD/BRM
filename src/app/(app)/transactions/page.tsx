import { ArrowLeftRight } from "lucide-react";
import Decimal from "decimal.js";
import { getTransactions } from "@/lib/portfolio/getTransactions";

function money(amount: Decimal, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    amount.toNumber(),
  );
}

function describe(legs: Awaited<ReturnType<typeof getTransactions>>[number]["legs"]) {
  const assetLeg = legs.find((l) => l.legType === "asset");
  if (assetLeg && assetLeg.quantityDelta) {
    const direction = assetLeg.quantityDelta.isPositive() ? "+" : "";
    return `${direction}${assetLeg.quantityDelta.toFixed(4)} ${assetLeg.assetName ?? "asset"}`;
  }
  return null;
}

const TYPE_LABEL: Record<string, string> = {
  buy: "Buy",
  sell: "Sell",
  dividend: "Dividend",
  transfer_in: "Deposit",
  transfer_out: "Withdrawal",
  fee: "Fee",
  interest: "Interest",
  fx: "FX",
  other: "Other",
};

export default async function Transactions() {
  const transactions = await getTransactions();

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground">Transactions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every buy, sell, dividend, and cash movement across your accounts.
        </p>
      </header>

      {transactions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-border bg-card px-8 py-10 text-center shadow-sm">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary/40 text-primary">
              <ArrowLeftRight className="h-6 w-6" strokeWidth={1.75} />
            </div>
            <h2 className="text-base font-semibold text-foreground">No transactions yet</h2>
            <p className="text-sm text-muted-foreground">
              Connect or import a broker account to see activity here.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-8">
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Account</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Details</th>
                  <th className="px-6 py-3">Cash impact</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-t border-border">
                    <td className="px-6 py-2.5 text-muted-foreground">
                      {new Date(tx.executedAt).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-6 py-2.5 text-muted-foreground">{tx.accountName}</td>
                    <td className="px-6 py-2.5 font-medium text-foreground">
                      {TYPE_LABEL[tx.type] ?? tx.type}
                    </td>
                    <td className="px-6 py-2.5 text-muted-foreground">
                      {describe(tx.legs) ?? "—"}
                    </td>
                    <td
                      className={`px-6 py-2.5 ${
                        tx.netCashDelta.isNegative() ? "text-destructive" : "text-primary"
                      }`}
                    >
                      {tx.netCashDelta.isZero() ? "—" : money(tx.netCashDelta, tx.currency)}
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
