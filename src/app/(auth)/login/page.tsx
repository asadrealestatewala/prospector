import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  setup: "Prospector is not connected to Supabase yet. Set the Supabase environment variables on the server.",
  reset: "Your password was changed. Sign in with the new password.",
  link: "That link has expired or was already used. Ask for a new one.",
  inactive: "This account is not active. Ask an Admin to give you access.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <LoginForm next={sp.next} notice={sp.error ? NOTICES[sp.error] : sp.notice ? NOTICES[sp.notice] : undefined} />;
}
