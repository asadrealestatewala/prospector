import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SettingsScreen, type SettingRow } from "./settings-screen";

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
  return <SettingsScreen settings={(data ?? []) as SettingRow[]} webhookUrl={`${appUrl}/api/webhooks/botlinkd`} resendWebhookUrl={`${appUrl}/api/webhooks/resend`} encryptionReady={encryptionReady} />;
}
