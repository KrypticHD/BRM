import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";

/**
 * "Last successful sync" state for the price pipeline — Session 6's own
 * done-when bar is just that this exists somewhere, even a simple
 * debug-style card. There's no dedicated price_sync_runs table; the
 * existence of a snapshot row for today's date already is the evidence
 * a sync succeeded, so this reads price_snapshots/fx_rates directly
 * rather than adding a table purely to track something the data already
 * proves.
 */
export async function PriceSyncStatus() {
  const supabase = await createClient();

  const [{ data: latestPrice }, { data: latestFx }] = await Promise.all([
    supabase
      .from("price_snapshots")
      .select("date, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("fx_rates")
      .select("date, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const { count: priceCount } = latestPrice
    ? await supabase
        .from("price_snapshots")
        .select("*", { count: "exact", head: true })
        .eq("date", latestPrice.date)
    : { count: 0 };

  const hasSynced = Boolean(latestPrice || latestFx);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Price pipeline</CardTitle>
        <Badge variant={hasSynced ? "default" : "secondary"}>
          {hasSynced ? "synced" : "never run"}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p>
          Last price snapshot:{" "}
          {latestPrice
            ? `${new Date(latestPrice.created_at).toLocaleString()} (${priceCount ?? 0} assets, date ${latestPrice.date})`
            : "never"}
        </p>
        <p>
          Last FX rate sync:{" "}
          {latestFx ? new Date(latestFx.created_at).toLocaleString() : "never"}
        </p>
      </CardContent>
    </Card>
  );
}
