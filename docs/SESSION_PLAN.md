# BRM — Claude Code Session Plan

Work through these in order. Each block is close to copy-paste-ready as a
Claude Code prompt — adjust specifics as needed, but don't skip ahead.
Before session 1, make sure `CLAUDE.md` and `docs/ARCHITECTURE.md` (the
full build plan) are committed to the repo so every session has them as
context.

---

### Session 1 — Scaffold
> Scaffold a Next.js 16 (App Router) project with TypeScript, Tailwind
> CSS, and shadcn/ui. Set up Supabase (auth + Postgres client) using
> `@supabase/ssr`. Add a hardcoded email allowlist check at sign-in
> (two emails, from env vars) — no public signup. Deploy to Vercel and
> confirm the deployed URL loads a basic authenticated placeholder page.
> Follow the rules in CLAUDE.md, especially around service-role key
> isolation.

**Done when:** deployed URL is live, sign-in works, only allowlisted
emails can authenticate, service-role key is never referenced in any
client component.

---

### Session 2 — Schema & RLS
> Using the data model in docs/ARCHITECTURE.md §3, write Supabase
> migrations for: profiles, broker_connections, accounts, assets,
> asset_identifiers, source_events, imports, transactions,
> transaction_legs, cash_ledger_entries, corporate_actions,
> price_snapshots, fx_rates, portfolio_snapshots, sync_runs. Enable RLS
> on every table, scoped to auth.uid(). Enable the Vault extension and
> create SECURITY DEFINER functions for storing/retrieving broker
> credentials (insert_broker_credential, get_broker_credential),
> grantable only to service_role. Write a seed script that creates two
> fake users with sample accounts and transactions, and a test that
> confirms user A cannot read user B's rows under RLS.

**Done when:** migrations run cleanly, the cross-user RLS test passes,
Vault functions work via a manual `service_role` call.

---

### Session 3 — Ledger engine (the core of the app)
> Build the accounting engine: given transaction_legs for an account,
> compute current holdings (quantity, average cost, unrealised P/L),
> realised P/L on sells, and cash balances per currency. Implement as
> pure, well-typed functions using decimal.js — no native Number for
> money. Write unit tests plus property-based tests for these
> invariants: position quantity = sum of quantity legs; cash by
> currency = sum of cash legs; computed account value = cash + market
> value of positions; importing identical source data twice changes
> nothing; a stock split changes quantity and unit cost but not total
> cost basis; an internal transfer between accounts creates no
> performance impact. Do not build any UI yet.

**Done when:** all invariant tests pass. This gate matters more than
any other session — don't move to session 4 until it's solid.

---

### Session 4 — Trading 212 connection
> Build the Trading 212 API connection flow: a page to paste in a T212
> API key, store it via the Vault functions from session 2, and a
> "test connection" action that confirms it works. Build a sync job
> that pulls positions, orders, dividends, and cash transactions from
> the T212 API, writes each raw response to source_events first, then
> normalises into transactions/transaction_legs using the session 3
> engine's expectations. Respect T212's per-account rate limits — pace
> requests, don't fire everything concurrently. Add a reconciliation
> view comparing T212's reported total account value to BRM's computed
> value, showing the delta.

**Done when:** a real T212 account can be connected, synced, and its
BRM-computed total matches the broker-reported total (or the delta is
explained, e.g. pending settlement).

---

### Session 5 — Trading 212 CSV backfill
> Build CSV upload for Trading 212 exports: parse with Papaparse,
> preview parsed rows before commit, validate with Zod, write to
> source_events, normalise into transactions using the same pipeline
> as session 4. Use this to backfill history older than what the API
> returns, and cross-check against API-synced data for the overlapping
> period — flag any discrepancies rather than silently overwriting.

**Done when:** a real historical T212 CSV imports cleanly, duplicates
against already-synced API data are correctly skipped (not
double-counted), and any real discrepancies are surfaced, not hidden.

---

### Session 6 — Price pipeline
> Before writing fetch code, first build a small standalone script that
> takes a list of holdings (ISIN, ticker, exchange, currency) and checks
> coverage against [chosen equities/fund API — validate EODHD vs Twelve
> Data against real holdings first] and CoinGecko for crypto. Report
> matches and gaps. Once a provider is confirmed, build a Vercel Cron
> job (once daily, idempotent, safe to retry within the scheduled hour)
> that fetches closing prices for all held assets plus GBP/USD/EUR FX
> rates into price_snapshots and fx_rates. Add a short-cached
> (~15 min) on-demand live-price fetch for the dashboard overview,
> server-side only.

**Done when:** the coverage report is reviewed and a provider is
picked, the cron job runs successfully on a schedule, and the "last
successful sync" state is visible somewhere in the app (even a simple
admin/debug page).

---

### Session 7 — Dashboard
> Build the portfolio overview page per the existing BRM design:
> total value, day change, all-time gain, per-account rollup, holdings
> table (quantity, avg cost, current value, unrealised P/L, weight),
> and a value-over-time chart (1D/1W/1M/3M/1Y/All) using
> portfolio_snapshots. Add a sync-health indicator showing last
> successful sync per connection. Build this against real synced data
> from sessions 4–6, not mock data.

**Done when:** the dashboard renders real numbers for at least one
connected account and matches what session 4's reconciliation view
shows.

---

### Session 8 — Vanguard & AJ Bell
> Add a Vanguard UK CSV import preset (handle the ~18-month export
> cap — support importing multiple date-range exports without
> duplicating overlapping rows). Add an AJ Bell CSV preset if the
> export format is usable, otherwise build a clean manual transaction
> entry flow as the fallback for AJ Bell. Add cross-broker holding
> aggregation: the same asset held at two brokers should appear as one
> merged holding with a per-account drill-down, not two separate rows.

**Done when:** a real Vanguard and/or AJ Bell export/manual entry
imports correctly and merges properly with existing T212 holdings.

---

### Session 9 — Analytics
> Add asset allocation breakdown (by asset class/sector/account),
> benchmark comparison (BRM portfolio vs S&P 500 and/or FTSE All-Share),
> TWR and MWR return calculations, and dividend tracking (received,
> yield on cost, YTD total). Build portfolio_snapshots backfill so
> historical charts don't need to recompute from all transactions on
> every load.

**Done when:** TWR/MWR numbers are unit-tested against known example
cash-flow scenarios, not just "looks plausible."

---

### Session 10+ — Phase 3/4 features
Pull individually from docs/ARCHITECTURE.md §2 Phase 3/4 as appetite
allows: multi-currency FX-effect display, UK CGT helper (clearly
labelled as not tax advice), watchlist, alerts, notes, dark mode, PWA,
PDF export, rebalancing tool. Each as its own session — don't batch
unrelated features into one prompt.
