import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "System Health" };

export default async function Page() {
  await requireScreen("system-health");
  return <ComingInStep title="System Health" step={9} stepName="Operations" description="Workers, queues, webhooks and server status." />;
}
