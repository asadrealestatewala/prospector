import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireScreen } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { LeadDetail, type TimelineItem } from "./lead-detail";

export const metadata: Metadata = { title: "Lead Detail" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireScreen("lead-detail");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("*, owner:users!leads_owner_id_fkey(id, full_name), source:searches!leads_source_search_id_fkey(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!lead) notFound();

  const [contacts, social, crawls, notes, events, changes, messages, owners, dnc] = await Promise.all([
    supabase.from("lead_contacts").select("id, kind, value, value_normalized, label, source, source_url, verification, verification_detail, verify_requested_at, consent_state, is_primary, created_at").eq("lead_id", id).order("kind").order("is_primary", { ascending: false }).order("created_at"),
    supabase.from("lead_social_links").select("id, platform, url").eq("lead_id", id).order("platform"),
    supabase.from("crawl_jobs").select("id, url, status, pages_visited, pages, error_reason, finished_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(5),
    supabase.from("lead_notes").select("id, kind, body, created_at, author:users!lead_notes_author_id_fkey(full_name)").eq("lead_id", id).order("created_at", { ascending: false }).limit(200),
    supabase.from("pipeline_events").select("id, from_status, to_status, reason, caused_by_system, created_at, user:users!pipeline_events_caused_by_user_fkey(full_name)").eq("lead_id", id).order("created_at", { ascending: false }).limit(200),
    supabase.from("lead_field_changes").select("id, field, old_value, new_value, changed_at, user:users!lead_field_changes_changed_by_fkey(full_name)").eq("lead_id", id).order("changed_at", { ascending: false }).limit(200),
    supabase.from("messages").select("id, channel, direction, subject, body, status, created_at").eq("lead_id", id).eq("is_internal_note", false).order("created_at", { ascending: false }).limit(200),
    supabase.from("users").select("id, full_name").eq("status", "active").order("full_name"),
    supabase.from("do_not_contact").select("channel, value_normalized").eq("lead_id", id).is("removed_at", null),
  ]);

  const canEmail = ["admin", "manager", "sales_agent"].includes(user.role);
  const [templates, senders] = canEmail
    ? await Promise.all([
        supabase.from("templates").select("id, name, subject, body, language").eq("channel", "email").eq("product", lead.product).is("archived_at", null).order("name"),
        // Sales agents cannot read email_senders under RLS; only the display fields are passed on.
        createSupabaseAdminClient().from("email_senders").select("id, from_name, from_email").eq("is_active", true).order("created_at"),
      ])
    : [{ data: [] }, { data: [] }];

  const name = (u: unknown) => (u as { full_name: string } | null)?.full_name ?? null;
  const timeline: TimelineItem[] = [
    ...(notes.data ?? []).map((n) => ({ id: `n-${n.id}`, at: n.created_at, kind: n.kind === "call" ? ("call" as const) : ("note" as const), title: n.kind === "call" ? "Call logged" : "Note", body: n.body, by: name(n.author) })),
    ...(events.data ?? []).map((e) => ({ id: `e-${e.id}`, at: e.created_at, kind: "status" as const, title: `Status ${e.from_status ? `${e.from_status} → ` : ""}${e.to_status}`, body: e.reason, by: name(e.user) ?? e.caused_by_system ?? null, from: e.from_status, to: e.to_status })),
    ...(changes.data ?? []).map((c) => ({ id: `c-${c.id}`, at: c.changed_at, kind: "edit" as const, title: `Changed ${c.field.replace("_", " ")}`, body: `${c.old_value ?? "empty"} → ${c.new_value ?? "removed"}`, by: name(c.user) })),
    ...(messages.data ?? []).map((m) => ({ id: `m-${m.id}`, at: m.created_at, kind: m.channel === "email" ? ("email" as const) : ("whatsapp" as const), title: `${m.channel === "email" ? "Email" : "WhatsApp"} ${m.direction === "inbound" ? "received" : m.status}`, body: m.subject ?? m.body, by: null })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const blocked = new Set((dnc.data ?? []).map((d) => `${d.channel}|${d.value_normalized}`));

  return (
    <LeadDetail
      lead={lead}
      contacts={(contacts.data ?? []).map((c) => ({ ...c, blocked: blocked.has(`${c.kind}|${c.value_normalized}`) || (c.kind !== "email" && (blocked.has(`phone|${c.value_normalized}`) || blocked.has(`whatsapp|${c.value_normalized}`))) }))}
      social={social.data ?? []}
      crawls={crawls.data ?? []}
      timeline={timeline}
      owners={owners.data ?? []}
      canSeeLeads={canAccess(user.role, "leads")}
      canVerify={["admin", "lead_expert"].includes(user.role)}
      canSeeConsent={canAccess(user.role, "consent-log")}
      canEmail={canEmail}
      emailTemplates={templates.data ?? []}
      senders={senders.data ?? []}
    />
  );
}
