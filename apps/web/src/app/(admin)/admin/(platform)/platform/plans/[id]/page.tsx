import { getEnv } from "@ecom/config";
import { listPlans } from "@ecom/core";
import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/server/access";
import { PlanForm } from "../plan-form";

export const metadata: Metadata = { title: "Plan" };

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  const plan = (await listPlans(getEnv().DATABASE_ADMIN_URL)).find((p) => p.id === id);
  if (!plan) notFound();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={plan.name}
        description="A new price applies to new invoices; invoices already sent keep their amount."
      />
      <Card>
        <PlanForm plan={plan} />
      </Card>
    </div>
  );
}
