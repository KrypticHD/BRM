alter table public.broker_connections
  add column environment text not null default 'live'
    check (environment in ('live', 'demo'));
