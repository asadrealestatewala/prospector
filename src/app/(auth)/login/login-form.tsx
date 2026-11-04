"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, undefined);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div>
        <h1 className="text-title font-semibold">Sign in</h1>
        <p className="text-body text-fg-muted">Use the email your Admin invited.</p>
      </div>
      {notice ? <p className="rounded-control bg-info-soft px-3 py-2 text-helper text-info">{notice}</p> : null}
      {state?.error ? (
        <p className="rounded-control bg-error-soft px-3 py-2 text-helper text-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required defaultValue={state?.email} autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <div className="relative">
          <Input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required className="pr-10" />
          <button
            type="button"
            className="absolute inset-y-0 right-0 grid w-10 place-items-center text-fg-muted hover:text-fg"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>
      <Button type="submit" variant="primary" loading={pending} className="w-full">
        Sign in
      </Button>
      <Link href="/forgot-password" className="text-center text-helper text-brand-600 hover:underline">
        Forgot password?
      </Link>
    </form>
  );
}
