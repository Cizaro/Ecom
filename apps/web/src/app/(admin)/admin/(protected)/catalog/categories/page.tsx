import { hasPermission, listCategories } from "@ecom/core";
import { Card, cx, EmptyState, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { categoryOptions } from "@/server/catalog-forms";
import { ActionForm, SelectField, TextField } from "../../../_components/form";
import { createCategoryAction } from "../actions";

export const metadata: Metadata = { title: "Categories" };

// Indentation per tree level (classes, because inline styles are blocked by
// the Content Security Policy).
const INDENT = ["", "ps-5", "ps-10", "ps-14"] as const;

export default async function CategoriesPage() {
  const { context } = await requirePermission("catalog.read");
  const categories = await listCategories(tenantDb(context), context);
  const canWrite = hasPermission(context, "catalog.write");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Categories"
        description="How products are grouped in the store's menus and pages."
      />

      {categories.length === 0 ? (
        <EmptyState title="No categories yet" />
      ) : (
        <List testId="category-list">
          {categories.map((category) => (
            <ListItem key={category.id} testId="category-row">
              <div className={cx("min-w-0", INDENT[Math.min(category.depth, INDENT.length - 1)])}>
                <p className="truncate font-medium">{category.name}</p>
                <p className="truncate text-sm text-ink-muted">/{category.slug}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
                <span>
                  {category.productCount} {category.productCount === 1 ? "product" : "products"}
                </span>
                {canWrite ? (
                  <Link
                    href={`/admin/catalog/categories/${category.id}`}
                    className="text-ink underline underline-offset-4"
                  >
                    Edit<span className="sr-only"> {category.name}</span>
                  </Link>
                ) : null}
              </div>
            </ListItem>
          ))}
        </List>
      )}

      {canWrite ? (
        <Card title="Add a category">
          <ActionForm action={createCategoryAction} submitLabel="Add category">
            <TextField label="Name" name="name" required maxLength={200} />
            <TextField
              label="URL name"
              name="slug"
              hint="Optional. Left empty, it is made from the name."
              maxLength={120}
            />
            <SelectField
              label="Inside"
              name="parentId"
              options={categoryOptions(categories, "Top level")}
            />
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
