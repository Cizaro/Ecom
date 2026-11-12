import { getCategory, listCategories } from "@ecom/core";
import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { categoryOptions, orNotFound } from "@/server/catalog-forms";
import {
  ActionForm,
  DangerForm,
  SelectField,
  TextAreaField,
  TextField,
} from "../../../../_components/form";
import { deleteCategoryAction, updateCategoryAction } from "../../actions";

export const metadata: Metadata = { title: "Edit category" };

export default async function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("catalog.write");
  const { id } = await params;
  const db = tenantDb(context);
  const category = await orNotFound(getCategory(db, context, id));
  const categories = await listCategories(db, context);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={category.name}
        description={
          <Link href="/admin/catalog/categories" className="underline underline-offset-4">
            Back to categories
          </Link>
        }
      />
      <Card>
        <ActionForm action={updateCategoryAction} submitLabel="Save category">
          <input type="hidden" name="id" value={category.id} />
          <TextField
            label="Name"
            name="name"
            required
            maxLength={200}
            defaultValue={category.name}
          />
          <TextField
            label="URL name"
            name="slug"
            hint="Lowercase letters, digits and hyphens. Changing it changes the category's web address."
            maxLength={120}
            defaultValue={category.slug}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Inside"
              name="parentId"
              defaultValue={category.parentId ?? ""}
              options={categoryOptions(categories, "Top level", category.id)}
            />
            <TextField
              label="Position"
              name="position"
              inputMode="numeric"
              hint="Lower numbers come first."
              defaultValue={String(category.position)}
            />
          </div>
          <TextAreaField
            label="Description"
            name="description"
            rows={3}
            defaultValue={category.description}
          />
          <TextField
            label="Search engine title"
            name="seoTitle"
            maxLength={200}
            defaultValue={category.seoTitle ?? ""}
          />
          <TextAreaField
            label="Search engine description"
            name="seoDescription"
            rows={2}
            maxLength={500}
            defaultValue={category.seoDescription ?? ""}
          />
        </ActionForm>
      </Card>
      <Card
        title="Delete this category"
        description="Its products are kept and become uncategorised. This cannot be undone."
      >
        <DangerForm
          action={deleteCategoryAction}
          submitLabel="Delete category"
          confirmMessage={`Delete the category "${category.name}"? This cannot be undone.`}
        >
          <input type="hidden" name="id" value={category.id} />
        </DangerForm>
      </Card>
    </div>
  );
}
