"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Refreshes the server-rendered page when matching rows change (SRS 8.5: updates without refresh).
 * Row-level security applies to realtime, so each user only hears about rows they may read.
 */
export function LiveRefresh({
  channel,
  tables,
  onStatus,
}: {
  channel: string;
  tables: { table: string; filter?: string; event?: "INSERT" | "UPDATE" | "*" }[];
  onStatus?: (live: boolean) => void;
}) {
  const router = useRouter();
  const key = JSON.stringify(tables);
  React.useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      // Batch bursts of changes (a page of 20 leads) into one refresh.
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, 700);
    };
    let ch = supabase.channel(channel);
    for (const t of JSON.parse(key) as typeof tables) {
      ch = ch.on("postgres_changes", { event: t.event ?? "*", schema: "public", table: t.table, filter: t.filter }, refresh);
    }
    ch.subscribe((status) => onStatus?.(status === "SUBSCRIBED"));
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [channel, key, router, onStatus]);
  return null;
}
