"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, AccessDeniedError } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { CHANNELS, DNC_REASONS } from "@/lib/compliance/filters";

export type DncResult = { ok: true; message: string } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AccessDeniedError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0].message };
  if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "42501") {
    return { ok: false, error: "You do not have access to this action." };
  }
  console.error("dnc action failed", e instanceof Error ? e.message : e);
  return { ok: false, error: "Could not save. Nothing was changed. Try again." };
}

const rowSchema = z.object({
  value: z.string().trim().min(1).max(200),
  channel: z.string().trim().max(20).optional(),
  reason: z.string().trim().max(30).optional(),
  note: z.string().trim().max(500).optional(),
});
const addSchema = z.object({
  rows: z.array(rowSchema).min(1, "Enter at least one email or phone number.").max(10000, "Add at most 10,000 at a time."),
  channel: z.enum(CHANNELS).optional(),
  reason: z.enum(DNC_REASONS),
  note: z.string().trim().max(500).optional(),
  source: z.enum(["manual", "import"]),
});

function summary(r: { added: number; already: number; invalid: number }) {
  const n = (x: number) => x.toLocaleString("en-PK");
  const parts = [`${n(r.added)} added`];
  if (r.already) parts.push(`${n(r.already)} already on the list`);
  if (r.invalid) parts.push(`${n(r.invalid)} skipped (not a valid email or phone number)`);
  return `${parts.join(", ")}.`;
}

/** Add one or many (the Add dialog) or a CSV import. Every send path checks this list at sending time. */
export async function addDoNotContact(input: z.input<typeof addSchema>): Promise<DncResult> {
  try {
    const actor = await requireRole("admin");
    const v = addSchema.parse(input);
    const rows = v.rows.map((r) => ({ ...r, channel: r.channel || v.channel }));
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("add_do_not_contact", {
      p_rows: rows,
      p_default_reason: v.reason,
      p_source: v.source,
      p_note: v.note || null,
    });
    if (error) throw error;
    const r = data as { added: number; already: number; invalid: number };
    await writeAudit(actor, v.source === "import" ? "dnc.imported" : "dnc.added", "do_not_contact", null, r);
    revalidatePath("/do-not-contact");
    return r.added || r.already ? { ok: true, message: summary(r) } : { ok: false, error: summary(r) };
  } catch (e) {
    return fail(e);
  }
}

/** Removal needs an Admin and a recorded reason (SRS screen 14). The entry is kept, marked removed. */
export async function removeDoNotContact(id: string, reason: string): Promise<DncResult> {
  try {
    const actor = await requireRole("admin");
    z.string().uuid().parse(id);
    const why = z.string().trim().min(5, "Write why this entry is being removed (at least 5 characters).").max(500).parse(reason);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("do_not_contact")
      .update({ removed_at: new Date().toISOString(), removed_by: actor.id, removal_reason: why })
      .eq("id", id)
      .is("removed_at", null)
      .select("id, channel");
    if (error) throw error;
    if (!data?.length) return { ok: false, error: "This entry was already removed." };
    await writeAudit(actor, "dnc.removed", "do_not_contact", id, { reason: why, channel: data[0].channel });
    revalidatePath("/do-not-contact");
    return { ok: true, message: "Removed from do-not-contact. The reason is kept in the audit log." };
  } catch (e) {
    return fail(e);
  }
}
