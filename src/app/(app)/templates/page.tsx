import type { Metadata } from "next";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TemplatesScreen, type TemplateRow } from "./templates-screen";

export const metadata: Metadata = { title: "Templates" };

export default async function Page({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  await requireScreen("templates");
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from("templates")
    .select("id, name, product, language, subject, is_starter, parent_template_id, archived_at, updated_at")
    .eq("channel", "email");
  q = showArchived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(500);
  return <TemplatesScreen rows={(data ?? []) as TemplateRow[]} showArchived={showArchived} loadError={error ? "Could not load templates. Try again." : null} />;
}
