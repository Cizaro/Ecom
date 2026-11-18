import { listSegments } from "@ecom/core";
import { Card, EmptyState, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm } from "../../../_components/form";
import { saveSegmentAction } from "../campaigns/actions";
import { SegmentFields } from "./segment-fields";

export const metadata: Metadata = { title: "Customer segments" };

// Groups of customers by what they bought and when, counted now from the
// store's own orders, with how many agreed to marketing emails.
export default async function SegmentsPage() {
  const { context } = await requirePermission("marketing.write");
  const db = tenantDb(context);
  const [segments, categories, store] = await Promise.all([
    listSegments(db, context),
    db.run((tx) =>
      tx.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ),
    db.run((tx) =>
      tx.store.findFirst({ select: { defaultCurrency: true }, orderBy: { createdAt: "asc" } }),
    ),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customer segments"
        description={
          <>
            Groups of customers by their orders. Only those who agreed to marketing emails can be
            exported for email.{" "}
            <Link href="/admin/marketing/campaigns" className="underline underline-offset-4">
              Marketing plan
            </Link>
          </>
        }
      />
      {segments.length === 0 ? (
        <EmptyState title="No segments yet" />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="segments">
          {segments.map((segment) => (
            <li
              key={segment.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line p-3 text-sm"
              data-testid="segment-row"
            >
              <Link
                href={`/admin/marketing/segments/${segment.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {segment.name}
              </Link>
              <span className="text-ink-muted">
                <strong className="text-ink">{segment.count}</strong>{" "}
                {segment.count === 1 ? "customer" : "customers"} · {segment.withConsent} agreed to
                emails
              </span>
            </li>
          ))}
        </ul>
      )}
      <Card title="New segment">
        <ActionForm action={saveSegmentAction} submitLabel="Save segment" testId="segment-form">
          <SegmentFields categories={categories} currency={store?.defaultCurrency ?? "USD"} />
        </ActionForm>
      </Card>
    </div>
  );
}
