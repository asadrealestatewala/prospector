import { Hammer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/** Placeholder for screens delivered by a later SRS 9.1 build step. */
export function ComingInStep({ title, step, stepName, description }: { title: string; step: number; stepName: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <EmptyState icon={Hammer} message={`This screen is built in step ${step} (${stepName}) of the build plan.`} />
      </Card>
    </>
  );
}
