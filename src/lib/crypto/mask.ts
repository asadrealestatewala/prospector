/** Browser-safe masking helper (no crypto). */
export function maskSecret(last4: string | null | undefined): string {
  if (last4 === null || last4 === undefined) return "Not set";
  return `••••••••${last4}`;
}
