import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Password" };

export default async function PasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <>
      <PageHeader
        title={user.mustResetPassword ? "Choose a new password" : "Change password"}
        description={user.mustResetPassword ? "Your Admin asked you to set a new password before continuing." : "Use at least 12 characters with letters and numbers."}
      />
      <Card className="max-w-md">
        <CardBody>
          <PasswordForm />
        </CardBody>
      </Card>
    </>
  );
}
