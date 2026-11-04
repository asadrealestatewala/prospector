import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SettingsScreen, type SettingRow } from "./settings-screen";
import type { CityGroup } from "@/lib/engine/cities";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireScreen("settings");
  const supabase = await createSupabaseServerClient();
  // secret_ciphertext is not selectable by signed-in users; only masked last four characters come back.
  const { data } = await supabase
    .from("settings")
    .select("key, value, is_secret, secret_last4, last_tested_at, last_test_ok, last_test_message, updated_at");
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const encryptionReady = Boolean(process.env.SETTINGS_ENCRYPTION_KEY);
  const value = (k: string) => (data ?? []).find((r) => r.key === k)?.value;
  const scoring = { website: 10, email: 5, verified_email: 20, whatsapp: 20, reviews: 10, reviews_min: 20, recent_reply: 30, recent_reply_days: 14, ...((value("scoring.rules") as object) ?? {}) };
  const autoVerify = Boolean((value("verification.options") as { auto_verify_new?: boolean } | null)?.auto_verify_new);
  const cityGroups = Array.isArray(value("search.city_groups")) ? (value("search.city_groups") as CityGroup[]) : [];
  return <SettingsScreen autoVerify={autoVerify} scoring={scoring} cityGroups={cityGroups} settings={(data ?? []) as SettingRow[]} webhookUrl={`${appUrl}/api/webhooks/botlinkd`} resendWebhookUrl={`${appUrl}/api/webhooks/resend`} encryptionReady={encryptionReady} />;
}
