import { BILLING_METHOD_LABELS, BILLING_METHODS, formatMoney, type Invoice } from "@ecom/core";
import { Badge } from "@ecom/ui";
import Link from "next/link";
import { ActionForm, SelectField, TextField } from "../../_components/form";
import { markInvoicePaidAction, voidInvoiceAction } from "./billing-actions";
import { when } from "./parts";

const METHODS = BILLING_METHODS.map((m) => ({ value: m, label: BILLING_METHOD_LABELS[m] }));

export function InvoiceStatus({ invoice, now = new Date() }: { invoice: Invoice; now?: Date }) {
  if (invoice.status === "paid") return <Badge tone="success">Paid</Badge>;
  if (invoice.status === "void") return <Badge tone="neutral">Cancelled</Badge>;
  return <Badge tone="warning">{invoice.dueAt < now ? "Overdue" : "Open"}</Badge>;
}

/** Invoices, newest first; open ones can be marked paid or cancelled. */
export function InvoiceList({
  invoices,
  showShop = false,
}: {
  invoices: (Invoice & { shopName?: string })[];
  showShop?: boolean;
}) {
  if (invoices.length === 0) return <p className="text-sm text-ink-muted">No invoices yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-line" data-testid="invoice-list">
      {invoices.map((invoice) => (
        <li key={invoice.id} className="flex flex-col gap-3 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5 text-sm">
              <span className="font-medium">
                <span className="font-mono">{invoice.number}</span>
                {showShop && invoice.shopName ? (
                  <>
                    {" · "}
                    <Link
                      href={`/admin/platform/shops/${invoice.tenantId}`}
                      className="underline underline-offset-4"
                    >
                      {invoice.shopName}
                    </Link>
                  </>
                ) : null}
              </span>
              <span className="text-ink-muted">
                {invoice.description} · {when.format(invoice.periodStart)} to{" "}
                {when.format(invoice.periodEnd)}
              </span>
              <span className="text-ink-muted">
                {invoice.status === "paid" && invoice.paidAt
                  ? `Paid ${when.format(invoice.paidAt)}${invoice.method ? ` by ${BILLING_METHOD_LABELS[invoice.method as keyof typeof BILLING_METHOD_LABELS] ?? invoice.method}` : ""}${invoice.reference ? ` (${invoice.reference})` : ""}`
                  : `Due ${when.format(invoice.dueAt)}`}
              </span>
            </div>
            <span className="flex items-center gap-3">
              <span className="text-lg font-semibold tabular-nums">
                {formatMoney(invoice.amount, invoice.currency)}
              </span>
              <InvoiceStatus invoice={invoice} />
            </span>
          </div>
          {invoice.status === "open" ? (
            <div className="grid gap-3 rounded-card bg-surface-muted p-3 sm:grid-cols-[1fr_auto]">
              <ActionForm
                action={markInvoicePaidAction}
                submitLabel="Record payment"
                testId={`pay-${invoice.number}`}
              >
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="tenantId" value={invoice.tenantId} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Paid by"
                    name="method"
                    id={`method-${invoice.id}`}
                    options={METHODS}
                    defaultValue="whish"
                  />
                  <TextField
                    label="Reference (optional)"
                    name="reference"
                    id={`reference-${invoice.id}`}
                    maxLength={200}
                    hint="e.g. the transfer number"
                  />
                </div>
              </ActionForm>
              <ActionForm
                action={voidInvoiceAction}
                submitLabel="Cancel invoice"
                submitTone="secondary"
                testId={`void-${invoice.number}`}
              >
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="tenantId" value={invoice.tenantId} />
              </ActionForm>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
