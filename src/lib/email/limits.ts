/**
 * Email sending limits (SRS screen 7 sending controls, 8.4 warm-up). All times are Pakistan time.
 * Values come from Settings, Sending limits; the defaults below only fill gaps in a saved setting.
 * No server-only imports: the worker uses this module.
 */
import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, for example 09:00.");

export const emailLimitsSchema = z.object({
  daily_cap: z.coerce.number().int().min(1).max(100_000),
  window_start: time,
  window_end: time,
  gap_seconds: z.coerce.number().int().min(0).max(3600),
  recent_contact_days: z.coerce.number().int().min(0).max(365),
  bounce_limit_pct: z.coerce.number().min(0.1).max(100),
  complaint_limit_pct: z.coerce.number().min(0.01).max(100),
  min_sample: z.coerce.number().int().min(1).max(10_000),
  warmup: z
    .array(z.object({ from_day: z.coerce.number().int().min(1).max(365), limit: z.coerce.number().int().min(1).max(100_000) }))
    .min(1)
    .max(12),
});
export type EmailLimits = z.infer<typeof emailLimitsSchema>;

export const DEFAULT_EMAIL_LIMITS: EmailLimits = {
  daily_cap: 300,
  window_start: "09:00",
  window_end: "18:00",
  gap_seconds: 60,
  recent_contact_days: 30,
  bounce_limit_pct: 5,
  complaint_limit_pct: 0.3,
  min_sample: 50,
  warmup: [
    { from_day: 1, limit: 20 },
    { from_day: 4, limit: 40 },
    { from_day: 8, limit: 80 },
    { from_day: 15, limit: 150 },
    { from_day: 22, limit: 300 },
  ],
};

export function readEmailLimits(value: unknown): EmailLimits {
  const merged = { ...DEFAULT_EMAIL_LIMITS, ...(value && typeof value === "object" ? value : {}) };
  const parsed = emailLimitsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_EMAIL_LIMITS;
}

const PK_OFFSET_MIN = 5 * 60; // Asia/Karachi is UTC+5 all year (no daylight saving).

/** Pakistan date, minutes past midnight, and the UTC instant when that Pakistan day began. */
export function pkClock(now: Date) {
  const shifted = new Date(now.getTime() + PK_OFFSET_MIN * 60_000);
  const date = shifted.toISOString().slice(0, 10);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const dayStart = new Date(Date.parse(`${date}T00:00:00Z`) - PK_OFFSET_MIN * 60_000);
  return { date, minutes, dayStart };
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** True inside the sending hours. A window that ends before it starts runs past midnight. */
export function inSendWindow(now: Date, start: string, end: string): boolean {
  const m = pkClock(now).minutes;
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return true;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** Daily limit for a sending domain on its Nth day of sending (day 1 is the first day). */
export function warmupLimit(schedule: EmailLimits["warmup"], startedOn: string | null, today: string): number {
  const day = startedOn ? Math.floor((Date.parse(today) - Date.parse(startedOn)) / 86_400_000) + 1 : 1;
  const steps = [...schedule].sort((a, b) => a.from_day - b.from_day);
  let limit = steps[0].limit;
  for (const s of steps) if (day >= s.from_day) limit = s.limit;
  return limit;
}

/**
 * How many emails to hand to the queue on this tick, and when the first goes out. With a gap,
 * emails are spaced `gapSeconds` apart and only the ones due before the next tick are queued.
 */
export function planBatch(input: {
  now: Date;
  nextSendAt: Date | null;
  gapSeconds: number;
  tickSeconds: number;
  allowed: number;
}): { count: number; firstAt: Date } {
  const first = new Date(Math.max(input.now.getTime(), input.nextSendAt?.getTime() ?? 0));
  const allowed = Math.max(0, Math.floor(input.allowed));
  if (allowed === 0) return { count: 0, firstAt: first };
  if (input.gapSeconds <= 0) return { count: Math.min(allowed, 25), firstAt: first };
  const horizon = input.now.getTime() + input.tickSeconds * 1000;
  if (first.getTime() >= horizon) return { count: 0, firstAt: first };
  const fits = Math.floor((horizon - first.getTime()) / (input.gapSeconds * 1000)) + 1;
  return { count: Math.min(allowed, fits, 25), firstAt: first };
}

/** The Resend plan period: from the billing day (or the 1st) of this month or last month. */
export function capPeriod(billingDay: number | null, today: string): { start: string; end: string } {
  const [y, m, d] = today.split("-").map(Number);
  const day = billingDay && billingDay >= 1 && billingDay <= 31 ? billingDay : 1;
  const clamp = (yy: number, mm: number) => Math.min(day, new Date(Date.UTC(yy, mm, 0)).getUTCDate());
  let sy = y;
  let sm = m;
  if (d < clamp(y, m)) {
    sm -= 1;
    if (sm === 0) {
      sm = 12;
      sy -= 1;
    }
  }
  const start = new Date(Date.UTC(sy, sm - 1, clamp(sy, sm)));
  let ey = sy;
  let em = sm + 1;
  if (em === 13) {
    em = 1;
    ey += 1;
  }
  const end = new Date(Date.UTC(ey, em - 1, clamp(ey, em)) - 86_400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
