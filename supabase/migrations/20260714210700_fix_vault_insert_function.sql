-- Raw INSERT INTO vault.secrets fails with "permission denied for function
-- _crypto_aead_det_noncegen" because the pgsodium encryption trigger needs
-- role grants the function owner doesn't have. vault.create_secret() is
-- Supabase's supported entry point and already has the right grants.
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
  v_id := vault.create_secret(
    p_secret,
    coalesce(p_name, 'broker_credential_' || gen_random_uuid()::text)
  );
  return v_id;
end;
$$;
