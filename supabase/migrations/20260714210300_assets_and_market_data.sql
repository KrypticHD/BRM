-- Shared reference data: not user-owned. RLS is enabled (no exceptions),
-- readable by any authenticated user, writable only by service_role
-- (price/FX cron jobs, asset matching during import) which bypasses RLS.
create type public.asset_type as enum ('equity', 'etf', 'fund', 'crypto');
create type public.asset_identifier_type as enum ('isin', 'ticker', 'figi', 'coingecko_id', 't212_ticker', 'vendor_symbol');
create type public.corporate_action_type as enum ('split', 'merger', 'spinoff');

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  asset_type public.asset_type not null,
  primary_currency text not null,
  created_at timestamptz not null default now()
);

alter table public.assets enable row level security;
create policy "assets_select_authenticated" on public.assets
  for select using (auth.role() = 'authenticated');

create table public.asset_identifiers (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  identifier_type public.asset_identifier_type not null,
  identifier_value text not null,
  exchange text,
  source text,
  created_at timestamptz not null default now(),
  unique (identifier_type, identifier_value, exchange)
);

create index asset_identifiers_asset_id_idx on public.asset_identifiers (asset_id);

alter table public.asset_identifiers enable row level security;
create policy "asset_identifiers_select_authenticated" on public.asset_identifiers
  for select using (auth.role() = 'authenticated');

create table public.corporate_actions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  action_type public.corporate_action_type not null,
  effective_date date not null,
  ratio numeric,
  details jsonb,
  created_at timestamptz not null default now()
);

create index corporate_actions_asset_id_idx on public.corporate_actions (asset_id);

alter table public.corporate_actions enable row level security;
create policy "corporate_actions_select_authenticated" on public.corporate_actions
  for select using (auth.role() = 'authenticated');

create table public.price_snapshots (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  date date not null,
  close_price numeric not null,
  currency text not null,
  created_at timestamptz not null default now(),
  unique (asset_id, date)
);

create index price_snapshots_asset_id_date_idx on public.price_snapshots (asset_id, date);

alter table public.price_snapshots enable row level security;
create policy "price_snapshots_select_authenticated" on public.price_snapshots
  for select using (auth.role() = 'authenticated');

create table public.fx_rates (
  date date not null,
  from_ccy text not null,
  to_ccy text not null,
  rate numeric not null,
  created_at timestamptz not null default now(),
  primary key (date, from_ccy, to_ccy)
);

alter table public.fx_rates enable row level security;
create policy "fx_rates_select_authenticated" on public.fx_rates
  for select using (auth.role() = 'authenticated');
