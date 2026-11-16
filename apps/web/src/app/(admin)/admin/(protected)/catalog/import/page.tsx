import { listProductImports, MAX_IMPORT_ROWS, MAX_PICTURES_PER_PRODUCT } from "@ecom/core";
import { buttonClasses, Card, inputClasses, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm } from "../../../_components/form";
import { checkImportAction } from "./actions";

export const metadata: Metadata = { title: "Import products" };

const STATUS = { checked: "Checked, not imported", imported: "Imported", discarded: "Discarded" };

export default async function ImportPage() {
  const { context } = await requirePermission("catalog.write");
  const recent = await listProductImports(tenantDb(context), context);
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import products"
        description={
          <>
            Add many products at once from a spreadsheet.{" "}
            <Link href="/admin/catalog/products" className="underline underline-offset-4">
              Back to products
            </Link>
          </>
        }
      />

      <Card title="1. Download the template">
        <p className="text-sm">
          An Excel file made for your store. The Category and Brand columns are dropdowns of the
          categories and brands you already have. To use a new one, add it under{" "}
          <Link href="/admin/catalog/categories" className="underline underline-offset-4">
            Categories
          </Link>{" "}
          or{" "}
          <Link href="/admin/catalog/brands" className="underline underline-offset-4">
            Brands
          </Link>{" "}
          first, then download the template again.
        </p>
        <a
          href="/api/v1/admin/catalog/import-template"
          className={`${buttonClasses("secondary")} w-fit`}
          data-testid="download-template"
        >
          Download the template (.xlsx)
        </a>
      </Card>

      <Card title="2. Fill it in">
        <ul className="list-disc pl-5 text-sm">
          <li>
            One row per product; for several colours or sizes, one row each with the same product
            name.
          </li>
          <li>Product name, SKU and Price on every row. SKUs must be new.</li>
          <li>
            Picture links: web addresses (https://…), separated by commas, up to{" "}
            {MAX_PICTURES_PER_PRODUCT} per product.
          </li>
          <li>Stock: how many you have now, or empty if you do not count it.</li>
          <li>Up to {MAX_IMPORT_ROWS} rows per file. CSV files work too (without dropdowns).</li>
        </ul>
      </Card>

      <Card title="3. Upload it to check">
        <ActionForm action={checkImportAction} submitLabel="Check file" testId="import-form">
          <div className="flex flex-col gap-1">
            <label htmlFor="import-file" className="text-sm font-medium">
              Spreadsheet
            </label>
            <input
              id="import-file"
              name="file"
              type="file"
              required
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className={`${inputClasses} py-2`}
              aria-describedby="import-file-hint"
            />
            <p id="import-file-hint" className="text-sm text-ink-muted">
              Every row is checked first. Nothing is added until you press Import on the next page.
            </p>
          </div>
        </ActionForm>
      </Card>

      {recent.length > 0 ? (
        <Card title="Recent imports">
          <List testId="import-list">
            {recent.map((item) => (
              <ListItem key={item.id}>
                <Link
                  href={`/admin/catalog/import/${item.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {item.fileName}
                </Link>
                <span className="text-sm text-ink-muted">
                  {item.productCount} products · {STATUS[item.status]} ·{" "}
                  {when.format(item.importedAt ?? item.createdAt)}
                </span>
              </ListItem>
            ))}
          </List>
        </Card>
      ) : null}
    </div>
  );
}
