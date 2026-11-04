import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "Do-Not-Contact" };

export default async function Page() {
  await requireScreen("do-not-contact");
  return <ComingInStep title="Do-Not-Contact" step={4} stepName="Compliance base" description="Contacts who must never be messaged." />;
}
