import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RobotsTxtFile } from "@crawlee/utils";
import { CRAWLER_BOT_NAME, crawlSite, isPrivateAddress, loadRobots } from "./crawl-site";

/** A small local business website to crawl. */
const SITE: Record<string, { status?: number; type?: string; body: string }> = {
  "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /staff\n" },
  "/": {
    body: `<html><head><title>Paws Vet Clinic</title><meta name="description" content="Vet clinic in DHA Lahore for dogs and cats."></head>
      <body><a href="/contact-us">Contact</a> <a href="/about">About</a> <a href="/staff">Our team</a> <a href="/team-broken">Team</a>
      <a href="https://www.facebook.com/pawsvet">fb</a> <p>Vaccination and grooming.</p></body></html>`,
  },
  "/contact-us": { body: `<p>Email: hello@pawsvet.pk</p><p>WhatsApp 0300 1112223</p><p>Phone (042) 3571 0000</p>` },
  "/about": { body: `<title>About</title><p>Founded 2010.</p>` },
  "/staff": { body: `<p>secret@pawsvet.pk</p>` },
  "/team-broken": { status: 500, body: "oops" },
};

let server: Server;
let base: string;
const seen: { path: string; ua: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    seen.push({ path, ua: String(req.headers["user-agent"]) });
    const page = SITE[path];
    if (!page) {
      res.writeHead(404, { "content-type": "text/html" });
      return res.end("<p>Not found</p>");
    }
    res.writeHead(page.status ?? 200, { "content-type": page.type ?? "text/html; charset=utf-8" });
    res.end(page.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("crawlSite (Crawlee against a local website)", () => {
  it("crawls the homepage and contact pages, honours robots and reports broken pages", async () => {
    const robots = await loadRobots(`${base}/`, { allowPrivateHosts: true });
    expect(robots?.isAllowed(`${base}/staff`)).toBe(false);
    const r = await crawlSite(`${base}/`, { maxPages: 6, timeoutSecs: 10, robots, allowPrivateHosts: true });
    expect(r.homepageError).toBeNull();
    const urls = r.pages.map((p) => new URL(p.url).pathname).sort();
    expect(urls).toEqual(["/", "/about", "/contact-us"]);
    expect(r.skippedByRobots.map((u) => new URL(u).pathname)).toEqual(["/staff"]);
    expect(seen.some((s) => s.path === "/staff")).toBe(false);
    expect(r.failures.map((f) => new URL(f.url).pathname)).toEqual(["/team-broken"]);
    expect(r.failures[0].reason).toMatch(/500/);
    const contact = r.pages.find((p) => p.url.endsWith("/contact-us"))!;
    expect(contact.emails.map((e) => e.value)).toEqual(["hello@pawsvet.pk"]);
    expect(contact.whatsapp.map((e) => e.value)).toEqual(["+923001112223"]);
    expect(contact.phones.map((e) => e.value)).toEqual(["+924235710000"]);
    expect(seen.every((s) => s.ua.includes("ProspectorBot"))).toBe(true);
  }, 30_000);

  it("stops at the page limit", async () => {
    const r = await crawlSite(`${base}/`, { maxPages: 2, timeoutSecs: 10, robots: null, allowPrivateHosts: true });
    expect(r.pages).toHaveLength(2);
  }, 30_000);

  it("fails the crawl when the homepage is missing", async () => {
    const r = await crawlSite(`${base}/gone`, { maxPages: 6, timeoutSecs: 10, robots: null, allowPrivateHosts: true });
    expect(r.pages).toHaveLength(0);
    expect(r.homepageError).toMatch(/404/);
  }, 30_000);

  it("refuses private network addresses in production mode", async () => {
    const r = await crawlSite(`${base}/`, { maxPages: 6, timeoutSecs: 10, robots: null });
    expect(r.homepageError).toMatch(/private network/);
    const viaName = await crawlSite(`http://localhost:${new URL(base).port}/`, { maxPages: 6, timeoutSecs: 10, robots: null });
    expect(viaName.homepageError).toMatch(/private network/);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("203.0.113.9")).toBe(false);
  }, 30_000);

  it("matches robots rules for the Prospector bot by name", () => {
    const r = RobotsTxtFile.from("https://x.pk/robots.txt", "User-agent: ProspectorBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n");
    expect(r.isAllowed("https://x.pk/", CRAWLER_BOT_NAME)).toBe(false);
    expect(r.isAllowed("https://x.pk/", "OtherBot")).toBe(true);
  });
});
