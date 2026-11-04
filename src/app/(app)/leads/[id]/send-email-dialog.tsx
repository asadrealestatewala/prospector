"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { sendLeadEmail } from "./email-actions";

export type EmailOption = { value: string; verification: string; blocked: boolean; optedOut: boolean };
export type TemplateOption = { id: string; name: string; subject: string | null; body: string; language: "en" | "ur" };

/** Lead Detail quick action: one email from a template or written here. Variables are filled when it is sent. */
export function SendEmailDialog({
  open, onOpenChange, leadId, emails, templates, senders,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leadId: string;
  emails: EmailOption[];
  templates: TemplateOption[];
  senders: { id: string; from_name: string; from_email: string }[];
}) {
  const router = useRouter();
  const usable = emails.filter((e) => !e.blocked && !e.optedOut && e.verification !== "invalid");
  const [to, setTo] = React.useState(usable.find((e) => e.verification === "valid")?.value ?? usable[0]?.value ?? "");
  const [senderId, setSenderId] = React.useState(senders[0]?.id ?? "");
  const [templateId, setTemplateId] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("<p></p>");
  const [language, setLanguage] = React.useState<"en" | "ur">("en");
  const [editorKey, setEditorKey] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const chosen = emails.find((e) => e.value === to);

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(t.subject ?? "");
    setBody(t.body);
    setLanguage(t.language);
    setEditorKey((k) => k + 1);
  }

  async function send() {
    setBusy(true);
    const r = await sendLeadEmail({ leadId, to, senderId, subject, body, language, templateId: templateId || null });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Send email"
        description="Checked against do-not-contact and the Resend cap before it goes. The unsubscribe footer is added."
        className="max-w-2xl"
        footer={
          <>
            <DialogClose asChild><Button>Cancel</Button></DialogClose>
            <Button variant="primary" loading={busy} disabled={!to || !senderId || !subject.trim()} onClick={send}><Send /> Send email</Button>
          </>
        }
      >
        {usable.length === 0 ? (
          <p className="text-body text-fg-muted">This lead has no email that can be used. Addresses that are invalid, opted out or on the do-not-contact list are not offered.</p>
        ) : senders.length === 0 ? (
          <p className="text-body text-fg-muted">No sender address yet. An Admin adds one in Settings, Sender identities.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="To" htmlFor="se-to" hint={chosen && chosen.verification !== "valid" ? "This address is not verified, so it may bounce." : undefined}>
                <Select id="se-to" value={to} onChange={(e) => setTo(e.target.value)}>
                  {usable.map((e) => <option key={e.value} value={e.value}>{e.value}{e.verification === "valid" ? "" : ` (${e.verification})`}</option>)}
                </Select>
              </Field>
              <Field label="From" htmlFor="se-from">
                <Select id="se-from" value={senderId} onChange={(e) => setSenderId(e.target.value)}>
                  {senders.map((s) => <option key={s.id} value={s.id}>{s.from_name} &lt;{s.from_email}&gt;</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Template (optional)" htmlFor="se-tpl">
              <Select id="se-tpl" value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
                <option value="">Write my own</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Subject" htmlFor="se-subject">
              <Input id="se-subject" dir={language === "ur" ? "rtl" : "ltr"} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <div className="flex flex-col gap-1">
              <label htmlFor="se-body" className="text-helper font-medium text-fg">Message</label>
              <RichTextEditor key={editorKey} id="se-body" value={body} dir={language === "ur" ? "rtl" : "ltr"} onChange={setBody} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
