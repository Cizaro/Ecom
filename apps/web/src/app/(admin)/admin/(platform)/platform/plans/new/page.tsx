import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/server/access";
import { PlanForm } from "../plan-form";

export const metadata: Metadata = { title: "New plan" };

export default async function NewPlanPage() {
  await requirePlatformAdmin();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New plan"
        description="A plan you sell, its monthly price and what it includes."
      />
      <Card>
        <PlanForm />
      </Card>
    </div>
  );
}
