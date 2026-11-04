import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { readToken, unsubscribe } from "@/lib/email/unsubscribe-server";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The unsubscribe link in every email (SRS 8.4). The page asks for one click, so link scanners in
 * mail systems cannot unsubscribe people by opening the link.
 */
export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const valid = Boolean(readToken(token));

  async function confirm() {
    "use server";
    const r = await unsubscribe(token);
    const { redirect } = await import("next/navigation");
    redirect(`/u/${encodeURIComponent(token)}?done=${r.ok ? "1" : "0"}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-8">
      <div className="w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-float">
        {!valid || done === "0" ? (
          <>
            <h1 className="text-title font-semibold">This link is not valid</h1>
            <p className="mt-2 text-body text-fg-muted">The unsubscribe link may be incomplete. Reply to the email with the word &quot;unsubscribe&quot; and we will remove you.</p>
          </>
        ) : done === "1" ? (
          <>
            <h1 className="text-title font-semibold">You are unsubscribed</h1>
            <p className="mt-2 text-body text-fg-muted">We will not email this address again.</p>
          </>
        ) : (
          <form action={confirm}>
            <h1 className="text-title font-semibold">Stop these emails?</h1>
            <p className="mt-2 text-body text-fg-muted">Confirm and we will not email this address again.</p>
            <Button type="submit" className="mt-6 w-full">Unsubscribe</Button>
          </form>
        )}
      </div>
    </main>
  );
}
