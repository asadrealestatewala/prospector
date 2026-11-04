"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban, CalendarClock, Clock, Download, ExternalLink, Globe, Mail, MailCheck, MapPin, MessageCircle, NotebookPen, Pencil, Phone, Plus, Star, Tag, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ProductChip, StatusChip, WhatsAppChip, type Product } from "@/components/ui/chips";
import { ConfirmDialog, Dialog, DialogContent, SidePanel } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { CONSENT_LABEL, LEAD_STATUS, LEAD_STATUSES, type LeadStatus } from "@/lib/engine/labels";
import { cn, formatPkDateTime } from "@/lib/utils";
import { addLeadsToDnc, addTags, assignOwner, changeStatus, removeTag, verifyLeadEmails } from "../actions";
import { SendEmailDialog, type TemplateOption } from "./send-email-dialog";
import { addContact, addNote, makePrimary, removeContact, updateLeadInfo, updatePlan } from "./actions";

type Lead = {
  id: string;
  name: string;
  product: Product;
  business_type: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  website: string | null;
  google_place_id: string | null;
  google_maps_url: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  opening_hours: string[] | null;
  description: string | null;
  crawl_hints: Record<string, unknown>;
  score: number;
  status: LeadStatus;
  owner_id: string | null;
  tags: string[];
  next_follow_up_at: string | null;
  last_contacted_at: string | null;
  demo_at: string | null;
  trial_ends_at: string | null;
  demo_notes: string | null;
  created_at: string;
  owner: { id: string; full_name: string } | null;
  source: { id: string; name: string } | null;
};
type ContactRow = { id: string; kind: "email" | "phone" | "whatsapp"; value: string; label: string | null; source: string; source_url: string | null; verification: string; verification_detail: string | null; verify_requested_at: string | null; consent_state: string; is_primary: boolean; blocked: boolean };
type Social = { id: string; platform: string; url: string };
type Crawl = { id: string; url: string; status: string; pages_visited: number; pages: unknown; error_reason: string | null; finished_at: string | null };
export type TimelineItem = { id: string; at: string; kind: "note" | "call" | "status" | "edit" | "email" | "whatsapp"; title: string; body: string | null; by: string | null; from?: string | null; to?: string };

type Result = { ok: boolean; message?: string; error?: string };

/** Pakistan-time value for a datetime-local input. */
function toPkInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export function LeadDetail({
  lead,
  contacts,
  social,
  crawls,
  timeline,
  owners,
  canSeeLeads,
  canVerify,
  canSeeConsent,
  canEmail,
  emailTemplates,
  senders,
}: {
  lead: Lead;
  contacts: ContactRow[];
  social: Social[];
  crawls: Crawl[];
  timeline: TimelineItem[];
  owners: { id: string; full_name: string }[];
  canSeeLeads: boolean;
  canVerify: boolean;
  canSeeConsent: boolean;
  canEmail: boolean;
  emailTemplates: TemplateOption[];
  senders: { id: string; from_name: string; from_email: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [noteOpen, setNoteOpen] = React.useState<null | "note" | "call">(null);
  const [contactOpen, setContactOpen] = React.useState(false);
  const [dncOpen, setDncOpen] = React.useState(false);
  const [lostOpen, setLostOpen] = React.useState(false);
  const [tagDraft, setTagDraft] = React.useState("");
  const [emailOpen, setEmailOpen] = React.useState(false);

  async function run(label: string, fn: () => Promise<Result>, after?: () => void) {
    setBusy(label);
    const r = await fn();
    setBusy(null);
    if (r.ok) {
      toast.success(r.message ?? "Saved.");
      after?.();
      router.refresh();
    } else toast.error(r.error ?? "Something went wrong.");
  }

  const emails = contacts.filter((c) => c.kind === "email");
  const phones = contacts.filter((c) => c.kind === "phone");
  const whatsapps = contacts.filter((c) => c.kind === "whatsapp");
  const allBlocked = contacts.length > 0 && contacts.every((c) => c.blocked);
  const consent = (kind: "email" | "whatsapp") => {
    const list = contacts.filter((c) => c.kind === kind);
    if (!list.length) return "No contact";
    if (list.some((c) => c.blocked || c.consent_state === "opted_out")) return "Opted out";
    if (list.some((c) => c.consent_state === "opted_in")) return "Opted in";
    return "Unknown";
  };
  const mapHref = lead.google_maps_url ?? (lead.latitude && lead.longitude ? `https://www.google.com/maps/search/?api=1&query=${lead.latitude},${lead.longitude}` : lead.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}` : null);
  const callNumber = phones[0]?.value ?? lead.phone;
  const lastCrawl = crawls[0];
  const pages = Array.isArray(lastCrawl?.pages) ? (lastCrawl.pages as { url?: string; title?: string }[]) : [];
  const hints = Object.entries(lead.crawl_hints ?? {});

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        {canSeeLeads ? (
          <p className="mb-1 text-helper text-fg-muted">
            <Link href="/leads" className="hover:underline">Leads</Link>
          </p>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-title font-semibold text-fg">{lead.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ProductChip product={lead.product} />
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-brand-100 px-3 text-helper font-semibold text-brand-700" title="Lead score">
                <Star className="size-3" aria-hidden /> Score {lead.score}
              </span>
              <label className="sr-only" htmlFor="status">Status</label>
              <Select
                id="status"
                className="h-8 w-auto"
                value={lead.status}
                disabled={busy === "status"}
                onChange={(e) => {
                  const to = e.target.value as LeadStatus;
                  if (to === "lost") setLostOpen(true);
                  else void run("status", () => changeStatus([lead.id], to));
                }}
              >
                {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS[s].label}</option>)}
              </Select>
              <label className="sr-only" htmlFor="owner">Owner</label>
              <Select id="owner" className="h-8 w-auto" value={lead.owner_id ?? ""} disabled={busy === "owner"} onChange={(e) => run("owner", () => assignOwner([lead.id], e.target.value || null))}>
                <option value="">No owner</option>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEmail ? (
              <Button disabled={emails.length === 0} title={emails.length === 0 ? "No email address" : undefined} onClick={() => setEmailOpen(true)}><Mail /> Send email</Button>
            ) : null}
            <Button variant="whatsapp" disabled title="WhatsApp sending arrives in step 6"><MessageCircle /> Send WhatsApp</Button>
            {callNumber ? (
              <Button asChild onClick={() => setNoteOpen("call")}>
                <a href={`tel:${callNumber.replace(/[^\d+]/g, "")}`}><Phone /> Call</a>
              </Button>
            ) : (
              <Button disabled title="No phone number"><Phone /> Call</Button>
            )}
            <Button variant="primary" onClick={() => setNoteOpen("note")}><NotebookPen /> Add note</Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        {/* Left: business info and crawled data */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Business info" action={<Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>} />
            <CardBody className="flex flex-col gap-3 text-body">
              <InfoRow icon={MapPin} label="Address">
                {lead.address ?? [lead.area, lead.city].filter(Boolean).join(", ") ?? "Not known"}
                {mapHref ? (
                  <a href={mapHref} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-1 text-brand-600 hover:underline">Map <ExternalLink className="size-3" /></a>
                ) : null}
              </InfoRow>
              <InfoRow icon={Globe} label="Website">
                {lead.website ? <a href={lead.website} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-600 hover:underline">{lead.website}</a> : "None"}
              </InfoRow>
              <InfoRow icon={Star} label="Google rating">
                {lead.google_rating ? `${Number(lead.google_rating).toFixed(1)} from ${lead.google_review_count ?? 0} reviews` : "No rating"}
              </InfoRow>
              {lead.opening_hours?.length ? (
                <InfoRow icon={Clock} label="Opening hours">
                  <ul className="text-helper text-fg-muted">{lead.opening_hours.map((h) => <li key={h}>{h}</li>)}</ul>
                </InfoRow>
              ) : null}
              <ContactGroup title="Phone numbers" items={phones} leadId={lead.id} run={run} />
              <ContactGroup title="Emails" items={emails} leadId={lead.id} run={run} showVerification />
              {canVerify && emails.length ? (
                <div className="flex flex-wrap gap-2">
                  {emails.some((e) => e.verification === "unverified" && !e.verify_requested_at) ? (
                    <Button size="sm" loading={busy === "verify"} onClick={() => run("verify", () => verifyLeadEmails([lead.id]))}><MailCheck /> Verify emails</Button>
                  ) : !emails.some((e) => e.verify_requested_at) ? (
                    <Button size="sm" variant="ghost" loading={busy === "verify"} onClick={() => run("verify", () => verifyLeadEmails([lead.id], true))}><MailCheck /> Check again</Button>
                  ) : null}
                </div>
              ) : null}
              <ContactGroup title="WhatsApp" items={whatsapps} leadId={lead.id} run={run} />
              <Button size="sm" className="self-start" onClick={() => setContactOpen(true)}><Plus /> Add contact</Button>
              {social.length ? (
                <div>
                  <p className="mb-1 text-helper font-semibold text-fg-muted">Social links</p>
                  <ul className="flex flex-col gap-1">
                    {social.map((s) => (
                      <li key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-600 hover:underline">{s.platform}</a></li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-helper text-fg-muted">
                Added {formatPkDateTime(lead.created_at)}
                {lead.source ? <> by search <Link className="text-brand-600 hover:underline" href={`/searches/${lead.source.id}`}>{lead.source.name}</Link></> : null}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Crawled data" description={lastCrawl ? `Website ${lastCrawl.status === "done" ? `crawled ${formatPkDateTime(lastCrawl.finished_at)}` : lastCrawl.status.replaceAll("_", " ")}` : "Not crawled yet"} />
            <CardBody className="flex flex-col gap-3 text-body">
              {lead.description ? <p className="text-fg">{lead.description}</p> : null}
              {pages.length ? (
                <div>
                  <p className="mb-1 text-helper font-semibold text-fg-muted">Pages visited ({lastCrawl.pages_visited})</p>
                  <ul className="flex flex-col gap-0.5 text-helper">{pages.slice(0, 10).map((p, i) => <li key={i} className="truncate">{p.title || p.url}</li>)}</ul>
                </div>
              ) : null}
              {hints.length ? (
                <div>
                  <p className="mb-1 text-helper font-semibold text-fg-muted">Hints</p>
                  <ul className="flex flex-col gap-0.5 text-helper">{hints.map(([k, v]) => <li key={k}><span className="font-medium">{k.replaceAll("_", " ")}:</span> {Array.isArray(v) ? v.join(", ") : String(v)}</li>)}</ul>
                </div>
              ) : null}
              {lastCrawl?.error_reason ? (
                <p className={cn("text-helper", lastCrawl.status === "done" || lastCrawl.status === "blocked_by_robots" ? "text-fg-muted" : "text-error")}>{lastCrawl.error_reason}</p>
              ) : null}
              {!lead.description && !pages.length && !hints.length && !lastCrawl?.error_reason ? (
                <p className="text-fg-muted">
                  {!lead.website
                    ? "This business has no website."
                    : !lastCrawl
                      ? "The website was not crawled. Turn on automatic crawling in the search options to crawl new leads."
                      : lastCrawl.status === "done"
                        ? "The website was crawled, but it had no description or hints."
                        : "The website is waiting to be crawled."}
                </p>
              ) : null}
            </CardBody>
          </Card>
        </div>

        {/* Centre: timeline */}
        <Card className="min-w-0">
          <CardHeader title="Timeline" description="Messages, notes, calls, status changes and edits, newest first" />
          {timeline.length === 0 ? (
            <CardBody><p className="text-body text-fg-muted">Nothing has happened with this lead yet.</p></CardBody>
          ) : (
            <ol className="divide-y divide-border">
              {timeline.map((t) => (
                <li key={t.id} className="flex gap-3 px-4 py-3">
                  <TimelineIcon kind={t.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium text-fg">
                      {t.kind === "status" && t.to ? <>Status changed to <StatusChip tone={LEAD_STATUS[t.to as LeadStatus]?.tone ?? "neutral"} className="ml-1">{LEAD_STATUS[t.to as LeadStatus]?.label ?? t.to}</StatusChip></> : t.title}
                    </p>
                    {t.body ? <p className={cn("mt-0.5 whitespace-pre-wrap break-words text-body", t.kind === "edit" ? "text-helper text-fg-muted" : "text-fg")}>{t.body}</p> : null}
                    <p className="mt-0.5 text-helper text-fg-muted">{formatPkDateTime(t.at)}{t.by ? ` · ${t.by}` : ""}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* Right: tags, consent, follow-up, demo, do-not-contact */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Tags" />
            <CardBody className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {lead.tags.length === 0 ? <span className="text-body text-fg-muted">No tags.</span> : null}
                {lead.tags.map((t) => (
                  <span key={t} className="inline-flex h-6 items-center gap-1 rounded-full bg-brand-100 pl-3 pr-1 text-helper text-brand-700">
                    {t}
                    <button type="button" aria-label={`Remove tag ${t}`} className="grid size-4 place-items-center rounded-full hover:bg-brand-50" onClick={() => run("tag", () => removeTag(lead.id, t))}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (tagDraft.trim()) void run("tag", () => addTags([lead.id], [tagDraft.trim()]), () => setTagDraft(""));
                }}
              >
                <Input aria-label="New tag" placeholder="Add a tag" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} maxLength={40} className="h-8" />
                <Button size="sm" type="submit" disabled={!tagDraft.trim()} aria-label="Add tag"><Tag /></Button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Consent"
              action={canSeeConsent ? (
                <Button size="sm" variant="ghost" asChild>
                  <a href={`/consent-log/export?lead=${lead.id}`}><Download /> Export</a>
                </Button>
              ) : undefined}
            />
            <CardBody className="flex flex-col gap-2 text-body">
              <div className="flex items-center justify-between"><span className="inline-flex items-center gap-2"><Mail className="size-4" /> Email</span><ConsentChip state={consent("email")} /></div>
              <div className="flex items-center justify-between"><span className="inline-flex items-center gap-2"><MessageCircle className="size-4" /> WhatsApp</span><ConsentChip state={consent("whatsapp")} /></div>
            </CardBody>
          </Card>

          <PlanCard lead={lead} busy={busy === "plan"} onSave={(v) => run("plan", () => updatePlan(lead.id, v))} />

          <Card>
            <CardBody className="flex flex-col gap-2">
              {allBlocked ? (
                <p className="flex items-center gap-2 text-body text-error"><Ban className="size-4" /> Every contact is on do-not-contact.</p>
              ) : (
                <Button variant="destructive" onClick={() => setDncOpen(true)} disabled={contacts.length === 0 && !lead.phone}>
                  <Ban /> Mark as do-not-contact
                </Button>
              )}
              <p className="text-helper text-fg-muted">Blocks every email, phone and WhatsApp number of this lead. Only an Admin can undo it.</p>
            </CardBody>
          </Card>
        </div>
      </div>

      <EditInfoPanel open={editOpen} onOpenChange={setEditOpen} lead={lead} busy={busy === "info"} onSave={(v) => run("info", () => updateLeadInfo(lead.id, v), () => setEditOpen(false))} />
      <NoteDialog kind={noteOpen} onClose={() => setNoteOpen(null)} busy={busy === "note"} onSave={(body, kind) => run("note", () => addNote(lead.id, body, kind), () => setNoteOpen(null))} />
      <ContactDialog open={contactOpen} onOpenChange={setContactOpen} busy={busy === "contact"} onSave={(kind, value, label) => run("contact", () => addContact(lead.id, { kind, value } as never, label), () => setContactOpen(false))} />
      <ConfirmDialog
        open={dncOpen}
        onOpenChange={setDncOpen}
        title={`Mark ${lead.name} as do-not-contact?`}
        description="No email or WhatsApp message will be sent to any of its contacts. Only an Admin can remove them from the list."
        confirmLabel="Mark as do-not-contact"
        destructive
        loading={busy === "dnc"}
        onConfirm={() => run("dnc", () => addLeadsToDnc([lead.id]), () => setDncOpen(false))}
      />
      <LostDialog open={lostOpen} onOpenChange={setLostOpen} busy={busy === "status"} onSave={(reason) => run("status", () => changeStatus([lead.id], "lost", reason), () => setLostOpen(false))} />
      {canEmail && emailOpen ? (
        <SendEmailDialog
          open={emailOpen}
          onOpenChange={setEmailOpen}
          leadId={lead.id}
          emails={emails.map((c) => ({ value: c.value, verification: c.verification, blocked: c.blocked, optedOut: c.consent_state === "opted_out" }))}
          templates={emailTemplates}
          senders={senders}
        />
      ) : null}
    </>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
      <div className="min-w-0">
        <p className="text-helper text-fg-muted">{label}</p>
        <div className="break-words text-fg">{children}</div>
      </div>
    </div>
  );
}

function ContactGroup({ title, items, leadId, run, showVerification }: { title: string; items: ContactRow[]; leadId: string; run: (l: string, fn: () => Promise<Result>) => Promise<void>; showVerification?: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1 text-helper font-semibold text-fg-muted">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((c) => (
          <li key={c.id} className="group flex flex-wrap items-center gap-2">
            <span className={cn("tabular break-all", c.blocked && "text-fg-muted line-through")}>{c.value}</span>
            {c.kind === "whatsapp" ? <WhatsAppChip /> : null}
            {showVerification ? (
              c.verify_requested_at ? (
                <StatusChip tone="info">Checking</StatusChip>
              ) : (
                <span title={c.verification_detail ?? undefined}>
                  <StatusChip tone={c.verification === "valid" ? "success" : c.verification === "risky" ? "warning" : c.verification === "invalid" ? "error" : "neutral"}>
                    {c.verification === "valid" ? "Verified" : c.verification === "risky" ? "Risky" : c.verification === "invalid" ? "Invalid" : "Not checked"}
                  </StatusChip>
                </span>
              )
            ) : null}
            {c.blocked ? <StatusChip tone="error">Do not contact</StatusChip> : null}
            {c.is_primary && items.length > 1 ? <span className="text-helper text-fg-muted">Main</span> : null}
            <span className="ml-auto flex gap-1 opacity-70 group-hover:opacity-100">
              {!c.is_primary && items.length > 1 ? (
                <button type="button" className="text-helper text-brand-600 hover:underline" onClick={() => run("contact", () => makePrimary(leadId, c.id))}>Make main</button>
              ) : null}
              <button type="button" aria-label={`Remove ${c.value}`} className="grid size-6 place-items-center rounded-control text-fg-muted hover:bg-neutral-soft" onClick={() => run("contact", () => removeContact(leadId, c.id))}>
                <Trash2 className="size-3.5" />
              </button>
            </span>
            {showVerification && c.verification_detail && !c.verify_requested_at ? <p className="w-full text-helper text-fg-muted">{c.verification_detail}</p> : null}
            {c.source_url ? <p className="w-full truncate text-helper text-fg-muted">Found on {c.source_url}</p> : c.source === "google_listing" ? <p className="w-full text-helper text-fg-muted">From the Google listing</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConsentChip({ state }: { state: string }) {
  const tone = state === "Opted in" ? "success" : state === "Opted out" ? "error" : "neutral";
  return <StatusChip tone={tone}>{state === "Unknown" ? CONSENT_LABEL.unknown : state}</StatusChip>;
}

function TimelineIcon({ kind }: { kind: TimelineItem["kind"] }) {
  const Icon = { note: NotebookPen, call: Phone, status: CalendarClock, edit: Pencil, email: Mail, whatsapp: MessageCircle }[kind];
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", kind === "whatsapp" ? "bg-[#dcf8e7] text-[#0b5c2e]" : "bg-neutral-soft text-fg-muted")}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

function PlanCard({ lead, busy, onSave }: { lead: Lead; busy: boolean; onSave: (v: { next_follow_up_at: string; demo_at: string; trial_ends_at: string; demo_notes: string }) => void }) {
  const [v, setV] = React.useState({
    next_follow_up_at: toPkInput(lead.next_follow_up_at),
    demo_at: toPkInput(lead.demo_at),
    trial_ends_at: toPkInput(lead.trial_ends_at).slice(0, 10),
    demo_notes: lead.demo_notes ?? "",
  });
  return (
    <Card>
      <CardHeader title="Follow-up and demo" description="Pakistan time" />
      <CardBody className="flex flex-col gap-3">
        <Field label="Next follow-up" htmlFor="fu"><Input id="fu" type="datetime-local" value={v.next_follow_up_at} onChange={(e) => setV({ ...v, next_follow_up_at: e.target.value })} /></Field>
        <Field label="Demo" htmlFor="demo"><Input id="demo" type="datetime-local" value={v.demo_at} onChange={(e) => setV({ ...v, demo_at: e.target.value })} /></Field>
        <Field label="Trial ends" htmlFor="trial"><Input id="trial" type="date" value={v.trial_ends_at} onChange={(e) => setV({ ...v, trial_ends_at: e.target.value })} /></Field>
        <Field label="Demo or trial notes" htmlFor="dn"><Textarea id="dn" value={v.demo_notes} onChange={(e) => setV({ ...v, demo_notes: e.target.value })} maxLength={2000} /></Field>
        <Button size="sm" variant="primary" className="self-start" loading={busy} onClick={() => onSave(v)}>Save details</Button>
      </CardBody>
    </Card>
  );
}

function EditInfoPanel({ open, onOpenChange, lead, busy, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; lead: Lead; busy: boolean; onSave: (v: { name: string; phone: string; website: string; address: string; city: string; area: string; business_type: string }) => void }) {
  const initial = { name: lead.name, phone: lead.phone ?? "", website: lead.website ?? "", address: lead.address ?? "", city: lead.city ?? "", area: lead.area ?? "", business_type: lead.business_type ?? "" };
  const [v, setV] = React.useState(initial);
  return (
    <SidePanel
      open={open}
      onOpenChange={(o) => {
        if (o) setV(initial);
        onOpenChange(o);
      }}
      title="Edit business details"
      description="Every change is recorded with your name and the time."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => onSave(v)} disabled={!v.name.trim()}>Save changes</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Business name" htmlFor="e-name"><Input id="e-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={200} /></Field>
        <Field label="Main phone" htmlFor="e-phone"><Input id="e-phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} maxLength={40} inputMode="tel" /></Field>
        <Field label="Website" htmlFor="e-web"><Input id="e-web" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} maxLength={300} inputMode="url" /></Field>
        <Field label="Address" htmlFor="e-addr"><Textarea id="e-addr" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} maxLength={300} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" htmlFor="e-city"><Input id="e-city" value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} maxLength={80} /></Field>
          <Field label="Area" htmlFor="e-area"><Input id="e-area" value={v.area} onChange={(e) => setV({ ...v, area: e.target.value })} maxLength={80} /></Field>
        </div>
        <Field label="Business type" htmlFor="e-type"><Input id="e-type" value={v.business_type} onChange={(e) => setV({ ...v, business_type: e.target.value })} maxLength={80} /></Field>
      </div>
    </SidePanel>
  );
}

function NoteDialog({ kind, onClose, busy, onSave }: { kind: null | "note" | "call"; onClose: () => void; busy: boolean; onSave: (body: string, kind: "note" | "call") => void }) {
  const [body, setBody] = React.useState("");
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => { if (!o) { onClose(); setBody(""); } }}>
      <DialogContent
        title={kind === "call" ? "Log this call" : "Add a note"}
        description={kind === "call" ? "Write what was said. The call is added to the timeline." : undefined}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!body.trim()} onClick={() => { onSave(body, kind ?? "note"); setBody(""); }}>
              {kind === "call" ? "Log call" : "Add note"}
            </Button>
          </>
        }
      >
        <Field label={kind === "call" ? "Call notes" : "Note"} htmlFor="note-body">
          <Textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={5} autoFocus />
        </Field>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({ open, onOpenChange, busy, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; onSave: (kind: "email" | "phone" | "whatsapp", value: string, label: string) => void }) {
  const [kind, setKind] = React.useState<"email" | "phone" | "whatsapp">("email");
  const [value, setValue] = React.useState("");
  const [label, setLabel] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add a contact"
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!value.trim()} onClick={() => onSave(kind, value, label)}>Add contact</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Type" htmlFor="c-kind">
            <Select id="c-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="whatsapp">WhatsApp</option>
            </Select>
          </Field>
          <Field label={kind === "email" ? "Email address" : "Number"} htmlFor="c-val">
            <Input id="c-val" value={value} onChange={(e) => setValue(e.target.value)} inputMode={kind === "email" ? "email" : "tel"} maxLength={200} />
          </Field>
          <Field label="Label (optional)" htmlFor="c-label" hint="For example: Principal, Admissions, Owner."><Input id="c-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LostDialog({ open, onOpenChange, busy, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; onSave: (reason: string) => void }) {
  const [reason, setReason] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Mark this lead as lost"
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => onSave(reason)}>Mark as lost</Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="lost-r" hint="For example: price, already has software, not interested.">
          <Input id="lost-r" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </Field>
      </DialogContent>
    </Dialog>
  );
}
