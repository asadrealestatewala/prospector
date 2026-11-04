import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "WhatsApp Campaigns" };

export default async function Page() {
  await requireScreen("whatsapp-campaigns");
  return <ComingInStep title="WhatsApp Campaigns" step={6} stepName="WhatsApp" description="Approved-template WhatsApp campaigns." />;
}
