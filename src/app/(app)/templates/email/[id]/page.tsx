import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TemplateEditor, type EditableTemplate } from "./template-editor";

export const metadata: Metadata = { title: "Email template" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ product?: string }> }) {
  await requireScreen("templates");
  const { id } = await params;
  const { product } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: senders } = await supabase.from("email_senders").select("id, from_name, from_email").eq("is_active", true).order("from_email");

  let template: EditableTemplate | null = null;
  if (id !== "new") {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const { data } = await supabase
      .from("templates")
      .select("id, name, product, language, subject, body, is_starter, parent_template_id, archived_at")
      .eq("id", id)
      .eq("channel", "email")
      .maybeSingle();
    if (!data) notFound();
    template = data as EditableTemplate;
  }
  const initialProduct = product === "vetlin" || product === "postwala" ? product : "classwell";
  return <TemplateEditor template={template} initialProduct={initialProduct} senders={senders ?? []} />;
}
