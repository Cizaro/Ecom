import { hasPermission, listBrands } from "@ecom/core";
import { Card, EmptyState, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm, TextField } from "../../../_components/form";
import { createBrandAction } from "../actions";

export const metadata: Metadata = { title: "Brands" };

export default async function BrandsPage() {
  const { context } = await requirePermission("catalog.read");
  const brands = await listBrands(tenantDb(context), context);
  const canWrite = hasPermission(context, "catalog.write");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Brands" description="The makers of the products you sell." />

      {brands.length === 0 ? (
        <EmptyState title="No brands yet" />
      ) : (
        <List testId="brand-list">
          {brands.map((brand) => (
            <ListItem key={brand.id} testId="brand-row">
              <div className="min-w-0">
                <p className="truncate font-medium">{brand.name}</p>
                <p className="truncate text-sm text-ink-muted">/{brand.slug}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
                <span>
                  {brand.productCount} {brand.productCount === 1 ? "product" : "products"}
                </span>
                {canWrite ? (
                  <Link
                    href={`/admin/catalog/brands/${brand.id}`}
                    className="text-ink underline underline-offset-4"
                  >
                    Edit<span className="sr-only"> {brand.name}</span>
                  </Link>
                ) : null}
              </div>
            </ListItem>
          ))}
        </List>
      )}

      {canWrite ? (
        <Card title="Add a brand">
          <ActionForm action={createBrandAction} submitLabel="Add brand">
            <TextField label="Name" name="name" required maxLength={200} />
            <TextField
              label="URL name"
              name="slug"
              hint="Optional. Left empty, it is made from the name."
              maxLength={120}
            />
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
