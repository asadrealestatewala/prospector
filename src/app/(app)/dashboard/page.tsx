import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Page() {
  await requireScreen("dashboard");
  return <ComingInStep title="Dashboard" step={9} stepName="Operations" description="Leads, sending, replies and spend at a glance." />;
}
