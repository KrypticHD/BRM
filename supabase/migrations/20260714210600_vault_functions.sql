-- Broker credentials are stored in Supabase Vault, never in an app-visible
-- column. These SECURITY DEFINER functions are the only way to write or
-- read a decrypted credential, and are grantable only to service_role.
create or replace function public.insert_broker_credential(
  p_secret text,
  p_name text default null
) returns uuid
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  v_id uuid;
begin
  insert into vault.secrets (secret, name)
  values (p_secret, coalesce(p_name, 'broker_credential_' || gen_random_uuid()::text))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.insert_broker_credential(text, text) from public, anon, authenticated;
grant execute on function public.insert_broker_credential(text, text) to service_role;

create or replace function public.get_broker_credential(
  p_vault_secret_id uuid
) returns text
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where id = p_vault_secret_id;
  return v_secret;
end;
$$;

revoke all on function public.get_broker_credential(uuid) from public, anon, authenticated;
grant execute on function public.get_broker_credential(uuid) to service_role;
