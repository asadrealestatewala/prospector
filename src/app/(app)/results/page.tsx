import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "Results" };

export default async function Page() {
  await requireScreen("results");
  return <ComingInStep title="Results" step={8} stepName="Growth" description="Funnel, performance and cost per customer." />;
}
