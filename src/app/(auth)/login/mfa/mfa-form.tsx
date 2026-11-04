"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { verifyMfa, type MfaState } from "./actions";
import { signOut } from "../actions";

export function MfaForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<MfaState, FormData>(verifyMfa, undefined);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <div>
          <h1 className="text-title font-semibold">Two-step verification</h1>
          <p className="text-body text-fg-muted">Enter the 6-digit code from your authenticator app.</p>
        </div>
        {state?.error ? <p className="rounded-control bg-error-soft px-3 py-2 text-helper text-error" role="alert">{state.error}</p> : null}
        <input type="hidden" name="next" value={next} />
        <Field label="Code" htmlFor="code">
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus className="tabular tracking-widest" />
        </Field>
        <Button type="submit" variant="primary" loading={pending} className="w-full">Verify</Button>
      </form>
      <form action={signOut}>
        <Button type="submit" variant="link" className="w-full">Use a different account</Button>
      </form>
    </div>
  );
}
