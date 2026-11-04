import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "Templates" };

export default async function Page() {
  await requireScreen("templates");
  return <ComingInStep title="Templates" step={5} stepName="Email" description="Email and WhatsApp templates in English and Urdu." />;
}
