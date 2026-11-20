import { getEnv } from "@ecom/config";
import { formatMoney, getPaymentInstructions, listPlans } from "@ecom/core";
import { Alert, Badge, buttonClasses, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/server/access";
import { ActionForm, TextAreaField } from "../../../_components/form";
import { savePaymentInstructionsAction } from "../billing-actions";

export const metadata: Metadata = { title: "Plans" };

type Params = Record<string, string | string[] | undefined>;

const limit = (n: number | null) => (n === null ? "No limit" : n.toLocaleString("en"));

// The plans you sell (D122) and how shop owners pay you.
export default async function PlansPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePlatformAdmin();
  const saved = (await searchParams).saved === "1";
  const url = getEnv().DATABASE_ADMIN_URL;
  const plans = await listPlans(url);
  const instructions = await getPaymentInstructions(url);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plans"
        description="What you sell, at the prices you choose. Public plans appear in the platform site's pricing section."
        actions={
          <Link href="/admin/platform/plans/new" className={buttonClasses("primary")}>
            New plan
          </Link>
        }
      />
      {saved ? (
        <Alert tone="success" testId="plan-saved">
          Plan saved.
        </Alert>
      ) : null}
      <Card title="Your plans">
        {plans.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No plans yet. Create your first one; until then the pricing section says plans are being
            finalised.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="plan-table">
              <thead className="text-ink-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Plan
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Monthly
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Products
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Staff
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    AI per month
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Shown
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td className="py-2 pr-4">
                      <Link
                        href={`/admin/platform/plans/${plan.id}`}
                        className="font-medium underline underline-offset-4"
                      >
                        {plan.name}
                      </Link>
                      <span className="block font-mono text-xs text-ink-muted">{plan.key}</span>
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {formatMoney(plan.priceAmount, plan.currency)}
                    </td>
                    <td className="py-2 pr-4">{limit(plan.productLimit)}</td>
                    <td className="py-2 pr-4">{limit(plan.staffLimit)}</td>
                    <td className="py-2 pr-4">
                      {plan.aiMonthlyBudgetAmount === null
                        ? "Shop's own cap"
                        : formatMoney(plan.aiMonthlyBudgetAmount, "USD")}
                    </td>
                    <td className="py-2">
                      <Badge tone={plan.isPublic ? "success" : "neutral"}>
                        {plan.isPublic ? "Public" : "Hidden"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card
        title="How shop owners pay you"
        description="Shown on every shop's billing page, e.g. your Whish number, the name for OMT, or bank details."
      >
        <ActionForm
          action={savePaymentInstructionsAction}
          submitLabel="Save"
          testId="payment-instructions-form"
        >
          <TextAreaField
            label="Payment instructions"
            name="paymentInstructions"
            rows={5}
            maxLength={2000}
            defaultValue={instructions}
          />
        </ActionForm>
      </Card>
    </div>
  );
}
