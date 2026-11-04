import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "Leads" };

export default async function Page() {
  await requireScreen("leads");
  return <ComingInStep title="Leads" step={2} stepName="Lead engine" description="Every business found, with contacts, score and status." />;
}
