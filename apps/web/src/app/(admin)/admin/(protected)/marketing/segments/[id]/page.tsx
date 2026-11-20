import { formatMoney, getSegment, hasPermission, moneyToInput, segmentMembers } from "@ecom/core";
import { buttonClasses, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm } from "../../../../_components/form";
import { deleteSegmentAction, saveSegmentAction } from "../../campaigns/actions";
import { SegmentFields } from "../segment-fields";

export const metadata: Metadata = { title: "Segment" };

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export default async function SegmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("marketing.write");
  const { id } = await params;
  const db = tenantDb(context);
  const segment = await orNotFound(getSegment(db, context, id));
  const canSeeCustomers = hasPermission(context, "customers.read");
  const canExport = hasPermission(context, "customers.export");
  const [members, categories, store] = await Promise.all([
    canSeeCustomers ? segmentMembers(db, context, id) : Promise.resolve([]),
    db.run((tx) =>
      tx.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ),
    db.run((tx) =>
      tx.store.findFirst({ select: { defaultCurrency: true }, orderBy: { createdAt: "asc" } }),
    ),
  ]);
  const currency = store?.defaultCurrency ?? "USD";
  const rules = segment.rules;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={segment.name}
        description={
          <Link href="/admin/marketing/segments" className="underline underline-offset-4">
            All segments
          </Link>
        }
      />
      <dl className="grid gap-4 text-sm sm:grid-cols-3" data-testid="segment-counts">
        <div>
          <dt className="text-ink-muted">Customers now</dt>
          <dd className="text-2xl font-semibold">{segment.count}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Agreed to marketing emails</dt>
          <dd className="text-2xl font-semibold">{segment.withConsent}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Campaigns using it</dt>
          <dd className="text-2xl font-semibold">{segment.campaignCount}</dd>
        </div>
      </dl>
      {canExport ? (
        <div>
          <a
            href={`/api/v1/admin/marketing/segment-export?id=${segment.id}`}
            className={buttonClasses("secondary")}
          >
            Export emails (agreed only, CSV)
          </a>
        </div>
      ) : null}

      {canSeeCustomers ? (
        <Card
          title="Who is in it"
          description={
            members.length < segment.count
              ? `The ${members.length} biggest spenders of ${segment.count}.`
              : undefined
          }
        >
          {members.length === 0 ? (
            <p className="text-sm text-ink-muted">Nobody matches yet.</p>
          ) : (
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Customers in this segment"
            >
              <table className="w-full text-left text-sm" data-testid="segment-members">
                <thead className="text-ink-muted">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Customer</th>
                    <th className="py-1 pr-3 font-medium">Orders</th>
                    <th className="py-1 pr-3 font-medium">Spent</th>
                    <th className="py-1 pr-3 font-medium">Last order</th>
                    <th className="py-1 font-medium">Emails</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-t border-line">
                      <td className="py-1 pr-3">
                        <Link
                          href={`/admin/customers/${m.id}`}
                          className="underline underline-offset-4"
                        >
                          {m.name || m.email}
                        </Link>
                      </td>
                      <td className="py-1 pr-3">{m.orders}</td>
                      <td className="py-1 pr-3">{formatMoney(m.spentAmount, currency)}</td>
                      <td className="py-1 pr-3">
                        {m.lastOrderAt ? date.format(m.lastOrderAt) : "—"}
                      </td>
                      <td className="py-1">{m.marketingConsent ? "Agreed" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      <Card title="Rules">
        <ActionForm action={saveSegmentAction} submitLabel="Save" testId="segment-form">
          <input type="hidden" name="id" value={segment.id} />
          <SegmentFields
            categories={categories}
            currency={currency}
            value={{
              name: segment.name,
              minOrders: rules.minOrders ? String(rules.minOrders) : "",
              minSpent: rules.minSpentAmount ? moneyToInput(rules.minSpentAmount, currency) : "",
              orderedWithinDays: rules.orderedWithinDays ? String(rules.orderedWithinDays) : "",
              noOrderForDays: rules.noOrderForDays ? String(rules.noOrderForDays) : "",
              categoryId: rules.categoryId ?? "",
            }}
          />
        </ActionForm>
      </Card>
      <ActionForm action={deleteSegmentAction} submitLabel="Delete segment" submitTone="danger">
        <input type="hidden" name="id" value={segment.id} />
      </ActionForm>
    </div>
  );
}
