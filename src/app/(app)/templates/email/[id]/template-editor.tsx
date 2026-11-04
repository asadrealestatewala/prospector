"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowLeft, Copy, FlaskConical, Send } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip, type Product } from "@/components/ui/chips";
import { Field, Input, Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { TEMPLATE_VARIABLES } from "@/lib/email/variables";
import { copyEmailTemplate, previewEmailTemplate, saveEmailTemplate, sendTemplateTest, setTemplateArchived } from "../../actions";

export type EditableTemplate = {
  id: string;
  name: string;
  product: Product;
  language: "en" | "ur";
  subject: string | null;
  body: string;
  is_starter: boolean;
  parent_template_id: string | null;
  archived_at: string | null;
};

/** SRS screen 9: name, product, language, subject, rich body with variables, and a live preview. */
export function TemplateEditor({ template, initialProduct, senders }: { template: EditableTemplate | null; initialProduct: Product; senders: { id: string; from_name: string; from_email: string }[] }) {
  const router = useRouter();
  const [name, setName] = React.useState(template?.name ?? "");
  const [product, setProduct] = React.useState<Product>(template?.product ?? initialProduct);
  const [language, setLanguage] = React.useState<"en" | "ur">(template?.language ?? "en");
  const [subject, setSubject] = React.useState(template?.subject ?? "");
  const [body, setBody] = React.useState(template?.body ?? "<p></p>");
  const [errors, setErrors] = React.useState<{ name?: string; subject?: string; body?: string }>({});
  const [busy, setBusy] = React.useState<null | string>(null);
  const [preview, setPreview] = React.useState<{ subject: string; html: string; missing: string[] } | null>(null);
  const [senderId, setSenderId] = React.useState(senders[0]?.id ?? "");
  const [lastFocus, setLastFocus] = React.useState<"subject" | "body">("body");
  const insertRef = React.useRef<((text: string) => void) | null>(null);
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const dirty = React.useRef(false);

  // Live preview, rebuilt shortly after typing stops.
  React.useEffect(() => {
    const t = setTimeout(async () => {
      const r = await previewEmailTemplate({ subject, body, product, language });
      if (r.ok) setPreview({ subject: r.subject, html: r.html, missing: r.missing });
    }, 400);
    return () => clearTimeout(t);
  }, [subject, body, product, language]);

  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function insertVariable(key: string) {
    const token = `{{${key}}}`;
    if (lastFocus === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? subject.length;
      const end = el.selectionEnd ?? subject.length;
      setSubject(subject.slice(0, start) + token + subject.slice(end));
      dirty.current = true;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    } else {
      insertRef.current?.(token);
    }
  }

  async function save() {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = "Enter a name of at least 2 characters.";
    if (!subject.trim()) next.subject = "Enter a subject.";
    if (!body.replace(/<[^>]+>/g, "").trim()) next.body = "Write the email body.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy("save");
    const r = await saveEmailTemplate({ id: template?.id, name, product, language, subject, body });
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    dirty.current = false;
    toast.success(r.message);
    if (!template && r.id) router.replace(`/templates/email/${r.id}`);
    else router.refresh();
  }

  async function run(key: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string; id?: string }>, go?: (id: string) => void) {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return toast.error(r.error ?? "Something went wrong.");
    toast.success(r.message ?? "Done.");
    if (go && r.id) go(r.id);
    else router.refresh();
  }

  const rtl = language === "ur";
  return (
    <>
      <Link href="/templates" className="mb-3 inline-flex items-center gap-1 text-helper text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Templates
      </Link>
      <PageHeader
        title={template ? template.name : "New email template"}
        description={template?.is_starter ? "Starter template from the library. Changes apply to everyone." : "Variables are filled in for each lead when the email is sent."}
        actions={
          <>
            {template ? (
              <>
                <Button variant="ghost" loading={busy === "copy"} onClick={() => run("copy", () => copyEmailTemplate(template.id, false), (id) => router.push(`/templates/email/${id}`))}><Copy /> Duplicate</Button>
                <Button variant="ghost" loading={busy === "variant"} onClick={() => run("variant", () => copyEmailTemplate(template.id, true), (id) => router.push(`/templates/email/${id}`))}><FlaskConical /> Create A/B version</Button>
                <Button variant="ghost" loading={busy === "archive"} onClick={() => run("archive", () => setTemplateArchived(template.id, !template.archived_at))}>
                  {template.archived_at ? <><ArchiveRestore /> Restore</> : <><Archive /> Archive</>}
                </Button>
              </>
            ) : null}
            <Button variant="primary" loading={busy === "save"} onClick={save}>{template ? "Save template" : "Create template"}</Button>
          </>
        }
      />
      {template?.archived_at ? <p className="mb-4 rounded-control bg-warning-soft px-3 py-2 text-body text-warning">This template is archived and cannot be picked for new campaigns.</p> : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Content" />
          <CardBody className="flex flex-col gap-4">
            <Field label="Name" htmlFor="tpl-name" error={errors.name}>
              <Input id="tpl-name" value={name} maxLength={120} aria-invalid={!!errors.name} onChange={(e) => { setName(e.target.value); dirty.current = true; if (errors.name) setErrors({ ...errors, name: undefined }); }} onBlur={() => name.trim().length > 0 && name.trim().length < 2 && setErrors({ ...errors, name: "Enter a name of at least 2 characters." })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Product" htmlFor="tpl-product">
                <Select id="tpl-product" value={product} onChange={(e) => { setProduct(e.target.value as Product); dirty.current = true; }}>
                  <option value="classwell">Classwell</option>
                  <option value="vetlin">Vetlin</option>
                  <option value="postwala">Postwala</option>
                </Select>
              </Field>
              <Field label="Language" htmlFor="tpl-language" hint={rtl ? "Urdu is written right to left." : undefined}>
                <Select id="tpl-language" value={language} onChange={(e) => { setLanguage(e.target.value as "en" | "ur"); dirty.current = true; }}>
                  <option value="en">English</option>
                  <option value="ur">Urdu</option>
                </Select>
              </Field>
            </div>
            <Field label="Subject" htmlFor="tpl-subject" error={errors.subject}>
              <Input ref={subjectRef} id="tpl-subject" dir={rtl ? "rtl" : "ltr"} value={subject} maxLength={200} aria-invalid={!!errors.subject} onFocus={() => setLastFocus("subject")} onChange={(e) => { setSubject(e.target.value); dirty.current = true; if (errors.subject) setErrors({ ...errors, subject: undefined }); }} />
            </Field>
            <div className="flex flex-col gap-1">
              <span className="text-helper font-medium text-fg">Insert a variable</span>
              <div className="flex flex-wrap gap-2">
                {TEMPLATE_VARIABLES.map((v) => (
                  <Button key={v.key} type="button" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVariable(v.key)}>{v.label}</Button>
                ))}
              </div>
              <p className="text-helper text-fg-muted">Add a fallback for empty values like this: {"{{contact_name|Sir}}"}.</p>
            </div>
            <div className="flex flex-col gap-1" onFocus={() => setLastFocus("body")}>
              <label htmlFor="tpl-body" className="text-helper font-medium text-fg">Body</label>
              <RichTextEditor id="tpl-body" value={body} dir={rtl ? "rtl" : "ltr"} insertRef={insertRef} invalid={!!errors.body} onChange={(html) => { setBody(html); dirty.current = true; if (errors.body) setErrors({ ...errors, body: undefined }); }} />
              {errors.body ? <p className="text-helper text-error" role="alert">{errors.body}</p> : null}
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Preview" description="With sample values. The unsubscribe footer is added to every email." />
            <CardBody className="flex flex-col gap-3">
              {preview?.missing.length ? (
                <p className="rounded-control bg-warning-soft px-3 py-2 text-helper text-warning">
                  Empty in this preview: {preview.missing.join(", ")}. Leads without a value get nothing there unless you add a fallback.
                </p>
              ) : null}
              <p className="text-body"><span className="text-fg-muted">Subject: </span><span dir={rtl ? "rtl" : undefined}>{preview?.subject ?? ""}</span></p>
              <iframe title="Email preview" sandbox="" className="h-[480px] w-full rounded-control border border-border bg-white" srcDoc={preview?.html ?? ""} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Send a test" description="Sends this version, with sample values, to your own email address." />
            <CardBody className="flex flex-wrap items-end gap-3">
              {senders.length ? (
                <>
                  <Field label="From" htmlFor="tpl-sender" className="min-w-56 flex-1">
                    <Select id="tpl-sender" value={senderId} onChange={(e) => setSenderId(e.target.value)}>
                      {senders.map((s) => <option key={s.id} value={s.id}>{s.from_name} &lt;{s.from_email}&gt;</option>)}
                    </Select>
                  </Field>
                  <Button loading={busy === "test"} onClick={() => run("test", () => sendTemplateTest({ subject, body, product, language, senderId }))}><Send /> Send test email</Button>
                </>
              ) : (
                <p className="text-body text-fg-muted">No sender address yet. An Admin adds one in Settings, Sender identities.</p>
              )}
            </CardBody>
          </Card>
          {template?.parent_template_id ? (
            <p className="text-helper text-fg-muted"><StatusChip tone="neutral">B version</StatusChip> A/B tests that pick between versions arrive in step 8.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
