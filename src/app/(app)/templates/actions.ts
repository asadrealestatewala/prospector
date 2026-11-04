"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccessDeniedError, requireRole } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { sanitizeEmailHtml, variablesIn } from "@/lib/email/render";
import { previewEmail, sendTestEmail } from "@/lib/email/server";

export type TemplateResult = { ok: true; message: string; id?: string } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AccessDeniedError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0].message };
  console.error("template action failed", e instanceof Error ? e.message : e);
  return { ok: false, error: "Could not save. Nothing was changed. Try again." };
}

const PRODUCTS = ["classwell", "vetlin", "postwala"] as const;
const contentSchema = z.object({
  subject: z.string().trim().min(1, "Enter a subject.").max(200, "Keep the subject under 200 characters."),
  body: z.string().max(100_000, "The body is too long."),
  product: z.enum(PRODUCTS),
  language: z.enum(["en", "ur"]),
});
const saveSchema = contentSchema.extend({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Enter a name of at least 2 characters.").max(120),
});

export async function saveEmailTemplate(input: z.input<typeof saveSchema>): Promise<TemplateResult> {
  try {
    const actor = await requireRole("admin", "manager");
    const v = saveSchema.parse(input);
    const body = sanitizeEmailHtml(v.body);
    if (!body.replace(/<[^>]+>/g, "").trim()) return { ok: false, error: "Write the email body." };
    const row = { name: v.name, product: v.product, language: v.language, subject: v.subject, body, variables: variablesIn(v.subject, body) };
    const supabase = await createSupabaseServerClient();
    if (v.id) {
      const { error } = await supabase.from("templates").update(row).eq("id", v.id).eq("channel", "email");
      if (error) throw error;
      await writeAudit(actor, "template.updated", "template", v.id, { name: v.name });
      revalidatePath("/templates");
      return { ok: true, message: "Template saved.", id: v.id };
    }
    const { data, error } = await supabase.from("templates").insert({ ...row, channel: "email", created_by: actor.id }).select("id").single();
    if (error) throw error;
    await writeAudit(actor, "template.created", "template", data.id, { name: v.name });
    revalidatePath("/templates");
    return { ok: true, message: "Template created.", id: data.id };
  } catch (e) {
    return fail(e);
  }
}

/** Duplicate, or create the B version for an A/B test (linked to the original). */
export async function copyEmailTemplate(id: string, asVariant: boolean): Promise<TemplateResult> {
  try {
    const actor = await requireRole("admin", "manager");
    z.string().uuid().parse(id);
    const supabase = await createSupabaseServerClient();
    const { data: t, error } = await supabase.from("templates").select("name, product, language, subject, body, variables").eq("id", id).eq("channel", "email").single();
    if (error) throw error;
    const { data, error: insErr } = await supabase
      .from("templates")
      .insert({ ...t, channel: "email", name: `${t.name} ${asVariant ? "(B version)" : "(copy)"}`.slice(0, 120), parent_template_id: asVariant ? id : null, created_by: actor.id })
      .select("id")
      .single();
    if (insErr) throw insErr;
    await writeAudit(actor, asVariant ? "template.variant_created" : "template.duplicated", "template", data.id, { from: id });
    revalidatePath("/templates");
    return { ok: true, message: asVariant ? "B version created. Edit the wording you want to test." : "Copy created.", id: data.id };
  } catch (e) {
    return fail(e);
  }
}

export async function setTemplateArchived(id: string, archived: boolean): Promise<TemplateResult> {
  try {
    const actor = await requireRole("admin", "manager");
    z.string().uuid().parse(id);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("templates").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", id);
    if (error) throw error;
    await writeAudit(actor, archived ? "template.archived" : "template.restored", "template", id);
    revalidatePath("/templates");
    return { ok: true, message: archived ? "Template archived. Running campaigns keep their copy." : "Template restored." };
  } catch (e) {
    return fail(e);
  }
}

export async function previewEmailTemplate(input: z.input<typeof contentSchema>) {
  try {
    await requireRole("admin", "manager");
    const v = contentSchema.extend({ subject: z.string().max(200) }).parse(input);
    const e = await previewEmail(v);
    return { ok: true as const, subject: e.subject, html: e.html, missing: e.missing };
  } catch (e) {
    return fail(e);
  }
}

export async function sendTemplateTest(input: z.input<typeof contentSchema> & { senderId: string }): Promise<TemplateResult> {
  try {
    const actor = await requireRole("admin", "manager");
    const v = contentSchema.extend({ senderId: z.string().uuid("Choose a sender address.") }).parse(input);
    const r = await sendTestEmail({ ...v, to: actor.email });
    if (!r.ok) return r;
    await writeAudit(actor, "template.test_sent", "template", null, { product: v.product });
    return { ok: true, message: `Test email sent to ${actor.email}.` };
  } catch (e) {
    return fail(e);
  }
}
