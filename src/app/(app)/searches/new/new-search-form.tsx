"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CalendarClock, ChevronLeft, ChevronRight, Play, Plus, Save, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { PRODUCT_LABELS, ProductChip, type Product } from "@/components/ui/chips";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { CITIES, PROVINCES, findCity, type CityGroup } from "@/lib/engine/cities";
import { BUSINESS_TYPE_PRESETS, PRODUCT_BUSINESS_TYPES } from "@/lib/engine/products";
import type { SearchOptions } from "@/lib/engine/search-options";
import { cn, formatMoney, formatNumber } from "@/lib/utils";
import { createSearch, deleteSavedSearch, estimateSearch, type Estimate, type SearchInput } from "../actions";

export type SavedSearch = {
  id: string;
  name: string;
  product: Product;
  businessType: string | null;
  keywords: string[];
  options: SearchOptions;
  locations: { city: string; area: string | null; radiusKm: number | null }[];
};

type CityPick = { radiusKm: number | null; split: boolean; areas: string[] };

const STEPS = ["Product", "Business type", "Cities", "Options", "Review"] as const;
const DEFAULT_OPTIONS: SearchOptions = { maxPerCity: 60, minRating: null, requireWebsite: false, skipExisting: true, autoCrawl: true };

export function NewSearchForm({ saved, groups, initialFrom }: { saved: SavedSearch[]; groups: CityGroup[]; initialFrom: string | null }) {
  const router = useRouter();
  const init = React.useMemo(() => {
    const s = initialFrom ? saved.find((x) => x.id === initialFrom) : undefined;
    return s ? fromSaved(s) : null;
    // Only the first render reads the link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [step, setStep] = React.useState(init ? 4 : 0);
  const [product, setProduct] = React.useState<Product | null>(init?.product ?? null);
  const [businessType, setBusinessType] = React.useState<string | null>(init?.businessType ?? null);
  const [keywords, setKeywords] = React.useState<string[]>(init?.keywords ?? []);
  const [keywordDraft, setKeywordDraft] = React.useState("");
  const [picked, setPicked] = React.useState<Record<string, CityPick>>(init?.picked ?? {});
  const [options, setOptions] = React.useState<SearchOptions>(init?.options ?? DEFAULT_OPTIONS);
  const [name, setName] = React.useState(init?.name ?? "");
  const [estimate, setEstimate] = React.useState<Estimate | null>(null);
  const [estimating, setEstimating] = React.useState(false);
  const [busy, setBusy] = React.useState<null | "now" | "schedule" | "template">(null);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [scheduleAt, setScheduleAt] = React.useState("");
  const [savedList, setSavedList] = React.useState(saved);

  const loadSaved = (s: SavedSearch) => {
    const v = fromSaved(s);
    setProduct(v.product);
    setBusinessType(v.businessType);
    setKeywords(v.keywords);
    setOptions(v.options);
    setPicked(v.picked);
    setName(v.name);
    setStep(4);
  };

  const locations = React.useMemo(
    () =>
      Object.entries(picked).flatMap(([city, p]): { city: string; area: string | null; radiusKm: number | null }[] =>
        p.split && p.areas.length ? p.areas.map((area) => ({ city, area, radiusKm: p.radiusKm })) : [{ city, area: null, radiusKm: p.radiusKm }],
      ),
    [picked],
  );

  const input: SearchInput | null = product
    ? { name: name || undefined, product, businessType, keywords, locations, options }
    : null;

  const stepError = (i: number): string | null => {
    if (i === 0 && !product) return "Choose a product.";
    if (i === 1 && keywords.length === 0) return "Add at least one business type or keyword.";
    if (i === 2 && locations.length === 0) return "Choose at least one city.";
    return null;
  };

  // Review estimate refreshes whenever the review step is shown or its inputs change.
  const inputKey = JSON.stringify(input);
  React.useEffect(() => {
    if (step !== 4 || !input) return;
    let live = true;
    const t = setTimeout(async () => {
      setEstimating(true);
      const r = await estimateSearch(input);
      if (!live) return;
      setEstimating(false);
      if (r.ok && r.data) setEstimate(r.data);
      else if (!r.ok) toast.error(r.error);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, inputKey]);

  function chooseProduct(p: Product) {
    setProduct(p);
    if (keywords.length === 0) {
      setBusinessType(PRODUCT_BUSINESS_TYPES[p].label);
      setKeywords(PRODUCT_BUSINESS_TYPES[p].keywords);
    }
  }

  function addKeyword() {
    const k = keywordDraft.trim().replace(/\s+/g, " ");
    if (k.length < 2) return;
    if (!keywords.some((x) => x.toLowerCase() === k.toLowerCase())) setKeywords([...keywords, k]);
    setKeywordDraft("");
  }

  function goNext() {
    const err = stepError(step);
    if (err) {
      toast.error(err);
      return;
    }
    setStep(Math.min(4, step + 1));
  }

  async function submit(mode: "now" | "schedule" | "template") {
    if (!input) return;
    for (let i = 0; i < 3; i++) {
      const err = stepError(i);
      if (err) {
        setStep(i);
        toast.error(err);
        return;
      }
    }
    setBusy(mode);
    const r = await createSearch(input, mode, mode === "schedule" ? scheduleAt : undefined);
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(r.message);
    setScheduleOpen(false);
    if (mode === "template") {
      router.refresh();
      return;
    }
    router.push(`/searches/${r.data!.id}`);
  }

  async function removeSaved(id: string) {
    const r = await deleteSavedSearch(id);
    if (!r.ok) toast.error(r.error);
    else {
      setSavedList(savedList.filter((s) => s.id !== id));
      toast.success(r.message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Search steps" className="flex gap-2 overflow-x-auto lg:flex-col">
        {STEPS.map((label, i) => {
          const done = i < step && !stepError(i);
          return (
            <button
              key={label}
              type="button"
              onClick={() => (i <= step || !stepError(Math.max(0, i - 1)) ? setStep(i) : null)}
              aria-current={step === i ? "step" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-3 rounded-control px-3 py-2 text-left text-body",
                step === i ? "bg-brand-100 font-medium text-brand-700" : "text-fg-muted hover:bg-neutral-soft",
              )}
            >
              <span className={cn("grid size-6 place-items-center rounded-full text-helper", done ? "bg-brand-600 text-white" : step === i ? "bg-brand-600 text-white" : "bg-neutral-soft")}>
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              {label}
            </button>
          );
        })}
        {savedList.length > 0 ? (
          <div className="mt-4 hidden lg:block">
            <p className="mb-2 px-3 text-helper font-semibold text-fg-muted">Saved searches</p>
            <ul className="flex flex-col gap-1">
              {savedList.map((s) => (
                <li key={s.id} className="group flex items-center gap-1">
                  <button type="button" className="min-w-0 flex-1 truncate rounded-control px-3 py-1.5 text-left text-body hover:bg-neutral-soft" onClick={() => loadSaved(s)} title={s.name}>
                    {s.name}
                  </button>
                  <Button variant="ghost" size="icon" className="size-7 opacity-60 hover:opacity-100" aria-label={`Remove saved search ${s.name}`} onClick={() => removeSaved(s.id)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>

      <div className="min-w-0">
        {step === 0 && (
          <Card>
            <CardHeader title="Step 1: Product" description="This sets the default business type and, later, the templates." />
            <CardBody>
              <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Product">
                {(Object.keys(PRODUCT_LABELS) as Product[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={product === p}
                    onClick={() => chooseProduct(p)}
                    className={cn("flex flex-col items-start gap-2 rounded-card border p-4 text-left transition-colors", product === p ? "border-brand-600 bg-brand-50" : "border-border hover:bg-neutral-soft")}
                  >
                    <ProductChip product={p} />
                    <span className="text-body text-fg-muted">Finds {PRODUCT_BUSINESS_TYPES[p].label.toLowerCase()}</span>
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {step === 1 && (
          <Card>
            <CardHeader title="Step 2: Business type" description="Each keyword is searched separately in every city. Duplicates are skipped." />
            <CardBody className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {BUSINESS_TYPE_PRESETS.map((b) => (
                  <Button
                    key={b.label}
                    variant={businessType === b.label ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => {
                      setBusinessType(b.label);
                      setKeywords(b.keywords);
                    }}
                  >
                    {b.label}
                  </Button>
                ))}
                <Button variant={businessType === null ? "primary" : "secondary"} size="sm" onClick={() => { setBusinessType(null); setKeywords([]); }}>
                  Custom keyword
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2" aria-label="Keywords">
                {keywords.map((k) => (
                  <span key={k} className="inline-flex h-7 items-center gap-1 rounded-full bg-brand-100 pl-3 pr-1 text-body text-brand-700">
                    {k}
                    <button type="button" aria-label={`Remove ${k}`} className="grid size-5 place-items-center rounded-full hover:bg-brand-50" onClick={() => setKeywords(keywords.filter((x) => x !== k))}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                {keywords.length === 0 ? <span className="text-body text-fg-muted">No keywords yet.</span> : null}
              </div>
              <form
                className="flex max-w-md gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addKeyword();
                }}
              >
                <Field label="Add a keyword" htmlFor="kw" hint="For example: montessori, girls school, pet shop." className="flex-1">
                  <Input id="kw" value={keywordDraft} onChange={(e) => setKeywordDraft(e.target.value)} maxLength={80} />
                </Field>
                <Button type="submit" className="mt-5" disabled={keywordDraft.trim().length < 2}>
                  <Plus /> Add
                </Button>
              </form>
            </CardBody>
          </Card>
        )}

        {step === 2 && <CityStep picked={picked} setPicked={setPicked} groups={groups} />}

        {step === 3 && (
          <Card>
            <CardHeader title="Step 4: Options" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Maximum results per city" htmlFor="max" hint="Google returns at most 60 per keyword. Split big cities by area for more.">
                <Input id="max" type="number" min={1} max={1000} value={options.maxPerCity} onChange={(e) => setOptions({ ...options, maxPerCity: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })} />
              </Field>
              <Field label="Minimum Google rating" htmlFor="rating" hint="Leave empty to include unrated businesses.">
                <Select id="rating" value={options.minRating ?? ""} onChange={(e) => setOptions({ ...options, minRating: e.target.value === "" ? null : Number(e.target.value) })}>
                  <option value="">Any rating</option>
                  {[3, 3.5, 4, 4.5].map((r) => (
                    <option key={r} value={r}>{r} and above</option>
                  ))}
                </Select>
              </Field>
              <Toggle label="Require a website" hint="Skip businesses without a website." checked={options.requireWebsite} onChange={(v) => setOptions({ ...options, requireWebsite: v })} />
              <Toggle label="Skip businesses already in the system" hint="When off, existing leads get their Google rating and hours refreshed." checked={options.skipExisting} onChange={(v) => setOptions({ ...options, skipExisting: v })} />
              <Toggle label="Crawl websites automatically" hint="Queues each website to find emails and WhatsApp numbers." checked={options.autoCrawl} onChange={(v) => setOptions({ ...options, autoCrawl: v })} />
            </CardBody>
          </Card>
        )}

        {step === 4 && (
          <Card>
            <CardHeader title="Step 5: Review" />
            <CardBody className="flex flex-col gap-5">
              <Field label="Search name" htmlFor="name" hint="Optional. A name is made from the business type and cities.">
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="max-w-md" />
              </Field>
              <dl className="grid gap-x-6 gap-y-3 text-body sm:grid-cols-2">
                <Summary label="Product">{product ? <ProductChip product={product} /> : "Not chosen"}</Summary>
                <Summary label="Keywords">{keywords.join(", ") || "None"}</Summary>
                <Summary label="Cities and areas">
                  {formatNumber(locations.length)} ({[...new Set(locations.map((l) => l.city))].slice(0, 6).join(", ")}
                  {Object.keys(picked).length > 6 ? "…" : ""})
                </Summary>
                <Summary label="Options">
                  Up to {options.maxPerCity} per city
                  {options.minRating ? `, rating ${options.minRating}+` : ""}
                  {options.requireWebsite ? ", website required" : ""}
                  {options.skipExisting ? ", skip existing" : ""}
                  {options.autoCrawl ? ", crawl websites" : ""}
                </Summary>
              </dl>
              <div className="grid gap-3 sm:grid-cols-3">
                <Figure label="Estimated API calls (at most)" value={estimating && !estimate ? "…" : formatNumber(estimate?.calls ?? 0)} />
                <Figure label="Estimated Google cost" value={estimate ? (estimate.costPkr === null ? "Price not set" : formatMoney(estimate.costPkr, "PKR")) : "…"} />
                <Figure label="Budget left this month" value={estimate ? (estimate.remainingPkr === null ? "No budget" : formatMoney(estimate.remainingPkr, "PKR")) : "…"} />
              </div>
              {estimate && !estimate.ok ? (
                <p role="alert" className="flex items-start gap-2 rounded-control bg-error-soft px-3 py-2 text-body text-error">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {estimate.message}
                </p>
              ) : estimate?.warning ? (
                <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-body text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {estimate.warning}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => submit("now")} loading={busy === "now"} disabled={!estimate?.ok || estimating || busy !== null}>
                  <Play /> Start now
                </Button>
                <Button onClick={() => setScheduleOpen(true)} disabled={busy !== null}>
                  <CalendarClock /> Schedule for later
                </Button>
                <Button onClick={() => submit("template")} loading={busy === "template"} disabled={busy !== null}>
                  <Save /> Save as reusable search
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        <div className="mt-4 flex justify-between">
          <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
            <ChevronLeft /> Back
          </Button>
          {step < 4 ? (
            <Button variant="primary" onClick={goNext}>
              Next <ChevronRight />
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent
          title="Schedule this search"
          description="It starts at this time if the Google budget still allows it. Times are Pakistan time."
          footer={
            <>
              <Button onClick={() => setScheduleOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => submit("schedule")} loading={busy === "schedule"} disabled={!scheduleAt}>
                Schedule search
              </Button>
            </>
          }
        >
          <Field label="Start at (Pakistan time)" htmlFor="at">
            <Input id="at" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
          </Field>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function fromSaved(s: SavedSearch) {
  const picked: Record<string, CityPick> = {};
  for (const l of s.locations) {
    const cur = picked[l.city] ?? { radiusKm: l.radiusKm, split: false, areas: [] };
    if (l.area) {
      cur.split = true;
      cur.areas = [...cur.areas, l.area];
    }
    picked[l.city] = cur;
  }
  return { product: s.product, businessType: s.businessType, keywords: s.keywords, options: s.options, picked, name: s.name };
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-helper text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-fg">{children}</dd>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border p-4">
      <p className="text-helper text-fg-muted">{label}</p>
      <p className="tabular mt-1 text-section font-semibold text-fg">{value}</p>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = React.useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-card border border-border p-3 hover:bg-neutral-soft">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--brand-600)]" />
      <span>
        <span className="block text-body font-medium text-fg">{label}</span>
        <span className="block text-helper text-fg-muted">{hint}</span>
      </span>
    </label>
  );
}

function CityStep({
  picked,
  setPicked,
  groups,
}: {
  picked: Record<string, CityPick>;
  setPicked: (p: Record<string, CityPick>) => void;
  groups: CityGroup[];
}) {
  const [q, setQ] = React.useState("");
  const query = q.trim().toLowerCase();
  const matches = CITIES.filter((c) => !query || c.name.toLowerCase().includes(query) || c.province.toLowerCase().includes(query));
  const exact = query && CITIES.some((c) => c.name.toLowerCase() === query);
  const selected = Object.keys(picked);

  function toggle(city: string) {
    const next = { ...picked };
    if (next[city]) delete next[city];
    else next[city] = { radiusKm: null, split: false, areas: findCity(city)?.areas ?? [] };
    setPicked(next);
  }
  function addMany(names: string[]) {
    const next = { ...picked };
    for (const n of names) if (!next[n]) next[n] = { radiusKm: null, split: false, areas: findCity(n)?.areas ?? [] };
    setPicked(next);
  }
  function update(city: string, patch: Partial<CityPick>) {
    setPicked({ ...picked, [city]: { ...picked[city], ...patch } });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Step 3: Cities" description={`${selected.length} selected`} />
        <CardBody className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
            <Input aria-label="Search cities" placeholder="Search cities or provinces" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => addMany(matches.map((c) => c.name))}>Select all{query ? " shown" : ""}</Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked({})} disabled={selected.length === 0}>Clear all</Button>
            {query && !exact ? (
              <Button size="sm" variant="ghost" onClick={() => { addMany([q.trim().replace(/\b\w/g, (m) => m.toUpperCase())]); setQ(""); }}>
                <Plus /> Add “{q.trim()}”
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2" aria-label="City groups">
            {groups.filter((g) => g.cities.length).map((g) => (
              <button key={g.name} type="button" onClick={() => addMany(g.cities)} className="h-7 rounded-full border border-border px-3 text-helper text-fg hover:bg-brand-50">
                + {g.name}
              </button>
            ))}
          </div>
          <div className="max-h-96 overflow-y-auto rounded-control border border-border">
            {PROVINCES.map((p) => {
              const list = matches.filter((c) => c.province === p);
              if (!list.length) return null;
              return (
                <fieldset key={p} className="border-b border-border last:border-b-0">
                  <legend className="sr-only">{p}</legend>
                  <p className="sticky top-0 bg-neutral-soft px-3 py-1 text-helper font-semibold text-fg-muted">{p}</p>
                  {list.map((c) => (
                    <label key={c.name} className="flex h-9 cursor-pointer items-center gap-3 px-3 hover:bg-brand-50">
                      <input type="checkbox" checked={!!picked[c.name]} onChange={() => toggle(c.name)} className="size-4 accent-[var(--brand-600)]" />
                      <span className="text-body">{c.name}</span>
                      {c.areas ? <span className="ml-auto text-helper text-fg-muted">{c.areas.length} areas</span> : null}
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Selected cities" description="Set a radius, or split a large city into areas for fuller coverage." />
        <CardBody>
          {selected.length === 0 ? (
            <p className="text-body text-fg-muted">No cities selected yet.</p>
          ) : (
            <ul className="flex max-h-[30rem] flex-col gap-3 overflow-y-auto">
              {selected.map((city) => {
                const p = picked[city];
                const all = findCity(city)?.areas ?? [];
                const known = !!findCity(city);
                return (
                  <li key={city} className="rounded-control border border-border p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-body font-medium">{city}</span>
                      <label className="ml-auto flex items-center gap-2 text-helper text-fg-muted">
                        Radius
                        <Input
                          type="number"
                          min={1}
                          max={50}
                          className="h-8 w-20"
                          aria-label={`Radius for ${city} in km`}
                          placeholder="km"
                          disabled={!known}
                          title={known ? undefined : "Radius needs a city from the list"}
                          value={p.radiusKm ?? ""}
                          onChange={(e) => update(city, { radiusKm: e.target.value === "" ? null : Math.max(1, Math.min(50, Number(e.target.value))) })}
                        />
                        km
                      </label>
                      {all.length ? (
                        <label className="flex items-center gap-2 text-helper">
                          <input type="checkbox" checked={p.split} onChange={(e) => update(city, { split: e.target.checked, areas: p.areas.length ? p.areas : all })} className="size-4 accent-[var(--brand-600)]" />
                          Split by area
                        </label>
                      ) : null}
                      <Button variant="ghost" size="icon" className="size-8" aria-label={`Remove ${city}`} onClick={() => toggle(city)}>
                        <X />
                      </Button>
                    </div>
                    {p.split ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {all.map((a) => {
                          const on = p.areas.includes(a);
                          return (
                            <button
                              key={a}
                              type="button"
                              aria-pressed={on}
                              onClick={() => update(city, { areas: on ? p.areas.filter((x) => x !== a) : [...p.areas, a] })}
                              className={cn("h-7 rounded-full px-3 text-helper", on ? "bg-brand-100 text-brand-700" : "border border-border text-fg-muted")}
                            >
                              {a}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
