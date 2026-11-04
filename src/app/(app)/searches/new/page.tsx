import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { ComingInStep } from "@/components/app/coming-in-step";

export const metadata: Metadata = { title: "New Search" };

export default async function Page() {
  await requireScreen("new-search");
  return <ComingInStep title="New Search" step={2} stepName="Lead engine" description="Choose a product, business type and cities, then start a search." />;
}
