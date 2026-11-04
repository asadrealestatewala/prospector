import { load, type CheerioAPI } from "cheerio";

/**
 * Reads business contact details from one web page (SRS 8.2, 8.4): emails, phone and WhatsApp numbers,
 * social links, a short description and links to the contact, about and team pages.
 * Pure functions so they can be tested without a network.
 */

export type Found = { value: string; source_url: string };
export type SocialPlatform = "facebook" | "instagram" | "linkedin" | "youtube" | "tiktok" | "x";
export type SocialLink = { platform: SocialPlatform; url: string; source_url: string };
export type PageResult = {
  url: string;
  title: string | null;
  description: string | null;
  emails: Found[];
  phones: Found[];
  whatsapp: Found[];
  social: SocialLink[];
  /** Same-site pages worth visiting next, best first. */
  links: string[];
  /** Visible text, used for product hints. */
  text: string;
};

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}/gi;
const FILE_TLDS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "bmp", "css", "js", "pdf", "mp4", "webm"]);
const PLACEHOLDER_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "domain.com", "yourdomain.com", "email.com", "mail.com", "website.com",
  "company.com", "yoursite.com", "test.com", "sentry.io", "wixpress.com", "sentry.wixpress.com", "sentry-next.wixpress.com",
  "godaddy.com", "w3.org", "schema.org", "yourcompany.com",
]);
const PLACEHOLDER_LOCALS = /^(you|your|yourname|youremail|name|user|username|email|someone|john|johndoe|jane|test|example|abc|xyz)$/i;

/** Lower-cased email, or null when it looks like a file name, placeholder or tracking id. */
export function cleanEmail(raw: string): string | null {
  const e = raw.trim().replace(/^mailto:/i, "").split("?")[0].replace(/[.,;:)\]]+$/, "").toLowerCase();
  let decoded = e;
  try {
    decoded = decodeURIComponent(e);
  } catch {
    /* keep as is */
  }
  const m = decoded.match(new RegExp(`^${EMAIL_RE.source}$`, "i"));
  if (!m) return null;
  const [local, domain] = decoded.split("@");
  const tld = domain.split(".").pop() ?? "";
  if (FILE_TLDS.has(tld)) return null;
  if (PLACEHOLDER_DOMAINS.has(domain) || PLACEHOLDER_LOCALS.test(local)) return null;
  if (/^[0-9a-f]{16,}$/.test(local)) return null; // tracking ids such as Sentry keys
  if (/@\d+x\./.test(decoded)) return null; // image@2x.png
  return decoded;
}

/** Cloudflare "email protection" hides addresses as hex; the first byte is the XOR key. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/**
 * Pakistani numbers to +92 E.164 (same rules as normalize_phone in the database).
 * Returns null when the digits are not a plausible phone number.
 */
export function toE164(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0092")) d = d.slice(2);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (/^0?111\d{6}$/.test(d)) d = "92" + d.replace(/^0/, ""); // UAN 111-xxx-xxx
  else if (/^03\d{9}$/.test(d)) d = "92" + d.slice(1);
  else if (/^3\d{9}$/.test(d)) d = "92" + d;
  else if (/^0\d{9,10}$/.test(d)) d = "92" + d.slice(1);
  if (d.startsWith("92")) {
    // Mobile: 92 3xx xxxxxxx. Landline: 92 + area code (2 to 4 digits) + number, 11 or 12 digits in all.
    if (/^923\d{9}$/.test(d)) return `+${d}`;
    if (/^92[2-9]\d{8,9}$/.test(d) && !d.startsWith("923")) return `+${d}`;
    if (/^92111\d{6}$/.test(d)) return `+${d}`;
    return null;
  }
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}

// Numbers written in page text. Mobiles are strict (03xx xxxxxxx); landlines need a 0 or +92 prefix.
const MOBILE_TEXT_RE = /(?<![\d+])(?:\+92|0092|92|0)[\s.-]?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const LANDLINE_TEXT_RE = /(?<![\d+])(?:\+92[\s.-]?|0092[\s.-]?|\(?0)(?:21|22|41|42|51|52|61|62|71|81|91|\d{3})\)?[\s.-]?\d{3,4}[\s.-]?\d{3,5}(?!\d)/g;
const UAN_RE = /(?<!\d)(?:\+92[\s.-]?|0)?111[\s.-]?\d{3}[\s.-]?\d{3}(?!\d)/g;
const WHATSAPP_TEXT_RE = /whats\s?app[^0-9+]{0,30}((?:\+|00)?[\d][\d\s().-]{8,18}\d)/gi;

const SOCIAL_HOSTS: [RegExp, SocialPlatform][] = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(twitter\.com|x\.com)$/, "x"],
];
const SOCIAL_SKIP: Record<SocialPlatform, RegExp> = {
  facebook: /^\/(sharer|share|dialog|plugins|tr|login|privacy|policies|help|events\/?$|groups\/?$|watch|photo|story\.php|permalink\.php|hashtag)|^\/?$/i,
  instagram: /^\/(p|reel|reels|explore|accounts|stories|tv)\/|^\/?$/i,
  linkedin: /^\/(shareArticle|sharing|feed|login|signup|pulse|posts)|^\/?$/i,
  youtube: /^\/(watch|embed|shorts|results|playlist|redirect|iframe_api)|^\/?$/i,
  tiktok: /^\/(embed|share|tag|music|discover)|^\/?$/i,
  x: /^\/(intent|share|home|search|hashtag|i\/|login)|^\/?$/i,
};

/** The platform for a social profile link, or null for other links and for share buttons and posts. */
export function socialLink(href: string): { platform: SocialPlatform; url: string } | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|web|mobile|business|pk)\./, "");
  const hit = SOCIAL_HOSTS.find(([re]) => re.test(host));
  if (!hit) return null;
  const platform = hit[1];
  // Old Facebook page links carry the id in the query: profile.php?id=123.
  if (platform === "facebook" && /^\/profile\.php$/i.test(u.pathname) && u.searchParams.get("id")) {
    return { platform, url: `https://www.facebook.com/profile.php?id=${u.searchParams.get("id")}` };
  }
  if (SOCIAL_SKIP[platform].test(u.pathname)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  return { platform, url: `https://${host === "youtu.be" ? "youtu.be" : `www.${host}`}${path}` };
}

/** True when a lead's "website" is really a social or link page that the crawler should not fetch. */
export function isSocialOrLinkPage(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return SOCIAL_HOSTS.some(([re]) => re.test(host.replace(/^(m|web|mobile|business|pk)\./, ""))) ||
      /(^|\.)(linktr\.ee|bio\.link|wa\.me|whatsapp\.com|sites\.google\.com|g\.page|goo\.gl|bit\.ly)$/.test(host);
  } catch {
    return false;
  }
}

function whatsappFromHref(href: string): string | null {
  try {
    const u = new URL(href);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "wa.me") return u.pathname.slice(1).replace(/\D/g, "") || null;
    if (/(^|\.)whatsapp\.com$/.test(host) || u.protocol === "whatsapp:") return (u.searchParams.get("phone") ?? "").replace(/\D/g, "") || null;
  } catch {
    /* not a URL */
  }
  return null;
}

// Page names that usually hold contact details, best first. Urdu: رابطہ (contact), ہمارے بارے (about us).
const NEXT_PAGE_RULES: [RegExp, number][] = [
  [/contact|get-?in-?touch|reach-?us|رابطہ/i, 0],
  [/about|who-?we-?are|our-?story|ہمارے\s*بارے/i, 1],
  [/team|staff|faculty|management|doctors|our-?people/i, 2],
  [/location|branch|campus|find-?us|visit-?us|admission/i, 3],
];
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|zip|rar|docx?|xlsx?|pptx?|mp4|mp3|avi)$/i;

export function sameSite(a: string, b: string): boolean {
  try {
    const h = (u: string) => new URL(u).hostname.toLowerCase().replace(/^www\./, "");
    return h(a) === h(b);
  } catch {
    return false;
  }
}

function cleanText($: CheerioAPI): string {
  $("script, style, noscript, template, svg, iframe").remove();
  // Keep words in separate elements apart, so "info@x.pk" and "WhatsApp" do not run together.
  $("br").replaceWith(" ");
  $("p, div, li, td, th, tr, h1, h2, h3, h4, h5, h6, section, article, header, footer, nav, address, span, a, strong, b, label, dt, dd").append(" ");
  return $("body").text().replace(/\s+/g, " ").trim();
}

export function extractPage(html: string, pageUrl: string): PageResult {
  const $ = load(html);
  const title = $("title").first().text().replace(/\s+/g, " ").trim().slice(0, 200) || null;
  const metaDesc =
    $('meta[name="description" i]').attr("content") || $('meta[property="og:description" i]').attr("content") || "";
  const emails = new Map<string, Found>();
  const phones = new Map<string, Found>();
  const whatsapp = new Map<string, Found>();
  const social = new Map<string, SocialLink>();
  const links: { url: string; rank: number }[] = [];
  const addEmail = (raw: string) => {
    const e = cleanEmail(raw);
    if (e && !emails.has(e)) emails.set(e, { value: e, source_url: pageUrl });
  };
  const addPhone = (raw: string, into: Map<string, Found>) => {
    const e = toE164(raw);
    if (e && !into.has(e)) into.set(e, { value: e, source_url: pageUrl });
  };

  $("[data-cfemail]").each((_, el) => {
    const d = decodeCfEmail($(el).attr("data-cfemail") ?? "");
    if (d) addEmail(d);
  });
  $("a[href]").each((_, el) => {
    const raw = ($(el).attr("href") ?? "").trim();
    if (!raw) return;
    if (/^mailto:/i.test(raw)) return addEmail(raw);
    if (/^tel:/i.test(raw)) return addPhone(raw.slice(4), phones);
    if (/^\/cdn-cgi\/l\/email-protection#/i.test(raw)) {
      const d = decodeCfEmail(raw.split("#")[1] ?? "");
      if (d) addEmail(d);
      return;
    }
    let abs: string;
    try {
      abs = new URL(raw, pageUrl).toString();
    } catch {
      return;
    }
    const wa = whatsappFromHref(abs) ?? (/^whatsapp:/i.test(raw) ? whatsappFromHref(raw) : null);
    if (wa) return addPhone(wa.length === 10 && wa.startsWith("3") ? `0${wa}` : `+${wa}`, whatsapp);
    const s = socialLink(abs);
    if (s) {
      if (!social.has(s.url) && [...social.values()].filter((x) => x.platform === s.platform).length < 2) {
        social.set(s.url, { ...s, source_url: pageUrl });
      }
      return;
    }
    if (!/^https?:/i.test(abs) || !sameSite(abs, pageUrl) || SKIP_EXT.test(new URL(abs).pathname)) return;
    const label = `${new URL(abs).pathname} ${$(el).text()}`;
    const rule = NEXT_PAGE_RULES.find(([re]) => re.test(label));
    if (rule) links.push({ url: abs.split("#")[0], rank: rule[1] });
  });

  const text = cleanText($);
  for (const m of text.matchAll(EMAIL_RE)) addEmail(m[0]);
  for (const m of text.matchAll(WHATSAPP_TEXT_RE)) addPhone(m[1], whatsapp);
  for (const re of [MOBILE_TEXT_RE, LANDLINE_TEXT_RE, UAN_RE]) for (const m of text.matchAll(re)) addPhone(m[0], phones);
  // A number shown as WhatsApp is kept once, as WhatsApp.
  for (const k of whatsapp.keys()) phones.delete(k);

  let description = metaDesc.replace(/\s+/g, " ").trim();
  if (description.length < 40) {
    const p = $("p")
      .toArray()
      .map((el) => $(el).text().replace(/\s+/g, " ").trim())
      .find((t) => t.length >= 60 && !t.includes("@"));
    description = p ?? description;
  }

  const seen = new Set<string>();
  const ordered = links
    .sort((a, b) => a.rank - b.rank)
    .map((l) => l.url)
    .filter((u) => {
      const k = u.replace(/\/+$/, "").toLowerCase();
      if (seen.has(k) || k === pageUrl.replace(/\/+$/, "").toLowerCase()) return false;
      seen.add(k);
      return true;
    });

  return {
    url: pageUrl,
    title,
    description: description ? description.slice(0, 600) : null,
    emails: [...emails.values()].slice(0, 15),
    phones: [...phones.values()].slice(0, 10),
    whatsapp: [...whatsapp.values()].slice(0, 5),
    social: [...social.values()],
    links: ordered,
    text: text.slice(0, 50_000),
  };
}

type HintRule = [label: string, re: RegExp];
const CLASSWELL_LEVELS: HintRule[] = [
  ["Montessori", /montessori/i], ["Playgroup", /play\s?group/i], ["Nursery", /nursery/i], ["Kindergarten", /\bkg\b|kinder\s?garten|\bprep\b/i],
  ["Primary", /\bprimary\b/i], ["Middle", /\bmiddle\b/i], ["Matric", /\bmatric|\bssc\b/i], ["O Level", /\bo[\s-]?levels?\b/i],
  ["A Level", /\ba[\s-]?levels?\b/i], ["Intermediate", /\bintermediate\b|\bhssc\b|\bf\.?sc\b|\bi\.?cs\b|\bi\.?com\b/i], ["Hifz", /\bhifz\b|hifz-?ul-?quran/i],
];
const CLASSWELL_SYSTEMS: HintRule[] = [
  ["Cambridge", /cambridge/i], ["Federal Board", /federal board|\bfbise\b/i], ["Punjab Board", /\bbise\b|punjab board/i],
  ["Aga Khan Board", /aga khan (university )?(examination )?board|\baku-?eb\b/i], ["IB", /international baccalaureate|\bib (diploma|programme|program)\b/i],
];
const VETLIN_SERVICES: HintRule[] = [
  ["Vaccination", /vaccin/i], ["Surgery", /surger|surgical|spay|neuter/i], ["Grooming", /groom/i], ["Boarding", /boarding|pet hotel|daycare/i],
  ["Dental", /dental|teeth/i], ["X-ray", /x-?ray|radiolog/i], ["Ultrasound", /ultrasound|sonograph/i], ["Laboratory", /\blab\b|laborator/i],
  ["Pharmacy or pet shop", /pharmacy|pet shop|pet store|pet food/i], ["Emergency", /emergency|24\s?\/\s?7|24 hours/i], ["Deworming", /deworm/i],
];
const VETLIN_ANIMALS: HintRule[] = [
  ["Dogs", /\bdogs?\b|canine|puppy|puppies/i], ["Cats", /\bcats?\b|feline|kitten/i], ["Birds", /\bbirds?\b|parrot|avian/i],
  ["Livestock", /livestock|cattle|\bcows?\b|buffalo|goats?\b|sheep|poultry/i], ["Horses", /\bhorses?\b|equine/i],
];
const POSTWALA_SIGNALS: HintRule[] = [
  ["Online ordering", /order online|order now|online order|add to cart|checkout/i], ["Delivery", /home delivery|free delivery|we deliver|foodpanda|cash on delivery/i],
  ["Bookings", /book (an )?appointment|book now|reservation|booking/i], ["Blog or news", /\bblog\b|latest news/i],
];

const pick = (rules: HintRule[], text: string) => rules.filter(([, re]) => re.test(text)).map(([l]) => l);

/** Product-specific hints for Lead Detail (SRS screen 6): class levels for schools, services for clinics. */
export function productHints(product: string, text: string, social: SocialLink[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const set = (k: string, v: string[]) => {
    if (v.length) out[k] = v;
  };
  if (product === "classwell") {
    set("class_levels", pick(CLASSWELL_LEVELS, text));
    set("exam_systems", pick(CLASSWELL_SYSTEMS, text));
  } else if (product === "vetlin") {
    set("services", pick(VETLIN_SERVICES, text));
    set("animals", pick(VETLIN_ANIMALS, text));
  } else if (product === "postwala") {
    const names: Record<SocialPlatform, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", youtube: "YouTube", tiktok: "TikTok", x: "X" };
    const have = [...new Set(social.map((s) => s.platform))];
    set("social_platforms", have.map((p) => names[p]));
    set("missing_platforms", (["facebook", "instagram", "tiktok", "youtube"] as SocialPlatform[]).filter((p) => !have.includes(p)).map((p) => names[p]));
    set("website_features", pick(POSTWALA_SIGNALS, text));
  }
  return out;
}
