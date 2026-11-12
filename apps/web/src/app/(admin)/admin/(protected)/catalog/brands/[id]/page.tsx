import { getBrand } from "@ecom/core";
import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm, DangerForm, TextField } from "../../../../_components/form";
import { deleteBrandAction, updateBrandAction } from "../../actions";

export const metadata: Metadata = { title: "Edit brand" };

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("catalog.write");
  const { id } = await params;
  const brand = await orNotFound(getBrand(tenantDb(context), context, id));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={brand.name}
        description={
          <Link href="/admin/catalog/brands" className="underline underline-offset-4">
            Back to brands
          </Link>
        }
      />
      <Card>
        <ActionForm action={updateBrandAction} submitLabel="Save brand">
          <input type="hidden" name="id" value={brand.id} />
          <TextField label="Name" name="name" required maxLength={200} defaultValue={brand.name} />
          <TextField
            label="URL name"
            name="slug"
            hint="Lowercase letters, digits and hyphens."
            maxLength={120}
            defaultValue={brand.slug}
          />
        </ActionForm>
      </Card>
      <Card
        title="Delete this brand"
        description="Its products are kept and lose their brand. This cannot be undone."
      >
        <DangerForm
          action={deleteBrandAction}
          submitLabel="Delete brand"
          confirmMessage={`Delete the brand "${brand.name}"? This cannot be undone.`}
        >
          <input type="hidden" name="id" value={brand.id} />
        </DangerForm>
      </Card>
    </div>
  );
}
