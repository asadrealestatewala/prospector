"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, AccessDeniedError } from "@/lib/auth/session";
import { INTEGRATIONS, PLAIN_KEYS, SECRET_KEYS, type IntegrationId, type SecretKey } from "@/lib/integrations/catalog";
import { recordTestResult, setPlainSetting, setSecret } from "@/lib/integrations/settings-store";
import { testIntegration } from "@/lib/integrations/test-connection";
import { writeAudit } from "@/lib/audit";

export type SettingsResult = { ok: true; message: string } | { ok: false; error: string };

function fail(e: unknown): SettingsResult {
  if (e instanceof AccessDeniedError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0].message };
  if (e instanceof Error && /SETTINGS_ENCRYPTION_KEY/.test(e.message)) return { ok: false, error: e.message };
  return { ok: false, error: "Could not save. Nothing was changed. Try again." };
}

/** Saves one key. The plain value goes straight to encryption and is never logged or returned. */
export async function saveSecret(name: SecretKey, value: string): Promise<SettingsResult> {
  try {
    const actor = await requireRole("admin");
    const key = z.enum(SECRET_KEYS as [SecretKey, ...SecretKey[]]).parse(name);
    const v = z.string().trim().min(8, "That key looks too short. Paste the whole key.").max(500).parse(value);
    await setSecret(key, v, actor.id);
    await writeAudit(actor, "settings.key_changed", "setting", key);
    revalidatePath("/settings");
    return { ok: true, message: "Key saved and encrypted." };
  } catch (e) {
    return fail(e);
  }
}

export async function clearSecret(name: SecretKey): Promise<SettingsResult> {
  try {
    const actor = await requireRole("admin");
    const key = z.enum(SECRET_KEYS as [SecretKey, ...SecretKey[]]).parse(name);
    await setSecret(key, null, actor.id);
    await writeAudit(actor, "settings.key_removed", "setting", key);
    revalidatePath("/settings");
    return { ok: true, message: "Key removed." };
  } catch (e) {
    return fail(e);
  }
}

export async function savePlain(name: string, value: string): Promise<SettingsResult> {
  try {
    const actor = await requireRole("admin");
    const key = z.enum(PLAIN_KEYS as [string, ...string[]]).parse(name);
    const v = z.string().trim().max(200).parse(value);
    await setPlainSetting(key, v || null, actor.id);
    await writeAudit(actor, "settings.changed", "setting", key);
    revalidatePath("/settings");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}

export async function runTest(id: IntegrationId, target?: string): Promise<SettingsResult> {
  try {
    const actor = await requireRole("admin");
    const integration = INTEGRATIONS.find((i) => i.id === id);
    if (!integration) throw new Error("Unknown integration");
    const result = await testIntegration(id, target);
    await recordTestResult(integration.secrets.map((s) => s.key), result.ok, result.message);
    await writeAudit(actor, "settings.connection_tested", "integration", id, { ok: result.ok });
    revalidatePath("/settings");
    return result.ok ? { ok: true, message: result.message } : { ok: false, error: result.message };
  } catch (e) {
    return fail(e);
  }
}
