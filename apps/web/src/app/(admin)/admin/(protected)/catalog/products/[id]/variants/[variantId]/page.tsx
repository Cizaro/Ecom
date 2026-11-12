import { getVariant } from "@ecom/core";
import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm, DangerForm } from "../../../../../../_components/form";
import { VariantFields } from "../../../../_components/variant-fields";
import { deleteVariantAction, updateVariantAction } from "../../../../actions";

export const metadata: Metadata = { title: "Edit variant" };

export default async function VariantPage({
  params,
}: {
  params: Promise<{ id: string; variantId: string }>;
}) {
  const { context } = await requirePermission("catalog.write");
  const { id, variantId } = await params;
  const variant = await orNotFound(getVariant(tenantDb(context), context, variantId));
  if (variant.productId !== id) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Variant ${variant.sku}`}
        description={
          <>
            Of{" "}
            <Link
              href={`/admin/catalog/products/${variant.productId}`}
              className="underline underline-offset-4"
            >
              {variant.productName}
            </Link>
          </>
        }
      />
      <Card>
        <ActionForm action={updateVariantAction} submitLabel="Save variant">
          <input type="hidden" name="id" value={variant.id} />
          <VariantFields currency={variant.currency} variant={variant} />
        </ActionForm>
      </Card>
      <Card title="Delete this variant" description="This cannot be undone.">
        <DangerForm
          action={deleteVariantAction}
          submitLabel="Delete variant"
          confirmMessage={`Delete variant ${variant.sku}? This cannot be undone.`}
        >
          <input type="hidden" name="id" value={variant.id} />
        </DangerForm>
      </Card>
    </div>
  );
}
