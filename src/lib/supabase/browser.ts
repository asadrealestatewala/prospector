"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Browser client with the public anon key only. Used for realtime and the password reset form. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
