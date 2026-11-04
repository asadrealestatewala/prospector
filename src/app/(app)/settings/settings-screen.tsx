"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, PlugZap, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import type { CityGroup } from "@/lib/engine/cities";
import { BrandingTab, LimitsTab, PriceLinesCard, SendersTab, type SenderRow } from "./email-tabs";
import type { EmailLimits } from "@/lib/email/limits";
import { DefaultsTab, type ScoringRules } from "./defaults-tab";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { INTEGRATIONS, type Integration, type SecretKey } from "@/lib/integrations/catalog";
import { formatPkDateTime } from "@/lib/utils";
import { maskSecret } from "@/lib/crypto/mask";
import { clearSecret, runTest, savePlain, saveSecret } from "./actions";

export type SettingRow = {
  key: string;
  value: unknown;
  is_secret: boolean;
  secret_last4: string | null;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  updated_at: string;
};

function CopyField({ id, label, value, hint }: { id: string; label: string; value: string; hint: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex gap-2">
        <Input id={id} value={value} readOnly className="tabular" />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </Field>
  );
}

function SecretInput({ name, label, hint, row, disabled }: { name: SecretKey; label: string; hint: string; row?: SettingRow; disabled: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const isSet = row?.secret_last4 !== null && row?.secret_last4 !== undefined;
  const id = name.replace(/\./g, "-");

  async function save() {
    setSaving(true);
    const res = await saveSecret(name, value);
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    setValue("");
    setEditing(false);
    toast.success(res.message);
    router.refresh();
  }

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      {editing || !isSet ? (
        <div className="flex flex-wrap gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste the key here"
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="button" variant="primary" loading={saving} disabled={!value || disabled} onClick={save}>
            Save
          </Button>
          {isSet ? (
            <Button type="button" variant="ghost" onClick={() => { setEditing(false); setValue(""); }}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input id={id} value={maskSecret(row?.secret_last4)} readOnly className="tabular min-w-0 flex-1" aria-describedby={`${id}-hint`} />
          <Button type="button" variant="secondary" onClick={() => setEditing(true)} disabled={disabled}>
            Replace
          </Button>
          <Button type="button" variant="destructive" onClick={() => setConfirmClear(true)} disabled={disabled}>
            Remove
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={`Remove ${label}`}
        description="Anything that uses this key stops working until a new key is saved. 1 key affected."
        confirmLabel="Remove key"
        destructive
        onConfirm={async () => {
          const res = await clearSecret(name);
          setConfirmClear(false);
          if (!res.ok) return toast.error(res.error);
          toast.success(res.message);
          router.refresh();
        }}
      />
    </Field>
  );
}

function PlainInput({ name, label, hint, row, options }: { name: string; label: string; hint: string; row?: SettingRow; options?: { value: string; label: string }[] }) {
  const router = useRouter();
  const initial = typeof row?.value === "string" ? row.value : "";
  const [value, setValue] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const id = name.replace(/\./g, "-");
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex gap-2">
        {options ? (
          <Select id={id} value={value} onChange={(e) => setValue(e.target.value)} className="min-w-0 flex-1">
            <option value="">Not chosen</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        ) : (
          <Input id={id} value={value} onChange={(e) => setValue(e.target.value)} className="min-w-0 flex-1" />
        )}
        <Button
          type="button"
          variant="secondary"
          loading={saving}
          disabled={value === initial}
          onClick={async () => {
            setSaving(true);
            const res = await savePlain(name, value);
            setSaving(false);
            if (!res.ok) return toast.error(res.error);
            toast.success(res.message);
            router.refresh();
          }}
        >
          Save
        </Button>
      </div>
    </Field>
  );
}

function IntegrationCard({ integration, rows, disabled, extra }: { integration: Integration; rows: Map<string, SettingRow>; disabled: boolean; extra?: React.ReactNode }) {
  const router = useRouter();
  const [testing, setTesting] = React.useState(false);
  const [target, setTarget] = React.useState("");
  const first = rows.get(integration.secrets[0].key);
  const allSet = integration.secrets.every((s) => rows.get(s.key)?.secret_last4 !== null && rows.get(s.key)?.secret_last4 !== undefined);

  const status = !allSet ? (
    <StatusChip tone="neutral">Not set</StatusChip>
  ) : first?.last_test_ok === true ? (
    <StatusChip tone="success">Connected</StatusChip>
  ) : first?.last_test_ok === false ? (
    <StatusChip tone="error">Test failed</StatusChip>
  ) : (
    <StatusChip tone="warning">Not tested</StatusChip>
  );

  return (
    <Card>
      <CardHeader title={integration.name} description={integration.description} action={status} />
      <CardBody className="flex flex-col gap-4">
        {integration.secrets.map((s) => (
          <SecretInput key={s.key} name={s.key} label={s.label} hint={s.hint} row={rows.get(s.key)} disabled={disabled} />
        ))}
        {(integration.plain ?? []).map((p) => (
          <PlainInput key={p.key} name={p.key} label={p.label} hint={p.hint} row={rows.get(p.key)} options={p.options} />
        ))}
        {extra}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {integration.testNeedsTarget ? (
            <Field label={integration.testNeedsTarget.label} htmlFor={`${integration.id}-target`} hint={integration.testNeedsTarget.hint}>
              <Input id={`${integration.id}-target`} inputMode={integration.id === "email_verification" ? "email" : "tel"} placeholder={integration.id === "email_verification" ? "you@yourdomain.com" : "923001234567"} value={target} onChange={(e) => setTarget(e.target.value)} className="max-w-60" />
            </Field>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              loading={testing}
              disabled={!allSet || disabled}
              onClick={async () => {
                setTesting(true);
                const res = await runTest(integration.id, target);
                setTesting(false);
                if (res.ok) toast.success(res.message);
                else toast.error(res.error);
                router.refresh();
              }}
            >
              <PlugZap /> Test connection
            </Button>
            {first?.last_tested_at ? (
              <span className="text-helper text-fg-muted">
                Last test {formatPkDateTime(first.last_tested_at)}: {first.last_test_message}
              </span>
            ) : null}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

export function SettingsScreen({ settings, webhookUrl, resendWebhookUrl, encryptionReady, scoring, cityGroups, autoVerify, emailLimits, senders, footer, priceLines }: { settings: SettingRow[]; webhookUrl: string; resendWebhookUrl: string; encryptionReady: boolean; scoring: ScoringRules; cityGroups: CityGroup[]; autoVerify: boolean; emailLimits: EmailLimits; senders: SenderRow[]; footer: string; priceLines: Record<string, string> }) {
  const rows = new Map(settings.map((s) => [s.key, s]));
  return (
    <>
      <PageHeader title="Settings" description="Integrations, sending limits, sender identities, defaults and branding." />
      <Tabs defaultValue="integrations">
        <TabsList
          tabs={[
            { value: "integrations", label: "Integrations" },
            { value: "limits", label: "Sending limits" },
            { value: "senders", label: "Sender identities" },
            { value: "defaults", label: "Defaults" },
            { value: "branding", label: "Branding" },
          ]}
        />
        <TabsContent value="defaults" className="flex flex-col gap-6">
          <DefaultsTab scoring={scoring} groups={cityGroups} autoVerify={autoVerify} />
          <PriceLinesCard lines={priceLines} />
        </TabsContent>
        <TabsContent value="integrations" className="flex flex-col gap-6">
          {!encryptionReady ? (
            <p className="rounded-control bg-warning-soft px-3 py-2 text-body text-warning" role="alert">
              Keys cannot be saved yet. Set SETTINGS_ENCRYPTION_KEY on the server, then restart Prospector.
            </p>
          ) : (
            <p className="flex items-center gap-2 text-helper text-fg-muted">
              <KeyRound className="size-4" aria-hidden /> Keys are encrypted on the server (AES-256-GCM) and only the last four characters are ever shown.
            </p>
          )}
          <div className="grid gap-6 xl:grid-cols-2">
            {INTEGRATIONS.map((i) => (
              <IntegrationCard
                key={i.id}
                integration={i}
                rows={rows}
                disabled={!encryptionReady}
                extra={
                  i.id === "botlinkd" ? (
                    <CopyField id="botlinkd-webhook" label="Webhook address for BotLinkd" value={webhookUrl} hint="Paste this into BotLinkd so replies reach the Inbox. The receiver is built in step 6." />
                  ) : i.id === "resend" ? (
                    <CopyField id="resend-webhook" label="Webhook address for Resend" value={resendWebhookUrl} hint="In Resend, Webhooks, add this address with the delivered, opened, clicked, bounced, complained and failed events, then paste the signing secret above." />
                  ) : null
                }
              />
            ))}
          </div>
        </TabsContent>
        <TabsContent value="limits"><LimitsTab limits={emailLimits} /></TabsContent>
        <TabsContent value="senders"><SendersTab senders={senders} /></TabsContent>
        <TabsContent value="branding"><BrandingTab footer={footer} /></TabsContent>
      </Tabs>
    </>
  );
}
