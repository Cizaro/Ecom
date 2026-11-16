import { getCatalogCurrency, getProduct, hasPermission } from "@ecom/core";
import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm, TextField } from "../../../../../../_components/form";
import { VariantFields } from "../../../../_components/variant-fields";
import { addVariantAction } from "../../../../actions";

export const metadata: Metadata = { title: "Add variant" };

export default async function NewVariantPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("catalog.write");
  const { id } = await params;
  const db = tenantDb(context);
  const product = await orNotFound(getProduct(db, context, id));
  const currency = await getCatalogCurrency(db, context);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Add variant"
        description={
          <>
            For{" "}
            <Link
              href={`/admin/catalog/products/${product.id}`}
              className="underline underline-offset-4"
            >
              {product.name}
            </Link>
          </>
        }
      />
      <Card>
        <ActionForm action={addVariantAction} submitLabel="Add variant">
          <input type="hidden" name="productId" value={product.id} />
          <VariantFields currency={currency} />
          {hasPermission(context, "inventory.adjust") ? (
            <TextField
              label="Opening stock"
              name="openingStock"
              inputMode="numeric"
              hint="How many you have now, at the default location. Leave empty for none: shoppers will see it as out of stock until stock is received."
            />
          ) : (
            <p className="text-sm text-ink-muted">
              Stock for this variant is counted. Someone with stock access can receive it.
            </p>
          )}
        </ActionForm>
      </Card>
    </div>
  );
}
