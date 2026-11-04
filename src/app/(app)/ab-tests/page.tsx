import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "A/B Tests" };

export default async function Page() {
  await requireScreen("ab-tests");
  return <ComingInStep title="A/B Tests" step={8} stepName="Growth" description="Test two versions and send the winner." />;
}
