import { getEnv } from "@ecom/config";
import { BILLING_STATE_LABELS, listInvoices, shopsNeedingAttention } from "@ecom/core";
import { Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/server/access";
import { InvoiceList } from "../invoice-list";
import { when } from "../parts";

export const metadata: Metadata = { title: "Billing" };

type Params = Record<string, string | string[] | undefined>;

const FILTERS = [
  { value: "open", label: "Open" },
  { value: "paid", label: "Paid" },
  { value: "", label: "All" },
];

// Who owes what (D122): shops that need you, then invoices. Nothing is
// suspended automatically; suspend from the shop's page if you decide to.
export default async function BillingPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePlatformAdmin();
  const raw = (await searchParams).status;
  const status = typeof raw === "string" ? raw : "open";
  const url = getEnv().DATABASE_ADMIN_URL;
  const attention = await shopsNeedingAttention(url);
  const invoices = await listInvoices(url, { status });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing"
        description="Trials ending, renewals due, overdue shops and invoices. Bill a shop from its page."
      />
      <Card title="Needs your attention" description="Shops are never suspended automatically.">
        {attention.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing needs you right now.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm" data-testid="attention-list">
            {attention.map((shop) => (
              <li key={shop.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link
                  href={`/admin/platform/shops/${shop.id}`}
                  className="font-medium underline underline-offset-4"
                >
                  {shop.name}
                </Link>
                <span className="flex flex-wrap items-center gap-2 text-ink-muted">
                  <Badge
                    tone={
                      shop.state === "overdue" || shop.state === "trial_ended"
                        ? "warning"
                        : "neutral"
                    }
                  >
                    {BILLING_STATE_LABELS[shop.state]}
                  </Badge>
                  {shop.date ? when.format(shop.date) : null}
                  {shop.openInvoices > 0
                    ? ` · ${shop.openInvoices} open ${shop.openInvoices === 1 ? "invoice" : "invoices"}`
                    : null}
                  {shop.status !== "active" ? <Badge tone="warning">{shop.status}</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Invoices">
        <nav aria-label="Invoice filter" className="mb-2 flex gap-2 text-sm">
          {FILTERS.map((f) => (
            <Link
              key={f.label}
              href={
                f.value
                  ? `/admin/platform/billing?status=${f.value}`
                  : "/admin/platform/billing?status=all"
              }
              aria-current={status === (f.value || "all") ? "page" : undefined}
              className={`rounded-control px-3 py-1.5 ${
                status === (f.value || "all")
                  ? "bg-brand text-brand-contrast"
                  : "hover:bg-surface-muted"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <InvoiceList invoices={invoices} showShop />
      </Card>
    </div>
  );
}
