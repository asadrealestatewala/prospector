import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret, lastFour, parseEncryptionKey } from "@/lib/crypto/secrets";
import type { SecretKey } from "@/lib/integrations/catalog";

function key() {
  return parseEncryptionKey(process.env.SETTINGS_ENCRYPTION_KEY);
}

/** Decrypts a stored key for server-side use. Returns null when it has not been set. */
export async function getSecret(name: SecretKey): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("settings").select("secret_ciphertext").eq("key", name).maybeSingle();
  if (error) throw new Error("Could not read settings.");
  if (!data?.secret_ciphertext) return null;
  return decryptSecret(data.secret_ciphertext, key(), name);
}

export async function setSecret(name: SecretKey, value: string | null, userId: string) {
  const admin = createSupabaseAdminClient();
  const trimmed = value?.trim() || null;
  const row = {
    key: name,
    category: "integrations",
    is_secret: true,
    value: null,
    secret_ciphertext: trimmed ? encryptSecret(trimmed, key(), name) : null,
    secret_last4: trimmed ? lastFour(trimmed) : null,
    last_tested_at: null,
    last_test_ok: null,
    last_test_message: null,
    updated_by: userId,
  };
  const { error } = await admin.from("settings").upsert(row, { onConflict: "key" });
  if (error) throw new Error("Could not save the key.");
}

export async function getPlainSetting<T = unknown>(name: string): Promise<T | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("settings").select("value").eq("key", name).maybeSingle();
  return (data?.value ?? null) as T | null;
}

export async function setPlainSetting(name: string, value: unknown, userId: string, category = "integrations") {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("settings")
    .upsert({ key: name, category, is_secret: false, value: value ?? null, updated_by: userId }, { onConflict: "key" });
  if (error) throw new Error("Could not save the setting.");
}

export async function recordTestResult(names: string[], ok: boolean, message: string) {
  const admin = createSupabaseAdminClient();
  await admin
    .from("settings")
    .update({ last_tested_at: new Date().toISOString(), last_test_ok: ok, last_test_message: message.slice(0, 300) })
    .in("key", names);
}
