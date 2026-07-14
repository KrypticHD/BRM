-- source_events, imports, transactions, transaction_legs, cash_ledger_entries.
-- All owned indirectly via accounts.user_id. Writes to these tables happen
-- through the server-side import/sync pipeline (service_role or a
-- SECURITY DEFINER function), not directly from the client, so only
-- SELECT policies are defined for now.
create type public.processing_status as enum ('pending', 'processed', 'failed', 'skipped');
create type public.import_status as enum ('pending', 'previewed', 'committed', 'failed');
create type public.transaction_type as enum ('buy', 'sell', 'dividend', 'transfer_in', 'transfer_out', 'fee', 'interest', 'fx', 'other');
create type public.transaction_status as enum ('pending', 'settled', 'cancelled');
create type public.leg_type as enum ('asset', 'cash', 'fee');
create type public.cash_entry_type as enum ('deposit', 'withdrawal', 'dividend', 'interest', 'fee', 'fx', 'trade_settlement', 'other');

create table public.source_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  connection_id uuid references public.broker_connections (id) on delete set null,
  import_id uuid,
  source text not null,
  external_id text,
  event_type text not null,
  raw_payload jsonb not null,
  occurred_at timestamptz not null,
  payload_hash text not null,
  processing_status public.processing_status not null default 'pending',
  processing_error text,
  created_at timestamptz not null default now()
);

create index source_events_account_id_idx on public.source_events (account_id);
create unique index source_events_dedup_idx on public.source_events (account_id, source, external_id) where external_id is not null;
create unique index source_events_hash_dedup_idx on public.source_events (account_id, payload_hash);

alter table public.source_events enable row level security;
create policy "source_events_select_own" on public.source_events
  for select using (account_id in (select id from public.accounts where user_id = auth.uid()));

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  broker public.broker not null,
  filename text not null,
  row_count integer,
  status public.import_status not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.source_events
  add constraint source_events_import_id_fkey foreign key (import_id) references public.imports (id) on delete set null;

create index imports_account_id_idx on public.imports (account_id);

alter table public.imports enable row level security;
create policy "imports_select_own" on public.imports
  for select using (account_id in (select id from public.accounts where user_id = auth.uid()));

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  type public.transaction_type not null,
  executed_at timestamptz not null,
  source_event_id uuid references public.source_events (id) on delete set null,
  external_ref text,
  status public.transaction_status not null default 'settled',
  created_at timestamptz not null default now()
);

create index transactions_account_id_idx on public.transactions (account_id);

alter table public.transactions enable row level security;
create policy "transactions_select_own" on public.transactions
  for select using (account_id in (select id from public.accounts where user_id = auth.uid()));

create table public.transaction_legs (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  asset_id uuid references public.assets (id),
  currency text not null,
  quantity_delta numeric,
  cash_delta numeric,
  gbp_value numeric not null,
  leg_type public.leg_type not null,
  created_at timestamptz not null default now()
);

create index transaction_legs_transaction_id_idx on public.transaction_legs (transaction_id);

alter table public.transaction_legs enable row level security;
create policy "transaction_legs_select_own" on public.transaction_legs
  for select using (
    transaction_id in (
      select t.id from public.transactions t
      join public.accounts a on a.id = t.account_id
      where a.user_id = auth.uid()
    )
  );

create table public.cash_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  currency text not null,
  amount numeric not null,
  entry_type public.cash_entry_type not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index cash_ledger_entries_account_id_idx on public.cash_ledger_entries (account_id);

alter table public.cash_ledger_entries enable row level security;
create policy "cash_ledger_entries_select_own" on public.cash_ledger_entries
  for select using (account_id in (select id from public.accounts where user_id = auth.uid()));
