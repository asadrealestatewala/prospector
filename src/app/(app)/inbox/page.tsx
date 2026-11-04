import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "Inbox" };

export default async function Page() {
  await requireScreen("inbox");
  return <ComingInStep title="Inbox" step={7} stepName="Inbox" description="Replies across WhatsApp and email." />;
}
