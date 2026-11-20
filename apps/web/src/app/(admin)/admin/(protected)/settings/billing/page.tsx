import { getEnv } from "@ecom/config";
import {
  BILLING_METHOD_LABELS,
  BILLING_STATE_LABELS,
  formatMoney,
  getShopBilling,
} from "@ecom/core";
import { Alert, Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import { requirePermission } from "@/server/access";

export const metadata: Metadata = { title: "Plan and billing" };

const when = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "Asia/Beirut" });

// The shop's own plan, where it stands, its invoices and how to pay (D122).
// Read-only: the platform owner records payments.
export default async function BillingSettingsPage() {
  const { context } = await requirePermission("settings.write");
  const billing = await getShopBilling(getEnv().DATABASE_ADMIN_URL, context.tenantId);
  const now = new Date();
  const open = billing.invoices.filter((i) => i.status === "open");
  const warn = ["trial_ending", "trial_ended", "renewal_due", "overdue"].includes(billing.state);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Plan and billing" description="Your plan, your invoices and how to pay." />

      {warn ? (
        <Alert tone="warning" testId="billing-warning">
          {billing.state === "trial_ended"
            ? "Your free trial has ended. Pay your invoice to keep your shop open."
            : billing.state === "overdue"
              ? "Your payment is overdue. Pay your invoice to keep your shop open."
              : billing.state === "trial_ending"
                ? `Your free trial ends on ${when.format(billing.trialEndsAt!)}.`
                : `Your plan runs until ${when.format(billing.paidUntil!)}.`}
        </Alert>
      ) : null}

      <Card title="Your plan">
        <div className="flex flex-col gap-2 text-sm" data-testid="current-plan">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">
              {billing.plan ? billing.plan.name : billing.onTrial ? "Free trial" : "Custom"}
            </span>
            <Badge tone={warn ? "warning" : "neutral"}>{BILLING_STATE_LABELS[billing.state]}</Badge>
          </p>
          {billing.plan ? (
            <p className="text-ink-muted">
              {formatMoney(billing.plan.priceAmount, billing.plan.currency)} a month
            </p>
          ) : null}
          {billing.paidUntil ? (
            <p className="text-ink-muted">Paid until {when.format(billing.paidUntil)}.</p>
          ) : billing.onTrial && billing.trialEndsAt ? (
            <p className="text-ink-muted">Trial ends {when.format(billing.trialEndsAt)}.</p>
          ) : null}
          {billing.plan?.description ? (
            <ul className="mt-2 list-inside list-disc text-ink-muted">
              {billing.plan.description
                .split("\n")
                .filter((line) => line.trim())
                .map((line) => (
                  <li key={line}>{line}</li>
                ))}
            </ul>
          ) : null}
        </div>
      </Card>

      {billing.onTrial && billing.plans.length > 0 ? (
        <Card title="Plans" description="Tell us which plan you want and we send you the invoice.">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {billing.plans.map((plan) => (
              <li key={plan.id} className="flex flex-col gap-1 rounded-card border border-line p-4">
                <span className="font-semibold">{plan.name}</span>
                <span className="text-sm text-ink-muted">
                  {formatMoney(plan.priceAmount, plan.currency)} a month
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="How to pay">
        {billing.paymentInstructions ? (
          <p className="text-sm whitespace-pre-line" data-testid="payment-instructions">
            {billing.paymentInstructions}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            Payment details will be sent to you with your first invoice.
          </p>
        )}
        {open.length > 0 ? (
          <p className="mt-3 text-sm">
            Please mention your invoice number ({open.map((i) => i.number).join(", ")}) with the
            payment.
          </p>
        ) : null}
      </Card>

      <Card title="Invoices">
        {billing.invoices.length === 0 ? (
          <p className="text-sm text-ink-muted">No invoices yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm" data-testid="shop-invoices">
            {billing.invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono font-medium">{invoice.number}</span>
                  <span className="text-ink-muted">
                    {invoice.description} · {when.format(invoice.periodStart)} to{" "}
                    {when.format(invoice.periodEnd)}
                  </span>
                  <span className="text-ink-muted">
                    {invoice.status === "paid" && invoice.paidAt
                      ? `Paid ${when.format(invoice.paidAt)}${
                          invoice.method
                            ? ` by ${BILLING_METHOD_LABELS[invoice.method as keyof typeof BILLING_METHOD_LABELS] ?? invoice.method}`
                            : ""
                        }`
                      : `Due ${when.format(invoice.dueAt)}`}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">
                    {formatMoney(invoice.amount, invoice.currency)}
                  </span>
                  <Badge tone={invoice.status === "paid" ? "success" : "warning"}>
                    {invoice.status === "paid"
                      ? "Paid"
                      : invoice.dueAt < now
                        ? "Overdue"
                        : "To pay"}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
