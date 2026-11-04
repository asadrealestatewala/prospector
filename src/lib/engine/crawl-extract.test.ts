import { describe, expect, it } from "vitest";
import { cleanEmail, decodeCfEmail, extractPage, isSocialOrLinkPage, productHints, socialLink, toE164 } from "./crawl-extract";

const HOME = `<!doctype html><html><head><title>Al-Noor Grammar School | Lahore</title>
<meta name="description" content="Montessori to O Level, Cambridge and Matric streams in Johar Town, Lahore.">
<script>var x = "tracker@sentry.io";</script></head>
<body>
  <nav><a href="/about-us">About Us</a> <a href="/contact">Contact</a> <a href="/gallery">Gallery</a>
       <a href="/prospectus.pdf">Contact prospectus</a> <a href="https://other.pk/contact">Partner</a></nav>
  <p>Call 0300-1234567 or (042) 3576 1234. UAN 111-222-333.</p>
  <p>WhatsApp: +92 321 7654321</p>
  <a href="https://wa.me/923331112223">Chat</a>
  <a href="mailto:Info@AlNoor.edu.pk?subject=Admission">Email us</a>
  <img src="logo@2x.png" alt="logo@2x.png">
  <a href="https://www.facebook.com/alnoorlahore/">Facebook</a>
  <a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
  <a href="https://instagram.com/p/abc123">Post</a>
  <a href="https://www.instagram.com/alnoor.lahore">Instagram</a>
  <a href="https://youtube.com/watch?v=1">Video</a>
  <p>Write to name@example.com for a sample.</p>
</body></html>`;

describe("crawl extractor", () => {
  it("finds emails, phones, WhatsApp, social links and next pages", () => {
    const r = extractPage(HOME, "https://alnoor.edu.pk/");
    expect(r.title).toBe("Al-Noor Grammar School | Lahore");
    expect(r.description).toContain("Montessori to O Level");
    expect(r.emails.map((e) => e.value)).toEqual(expect.arrayContaining(["info@alnoor.edu.pk"]));
    expect(r.emails.map((e) => e.value)).not.toContain("tracker@sentry.io");
    expect(r.emails.map((e) => e.value)).not.toContain("name@example.com");
    expect(r.emails.some((e) => e.value.includes("2x"))).toBe(false);
    expect(r.phones.map((p) => p.value)).toEqual(expect.arrayContaining(["+923001234567", "+924235761234"]));
    expect(r.whatsapp.map((p) => p.value).sort()).toEqual(["+923217654321", "+923331112223"]);
    // A number shown as WhatsApp is not repeated as a phone.
    expect(r.phones.map((p) => p.value)).not.toContain("+923217654321");
    expect(r.social).toEqual([
      { platform: "facebook", url: "https://www.facebook.com/alnoorlahore", source_url: "https://alnoor.edu.pk/" },
      { platform: "instagram", url: "https://www.instagram.com/alnoor.lahore", source_url: "https://alnoor.edu.pk/" },
    ]);
    expect(r.links).toEqual(["https://alnoor.edu.pk/contact", "https://alnoor.edu.pk/about-us"]);
    expect(r.emails.every((e) => e.source_url === "https://alnoor.edu.pk/")).toBe(true);
  });

  it("decodes Cloudflare-protected emails", () => {
    const hex = "42" + [..."info@clinic.pk"].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, "0")).join("");
    expect(decodeCfEmail(hex)).toBe("info@clinic.pk");
    const r = extractPage(`<a class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</a>`, "https://clinic.pk/");
    expect(r.emails.map((e) => e.value)).toEqual(["info@clinic.pk"]);
  });

  it("falls back to the first long paragraph for the description", () => {
    const r = extractPage(`<p>Hi</p><p>We are a full-service veterinary hospital caring for dogs, cats and birds in Gulberg.</p>`, "https://vet.pk/");
    expect(r.description).toMatch(/^We are a full-service veterinary hospital/);
  });

  it("normalises Pakistani numbers and rejects junk", () => {
    expect(toE164("0300 1234567")).toBe("+923001234567");
    expect(toE164("+92 (300) 123-4567")).toBe("+923001234567");
    expect(toE164("3001234567")).toBe("+923001234567");
    expect(toE164("042-35761234")).toBe("+924235761234");
    expect(toE164("111-222-333")).toBe("+92111222333");
    expect(toE164("2024")).toBeNull();
    expect(toE164("0300 12")).toBeNull();
  });

  it("cleans emails", () => {
    expect(cleanEmail("mailto:Sales%40Shop.pk")).toBe("sales@shop.pk");
    expect(cleanEmail("hero@3x.webp")).toBeNull();
    expect(cleanEmail("your@email.com")).toBeNull();
    expect(cleanEmail("8f14e45fceea167a5a36dedd4bea2543@sentry.wixpress.com")).toBeNull();
  });

  it("tells profiles from share buttons and posts", () => {
    expect(socialLink("https://m.facebook.com/profile.php?id=1000123")).toEqual({ platform: "facebook", url: "https://www.facebook.com/profile.php?id=1000123" });
    expect(socialLink("https://twitter.com/intent/tweet?text=hi")).toBeNull();
    expect(socialLink("https://x.com/alnoor")).toEqual({ platform: "x", url: "https://www.x.com/alnoor" });
    expect(socialLink("https://www.linkedin.com/company/alnoor/")).toEqual({ platform: "linkedin", url: "https://www.linkedin.com/company/alnoor" });
    expect(socialLink("https://www.youtube.com/@alnoor")).toEqual({ platform: "youtube", url: "https://www.youtube.com/@alnoor" });
    expect(socialLink("https://alnoor.edu.pk/facebook")).toBeNull();
  });

  it("spots websites that are really social or link pages", () => {
    expect(isSocialOrLinkPage("https://www.facebook.com/petcare")).toBe(true);
    expect(isSocialOrLinkPage("https://linktr.ee/shop")).toBe(true);
    expect(isSocialOrLinkPage("https://petcare.pk")).toBe(false);
  });

  it("builds product hints", () => {
    const text = "Montessori, Playgroup, O Levels and A Level. Cambridge and FBISE. Hifz classes.";
    expect(productHints("classwell", text, [])).toEqual({
      class_levels: ["Montessori", "Playgroup", "O Level", "A Level", "Hifz"],
      exam_systems: ["Cambridge", "Federal Board"],
    });
    expect(productHints("vetlin", "Vaccination, spay and neuter, grooming for dogs and cats. Open 24/7.", [])).toEqual({
      services: ["Vaccination", "Surgery", "Grooming", "Emergency"],
      animals: ["Dogs", "Cats"],
    });
    expect(productHints("postwala", "Order online for home delivery", [{ platform: "facebook", url: "https://www.facebook.com/x", source_url: "" }])).toEqual({
      social_platforms: ["Facebook"],
      missing_platforms: ["Instagram", "TikTok", "YouTube"],
      website_features: ["Online ordering", "Delivery"],
    });
  });
});
