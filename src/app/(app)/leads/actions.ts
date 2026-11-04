"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, AccessDeniedError } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { LEAD_STATUSES } from "@/lib/engine/labels";
import { leadFilterSchema } from "@/lib/leads/filters";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkVerifySpend } from "@/lib/engine/budget";
import { isProviderId } from "@/lib/engine/email-verify";

export type LeadResult = { ok: true; message: string } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AccessDeniedError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0].message };
  if (e && typeof e === "object" && "code" in e) {
    const code = (e as { code: string }).code;
    if (code === "23505") return { ok: false, error: "Another lead already has this phone, website or Google place. Use the duplicate merge tool instead." };
    if (code === "42501") return { ok: false, error: "You do not have access to this action." };
  }
  console.error("lead action failed", e instanceof Error ? e.message : e);
  return { ok: false, error: "Could not save. Nothing was changed. Try again." };
}

const ids = z.array(z.string().uuid()).min(1, "Select at least one lead.").max(500, "Select at most 500 leads at a time.");
const ALL = ["admin", "manager", "lead_expert", "sales_agent"] as const;
const LIST_ROLES = ["admin", "manager", "lead_expert"] as const;

function plural(n: number, word: string) {
  return `${n.toLocaleString("en-PK")} ${word}${n === 1 ? "" : "s"}`;
}

export async function assignOwner(leadIds: string[], ownerId: string | null): Promise<LeadResult> {
  try {
    const actor = await requireRole(...ALL);
    const v = ids.parse(leadIds);
    const owner = ownerId === null ? null : z.string().uuid().parse(ownerId);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("leads").update({ owner_id: owner }).in("id", v).select("id");
    if (error) throw error;
    await writeAudit(actor, "lead.owner_assigned", "lead", v.length === 1 ? v[0] : null, { count: data.length, owner_id: owner });
    revalidatePath("/leads");
    return { ok: true, message: owner ? `Owner set on ${plural(data.length, "lead")}.` : `Owner removed from ${plural(data.length, "lead")}.` };
  } catch (e) {
    return fail(e);
  }
}

/** Changes status and writes a pipeline event for each lead, so the history shows who did it. */
export async function changeStatus(leadIds: string[], status: string, reason?: string): Promise<LeadResult> {
  try {
    const actor = await requireRole(...ALL);
    const v = ids.parse(leadIds);
    const to = z.enum(LEAD_STATUSES).parse(status);
    const why = z.string().trim().max(300).optional().parse(reason || undefined);
    const supabase = await createSupabaseServerClient();
    const { data: before, error: readErr } = await supabase.from("leads").select("id, status").in("id", v);
    if (readErr) throw readErr;
    const changing = (before ?? []).filter((l) => l.status !== to);
    if (changing.length === 0) return { ok: true, message: "No change: the leads already have that status." };
    const { error } = await supabase.from("leads").update({ status: to }).in("id", changing.map((l) => l.id));
    if (error) throw error;
    const { error: evErr } = await supabase.from("pipeline_events").insert(
      changing.map((l) => ({ lead_id: l.id, from_status: l.status, to_status: to, caused_by_user: actor.id, reason: why ?? null })),
    );
    if (evErr) throw evErr;
    revalidatePath("/leads");
    for (const l of changing) revalidatePath(`/leads/${l.id}`);
    return { ok: true, message: `Status changed on ${plural(changing.length, "lead")}.` };
  } catch (e) {
    return fail(e);
  }
}

const tagSchema = z.array(z.string().trim().toLowerCase().min(1).max(40).regex(/^[\p{L}\p{N} _-]+$/u, "Tags may use letters, numbers, spaces, - and _.")).min(1).max(10);

export async function addTags(leadIds: string[], tags: string[]): Promise<LeadResult> {
  try {
    await requireRole(...ALL);
    const v = ids.parse(leadIds);
    const t = tagSchema.parse(tags);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("leads").select("id, tags").in("id", v);
    if (error) throw error;
    for (const l of data ?? []) {
      const next = [...new Set([...(l.tags as string[]), ...t])];
      if (next.length === (l.tags as string[]).length) continue;
      const { error: upErr } = await supabase.from("leads").update({ tags: next }).eq("id", l.id);
      if (upErr) throw upErr;
    }
    revalidatePath("/leads");
    return { ok: true, message: `Tags added to ${plural(data?.length ?? 0, "lead")}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeTag(leadId: string, tag: string): Promise<LeadResult> {
  try {
    await requireRole(...ALL);
    const id = z.string().uuid().parse(leadId);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("leads").select("tags").eq("id", id).single();
    if (error) throw error;
    const { error: upErr } = await supabase.from("leads").update({ tags: (data.tags as string[]).filter((x) => x !== tag) }).eq("id", id);
    if (upErr) throw upErr;
    revalidatePath(`/leads/${id}`);
    return { ok: true, message: "Tag removed." };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Adds every email, phone and WhatsApp number of the leads to do-not-contact (SRS screen 5).
 * Entries already on the list are left as they are.
 */
export async function addLeadsToDnc(leadIds: string[], note?: string): Promise<LeadResult> {
  try {
    const actor = await requireRole(...ALL);
    const v = ids.parse(leadIds);
    const why = z.string().trim().max(300).optional().parse(note || undefined);
    const supabase = await createSupabaseServerClient();
    const [{ data: contacts, error: cErr }, { data: leads, error: lErr }] = await Promise.all([
      supabase.from("lead_contacts").select("lead_id, kind, value").in("lead_id", v),
      supabase.from("leads").select("id, phone").in("id", v),
    ]);
    if (cErr || lErr) throw cErr ?? lErr;
    const entries = new Map<string, { channel: "email" | "whatsapp" | "phone"; value: string; lead_id: string }>();
    for (const c of contacts ?? []) entries.set(`${c.kind}|${c.value}`, { channel: c.kind, value: c.value, lead_id: c.lead_id });
    for (const l of leads ?? []) if (l.phone) entries.set(`phone|${l.phone}`, { channel: "phone", value: l.phone, lead_id: l.id });
    if (entries.size === 0) return { ok: false, error: "These leads have no email or phone number to block." };

    let added = 0;
    for (const e of entries.values()) {
      const { data: already } = await supabase.rpc("is_do_not_contact", { p_channel: e.channel, p_value: e.value });
      if (already) continue;
      const { error } = await supabase.from("do_not_contact").insert({
        channel: e.channel,
        value: e.value,
        value_normalized: "",
        reason: "manual",
        note: why ?? null,
        lead_id: e.lead_id,
        added_by: actor.id,
      });
      if (error && (error as { code?: string }).code !== "23505") throw error;
      if (!error) added += 1;
    }
    await writeAudit(actor, "dnc.added_from_leads", "lead", v.length === 1 ? v[0] : null, { leads: v.length, entries: added });
    revalidatePath("/leads");
    for (const id of v) revalidatePath(`/leads/${id}`);
    return { ok: true, message: added ? `${plural(added, "contact")} added to do-not-contact.` : "Every contact was already on do-not-contact." };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteLeads(leadIds: string[]): Promise<LeadResult> {
  try {
    const actor = await requireRole(...LIST_ROLES);
    const v = ids.parse(leadIds);
    const supabase = await createSupabaseServerClient();
    const { data: names } = await supabase.from("leads").select("id, name").in("id", v);
    const { data, error } = await supabase.from("leads").delete().in("id", v).select("id");
    if (error) throw error;
    await writeAudit(actor, "lead.deleted", "lead", null, { count: data.length, names: (names ?? []).slice(0, 20).map((n) => n.name) });
    revalidatePath("/leads");
    return { ok: true, message: `${plural(data.length, "lead")} deleted.` };
  } catch (e) {
    return fail(e);
  }
}

const viewSchema = z.object({
  name: z.string().trim().min(1, "Name the view.").max(80),
  params: leadFilterSchema.omit({ page: true }),
  columns: z.array(z.string().max(40)).max(30),
  shared: z.boolean(),
});

export async function saveView(input: z.input<typeof viewSchema>): Promise<LeadResult> {
  try {
    const actor = await requireRole(...LIST_ROLES);
    const v = viewSchema.parse(input);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("saved_views")
      .upsert({ user_id: actor.id, screen: "leads", name: v.name, params: v.params, columns: v.columns, is_shared: v.shared }, { onConflict: "user_id,screen,name" });
    if (error) throw error;
    revalidatePath("/leads");
    return { ok: true, message: `View “${v.name}” saved.` };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteView(id: string): Promise<LeadResult> {
  try {
    await requireRole(...LIST_ROLES);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("saved_views").delete().eq("id", z.string().uuid().parse(id)).select("id");
    if (error) throw error;
    if (!data.length) return { ok: false, error: "Only the person who saved a view can delete it." };
    revalidatePath("/leads");
    return { ok: true, message: "View deleted." };
  } catch (e) {
    return fail(e);
  }
}

export async function mergeLeads(keepId: string, mergeIds: string[]): Promise<LeadResult> {
  try {
    const actor = await requireRole(...LIST_ROLES);
    const keep = z.string().uuid().parse(keepId);
    const others = ids.parse(mergeIds).filter((x) => x !== keep);
    if (others.length === 0) return { ok: false, error: "Choose at least one other lead to merge." };
    const supabase = await createSupabaseServerClient();
    const { data: names } = await supabase.from("leads").select("id, name").in("id", [keep, ...others]);
    const { data, error } = await supabase.rpc("merge_leads", { p_keep: keep, p_merge: others });
    if (error) throw error;
    await writeAudit(actor, "lead.merged", "lead", keep, { merged: others, names: (names ?? []).map((n) => n.name) });
    revalidatePath("/leads");
    revalidatePath("/leads/duplicates");
    revalidatePath(`/leads/${keep}`);
    return { ok: true, message: `${plural(Number(data), "lead")} merged.` };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Queues the leads' unverified emails for checking (email-verify queue). With a paid service connected,
 * the verification price and budget are checked first (SRS 8.4); the worker checks again before each call.
 */
export async function verifyLeadEmails(leadIds: string[], recheck = false): Promise<LeadResult> {
  try {
    const actor = await requireRole("admin", "lead_expert");
    const v = z.array(z.string().uuid()).min(1, "Select at least one lead.").max(5000, "Select at most 5,000 leads at a time.").parse(leadIds);
    const supabase = await createSupabaseServerClient();
    const { data: count, error: cErr } = await supabase.rpc("count_emails_to_verify", { p_lead_ids: v, p_recheck: recheck });
    if (cErr) throw cErr;
    const n = Number(count ?? 0);
    if (n === 0) return { ok: false, error: recheck ? "These leads have no email to check." : "These leads have no unverified email. Every email has been checked already or is being checked." };

    const admin = createSupabaseAdminClient();
    const { data: providerRow } = await admin.from("settings").select("value").eq("key", "email_verification.provider").maybeSingle();
    const { data: keyRow } = await admin.from("settings").select("secret_last4").eq("key", "email_verification.api_key").maybeSingle();
    const paid = isProviderId(providerRow?.value) && !!keyRow?.secret_last4;
    let warning: string | null = null;
    if (paid) {
      const spend = await checkVerifySpend(admin, null, n);
      if (!spend.ok) return { ok: false, error: spend.message ?? "The verification budget does not allow this many checks." };
      warning = spend.warning;
    }
    const { data: queued, error } = await supabase.rpc("request_email_verification", { p_lead_ids: v, p_recheck: recheck });
    if (error) throw error;
    await writeAudit(actor, "email.verification_requested", "lead", v.length === 1 ? v[0] : null, { leads: v.length, emails: queued, paid });
    revalidatePath("/leads");
    for (const id of v.slice(0, 50)) revalidatePath(`/leads/${id}`);
    const base = `${plural(Number(queued), "email")} queued for checking.`;
    return {
      ok: true,
      message: [base, paid ? null : "No verification service is connected yet, so only the free checks will run.", warning].filter(Boolean).join(" "),
    };
  } catch (e) {
    return fail(e);
  }
}
