import { campaignChoices } from "@ecom/core";
import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm } from "../../../../_components/form";
import { createCampaignAction } from "../actions";
import { CampaignFields } from "../campaign-fields";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const { context } = await requirePermission("marketing.write");
  const db = tenantDb(context);
  const [choices, store] = await Promise.all([
    campaignChoices(db, context),
    db.run((tx) =>
      tx.store.findFirst({ select: { defaultCurrency: true }, orderBy: { createdAt: "asc" } }),
    ),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New campaign"
        description={
          <Link href="/admin/marketing/campaigns" className="underline underline-offset-4">
            Back to the plan
          </Link>
        }
      />
      <Card>
        <ActionForm
          action={createCampaignAction}
          submitLabel="Save campaign"
          testId="campaign-form"
        >
          <CampaignFields choices={choices} currency={store?.defaultCurrency ?? "USD"} />
        </ActionForm>
      </Card>
    </div>
  );
}
