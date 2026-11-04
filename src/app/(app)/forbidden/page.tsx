import Link from "next/link";
import { Lock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_HOME, ROLE_LABELS } from "@/lib/auth/roles";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default async function Forbidden() {
  const user = await getCurrentUser();
  return (
    <Card>
      <EmptyState
        icon={Lock}
        message={`Your role (${user ? ROLE_LABELS[user.role] : "unknown"}) does not include this screen. Ask an Admin if you need access.`}
        action={
          <Button asChild variant="primary">
            <Link href={user ? ROLE_HOME[user.role] : "/login"}>Go to my home screen</Link>
          </Button>
        }
      />
    </Card>
  );
}
