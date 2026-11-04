/**
 * Email templates (SRS screen 9): variables, safe HTML, and the unsubscribe footer that every email
 * gets automatically (SRS 8.4). No server-only imports: the worker uses this module.
 */
import sanitizeHtml from "sanitize-html";

export type TemplateLanguage = "en" | "ur";

export { TEMPLATE_VARIABLES, type VariableKey, type TemplateValues } from "@/lib/email/variables";
import type { TemplateValues } from "@/lib/email/variables";

const VAR = /\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g;

/** Variable names used in a text, for the template's variable list. */
export function variablesIn(...texts: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const t of texts) for (const m of (t ?? "").matchAll(VAR)) found.add(m[1]);
  return [...found];
}

/**
 * Fills {{name}} and {{name|fallback}}. A value that is missing or empty uses the fallback, or
 * nothing. `escape` is on for HTML so a business name cannot add markup.
 */
export function fillVariables(text: string, values: TemplateValues, escape: boolean): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(VAR, (_all, name: string, fallback: string | undefined) => {
    const v = (values as Record<string, string | null | undefined>)[name]?.trim();
    const chosen = v ? v : (fallback ?? "").trim();
    if (!v && !fallback) missing.add(name);
    return escape ? escapeHtml(chosen) : chosen;
  });
  return { text: out, missing: [...missing] };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The HTML the editor may produce. Anything else (scripts, styles, images, forms) is removed. */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "h2", "h3", "blockquote", "hr"],
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: { h1: "h2" },
  }).trim();
}

/** Plain-text version for mail apps that do not show HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const l = label.replace(/<[^>]+>/g, "").trim();
      return l && l !== href ? `${l} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(p|h2|h3|li|blockquote|ul|ol)>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const UNSUBSCRIBE_LABEL: Record<TemplateLanguage, string> = {
  en: "Unsubscribe",
  ur: "مزید ای میل نہ بھیجیں (Unsubscribe)",
};
const FOOTER_REASON: Record<TemplateLanguage, string> = {
  en: "You are receiving this email because your business contact details are publicly listed.",
  ur: "آپ کو یہ ای میل اس لیے ملی کیونکہ آپ کے کاروبار کا رابطہ عوامی طور پر درج ہے۔",
};

export type BuiltEmail = { subject: string; html: string; text: string; missing: string[] };

/**
 * Builds the final email. The unsubscribe link is always added; a template cannot remove it.
 * `footer` is the Admin's branding footer (company name and address).
 */
export function buildEmail(input: {
  subject: string;
  bodyHtml: string;
  values: TemplateValues;
  language: TemplateLanguage;
  footer: string;
  unsubscribeUrl: string;
}): BuiltEmail {
  const subject = fillVariables(input.subject, input.values, false);
  const body = fillVariables(sanitizeEmailHtml(input.bodyHtml), input.values, true);
  const dir = input.language === "ur" ? "rtl" : "ltr";
  const footerLines = [input.footer.trim(), FOOTER_REASON[input.language]].filter(Boolean).map(escapeHtml).join("<br>");
  const url = escapeHtml(input.unsubscribeUrl);
  const html =
    `<!doctype html><html lang="${input.language}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>` +
    `<body style="margin:0;background:#ffffff;">` +
    `<div dir="${dir}" style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;">` +
    body.text +
    `<hr style="border:none;border-top:1px solid #e6e9ef;margin:32px 0 16px;">` +
    `<p style="font-size:12px;line-height:1.5;color:#6b7686;margin:0;">${footerLines}<br><a href="${url}" style="color:#6b7686;">${UNSUBSCRIBE_LABEL[input.language]}</a></p>` +
    `</div></body></html>`;
  const text = `${htmlToText(body.text)}\n\n--\n${[input.footer.trim(), FOOTER_REASON[input.language]].filter(Boolean).join("\n")}\n${UNSUBSCRIBE_LABEL[input.language]}: ${input.unsubscribeUrl}`;
  return { subject: subject.text.replace(/[\r\n]+/g, " ").trim(), html, text, missing: [...new Set([...subject.missing, ...body.missing])] };
}
