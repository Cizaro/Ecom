import { getBrand, getBrandLogo } from "@ecom/core";
import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm, DangerForm, TextField } from "../../../../_components/form";
import { SingleImage } from "../../_components/single-image";
import {
  deleteBrandAction,
  removeBrandLogoAction,
  setBrandLogoAction,
  updateBrandAction,
} from "../../actions";

export const metadata: Metadata = { title: "Edit brand" };

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("catalog.write");
  const { id } = await params;
  const db = tenantDb(context);
  const brand = await orNotFound(getBrand(db, context, id));
  const logo = await getBrandLogo(db, context, id);

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
      <SingleImage
        title="Logo"
        description="A logo with a transparent background (PNG) works best."
        noun="logo"
        id={brand.id}
        image={logo}
        alt={`${brand.name} logo`}
        setAction={setBrandLogoAction}
        removeAction={removeBrandLogoAction}
      />
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
