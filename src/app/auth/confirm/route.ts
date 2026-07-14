import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/server/allowlist";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (token_hash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });

    if (!error && isAllowedEmail(data.user?.email)) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    if (!error) {
      await supabase.auth.signOut();
    }
  }

  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
