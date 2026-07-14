import Link from "next/link";

export default function AuthCodeErrorPage() {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <h1 className="text-xl font-semibold text-primary">
        Sign-in link invalid or expired
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The link may have expired or already been used. Request a new one.
      </p>
      <Link href="/login" className="text-sm font-medium text-primary underline">
        Back to sign in
      </Link>
    </main>
  );
}
