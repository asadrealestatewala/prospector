#!/usr/bin/env node
// Invites the first Admin. Usage: node --env-file=.env.local scripts/invite-admin.mjs you@example.com "Your Name"
// The person gets an email link to set their own password. No password is ever typed here.
import { createClient } from "@supabase/supabase-js";

const [email, fullName = ""] = process.argv.slice(2);
if (!email) {
  console.error('Usage: node --env-file=.env.local scripts/invite-admin.mjs you@example.com "Your Name"');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
  data: { full_name: fullName },
  redirectTo: `${appUrl}/auth/confirm?next=/account/password`,
});
if (error) {
  console.error(`Invite failed: ${error.message}`);
  process.exit(1);
}
await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { role: "admin" } });
const { error: upErr } = await admin.from("users").upsert({ id: data.user.id, email, full_name: fullName, role: "admin", status: "invited" });
if (upErr) {
  console.error(`Profile update failed: ${upErr.message}`);
  process.exit(1);
}
console.log(`Invite sent to ${email} as Admin. Open the email link to set a password.`);
