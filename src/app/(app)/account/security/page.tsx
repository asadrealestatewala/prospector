import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chips";
import { Button } from "@/components/ui/button";
import { formatPkDateTime } from "@/lib/utils";
import { removeFactor } from "../actions";
import { EnrollForm } from "./enroll-form";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function SecurityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin" && user.role !== "manager") redirect("/forbidden");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = (data?.totp ?? []).filter((f) => f.status === "verified");
  return (
    <>
      <PageHeader title="Two-step verification" description="Ask for a code from an authenticator app each time you sign in." />
      {user.needsMfaSetup ? (
        <p className="mb-4 max-w-xl rounded-control bg-warning-soft px-3 py-2 text-body text-warning" role="alert">
          An Admin requires two-step verification for your account. Set it up to continue.
        </p>
      ) : null}
      <Card className="max-w-xl">
        <CardHeader
          title="Authenticator app"
          action={verified.length ? <StatusChip tone="success">On</StatusChip> : <StatusChip tone="neutral">Off</StatusChip>}
        />
        <CardBody>
          {verified.length ? (
            <ul className="flex flex-col gap-3">
              {verified.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-4">
                  <span className="text-body">Added {formatPkDateTime(f.created_at)}</span>
                  <form action={removeFactor}>
                    <input type="hidden" name="factorId" value={f.id} />
                    <Button type="submit" variant="destructive" size="sm">Turn off</Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <EnrollForm />
          )}
        </CardBody>
      </Card>
    </>
  );
}
