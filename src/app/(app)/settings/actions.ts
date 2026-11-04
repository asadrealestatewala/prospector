"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, AccessDeniedError } from "@/lib/auth/session";
import { INTEGRATIONS, PLAIN_KEYS, SECRET_KEYS, type IntegrationId, type SecretKey } from "@/lib/integrations/catalog";
import { recordTestResult, setPlainSetting, setSecret } from "@/lib/integrations/settings-store";
import { testIntegration } from "@/lib/integrations/test-connection";
import { writeAudit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    const options = INTEGRATIONS.flatMap((i) => i.plain ?? []).find((p) => p.key === key)?.options;
    if (options && v && !options.some((o) => o.value === v)) throw new z.ZodError([{ code: "custom", path: [], message: "Choose one of the listed options.", input: v }]);
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

const points = z.coerce.number().int().min(0, "Points cannot be negative.").max(100, "Use at most 100 points.");
const scoringSchema = z.object({
  website: points,
  email: points,
  verified_email: points,
  whatsapp: points,
  reviews: points,
  reviews_min: z.coerce.number().int().min(1).max(100000),
  recent_reply: points,
  recent_reply_days: z.coerce.number().int().min(1).max(365),
});

/** Lead scoring points (SRS 8.4). Saving recalculates every lead's score. */
export async function saveScoring(input: Record<string, unknown>): Promise<SettingsResult> {
  try {
    const actor = await requireRole("admin");
    const v = scoringSchema.parse(input);
    await setPlainSetting("scoring.rules", v, actor.id, "scoring");
    const supabase = await createSupabaseServerClient();
    const { data: changed, error } = await supabase.rpc("recalculate_lead_scores");
    if (error) throw error;
    await writeAudit(actor, "settings.scoring_changed", "setting", "scoring.rules", v);
    revalidatePath("/settings");
    revalidatePath("/leads");
    return { ok: true, message: `Scoring saved. ${Number(changed).toLocaleString("en-PK")} lead scores updated.` };
  } catch (e) {
    return fail(e);
  }
}

const groupsSchema = z
  .array(z.object({ name: z.string().trim().min(1, "Name every group.").max(60), cities: z.array(z.string().trim().min(1).max(80)).min(1, "Add at least one city to each group.").max(200) }))
  .max(50);

/** Saved city groups for New Search, alongside the built-in province groups. */
export async function saveCityGroups(input: unknown): Promise<SettingsResult> {
  try {
    const actor = await requireRole("admin");
    const v = groupsSchema.parse(input);
    await setPlainSetting("search.city_groups", v, actor.id, "search");
    await writeAudit(actor, "settings.city_groups_changed", "setting", "search.city_groups", { groups: v.length });
    revalidatePath("/settings");
    revalidatePath("/searches/new");
    return { ok: true, message: "City groups saved." };
  } catch (e) {
    return fail(e);
  }
}

/** Settings, Defaults: whether new emails are verified automatically (email-verify queue). */
export async function saveVerificationOptions(input: unknown): Promise<SettingsResult> {
  try {
    const actor = await requireRole("admin");
    const v = z.object({ auto_verify_new: z.boolean() }).parse(input);
    await setPlainSetting("verification.options", v, actor.id, "defaults");
    await writeAudit(actor, "settings.changed", "setting", "verification.options", v);
    revalidatePath("/settings");
    return { ok: true, message: v.auto_verify_new ? "New emails will be verified automatically." : "Automatic verification is off." };
  } catch (e) {
    return fail(e);
  }
}

/** Settings, Sending limits: the email limits and warm-up schedule (SRS 8.4). */
export async function saveEmailLimits(input: unknown): Promise<SettingsResult> {
  try {
    const actor = await requireRole("admin");
    const { emailLimitsSchema } = await import("@/lib/email/limits");
    const v = emailLimitsSchema.parse(input);
    const days = v.warmup.map((w) => w.from_day);
    if (!days.includes(1)) return { ok: false, error: "The warm-up schedule must start on day 1." };
    if (new Set(days).size !== days.length) return { ok: false, error: "Each warm-up step needs a different start day." };
    v.warmup.sort((a, b) => a.from_day - b.from_day);
    await setPlainSetting("email.limits", v, actor.id, "limits");
    await writeAudit(actor, "settings.changed", "setting", "email.limits", { daily_cap: v.daily_cap, window: `${v.window_start}-${v.window_end}` });
    revalidatePath("/settings");
    return { ok: true, message: "Sending limits saved. New campaigns use them; running campaigns keep their own hours and gap." };
  } catch (e) {
    return fail(e);
  }
}

const senderSchema = z.object({
  fromName: z.string().trim().min(1, "Enter the sender name.").max(80),
  fromEmail: z.string().trim().toLowerCase().email("Enter a valid sender address."),
  replyTo: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid reply-to address.")]),
});

/** Settings, Sender identities: an address on a domain verified in Resend. */
export async function addEmailSender(input: unknown): Promise<SettingsResult> {
  try {
    const actor = await requireRole("admin");
    const v = senderSchema.parse(input);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("email_senders").insert({ from_name: v.fromName, from_email: v.fromEmail, reply_to: v.replyTo || null, created_by: actor.id });
    if (error) {
      if (error.code === "23505") return { ok: false, error: "That sender address is already added." };
      throw error;
    }
    await writeAudit(actor, "sender.added", "email_sender", null, { email: v.fromEmail });
    revalidatePath("/settings");
    return { ok: true, message: "Sender added. Make sure its domain is verified in Resend before sending." };
  } catch (e) {
    return fail(e);
  }
}

export async function setEmailSenderActive(id: string, active: boolean): Promise<SettingsResult> {
  try {
    const actor = await requireRole("admin");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("email_senders").update({ is_active: active }).eq("id", z.string().uuid().parse(id));
    if (error) throw error;
    await writeAudit(actor, active ? "sender.enabled" : "sender.disabled", "email_sender", id);
    revalidatePath("/settings");
    return { ok: true, message: active ? "Sender turned on." : "Sender turned off. Campaigns using it pause until you pick another sender." };
  } catch (e) {
    return fail(e);
  }
}

/** Settings, Branding: the email footer (company name and address) shown above the unsubscribe link. */
export async function saveBranding(input: unknown): Promise<SettingsResult> {
  try {
    const actor = await requireRole("admin");
    const v = z.object({ emailFooter: z.string().trim().max(500, "Keep the footer under 500 characters.") }).parse(input);
    await setPlainSetting("branding.email_footer", v.emailFooter, actor.id, "branding");
    await writeAudit(actor, "settings.changed", "setting", "branding.email_footer");
    revalidatePath("/settings");
    return { ok: true, message: "Email footer saved." };
  } catch (e) {
    return fail(e);
  }
}

/** Settings, Defaults: the {{product_price}} line for each product. */
export async function savePriceLines(input: unknown): Promise<SettingsResult> {
  try {
    const actor = await requireRole("admin");
    const line = z.string().trim().max(120, "Keep each price line under 120 characters.");
    const v = z.object({ classwell: line, vetlin: line, postwala: line }).parse(input);
    await setPlainSetting("products.price_lines", v, actor.id, "defaults");
    await writeAudit(actor, "settings.changed", "setting", "products.price_lines");
    revalidatePath("/settings");
    return { ok: true, message: "Price lines saved." };
  } catch (e) {
    return fail(e);
  }
}
