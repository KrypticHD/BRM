# BRM — Build & Deployment Plan

**Product:** BRM ("Know Your Wealth") — a multi-broker portfolio tracker for stocks + crypto.
**Audience:** Friends & family (invite-only, small trusted user base — not a public launch).
**Brokers at launch:** Trading 212, Vanguard UK, AJ Bell.
**Base currency:** GBP (multi-currency aware).
**Builder:** Solo, using Claude Code.

**What "friends & family" changes vs. a solo personal tool:**
- Real multi-tenancy from day one — RLS isolation now protects other people's financial data, not a hypothetical
- You will hold other people's broker credentials (if API-connected) — encryption, and how you store/rotate/revoke them, is now a trust obligation, not an architectural nicety
- A wrong number is now a reputation/trust issue with people you know, not just an annoyance to yourself
- Onboarding friction matters — asking a non-technical friend to export/upload a CSV correctly is a bigger barrier than it is for you
- You need an invite/allowlist mechanism — no public signup
- Basic legal hygiene: a short terms-of-use / "this is not financial advice, use at your own risk" disclaimer, since real people's money data is involved even informally

---

## 1. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | You already know it from Axiploy; current major version, pin exact versions in package.json rather than "latest" |
| Database + Auth | Supabase (Postgres + RLS + Auth) | Familiar stack; Postgres is right for transactional/financial data |
| Hosting | Vercel | Zero-config Next.js deploys, cron jobs for price refresh |
| Styling | Tailwind CSS + shadcn/ui | Matches the BRM design system tokens (cream/sage/forest/gold) |
| Charts | Recharts (or Tremor) | Line/area/donut charts per the dashboard mock |
| CSV parsing | Papaparse (client-side preview) + server-side validation | Preview-before-commit import flow |
| Background jobs | Vercel Cron → Next.js route handlers | Daily price snapshots, FX rates |
| Validation | Zod | Schema-validate every CSV row and API payload before it touches the DB |

**Security note (learned the hard way on Axiploy):** RLS on from day one on every table, no service-role key in client code, no secrets committed. Even solo/personal, build it like it's multi-tenant.

---

## 2. Feature List by Phase

Revised after incorporating an external review — see §9 for what was accepted, adapted, or pushed back on.

### Phase 1A — Financial foundation (build/validate against your own data only)
- [ ] Auth (Supabase) + invite-only signup (allowlist/invite codes — no public registration)
- [ ] RLS on every table, tested with a second real account, not just theoretically
- [ ] Accounts + `asset_identifiers` model (ISIN-first, not ticker-first — needed for Vanguard funds)
- [ ] `source_events` table: immutable raw payload storage before any normalisation
- [ ] Canonical transaction model + manual entry
- [ ] Holdings + cash-ledger engine (cash as first-class, currency-aware — not a residual)
- [ ] Unit + property-based tests on cost basis, cash reconciliation, and idempotent import — **do not proceed past this step until these pass**

### Phase 1B — Trading 212 live connection
- [ ] `broker_connections` table, credentials encrypted server-side, never returned to the client
- [ ] Read-only API connect flow + test-connection screen
- [ ] Positions, historical orders, dividends, cash transactions sync (cursor-paginated, rate-limit paced)
- [ ] CSV backfill/reconciliation against the API-synced data
- [ ] Reconciliation view: broker-reported total vs. BRM-computed total vs. delta

### Phase 1C — Vanguard, AJ Bell, dashboard
- [ ] Vanguard CSV preset (18-month export cap — batched historical import)
- [ ] AJ Bell CSV preset where reliable, manual fallback otherwise
- [ ] Cross-broker holding aggregation (same asset held at two brokers = one merged row, per-account drill-down)
- [ ] Dashboard built against real synced/imported data (deliberately built *after* 1A/1B are trustworthy, not before)
- [ ] Sync-health indicator (last successful sync per connection, visible in-app)

### Phase 2 — Analytics
- [ ] `portfolio_snapshots` (daily reconstructed value/cash/gains per account, for fast + reproducible charts)
- [ ] Asset allocation donut (asset class / sector / account)
- [ ] Benchmark comparison (portfolio vs S&P 500 / FTSE All-Share)
- [ ] TWR and MWR return calculations
- [ ] Dividend tracking: received, yield on cost, dividends YTD card

### Phase 3 — Depth
- [ ] Multi-currency handling surfaced in UI (FX effect on returns)
- [ ] UK capital gains helper (Section 104 pooling, realised gains per tax year) — **label clearly as "not tax advice"**
- [ ] Watchlist
- [ ] Alerts (price targets, % moves) via email
- [ ] Notes/journal per holding
- [ ] Lightweight per-user terms of use / risk disclaimer, shown at signup

### Phase 4 — Polish
- [ ] PWA / mobile-responsive summary view (deliberately reduced, not "everything stacked")
- [ ] Dark mode (forest/sage variant per brand plan)
- [ ] PDF/report export
- [ ] Rebalancing "what-if" tool

---

## 3. Data Model (Postgres / Supabase)

**Locked decisions:** broker credentials encrypted via **Supabase Vault** (`vault.secrets` / `vault.decrypted_secrets`, accessed only through `SECURITY DEFINER` SQL functions restricted to `service_role` — never queried directly from client code); money math via **decimal.js** in TypeScript paired with Postgres `numeric` columns end-to-end; user base is **two people at launch** (Cain + father), so the "invite-only" mechanism can start as a hardcoded email allowlist rather than a built invite flow — build the real thing only if a third person joins later.

```
profiles           — Supabase auth + invite/allowlist status

broker_connections — id, user_id, broker, status, vault_secret_id
                      (uuid referencing vault.secrets — the credential
                      itself never touches an app-visible column),
                      credential_version, permissions, last_synced_at,
                      last_successful_sync_at, last_sync_cursor,
                      last_error_code, last_error_message,
                      created_at, revoked_at

accounts            — id, user_id, broker_connection_id (nullable),
                      broker, external_account_id (nullable),
                      account_type (gia|isa|sipp|crypto), name, base_currency

assets              — id, canonical_name, asset_type (equity|etf|fund|crypto),
                      primary_currency

asset_identifiers   — asset_id, identifier_type (isin|ticker|figi|
                      coingecko_id|t212_ticker|vendor_symbol),
                      identifier_value, exchange, source
                      (ISIN preferred where available — a ticker alone
                      isn't a reliable global identity for UK funds)

source_events       — id, account_id, connection_id (nullable),
                      import_id (nullable), source, external_id,
                      event_type, raw_payload (jsonb), occurred_at,
                      payload_hash, processing_status, processing_error,
                      created_at
                      (immutable copy of exactly what the broker returned,
                      before any normalisation — lets you reprocess if
                      parsing logic improves, without losing evidence)

imports             — id, account_id, broker, filename, row_count, status,
                      created_at

transactions        — id, account_id, type, executed_at, source_event_id,
                      external_ref, status

transaction_legs    — transaction_id, asset_id (nullable), currency,
                      quantity_delta (nullable), cash_delta (nullable),
                      gbp_value, leg_type
                      (a single buy = an asset leg + a cash leg + a fee
                      leg if applicable — this is what makes FX, fees,
                      reinvested dividends, and transfers reconcile
                      cleanly instead of being squeezed into one row)

cash_ledger_entries — account_id, currency, amount, entry_type, occurred_at
                      (cash tracked explicitly per currency, not inferred
                      as "whatever's left over" — prevents drift from
                      broker-reported balances)

corporate_actions   — asset_id, action_type (split|merger|spinoff), 
                      effective_date, ratio/details

price_snapshots     — asset_id, date, close_price, currency (daily, cron)
fx_rates            — date, from_ccy, to_ccy, rate (daily, cron)

portfolio_snapshots — account_id, date, value, cash, cost_basis, gain
                      (daily reconstructed snapshot — makes historical
                      charts fast without recomputing from all transactions
                      on every page load, while staying reproducible)

sync_runs           — connection_id, started_at, finished_at, status,
                      records_synced, error_detail (audit trail per sync)
```

**Key decisions baked in:**
- Holdings are **derived from transaction_legs**, not stored — single source of truth, no sync bugs.
- `source_events` preserves the raw broker payload before normalisation — debugging a wrong number means checking what the broker actually sent, not guessing.
- Dedup priority: broker-provided event ID → raw-payload hash → deterministic fingerprint → flagged-for-review fuzzy match. A composite key on (account, asset, type, quantity, timestamp) alone is not used as the sole guard — identical fractional trades can legitimately share a timestamp.
- `asset_identifiers` is ISIN-first — Vanguard funds and cross-broker matching need this; tickers alone aren't a stable identity.
- Every transaction leg carries `gbp_value` computed at execution time — correct cost basis in GBP forever, regardless of later FX moves.
- `account_type` from day one → ISA vs SIPP vs GIA splits and future CGT logic come free.
- Broker credentials live only as a `vault_secret_id` reference on `broker_connections` — the actual secret sits in `vault.secrets`, decrypted only inside `SECURITY DEFINER` functions callable by `service_role`, never in a plain app-visible column or client response.

**Note on scope:** this is a more thorough model than a single-user tracker strictly needs, but with friends & family holding real accounts on shared infrastructure, the correctness and auditability this buys is worth the extra tables. It also means you're not migrating a live multi-user schema later.

---

## 4. External APIs

### Prices — equities/ETFs/funds
- **Primary: EODHD or Twelve Data** — both cover LSE tickers and UK funds properly, which US-centric free APIs often don't. Free/cheap tiers are fine for personal daily-close use.
- Fallback consideration: Alpha Vantage (free but 25 req/day — too tight beyond ~20 holdings), Yahoo Finance unofficial endpoints (free but unstable; fine as backup, don't build on it as primary).
- Vanguard UK funds (non-ETF, e.g. LifeStrategy) may need ISIN-based lookup rather than ticker — verify coverage in whichever API you pick **before** committing.

### Prices — crypto
- **CoinGecko free API** — simple, no key needed at low volume, `coingecko_id` field in assets table maps to it.

### FX rates
- **exchangerate.host or Frankfurter (ECB-based, free)** — daily GBP/USD/EUR rates. Cron-fetched into `fx_rates`.

### Trading 212 official API (Phase 1B)
- T212 exposes read-only endpoints for account summary, positions, instruments, orders, dividends, and cash transactions; historical endpoints use cursor pagination; API keys can be IP-restricted.
- With a friends & family audience, this earns its place in Phase 1 rather than being deferred: asking non-technical friends to correctly export and upload a CSV is real onboarding friction, and a "connect your account" flow is a materially better experience.
- Still sequenced *after* the accounting engine (Phase 1A) is proven — connect real API data to an engine you already trust, rather than debugging both at once.
- Pace requests per T212's per-account endpoint limits; do not fire every endpoint concurrently. Support sync on initial connection, user-triggered refresh, and daily automatic reconciliation — don't rely on the daily cron alone.
- CSV import is retained as backfill/reconciliation for Trading 212, not removed — it's still useful for cross-checking the API sync and for history older than the API returns.

### Provider validation (do this before committing to a price API)
- Coverage claims for equities/fund APIs aren't the same as reliable matching for your actual users' holdings. Before building against EODHD/Twelve Data, run every current holding (yours + first friend/family testers) through a small script: input ISIN/ticker/exchange/currency, output provider match, latest price, historical depth, and anything missing. Choose the provider from that report, not the marketing page.

### API strategy
- All price/FX fetching and all broker API calls happen **server-side only**, keys and connection credentials never exposed to the client.
- Daily cron: fetch closes for all held assets + FX rates → insert into snapshot tables. Dashboard reads from DB, not live APIs → fast, cheap, rate-limit-proof.
- "Live" intraday price on the overview can hit the API on-demand with a short cache (e.g. 15 min revalidate). Note: if the underlying price source is end-of-day only, don't imply intraday granularity in the UI (e.g. a "1D" chart) where the data doesn't support it.

---

## 5. CSV Import Pipeline

**Flow (same for every broker, different preset per broker):**
1. Upload CSV → parse client-side with Papaparse → detect broker preset (or user selects)
2. Map columns → normalise into canonical transaction shape (Zod-validated)
3. **Preview screen**: parsed rows, flagged warnings (unknown tickers, currency mismatches, suspected duplicates)
4. User confirms → server-side re-validation → insert with `import_id` → any unknown assets created/matched (ticker → ISIN → manual match fallback)
5. Dedup on insert: skip rows matching existing `external_ref` or the composite key

**Broker-specific notes:**
- **Trading 212** (build first): clean export via app (History → Export), separate sections for orders/dividends/transactions, includes FX rate column for non-GBP trades. Max 1 calendar year per export — handle multi-file import.
- **Vanguard UK**: CSV from Transaction History → Download; ~18-month history cap, so full history = multiple exports over time. Fund names rather than tickers in some rows — needs a name→ISIN mapping table.
- **AJ Bell**: transaction history CSV exists but format is the least standardised of the three; contract notes are PDF. **Decision: manual entry for AJ Bell in v1**, CSV preset in Phase 3 once the pipeline is proven on the other two.

---

## 6. Build Order (Claude Code sessions)

Each step = roughly one focused Claude Code session with a testable outcome.

1. **Scaffold**: Next.js 16 + Supabase + Tailwind + shadcn, invite-only auth working, deployed to Vercel on day one
2. **Schema**: migrations for all tables in §3, RLS policies on everything, seed script with fake multi-user data — test isolation with two real accounts, not just one
3. **Ledger engine**: `source_events` → `transactions`/`transaction_legs` → holdings + cash-ledger calculation (quantity, avg cost, realised/unrealised P/L, per-currency cash). *This is the heart of the app. Unit + property-based tests (position = sum of legs, cash = sum of cash legs, computed value = cash + market value, imports are idempotent, splits are cost-basis-neutral) must pass before step 4.*
4. **Trading 212 connection**: encrypted `broker_connections`, connect flow, positions/orders/dividends sync, reconciliation view (broker total vs. computed total vs. delta)
5. **T212 CSV backfill**: upload → map → preview → commit → dedup flow, cross-checked against the API-synced data
6. **Price pipeline**: cron route for daily snapshots + FX, provider validated against real holdings first (see §4)
7. **Dashboard UI**: overview page per the design (value chart, KPI cards, holdings table, account rollup, sync-health indicator) — built now that 1A/1B data can be trusted
8. **Vanguard + AJ Bell presets** + cross-broker holding aggregation
9. **`portfolio_snapshots`** + allocation + benchmark + TWR/MWR analytics
10. **Phase 3+ features** as appetite allows

**Testing non-negotiables:** unit + property-based tests on cost-basis math, cash reconciliation, TWR/MWR, and CSV/API import idempotency (feed it real anonymised exports and API responses). Financial math bugs are silent and corrosive — with friends & family's real data on the line, a wrong P/L number you all trust is worse than a crash.

---

## 7. Deployment & Ops

- **Environments**: local (Supabase local dev or a dev project) → production. A small friends & family user base doesn't need a full staging environment, but do keep dev/prod Supabase projects separate so testing never touches real people's data.
- **CI**: GitHub → Vercel auto-deploy on main; run tests + typecheck as a pre-merge GitHub Action
- **Env vars** (Vercel): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (client), `SUPABASE_SERVICE_ROLE_KEY` (server-only modules, never imported into client components), price API keys, broker credential encryption secret, `CRON_SECRET`
- **Cron** (vercel.json): Vercel Hobby allows cron jobs at most once/day, firing anywhere within the scheduled hour, UTC only — schedule generously (e.g. `0 22 * * *`) rather than targeting an exact post-close minute; make the handler idempotent and safe to retry. Trading 212 sync should not rely on this alone — see §4.
- **Backups**: Supabase PITR or scheduled `pg_dump` — this is other people's financial history now, not just yours; treat it accordingly
- **Monitoring**: Vercel logs + a sync-health indicator in-app (last successful sync per connection) so silent failures are visible to you, not just discovered when a friend asks why their numbers look wrong
- **Cost**: Vercel Hobby + Supabase Free + free API tiers should still cover early friends & family scale. First paid line items will likely be the equities price API (once past free-tier limits) and possibly Vercel Pro if cron/function limits are hit as usage grows (~£15–30/mo total, rough estimate).

---

## 8. Explicit Non-Goals (v1)

- No public signup — invite-only for the friends & family group
- No trade placement or order execution — read-only tracker
- No screen-scraping of broker websites, no unsupported credential collection
- No tax filing output — CGT helper is informational only, clearly labelled as such
- No claim of real-time/intraday pricing where the underlying source is delayed or end-of-day only
- No billing/subscriptions, no AI investment recommendations
- No Open Banking integration unless it provides genuine investment-account data

---

## 9. What changed from the original CSV-first plan, and why

An external review of the first draft argued for API-first sync (especially Trading 212), a source-event/ledger-based schema, and encrypted broker credentials as Phase 1, rather than Phase 2+ additions. Given this is now going to friends & family rather than staying solo, most of that was right and is reflected above. Specifically adopted: `source_events`, `asset_identifiers` (ISIN-first), `transaction_legs`, cash-as-ledger, three-way reconciliation, stronger dedup strategy, decimal arithmetic, and the corrected Vercel cron behaviour (verified against Vercel's current docs — Hobby is once/day, within-the-hour, UTC-only).

Adapted rather than adopted outright: Trading 212's API is still sequenced *after* the accounting engine is proven correct on your own data (Phase 1A before 1B), not built in parallel with it. The reasoning holds regardless of audience — validating cost-basis and reconciliation logic against clean, inspectable data before adding live sync's cursor pagination, rate limiting, and credential management reduces the chance of debugging two unproven systems at once. The end state converges with the external review either way; the sequencing inside Phase 1 is the main remaining difference.

---

## 10. Suggested CLAUDE.md seeds for the repo

When you scaffold, drop these rules into the project's CLAUDE.md so every session honours them:
- All money stored as `numeric` in Postgres, never JS floats; use a decimal library for calculations, render-side formatting only
- Every table has RLS; browser code uses only the anon/publishable key; service-role access is isolated in explicitly server-only modules never imported into client components
- Broker credentials are encrypted before persistence and never returned to a client component
- Holdings are always derived from transaction legs — never write a "current holdings" table
- Raw broker payloads (`source_events`) are immutable after ingestion
- Every CSV import and API sync is previewable/auditable, idempotent, and reversible without touching unrelated records
- All external API calls (prices, FX, broker sync) are server-side, with cached/snapshot reads for the UI
