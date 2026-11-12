import { listBrands, listCategories } from "@ecom/core";
import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { categoryOptions } from "@/server/catalog-forms";
import { ActionForm, SelectField, TextField } from "../../../../_components/form";
import { createProductAction } from "../../actions";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  const { context } = await requirePermission("catalog.write");
  const db = tenantDb(context);
  const [categories, brands] = await Promise.all([
    listCategories(db, context),
    listBrands(db, context),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Add product"
        description={
          <>
            The product starts as a draft. You add prices and options on the next screen.{" "}
            <Link href="/admin/catalog/products" className="underline underline-offset-4">
              Back to products
            </Link>
          </>
        }
      />
      <Card>
        <ActionForm action={createProductAction} submitLabel="Create draft">
          <TextField label="Name" name="name" required maxLength={200} />
          <TextField
            label="URL name"
            name="slug"
            hint="Optional. Lowercase letters, digits and hyphens. Left empty, it is made from the name."
            maxLength={120}
          />
          <SelectField
            label="Category"
            name="categoryId"
            options={categoryOptions(categories, "No category")}
          />
          <SelectField
            label="Brand"
            name="brandId"
            options={[
              { value: "", label: "No brand" },
              ...brands.map((brand) => ({ value: brand.id, label: brand.name })),
            ]}
          />
        </ActionForm>
      </Card>
    </div>
  );
}
