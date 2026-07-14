create type public.sync_run_status as enum ('running', 'success', 'failed', 'partial');

create table public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  date date not null,
  value numeric not null,
  cash numeric not null,
  cost_basis numeric not null,
  gain numeric not null,
  created_at timestamptz not null default now(),
  unique (account_id, date)
);

create index portfolio_snapshots_account_id_date_idx on public.portfolio_snapshots (account_id, date);

alter table public.portfolio_snapshots enable row level security;
create policy "portfolio_snapshots_select_own" on public.portfolio_snapshots
  for select using (account_id in (select id from public.accounts where user_id = auth.uid()));

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.broker_connections (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.sync_run_status not null default 'running',
  records_synced integer,
  error_detail text
);

create index sync_runs_connection_id_idx on public.sync_runs (connection_id);

alter table public.sync_runs enable row level security;
create policy "sync_runs_select_own" on public.sync_runs
  for select using (
    connection_id in (select id from public.broker_connections where user_id = auth.uid())
  );
