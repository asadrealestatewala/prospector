import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "Live Progress" };

export default async function Page() {
  await requireScreen("live-progress");
  return <ComingInStep title="Live Progress" step={2} stepName="Lead engine" description="Running searches, crawls and results as they arrive." />;
}
