import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { AppShell, SIDEBAR_COOKIE } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/login?error=inactive");
  if (user.needsMfaCode) redirect("/login/mfa");
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";
  return (
    <AppShell user={{ fullName: user.fullName, email: user.email, role: user.role }} initialCollapsed={collapsed}>
      {children}
    </AppShell>
  );
}
