create type public.broker as enum ('trading212', 'vanguard', 'ajbell');
create type public.broker_connection_status as enum ('active', 'revoked', 'error');
create type public.account_type as enum ('gia', 'isa', 'sipp', 'crypto');

create table public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  broker public.broker not null,
  status public.broker_connection_status not null default 'active',
  vault_secret_id uuid references vault.secrets (id),
  credential_version integer not null default 1,
  permissions jsonb,
  last_synced_at timestamptz,
  last_successful_sync_at timestamptz,
  last_sync_cursor text,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index broker_connections_user_id_idx on public.broker_connections (user_id);

alter table public.broker_connections enable row level security;

create policy "broker_connections_select_own" on public.broker_connections
  for select using (auth.uid() = user_id);
create policy "broker_connections_insert_own" on public.broker_connections
  for insert with check (auth.uid() = user_id);
create policy "broker_connections_update_own" on public.broker_connections
  for update using (auth.uid() = user_id);
create policy "broker_connections_delete_own" on public.broker_connections
  for delete using (auth.uid() = user_id);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  broker_connection_id uuid references public.broker_connections (id) on delete set null,
  broker public.broker not null,
  external_account_id text,
  account_type public.account_type not null,
  name text not null,
  base_currency text not null default 'GBP',
  created_at timestamptz not null default now()
);

create index accounts_user_id_idx on public.accounts (user_id);

alter table public.accounts enable row level security;

create policy "accounts_select_own" on public.accounts
  for select using (auth.uid() = user_id);
create policy "accounts_insert_own" on public.accounts
  for insert with check (auth.uid() = user_id);
create policy "accounts_update_own" on public.accounts
  for update using (auth.uid() = user_id);
create policy "accounts_delete_own" on public.accounts
  for delete using (auth.uid() = user_id);
