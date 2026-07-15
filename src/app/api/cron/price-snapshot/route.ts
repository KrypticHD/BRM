import { NextResponse } from "next/server";
import { runPriceSnapshot } from "@/lib/pricing/snapshot";
import { getConfiguredEquityProvider } from "@/lib/pricing/providerFactory";

// 300 is the maximum allowed on Vercel's Hobby plan. Twelve Data's
// free-tier pacing (8 req/min) means a ~60-asset holdings list can't
// fully refresh in one run at that cap — runPriceSnapshot's own time
// budget (270s) stops early and rotates through the stalest assets
// first across runs rather than exceeding this and getting killed.
export const maxDuration = 300;

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
