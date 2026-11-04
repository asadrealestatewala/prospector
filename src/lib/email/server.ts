import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSecret } from "@/lib/integrations/settings-store";
import { checkEmailAllowance } from "@/lib/engine/budget";
import { serverEnv } from "@/lib/env";
import { buildEmail, type TemplateLanguage, type TemplateValues } from "@/lib/email/render";
import { formatFrom, ResendError, sendWithResend } from "@/lib/email/resend";
import { emailSettings, PRODUCT_NAMES } from "@/lib/email/values";
import type { Product } from "@/components/ui/chips";

/** Sample values for previews and test emails. */
export function sampleValues(product: Product, priceLines: Partial<Record<Product, string>>, senderName: string): TemplateValues {
  return {
    business_name: product === "vetlin" ? "Happy Paws Clinic" : product === "postwala" ? "Brandsmith Agency" : "Bright Future School",
    city: "Lahore",
    contact_name: null,
    product_name: PRODUCT_NAMES[product],
    product_price: priceLines[product] ?? null,
    sender_name: senderName,
  };
}

export async function previewEmail(input: { subject: string; body: string; product: Product; language: TemplateLanguage }) {
  const db = createSupabaseAdminClient();
  const s = await emailSettings(db);
  return buildEmail({
    subject: input.subject,
    bodyHtml: input.body,
    values: sampleValues(input.product, s.priceLines, "Your name"),
    language: input.language,
    footer: s.footer,
    unsubscribeUrl: `${serverEnv().APP_URL.replace(/\/$/, "")}/u/preview`,
  });
}

/**
 * Sends one test email to the signed-in user with sample values. It goes straight to Resend (no
 * queue), after the same cap and budget check as every other email, and counts against the cap.
 */
export async function sendTestEmail(input: {
  to: string;
  senderId: string;
  subject: string;
  body: string;
  product: Product;
  language: TemplateLanguage;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createSupabaseAdminClient();
  const { data: sender } = await db.from("email_senders").select("from_name, from_email, reply_to, is_active").eq("id", input.senderId).maybeSingle();
  if (!sender?.is_active) return { ok: false, error: "Choose an active sender address. Admins add them in Settings, Sender identities." };
  const apiKey = await getSecret("resend.api_key");
  if (!apiKey) return { ok: false, error: "The Resend API key is not set. An Admin adds it in Settings, Integrations." };
  const allowance = await checkEmailAllowance(db, input.product, 1);
  if (!allowance.ok) return { ok: false, error: allowance.message ?? "Emails are blocked by the cost settings." };

  const s = await emailSettings(db);
  const email = buildEmail({
    subject: `[Test] ${input.subject}`,
    bodyHtml: input.body,
    values: sampleValues(input.product, s.priceLines, sender.from_name),
    language: input.language,
    footer: s.footer,
    unsubscribeUrl: `${serverEnv().APP_URL.replace(/\/$/, "")}/u/test-email`,
  });
  try {
    await sendWithResend(apiKey, {
      from: formatFrom(sender.from_name, sender.from_email),
      to: input.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: sender.reply_to,
    }, `prospector-test-${crypto.randomUUID()}`);
  } catch (e) {
    return { ok: false, error: e instanceof ResendError ? e.message : "Resend could not send the test email." };
  }
  await db.rpc("record_test_email", { p_period_start: allowance.period.start, p_period_end: allowance.period.end });
  return { ok: true };
}
