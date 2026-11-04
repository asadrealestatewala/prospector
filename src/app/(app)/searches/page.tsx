import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireScreen } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { SearchesTable, type SearchRow } from "./searches-table";
import { LiveRefresh } from "./live-refresh";

export const metadata: Metadata = { title: "Live Progress" };

export default async function Page() {
  await requireScreen("live-progress");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("searches")
    .select("id, name, product, status, created_at, started_at, finished_at, actual_calls, actual_cost_pkr, error, scheduled_at, search_cities(status, saved_count, duplicate_count)")
    .eq("is_saved_template", false)
    .order("created_at", { ascending: false })
    .limit(200);

  const rows: SearchRow[] = (data ?? []).map((s) => {
    const cities = (s.search_cities as { status: string; saved_count: number; duplicate_count: number }[]) ?? [];
    return {
      id: s.id,
      name: s.name,
      product: s.product,
      status: s.status,
      createdAt: s.created_at,
      scheduledAt: s.scheduled_at,
      error: s.error,
      citiesTotal: cities.length,
      citiesDone: cities.filter((c) => ["done", "failed", "cancelled"].includes(c.status)).length,
      saved: cities.reduce((n, c) => n + c.saved_count, 0),
      duplicates: cities.reduce((n, c) => n + c.duplicate_count, 0),
      costPkr: Number(s.actual_cost_pkr),
    };
  });

  return (
    <>
      <LiveRefresh channel="searches-list" tables={[{ table: "searches" }, { table: "search_cities" }]} />
      <PageHeader
        title="Live Progress"
        description="Every search, newest first. Open one to watch it run."
        actions={
          <Button asChild variant="primary">
            <Link href="/searches/new">
              <Plus /> New search
            </Link>
          </Button>
        }
      />
      <SearchesTable rows={rows} />
    </>
  );
}
