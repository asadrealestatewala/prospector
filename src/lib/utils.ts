import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const PK_TIMEZONE = "Asia/Karachi";

/** Formats a timestamp in Pakistan time, e.g. "4 Nov 2026, 5:24 pm". */
export function formatPkDateTime(value: string | Date | null | undefined): string {
  if (!value) return "Never";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-PK", {
    timeZone: PK_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatPkDate(value: string | Date | null | undefined): string {
  if (!value) return "Not set";
  const date = typeof value === "string" ? new Date(`${value}`.length === 10 ? `${value}T00:00:00+05:00` : value) : value;
  return new Intl.DateTimeFormat("en-PK", { timeZone: PK_TIMEZONE, day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** Today's date in Pakistan as YYYY-MM-DD. */
export function pkToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PK_TIMEZONE }).format(new Date());
}

export function formatMoney(amount: number | null | undefined, currency: "PKR" | "USD" | string): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "Not set";
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    maximumFractionDigits: amount !== 0 && Math.abs(amount) < 1 ? 4 : 2,
  }).format(amount);
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "Not set";
  return new Intl.NumberFormat("en-PK").format(n);
}
