"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { PROVINCE_GROUPS, type CityGroup } from "@/lib/engine/cities";
import { saveCityGroups, saveScoring } from "./actions";

export type ScoringRules = {
  website: number;
  email: number;
  verified_email: number;
  whatsapp: number;
  reviews: number;
  reviews_min: number;
  recent_reply: number;
  recent_reply_days: number;
};

const SCORING_FIELDS: { key: keyof ScoringRules; label: string; hint?: string }[] = [
  { key: "website", label: "Has a website" },
  { key: "email", label: "Has an email (not yet verified)" },
  { key: "verified_email", label: "Has a verified email", hint: "Replaces the points above once verified." },
  { key: "whatsapp", label: "Has a WhatsApp number" },
  { key: "reviews", label: "Many Google reviews" },
  { key: "reviews_min", label: "Reviews needed to count as many" },
  { key: "recent_reply", label: "Replied recently" },
  { key: "recent_reply_days", label: "Days a reply counts as recent" },
];

/** Settings, Defaults tab: lead scoring points and city groups (step 2). */
export function DefaultsTab({ scoring, groups }: { scoring: ScoringRules; groups: CityGroup[] }) {
  const [rules, setRules] = React.useState(scoring);
  const [list, setList] = React.useState(groups.map((g) => ({ name: g.name, cities: g.cities.join(", ") })));
  const [busy, setBusy] = React.useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(label);
    const r = await fn();
    setBusy(null);
    if (r.ok) toast.success(r.message ?? "Saved.");
    else toast.error(r.error ?? "Could not save.");
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Lead scoring" description="Points added to a lead's score. Saving recalculates every lead." />
        <CardBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {SCORING_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`sc-${f.key}`} hint={f.hint}>
                <Input id={`sc-${f.key}`} type="number" min={0} value={rules[f.key]} onChange={(e) => setRules({ ...rules, [f.key]: Number(e.target.value) })} />
              </Field>
            ))}
          </div>
          <Button variant="primary" className="self-start" loading={busy === "scoring"} onClick={() => run("scoring", () => saveScoring(rules))}>
            Save scoring
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="City groups" description={`Shown on New Search next to the province groups (${PROVINCE_GROUPS.map((g) => g.name).join(", ")}).`} />
        <CardBody className="flex flex-col gap-4">
          {list.length === 0 ? <p className="text-body text-fg-muted">No custom groups yet. For example: Big cities, or Twin cities.</p> : null}
          {list.map((g, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-control border border-border p-3">
              <div className="flex items-end gap-2">
                <Field label="Group name" htmlFor={`g-${i}`} className="flex-1">
                  <Input id={`g-${i}`} value={g.name} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} maxLength={60} />
                </Field>
                <Button variant="ghost" size="icon" aria-label={`Remove group ${g.name || i + 1}`} onClick={() => setList(list.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
              <Field label="Cities" htmlFor={`gc-${i}`} hint="Separate with commas.">
                <Textarea id={`gc-${i}`} value={g.cities} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, cities: e.target.value } : x)))} rows={2} />
              </Field>
            </div>
          ))}
          <div className="flex gap-2">
            <Button onClick={() => setList([...list, { name: "", cities: "" }])}><Plus /> Add group</Button>
            <Button
              variant="primary"
              loading={busy === "groups"}
              onClick={() => run("groups", () => saveCityGroups(list.map((g) => ({ name: g.name, cities: g.cities.split(",").map((c) => c.trim()).filter(Boolean) }))))}
            >
              Save city groups
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
