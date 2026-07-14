import "server-only";
import { createAdminClient } from "./supabase-admin";

/**
 * Thin wrapper around the Vault RPC functions from the Session 2
 * migration. Only ever called from server-only code with the service-role
 * admin client — insert_broker_credential/get_broker_credential are
 * revoked from anon/authenticated at the database level too, so this is
 * defense in depth, not the only guard.
 */
export async function storeBrokerCredential(
  secret: string,
  name: string,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("insert_broker_credential", {
    p_secret: secret,
    p_name: name,
  });
  if (error || !data) {
    throw new Error(`Failed to store broker credential: ${error?.message}`);
  }
  return data as string;
}

export async function getBrokerCredential(vaultSecretId: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_broker_credential", {
    p_vault_secret_id: vaultSecretId,
  });
  if (error || !data) {
    throw new Error(`Failed to retrieve broker credential: ${error?.message}`);
  }
  return data as string;
}
