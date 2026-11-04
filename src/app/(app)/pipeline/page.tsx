import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "Pipeline" };

export default async function Page() {
  await requireScreen("pipeline");
  return <ComingInStep title="Pipeline" step={8} stepName="Growth" description="Leads from New to Won." />;
}
