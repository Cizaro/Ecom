import { getVariantStock, hasPermission } from "@ecom/core";
import { Card, EmptyState, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm, SelectField, TextField } from "../../../_components/form";
import { changeStockAction, setTrackingAction } from "../actions";
import { StockBadge } from "../_components/stock-badge";

export const metadata: Metadata = { title: "Item stock" };

const REASONS: Record<string, string> = {
  purchase: "Received",
  sale: "Sold",
  return: "Returned",
  adjustment: "Count",
  damage: "Damaged",
  reservation: "Held for checkout",
  release: "Hold released",
};
const BUCKETS: Record<string, string> = {
  on_hand: "on hand",
  reserved: "held",
  damaged: "damaged",
};

export default async function VariantStockPage({
  params,
}: {
  params: Promise<{ variantId: string }>;
}) {
  const { context } = await requirePermission("inventory.read");
  const { variantId } = await params;
  const stock = await orNotFound(getVariantStock(tenantDb(context), context, variantId));
  const canAdjust = hasPermission(context, "inventory.adjust");
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
  const options = [stock.color, stock.size].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={stock.productName}
        description={
          <>
            {stock.sku}
            {options ? ` · ${options}` : ""} ·{" "}
            <Link
              href={`/admin/catalog/products/${stock.productId}`}
              className="underline underline-offset-4"
            >
              Product
            </Link>{" "}
            ·{" "}
            <Link href="/admin/inventory" className="underline underline-offset-4">
              All stock
            </Link>
          </>
        }
      />

      <Card
        title="Stock"
        description={
          stock.tracked
            ? `Shoppers see "only a few left" at ${stock.lowThreshold} or fewer.`
            : "Stock is not counted: this item is sold without a stock check."
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <span data-testid="variant-stock-status">
            <StockBadge status={stock.status} />
          </span>
          {stock.tracked ? (
            <span className="text-sm text-ink-muted" data-testid="variant-stock-totals">
              {stock.totals.available} available · {stock.totals.onHand} on hand ·{" "}
              {stock.totals.reserved} held · {stock.totals.damaged} damaged
            </span>
          ) : null}
        </div>
        {stock.tracked ? (
          <table className="w-full text-left text-sm" data-testid="stock-levels">
            <thead className="text-ink-muted">
              <tr>
                <th className="py-2 font-medium">Location</th>
                <th className="py-2 font-medium">Available</th>
                <th className="py-2 font-medium">On hand</th>
                <th className="hidden py-2 font-medium sm:table-cell">Held</th>
                <th className="hidden py-2 font-medium sm:table-cell">Damaged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {stock.levels.map((level) => (
                <tr key={level.locationId}>
                  <td className="py-2">
                    {level.name}
                    {level.isDefault ? <span className="text-ink-muted"> (default)</span> : null}
                  </td>
                  <td className="py-2">{level.available}</td>
                  <td className="py-2">{level.onHand}</td>
                  <td className="hidden py-2 sm:table-cell">{level.reserved}</td>
                  <td className="hidden py-2 sm:table-cell">{level.damaged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {canAdjust ? (
          <ActionForm
            action={setTrackingAction}
            submitLabel={stock.tracked ? "Stop counting stock" : "Count stock for this item"}
            submitTone="secondary"
          >
            <input type="hidden" name="variantId" value={stock.variantId} />
            <input type="hidden" name="tracked" value={stock.tracked ? "false" : "true"} />
          </ActionForm>
        ) : null}
      </Card>

      {canAdjust && stock.tracked ? (
        <Card
          title="Change stock"
          description="Every change is kept in the history below with your name and the reason."
        >
          <ActionForm action={changeStockAction} submitLabel="Save change" testId="stock-change">
            <input type="hidden" name="variantId" value={stock.variantId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="What happened"
                name="operation"
                defaultValue="receive"
                options={[
                  { value: "receive", label: "Stock received" },
                  { value: "count", label: "Counted: this many are here" },
                  { value: "damage", label: "Found damaged" },
                  { value: "remove_damaged", label: "Damaged items removed" },
                ]}
              />
              <SelectField
                label="Location"
                name="locationId"
                defaultValue={stock.levels.find((level) => level.isDefault)?.locationId}
                options={stock.levels.map((level) => ({
                  value: level.locationId,
                  label: level.name,
                }))}
              />
            </div>
            <TextField label="Quantity" name="quantity" inputMode="numeric" required />
            <TextField
              label="Note"
              name="note"
              maxLength={500}
              hint="Needed for a count, for example: Monthly stock take."
            />
          </ActionForm>
        </Card>
      ) : null}

      <Card title="History" description="The 50 most recent changes, newest first.">
        {stock.movements.length === 0 ? (
          <EmptyState title="No changes yet" />
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm" data-testid="stock-history">
            {stock.movements.map((movement) => (
              <li
                key={movement.id}
                className="flex flex-wrap justify-between gap-2 py-2"
                data-testid="stock-movement"
              >
                <span>
                  <span className="font-medium">{REASONS[movement.reason] ?? movement.reason}</span>{" "}
                  {movement.quantityDelta > 0 ? "+" : ""}
                  {movement.quantityDelta} {BUCKETS[movement.bucket]} at {movement.locationName}
                  {movement.note ? (
                    <span className="text-ink-muted"> · {movement.note}</span>
                  ) : null}
                </span>
                <span className="text-ink-muted">
                  {movement.actorName ?? "Shop"} · {when.format(movement.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
