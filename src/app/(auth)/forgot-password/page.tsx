"use client";
import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestReset, type ForgotState } from "./actions";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestReset, undefined);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div>
        <h1 className="text-title font-semibold">Reset your password</h1>
        <p className="text-body text-fg-muted">We will email you a link to choose a new password.</p>
      </div>
      {state?.sent ? (
        <p className="rounded-control bg-success-soft px-3 py-2 text-helper text-success" role="status">
          If that email belongs to a Prospector account, a reset link is on its way. It expires in one hour.
        </p>
      ) : null}
      {state?.error ? <p className="rounded-control bg-error-soft px-3 py-2 text-helper text-error" role="alert">{state.error}</p> : null}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Button type="submit" variant="primary" loading={pending} className="w-full">Send reset link</Button>
      <Link href="/login" className="text-center text-helper text-brand-600 hover:underline">Back to sign in</Link>
    </form>
  );
}
