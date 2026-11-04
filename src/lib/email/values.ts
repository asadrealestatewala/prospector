/**
 * Values for template variables, per lead (SRS screen 9). Shared by the sender, the test email and
 * the preview. No server-only imports: the worker uses this module.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product } from "@/components/ui/chips";
import type { TemplateValues } from "@/lib/email/render";

export const PRODUCT_NAMES: Record<Product, string> = { classwell: "Classwell", vetlin: "Vetlin", postwala: "Postwala" };

export type PriceLines = Partial<Record<Product, string>>;

export function leadValues(
  lead: { name: string; city: string | null; product: Product },
  priceLines: PriceLines,
  senderName: string,
  contactName?: string | null,
): TemplateValues {
  return {
    business_name: lead.name,
    city: lead.city,
    contact_name: contactName ?? null,
    product_name: PRODUCT_NAMES[lead.product],
    product_price: priceLines[lead.product] ?? null,
    sender_name: senderName,
  };
}

/** The settings every email needs: the branding footer and the product price lines. */
export async function emailSettings(db: SupabaseClient): Promise<{ footer: string; priceLines: PriceLines; limits: unknown }> {
  const { data } = await db.from("settings").select("key, value").in("key", ["branding.email_footer", "products.price_lines", "email.limits"]);
  const get = (k: string) => data?.find((r) => r.key === k)?.value;
  const footer = typeof get("branding.email_footer") === "string" ? (get("branding.email_footer") as string) : "";
  const lines = get("products.price_lines");
  return { footer, priceLines: lines && typeof lines === "object" ? (lines as PriceLines) : {}, limits: get("email.limits") };
}
