/**
 * email-verify worker (SRS 8.3): checks one address and stores the result on the contact.
 * Safe to run twice: the job claims the contact first, and a finished check clears the request.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { UnrecoverableError } from "bullmq";
import { checkVerifySpend, VERIFY_ITEM, VERIFY_PROVIDER } from "@/lib/engine/budget";
import { localCheck, ProviderError, verifyWithProvider, type ProviderId, type VerifyResult } from "@/lib/engine/email-verify";
import type { VerifyJob } from "@/lib/engine/queue";
import type { Product } from "@/components/ui/chips";

export type VerifyJobLike = { id?: string; data: VerifyJob; attemptsMade: number; opts?: { attempts?: number } };
export type VerifyDeps = {
  db: SupabaseClient;
  getProvider: () => Promise<{ id: ProviderId; apiKey: string } | null>;
  resolveMx: (domain: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

export const NO_PROVIDER_DETAIL =
  "Passed the free checks (format and mail server). Connect a verification service in Settings for a full check.";

export async function processVerifyJob(job: VerifyJobLike, deps: VerifyDeps): Promise<string> {
  const { db } = deps;
  const jobId = String(job.id);
  const { data: contact } = await db
    .from("lead_contacts")
    .update({ verify_job_id: jobId })
    .eq("id", job.data.contactId)
    .eq("kind", "email")
    .not("verify_requested_at", "is", null)
    .or(`verify_job_id.is.null,verify_job_id.eq.${jobId}`)
    .select("id, lead_id, value")
    .maybeSingle();
  if (!contact) return "skipped: not requested";

  const free = await localCheck(contact.value, deps.resolveMx);
  if (!free.pass) {
    await finish(db, contact.id, jobId, { verification: free.result, detail: free.detail });
    return `done: ${free.result} (free check)`;
  }

  const provider = await deps.getProvider();
  if (!provider) {
    await finish(db, contact.id, jobId, { detail: NO_PROVIDER_DETAIL });
    return "done: free checks only";
  }

  const { data: lead } = await db.from("leads").select("product").eq("id", contact.lead_id).maybeSingle();
  const product = (lead?.product ?? null) as Product | null;
  const spend = await checkVerifySpend(db, product, 1);
  if (!spend.ok) {
    await finish(db, contact.id, jobId, { detail: spend.message ?? "The verification budget does not allow this check." });
    return "stopped: budget";
  }

  let verdict: { result: VerifyResult; detail: string };
  try {
    verdict = await verifyWithProvider(provider.id, provider.apiKey, contact.value, deps.fetchImpl);
  } catch (e) {
    const fatal = e instanceof ProviderError && e.fatal;
    const message = e instanceof Error ? e.message : "The verification service failed.";
    const last = fatal || job.attemptsMade + 1 >= (job.opts?.attempts ?? 3);
    if (last) {
      await finish(db, contact.id, jobId, { detail: message });
      throw new UnrecoverableError(message);
    }
    throw e;
  }

  // Charged once the service answered, at the rate effective today.
  await db.rpc("record_api_usage", {
    p_provider: VERIFY_PROVIDER,
    p_item: VERIFY_ITEM,
    p_product: product,
    p_calls: 1,
    p_cost_pkr: spend.costPkr ?? 0,
    p_rate_id: spend.rateId,
  });
  await finish(db, contact.id, jobId, { verification: verdict.result, detail: verdict.detail });
  deps.log?.("email verified", { contactId: contact.id, result: verdict.result });
  return `done: ${verdict.result}`;
}

async function finish(
  db: SupabaseClient,
  id: string,
  jobId: string,
  r: { verification?: VerifyResult; detail: string },
) {
  await db
    .from("lead_contacts")
    .update({
      ...(r.verification ? { verification: r.verification, verified_at: new Date().toISOString() } : {}),
      verification_detail: r.detail,
      verify_requested_at: null,
      verify_enqueued_at: null,
      verify_job_id: null,
    })
    .eq("id", id)
    .eq("verify_job_id", jobId);
}

/** Hands requested checks to Redis every few seconds; on failure they are released for the next run. */
export async function dispatchVerifications(db: SupabaseClient, enqueue: (rows: { id: string; enqueuedAt: string }[]) => Promise<void>) {
  const { data, error } = await db.rpc("take_emails_to_verify", { p_limit: 500 });
  if (error) throw new Error(`Could not read requested checks: ${error.message}`);
  const rows = ((data ?? []) as { id: string; enqueued_at: string }[]).map((r) => ({ id: r.id, enqueuedAt: r.enqueued_at }));
  if (rows.length === 0) return 0;
  try {
    await enqueue(rows);
  } catch (e) {
    await db.from("lead_contacts").update({ verify_enqueued_at: null }).in("id", rows.map((r) => r.id));
    throw e;
  }
  return rows.length;
}
