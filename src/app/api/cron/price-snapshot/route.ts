import { NextResponse } from "next/server";
import { runPriceSnapshot } from "@/lib/pricing/snapshot";
import { getConfiguredEquityProvider } from "@/lib/pricing/providerFactory";

/**
 * Vercel Hobby cron fires at most once/day, anywhere within the scheduled
 * hour, UTC only (see vercel.json — scheduled generously rather than
 * targeting an exact post-close minute). Safe to retry: runPriceSnapshot
 * upserts on (asset_id, date) / (date, from_ccy, to_ccy), so a duplicate
 * invocation within the same day changes nothing.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const provider = getConfiguredEquityProvider();
    const result = await runPriceSnapshot(provider);
    return NextResponse.json({ ok: true, provider: provider.name, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Price snapshot failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
