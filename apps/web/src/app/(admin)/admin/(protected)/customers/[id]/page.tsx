import { formatMoney, getCustomerForStaff, hasPermission, type TimelineKind } from "@ecom/core";
import { Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm, TextAreaField } from "../../../_components/form";
import { addCustomerNoteAction } from "../actions";

export const metadata: Metadata = { title: "Customer" };

const KIND_LABEL: Record<TimelineKind, string> = {
  account: "Account",
  order: "Order",
  review: "Review",
  photo: "Photo",
  conversation: "Message",
  note: "Note",
};

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("customers.read");
  const { id } = await params;
  const customer = await orNotFound(getCustomerForStaff(tenantDb(context), context, id));
  const canNote = hasPermission(context, "customers.write");
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={customer.name || customer.email}
        description={
          <>
            {customer.email}
            {customer.phone ? ` · ${customer.phone}` : ""} ·{" "}
            <Link href="/admin/customers" className="underline underline-offset-4">
              All customers
            </Link>
          </>
        }
      />
      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-card border border-line p-4">
          <p className="text-sm text-ink-muted">Orders</p>
          <p className="text-xl font-semibold" data-testid="customer-order-count">
            {customer.orderCount}
          </p>
        </div>
        <div className="rounded-card border border-line p-4">
          <p className="text-sm text-ink-muted">Spent</p>
          <p className="text-xl font-semibold" data-testid="customer-spent">
            {formatMoney(customer.spent.amount, customer.spent.currency)}
          </p>
        </div>
        <div className="rounded-card border border-line p-4">
          <p className="text-sm text-ink-muted">Customer since</p>
          <p className="text-xl font-semibold">
            {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(customer.createdAt)}
          </p>
          <p className="text-sm text-ink-muted">
            {customer.hasAccount
              ? customer.emailVerified
                ? "Account, email confirmed"
                : "Account"
              : "Guest"}
          </p>
        </div>
      </section>

      {canNote ? (
        <Card title="Add a note for staff">
          <ActionForm
            action={addCustomerNoteAction}
            submitLabel="Add note"
            testId="customer-note-form"
          >
            <input type="hidden" name="id" value={customer.id} />
            <TextAreaField
              label="Note"
              name="note"
              rows={3}
              maxLength={2000}
              hint="Only staff see notes. They cannot be edited; add a new note to correct one."
            />
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Timeline">
        <ol className="flex flex-col divide-y divide-line text-sm" data-testid="customer-timeline">
          {customer.timeline.map((entry, index) => (
            <li
              key={index}
              className="flex flex-col gap-1 py-3"
              data-testid={`timeline-${entry.kind}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={entry.kind === "note" ? "warning" : "neutral"}>
                  {KIND_LABEL[entry.kind]}
                </Badge>
                {entry.href ? (
                  <Link
                    href={entry.href}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {entry.title}
                  </Link>
                ) : (
                  <span className="font-medium">{entry.title}</span>
                )}
                <span className="text-ink-muted">{when.format(entry.at)}</span>
              </div>
              {entry.detail ? (
                <p className="whitespace-pre-line text-ink-muted">{entry.detail}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
