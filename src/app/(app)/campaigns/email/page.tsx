import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "Email Campaigns" };

export default async function Page() {
  await requireScreen("email-campaigns");
  return <ComingInStep title="Email Campaigns" step={5} stepName="Email" description="Email campaigns with limits, safeguards and live counters." />;
}
