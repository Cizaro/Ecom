import { getEnv } from "@ecom/config";
import {
  BILLING_STATE_LABELS,
  formatMoney,
  getShop,
  getShopBilling,
  listInvoices,
  listPlans,
} from "@ecom/core";
import { Alert, Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/server/access";
import { ActionForm, SelectField, TextField } from "../../../../_components/form";
import { createInvoiceAction, setShopPlanAction } from "../../billing-actions";
import { InvoiceList } from "../../invoice-list";
import { setShopStatusAction } from "../../actions";
import { dollars, money, PlanBadge, Stat, StatusBadge, when, whenTime } from "../../parts";

export const metadata: Metadata = { title: "Shop" };

type Params = Record<string, string | string[] | undefined>;

const AI_MODE = {
  draft: "Drafts only",
  approval: "Drafts, a person sends",
  auto: "Automatic replies",
} as Record<string, string>;

// One shop: its figures, addresses, team, connections and recent activity,
// with suspend and resume.
export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Params>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;
  const created = (await searchParams).created === "1";
  const shop = await getShop(getEnv().DATABASE_ADMIN_URL, id);
  if (!shop) notFound();
  const adminUrl = getEnv().DATABASE_ADMIN_URL;
  const billing = await getShopBilling(adminUrl, id);
  const plans = await listPlans(adminUrl);
  const invoices = await listInvoices(adminUrl, { tenantId: id });
  const url = (host: string) =>
    `${host === "localhost" || host.endsWith(".localhost") ? "http" : "https"}://${host}${host === "localhost" || host.endsWith(".localhost") ? ":3000" : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={shop.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={shop.status} />
            <PlanBadge plan={shop.plan} trialEndsAt={shop.trialEndsAt} />
            <span>
              {shop.slug} · since {when.format(shop.createdAt)} · {shop.currency} · {shop.timezone}
            </span>
          </span>
        }
        actions={
          shop.address ? (
            <a
              href={url(shop.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              Open the shop
            </a>
          ) : null
        }
      />
      {created ? (
        <Alert tone="success" testId="shop-created">
          Shop created.{" "}
          {shop.owner ? `${shop.owner} has been emailed a link to choose a password.` : ""}
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Sales (30 days)"
          value={money(shop.sales30d)}
          hint={`${shop.orders30d} orders`}
        />
        <Stat label="Orders, all time" value={shop.ordersTotal} />
        <Stat
          label="Products for sale"
          value={shop.products}
          hint={`${shop.customers} customers`}
        />
        <Stat
          label="AI this month"
          value={dollars(shop.aiCostThisMonthMicros)}
          hint={AI_MODE[shop.aiAutomation] ?? shop.aiAutomation}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Web addresses">
          <ul className="flex flex-col gap-2 text-sm">
            {shop.addresses.map((a) => (
              <li key={a.hostname} className="flex items-center gap-2">
                <span className="font-mono">{a.hostname}</span>
                {a.isPrimary ? <Badge tone="neutral">Main</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Instagram and Facebook">
          <p className="text-sm">
            {shop.facebookPage
              ? `Connected: ${shop.facebookPage}${shop.instagram ? ` and @${shop.instagram}` : ""}`
              : "Not connected yet"}
          </p>
        </Card>
      </div>

      <Card
        title="Plan and billing"
        description={`${BILLING_STATE_LABELS[billing.state]}${
          billing.paidUntil
            ? `, paid until ${when.format(billing.paidUntil)}`
            : billing.onTrial && billing.trialEndsAt
              ? `, trial ends ${when.format(billing.trialEndsAt)}`
              : ""
        }`}
      >
        {plans.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Create a plan first under{" "}
            <Link href="/admin/platform/plans" className="underline underline-offset-4">
              Plans
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <ActionForm
              action={setShopPlanAction}
              submitLabel="Change plan"
              testId="shop-plan-form"
            >
              <input type="hidden" name="tenantId" value={shop.id} />
              <SelectField
                label="Plan"
                name="plan"
                options={plans.map((p) => ({
                  value: p.key,
                  label: `${p.name} (${formatMoney(p.priceAmount, p.currency)} a month)`,
                }))}
                defaultValue={billing.plan?.key ?? plans[0]!.key}
              />
            </ActionForm>
            <ActionForm
              action={createInvoiceAction}
              submitLabel="Create invoice"
              testId="invoice-form"
            >
              <input type="hidden" name="tenantId" value={shop.id} />
              <SelectField
                label="Bill for"
                name="months"
                options={[1, 3, 6, 12].map((m) => ({
                  value: String(m),
                  label: `${m} ${m === 1 ? "month" : "months"}`,
                }))}
                defaultValue="1"
                hint="At the plan's price. Starts where the paid time ends."
              />
            </ActionForm>
          </div>
        )}
        <div className="mt-4">
          <InvoiceList invoices={invoices} />
        </div>
      </Card>

      <Card title="Team">
        <ul className="flex flex-col divide-y divide-line text-sm" data-testid="shop-team">
          {shop.team.map((m) => (
            <li key={m.email} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{m.name || m.email}</span>
                <span className="text-ink-muted"> · {m.email}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-ink-muted">
                {m.role}
                <Badge tone={m.twoFactor ? "success" : "neutral"}>
                  Two-factor {m.twoFactor ? "on" : "off"}
                </Badge>
                {m.status !== "active" ? <Badge tone="warning">{m.status}</Badge> : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Recent activity">
        {shop.recent.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {shop.recent.map((r, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2">
                <span className="font-mono text-xs">{r.action}</span>
                <span className="text-ink-muted">
                  {r.actor} · {whenTime.format(r.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={shop.status === "active" ? "Suspend this shop" : "Resume this shop"}
        description={
          shop.status === "active"
            ? "Closes its website and its admin (for example for an unpaid invoice). Nothing is deleted; resume it any time."
            : "Opens its website and admin again."
        }
      >
        <ActionForm
          action={setShopStatusAction}
          submitLabel={shop.status === "active" ? "Suspend" : "Resume"}
          submitTone={shop.status === "active" ? "danger" : "primary"}
          testId="shop-status-form"
        >
          <input type="hidden" name="id" value={shop.id} />
          <input
            type="hidden"
            name="status"
            value={shop.status === "active" ? "suspended" : "active"}
          />
          {shop.status === "active" ? (
            <TextField label="Reason (kept in the shop's record)" name="reason" maxLength={500} />
          ) : null}
        </ActionForm>
      </Card>
      <p className="text-sm">
        <Link href="/admin/platform/shops" className="underline underline-offset-4">
          All shops
        </Link>
      </p>
    </div>
  );
}
