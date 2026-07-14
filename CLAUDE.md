# BRM — Project Rules for Claude Code

BRM is a multi-broker portfolio tracker (stocks + crypto) for a small
friends-and-family user base (2 users at launch: Cain + father).
Brokers: Trading 212 (API + CSV), Vanguard UK (CSV), AJ Bell (CSV/manual).
Base currency: GBP. Full architecture and rationale: `docs/ARCHITECTURE.md`.

Read `docs/ARCHITECTURE.md` §3 (data model) before touching schema.
Follow the numbered session plan in `docs/SESSION_PLAN.md` — do not jump
ahead to a later session's scope even if it seems related.

## Non-negotiable rules

**Money & math**
- All monetary values are Postgres `numeric`, never `float`/`double precision`.
- All money arithmetic in TypeScript uses `decimal.js`. Never use native
  JS `Number` for anything that touches price, quantity, cost basis, or
  gain/loss — including "just for display," since display bugs compound
  into user-visible wrong numbers.
- Holdings, cost basis, and P/L are always **derived** from
  `transaction_legs` at query time (or via `portfolio_snapshots` for
  historical charts) — never write or update a "current holdings" table
  directly.

**Security**
- Every table has RLS enabled. No exceptions, including tables that feel
  "internal only."
- Client/browser code uses only the Supabase anon/publishable key.
  `SUPABASE_SERVICE_ROLE_KEY` is used only inside files under a
  server-only boundary (e.g. `lib/server/`) and is never imported into
  any file that can render on the client.
- Broker credentials are stored via **Supabase Vault**
  (`vault.secrets` / `vault.decrypted_secrets`), referenced from
  `broker_connections.vault_secret_id`. Access decrypted credentials
  only inside `SECURITY DEFINER` Postgres functions restricted to
  `service_role`. Never select a decrypted credential into a normal
  query result, log line, or error message.
- No secrets, keys, or `.env` values are ever committed. Check before
  every commit.

**Data integrity**
- Every broker API response and every CSV row is written to
  `source_events` as an immutable raw payload *before* any
  normalisation into `transactions`/`transaction_legs`. If normalisation
  logic changes later, we reprocess from `source_events` rather than
  re-fetching from the broker.
- Dedup priority order: broker-provided external event ID → raw-payload
  hash → deterministic fingerprint → flag for manual review. Never rely
  solely on a resemblance-based composite key (e.g. same account +
  asset + quantity + timestamp) as the only duplicate guard.
- Every CSV import and every API sync run is auditable (`imports` /
  `sync_runs`), previewable before commit, idempotent on retry, and
  reversible without touching records outside that import/sync.

**External calls**
- All price, FX, and broker API calls happen server-side only (route
  handlers or cron), never directly from client components.
- The dashboard reads from `price_snapshots` / `portfolio_snapshots`,
  not live API calls, except for an explicitly short-cached "live price"
  widget (documented cache duration in the code).
- Don't imply intraday granularity in the UI (e.g. a true "1D" chart)
  where the underlying price source is end-of-day only.

**Scope discipline**
- Two users at launch. Don't build a general-purpose invite/signup
  system yet — a hardcoded email allowlist checked at sign-in is
  sufficient until a third user is actually being onboarded.
- Don't add features from a later session in `docs/SESSION_PLAN.md`
  "while you're in there." Flag them instead and move on.

## Testing

- Financial calculations (cost basis, cash reconciliation, TWR/MWR,
  import idempotency, corporate-action neutrality) require unit tests
  before the session is considered done — not "add tests later."
- Prefer property-based tests for the accounting engine invariants
  listed in `docs/ARCHITECTURE.md` §6, in addition to example-based tests.
- A financial calculation with no test is treated as incomplete work,
  not a nice-to-have.
