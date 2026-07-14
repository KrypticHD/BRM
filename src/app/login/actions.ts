"use server";

import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/server/allowlist";

export type SignInState = {
  status: "idle" | "sent" | "error";
  message?: string;
};

export async function signInWithEmail(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { status: "error", message: "Enter an email address." };
  }

  if (!isAllowedEmail(email)) {
    return {
      status: "error",
      message: "That email isn't authorized for this app.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (error) {
    return { status: "error", message: "Could not send sign-in link. Try again." };
  }

  return { status: "sent", message: `Check ${email} for a sign-in link.` };
}
