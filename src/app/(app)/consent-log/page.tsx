import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "Consent Log" };

export default async function Page() {
  await requireScreen("consent-log");
  return <ComingInStep title="Consent Log" step={4} stepName="Compliance base" description="Where each contact came from and their opt-in history." />;
}
