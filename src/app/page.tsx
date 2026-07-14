import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 bg-background p-6 text-center">
      <div className="flex items-center gap-2 text-2xl font-semibold text-primary">
        BRM
      </div>
      <p className="text-muted-foreground">
        Signed in as <span className="text-foreground">{user?.email}</span>
      </p>
      <form action={signOut}>
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </main>
  );
}
