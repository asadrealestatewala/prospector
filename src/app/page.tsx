import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/auth/roles";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(ROLE_HOME[user.role]);
}
