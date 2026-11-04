"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { setPassword, type FormState } from "../actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(setPassword, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.error ? <p className="rounded-control bg-error-soft px-3 py-2 text-helper text-error" role="alert">{state.error}</p> : null}
      <Field label="New password" htmlFor="password" hint="At least 12 characters, with a letter and a number.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} />
      </Field>
      <Field label="Type it again" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" variant="primary" loading={pending}>Save password</Button>
    </form>
  );
}
