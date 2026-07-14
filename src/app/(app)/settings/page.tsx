import { createClient } from "@/lib/supabase/server";
import { ConnectTrading212Form } from "@/components/settings/connect-form";
import { ConnectionCard } from "@/components/settings/connection-card";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: connections } = await supabase
    .from("broker_connections")
    .select("id, environment, status, last_synced_at, last_successful_sync_at, last_error_message")
    .order("created_at", { ascending: false });

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect and manage your broker accounts.
        </p>
      </header>

      <div className="flex flex-col gap-6 p-8 max-w-xl">
        {(connections ?? []).map((connection) => (
          <ConnectionCard key={connection.id} connection={connection} />
        ))}
        <ConnectTrading212Form />
      </div>
    </div>
  );
}
