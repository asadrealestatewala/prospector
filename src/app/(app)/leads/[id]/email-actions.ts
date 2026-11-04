"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccessDeniedError, requireRole } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { checkEmailAllowance } from "@/lib/engine/budget";
import { enqueueOneOffEmail, QueueUnavailableError } from "@/lib/engine/queue";
import { sanitizeEmailHtml } from "@/lib/email/render";
import type { Product } from "@/components/ui/chips";

const schema = z.object({
  leadId: z.string().uuid(),
  to: z.string().trim().toLowerCase().email("Choose an email address."),
  senderId: z.string().uuid("Choose the sender address."),
  subject: z.string().trim().min(1, "Enter a subject.").max(200),
  body: z.string().max(100_000),
  language: z.enum(["en", "ur"]),
  templateId: z.string().uuid().nullable(),
});

/** Lead Detail "Send email": one email to this lead, through the same queue and safeguards as campaigns. */
export async function sendLeadEmail(input: z.input<typeof schema>): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const actor = await requireRole("admin", "manager", "sales_agent");
    const v = schema.parse(input);
    const body = sanitizeEmailHtml(v.body);
    if (!body.replace(/<[^>]+>/g, "").trim()) return { ok: false, error: "Write the email." };
    const supabase = await createSupabaseServerClient();

    const { data: lead } = await supabase.from("leads").select("id, product").eq("id", v.leadId).maybeSingle();
    if (!lead) return { ok: false, error: "Lead not found." };
    const { data: contact } = await supabase
      .from("lead_contacts")
      .select("id, value, verification, consent_state")
      .eq("lead_id", v.leadId)
      .eq("kind", "email")
      .eq("value_normalized", v.to)
      .maybeSingle();
    if (!contact) return { ok: false, error: "That address is not on this lead." };
    if (contact.consent_state === "opted_out") return { ok: false, error: "This contact has opted out of email." };
    if (contact.verification === "invalid") return { ok: false, error: "This address is invalid, so the email would bounce." };
    const { data: blocked } = await supabase.rpc("is_do_not_contact", { p_channel: "email", p_value: contact.value });
    if (blocked) return { ok: false, error: "This address is on the do-not-contact list." };

    const admin = createSupabaseAdminClient();
    const { data: sender } = await admin.from("email_senders").select("from_email, is_active").eq("id", v.senderId).maybeSingle();
    if (!sender?.is_active) return { ok: false, error: "Choose an active sender address." };
    const { data: keyRow } = await admin.from("settings").select("secret_last4").eq("key", "resend.api_key").maybeSingle();
    if (!keyRow?.secret_last4) return { ok: false, error: "The Resend API key is not set. An Admin adds it in Settings, Integrations." };
    const allowance = await checkEmailAllowance(admin, lead.product as Product, 1);
    if (!allowance.ok) return { ok: false, error: allowance.message ?? "Emails are blocked by the cost settings." };

    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .upsert({ lead_id: v.leadId, channel: "email", address: contact.value }, { onConflict: "lead_id,channel" })
      .select("id")
      .single();
    if (convErr) throw convErr;
    const { data: msg, error: msgErr } = await supabase
      .from("messages")
      .insert({
        conversation_id: conv.id,
        lead_id: v.leadId,
        channel: "email",
        direction: "outbound",
        from_address: sender.from_email,
        to_address: contact.value,
        subject: v.subject,
        body,
        template_id: v.templateId,
        sender_id: v.senderId,
        language: v.language,
        status: "queued",
        sent_by: actor.id,
      })
      .select("id")
      .single();
    if (msgErr) throw msgErr;
    try {
      await enqueueOneOffEmail(msg.id);
    } catch (e) {
      const reason = e instanceof QueueUnavailableError ? e.message : "Could not queue the email.";
      await admin.from("messages").update({ status: "failed", error: reason }).eq("id", msg.id);
      return { ok: false, error: reason };
    }
    await writeAudit(actor, "email.sent_one", "lead", v.leadId, { message: msg.id });
    revalidatePath(`/leads/${v.leadId}`);
    return { ok: true, message: "Email queued. It shows on the timeline once Resend accepts it." };
  } catch (e) {
    if (e instanceof AccessDeniedError) return { ok: false, error: e.message };
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0].message };
    console.error("send lead email failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "Could not send. Nothing was sent. Try again." };
  }
}
