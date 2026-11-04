"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, AccessDeniedError } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Lead Detail edits (SRS screen 6). Every change to a contact field is recorded with who made it
 * and when by database triggers (lead_field_changes), and shown on the timeline.
 */
export type DetailResult = { ok: true; message: string } | { ok: false; error: string };
const ALL = ["admin", "manager", "lead_expert", "sales_agent"] as const;

function fail(e: unknown): DetailResult {
  if (e instanceof AccessDeniedError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0].message };
  if (e && typeof e === "object" && "code" in e) {
    const code = (e as { code: string }).code;
    if (code === "23505") return { ok: false, error: "Another lead already has this phone number or website. Use Find duplicates on the Leads screen to merge them." };
    if (code === "42501") return { ok: false, error: "You do not have access to change this." };
  }
  console.error("lead detail action failed", e instanceof Error ? e.message : e);
  return { ok: false, error: "Could not save. Nothing was changed. Try again." };
}

const opt = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable());
const id = z.string().uuid();

const infoSchema = z.object({
  name: z.string().trim().min(1, "Enter the business name.").max(200),
  phone: opt(40),
  website: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" && !/^https?:\/\//i.test(v.trim()) ? `https://${v.trim()}` : v),
    z.string().trim().url("Enter a website address such as https://school.pk").max(300).nullable(),
  ),
  address: opt(300),
  city: opt(80),
  area: opt(80),
  business_type: opt(80),
});

export async function updateLeadInfo(leadId: string, input: z.input<typeof infoSchema>): Promise<DetailResult> {
  try {
    await requireRole(...ALL);
    const v = infoSchema.parse(input);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("leads").update(v).eq("id", id.parse(leadId));
    if (error) throw error;
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: "Business details saved." };
  } catch (e) {
    return fail(e);
  }
}

const contactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email"), value: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200) }),
  z.object({ kind: z.literal("phone"), value: z.string().trim().regex(/^[+\d][\d\s()-]{6,20}$/, "Enter a valid phone number.") }),
  z.object({ kind: z.literal("whatsapp"), value: z.string().trim().regex(/^[+\d][\d\s()-]{6,20}$/, "Enter a valid WhatsApp number.") }),
]);

export async function addContact(leadId: string, input: z.input<typeof contactSchema>, label?: string): Promise<DetailResult> {
  try {
    const actor = await requireRole(...ALL);
    const lid = id.parse(leadId);
    const v = contactSchema.parse(input);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("lead_contacts")
      .insert({ lead_id: lid, kind: v.kind, value: v.value, value_normalized: "", label: label?.trim().slice(0, 60) || null, source: "manual" })
      .select("id, value")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") return { ok: false, error: "This lead already has that contact." };
      throw error;
    }
    // Where the contact came from is part of the consent record (SRS 8.1 consent_log).
    await supabase.from("consent_log").insert({
      lead_id: lid,
      contact_id: data.id,
      channel: v.kind,
      value: data.value,
      event: "collected",
      source: "manual",
      recorded_by: actor.id,
      note: "Added on Lead Detail",
    });
    revalidatePath(`/leads/${lid}`);
    return { ok: true, message: "Contact added." };
  } catch (e) {
    return fail(e);
  }
}

export async function removeContact(leadId: string, contactId: string): Promise<DetailResult> {
  try {
    await requireRole(...ALL);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("lead_contacts").delete().eq("id", id.parse(contactId)).eq("lead_id", id.parse(leadId)).select("id");
    if (error) throw error;
    if (!data.length) return { ok: false, error: "That contact was already removed." };
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: "Contact removed." };
  } catch (e) {
    return fail(e);
  }
}

export async function makePrimary(leadId: string, contactId: string): Promise<DetailResult> {
  try {
    await requireRole(...ALL);
    const supabase = await createSupabaseServerClient();
    const { data: c, error } = await supabase.from("lead_contacts").select("kind").eq("id", id.parse(contactId)).eq("lead_id", id.parse(leadId)).single();
    if (error) throw error;
    await supabase.from("lead_contacts").update({ is_primary: false }).eq("lead_id", leadId).eq("kind", c.kind);
    const { error: e2 } = await supabase.from("lead_contacts").update({ is_primary: true }).eq("id", contactId);
    if (e2) throw e2;
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: "Main contact changed." };
  } catch (e) {
    return fail(e);
  }
}

export async function addNote(leadId: string, body: string, kind: "note" | "call"): Promise<DetailResult> {
  try {
    const actor = await requireRole(...ALL);
    const text = z.string().trim().min(1, "Write something first.").max(4000).parse(body);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("lead_notes").insert({ lead_id: id.parse(leadId), body: text, kind: z.enum(["note", "call"]).parse(kind), author_id: actor.id });
    if (error) throw error;
    if (kind === "call") await supabase.from("leads").update({ last_contacted_at: new Date().toISOString() }).eq("id", leadId);
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: kind === "call" ? "Call logged." : "Note added." };
  } catch (e) {
    return fail(e);
  }
}

const pkDateTime = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Choose a date.").nullable(),
);
function toUtc(v: string | null): string | null {
  if (!v) return null;
  return new Date(v.length === 10 ? `${v}T09:00:00+05:00` : `${v}:00+05:00`).toISOString();
}

const planSchema = z.object({
  next_follow_up_at: pkDateTime,
  demo_at: pkDateTime,
  trial_ends_at: pkDateTime,
  demo_notes: opt(2000),
});

/** Next follow-up and demo or trial details. Times are entered in Pakistan time. */
export async function updatePlan(leadId: string, input: z.input<typeof planSchema>): Promise<DetailResult> {
  try {
    await requireRole(...ALL);
    const v = planSchema.parse(input);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("leads")
      .update({ next_follow_up_at: toUtc(v.next_follow_up_at), demo_at: toUtc(v.demo_at), trial_ends_at: toUtc(v.trial_ends_at), demo_notes: v.demo_notes })
      .eq("id", id.parse(leadId));
    if (error) throw error;
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: "Follow-up and demo details saved." };
  } catch (e) {
    return fail(e);
  }
}
