/**
 * Crawlee adapter: fetches a business homepage and up to a few contact, about and team pages
 * on the same site, honouring the site's robots file (SRS 8.4). Worker only.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { CheerioCrawler, Configuration, log as crawleeLog } from "@crawlee/cheerio";
import { MemoryStorage } from "@crawlee/memory-storage";
import { RobotsTxtFile } from "@crawlee/utils";
import { extractPage, sameSite, type PageResult } from "@/lib/engine/crawl-extract";

// The worker logs its own one-line results; Crawlee's own logs would repeat them with stack traces.
crawleeLog.setLevel(crawleeLog.LEVELS.OFF);

export const CRAWLER_USER_AGENT = process.env.CRAWLER_USER_AGENT || "Mozilla/5.0 (compatible; ProspectorBot/1.0; business contact finder)";
/** The robots file is matched on this name. */
export const CRAWLER_BOT_NAME = "ProspectorBot";

export type Robots = { isAllowed(url: string): boolean };
export type CrawlSiteOptions = {
  maxPages: number;
  timeoutSecs: number;
  robots: Robots | null;
  /** Tests run against a local server; production refuses private addresses. */
  allowPrivateHosts?: boolean;
};
export type CrawlSiteResult = {
  pages: PageResult[];
  /** Pages that could not be fetched, with the reason. */
  failures: { url: string; reason: string }[];
  /** Set when the homepage itself failed, which fails the whole crawl. */
  homepageError: string | null;
  /** Pages the robots file did not allow. */
  skippedByRobots: string[];
};

/**
 * Loads the robots file with the crawler's own name. A missing file (404) or an unreachable one allows
 * everything, as the robots rules say; a server error (5xx) is treated as "do not crawl" for safety.
 */
export async function loadRobots(url: string, opts: { allowPrivateHosts?: boolean; fetchImpl?: typeof fetch } = {}): Promise<Robots | null> {
  const robotsUrl = new URL("/robots.txt", url).toString();
  try {
    if (!opts.allowPrivateHosts && (await resolvesPrivate(new URL(url).hostname))) return null;
    const res = await (opts.fetchImpl ?? fetch)(robotsUrl, {
      headers: { "user-agent": CRAWLER_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (res.status >= 500) return { isAllowed: () => false };
    if (!res.ok) return null;
    const text = (await res.text()).slice(0, 500_000);
    const r = RobotsTxtFile.from(robotsUrl, text);
    return { isAllowed: (u) => r.isAllowed(u, CRAWLER_BOT_NAME) };
  } catch {
    return null;
  }
}

async function resolvesPrivate(host: string): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, "");
  if (h === "localhost") return true;
  if (isIP(h)) return isPrivateAddress(h);
  return new Promise((resolve) =>
    dnsLookup(h, { all: true }, (err, list) => resolve(!err && (list as LookupAddress[]).some((a) => isPrivateAddress(a.address)))),
  );
}

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") ||
    v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

export class PrivateAddressError extends Error {
  constructor(host: string) {
    super(`The website address ${host} points to a private network, so it was not crawled.`);
    this.name = "PrivateAddressError";
  }
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
/** DNS lookup that refuses private addresses, so a listing (or a redirect) cannot point the crawler inside the server. */
function safeLookup(hostname: string, options: unknown, callback?: LookupCb) {
  const cb = (typeof options === "function" ? options : callback) as LookupCb;
  const opts = (typeof options === "object" && options ? options : {}) as { all?: boolean; family?: number };
  dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err, []);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) return cb(new PrivateAddressError(hostname) as NodeJS.ErrnoException, []);
    if (opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function reason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/private network/.test(msg)) return msg;
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return "The website address does not exist (DNS lookup failed).";
  if (/ECONNREFUSED/.test(msg)) return "The website refused the connection.";
  if (/ECONNRESET|socket hang up/.test(msg)) return "The website closed the connection.";
  if (/timed? ?out|ETIMEDOUT|TimeoutError/i.test(msg)) return "The website took too long to respond.";
  if (/certificate|SSL|TLS|CERT_/i.test(msg)) return "The website's security certificate is not valid.";
  const code = /status code[:\s]+(\d{3})|(\d{3}) - /i.exec(msg);
  if (code) return `The website answered with error ${code[1] ?? code[2]}.`;
  if (/Content-Type|content type/i.test(msg)) return "The website address does not lead to a web page.";
  return msg.slice(0, 200);
}

export async function crawlSite(startUrl: string, opts: CrawlSiteOptions): Promise<CrawlSiteResult> {
  const result: CrawlSiteResult = { pages: [], failures: [], homepageError: null, skippedByRobots: [] };
  const config = new Configuration({ persistStorage: false, storageClient: new MemoryStorage({ persistStorage: false, writeMetadata: false }) });
  const isPrivateOk = !!opts.allowPrivateHosts;

  if (!isPrivateOk) {
    const host = new URL(startUrl).hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || (isIP(host) && isPrivateAddress(host))) {
      result.homepageError = new PrivateAddressError(host).message;
      return result;
    }
  }

  const crawler = new CheerioCrawler(
    {
      maxRequestsPerCrawl: opts.maxPages,
      maxConcurrency: 2,
      maxRequestRetries: 1,
      navigationTimeoutSecs: opts.timeoutSecs,
      requestHandlerTimeoutSecs: opts.timeoutSecs + 10,
      useSessionPool: false,
      statusMessageLoggingInterval: 3600,
      additionalMimeTypes: ["application/xhtml+xml"],
      preNavigationHooks: [
        (_ctx, gotOptions) => {
          gotOptions.headers = { ...gotOptions.headers, "user-agent": CRAWLER_USER_AGENT, "accept-language": "en-PK,en;q=0.9,ur;q=0.8" };
          if (!isPrivateOk) (gotOptions as Record<string, unknown>).dnsLookup = safeLookup;
          gotOptions.maxRedirects = 5;
        },
      ],
      requestHandler: async ({ request, response, body, crawler: c }) => {
        if (response.statusCode && response.statusCode >= 400) {
          request.noRetry = true;
          throw new Error(`status code ${response.statusCode}`);
        }
        const html = typeof body === "string" ? body : body.toString("utf8");
        const page = extractPage(html, request.loadedUrl ?? request.url);
        result.pages.push(page);
        if (request.userData.depth === 0) {
          const base = request.loadedUrl ?? request.url;
          const next: string[] = [];
          for (const u of page.links) {
            if (next.length >= opts.maxPages - 1) break;
            if (!sameSite(u, base)) continue;
            if (opts.robots && !opts.robots.isAllowed(u)) {
              result.skippedByRobots.push(u);
              continue;
            }
            next.push(u);
          }
          if (next.length) await c.addRequests(next.map((url) => ({ url, userData: { depth: 1 } })));
        }
      },
      failedRequestHandler: async ({ request }, error) => {
        const why = reason(error);
        if (request.userData.depth === 0) result.homepageError = why;
        else result.failures.push({ url: request.url, reason: why });
      },
    },
    config,
  );

  await crawler.run([{ url: startUrl, userData: { depth: 0 } }]);
  await crawler.teardown().catch(() => undefined);
  return result;
}
