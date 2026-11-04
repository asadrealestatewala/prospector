/** SRS screen 1: five failed attempts lock the account for 15 minutes. */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

export type Attempt = { succeeded: boolean; created_at: string };

/**
 * Given recent attempts (newest first), returns when the lock ends, or null if not locked.
 * Failures count only since the last success and within the lock window.
 */
export function lockedUntil(attempts: Attempt[], now = new Date()): Date | null {
  const windowStart = now.getTime() - LOCK_MINUTES * 60_000;
  const failures: number[] = [];
  for (const a of attempts) {
    if (a.succeeded) break;
    const t = new Date(a.created_at).getTime();
    if (t < windowStart) break;
    failures.push(t);
  }
  if (failures.length < MAX_FAILED_ATTEMPTS) return null;
  // Locked for 15 minutes from the most recent failure.
  const until = new Date(failures[0] + LOCK_MINUTES * 60_000);
  return until.getTime() > now.getTime() ? until : null;
}
