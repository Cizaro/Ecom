import {
  formatMoney,
  hasPermission,
  listProducts,
  PRODUCT_STATUSES,
  type ProductStatusValue,
} from "@ecom/core";
import {
  Badge,
  buttonClasses,
  EmptyState,
  Field,
  List,
  ListItem,
  PageHeader,
  Select,
  type BadgeTone,
} from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { viewOf } from "@/server/media";
import { MediaImage } from "../../../_components/media-image";

export const metadata: Metadata = { title: "Products" };

const STATUS_LABEL: Record<ProductStatusValue, string> = {
  draft: "Draft",
  active: "Published",
  archived: "Archived",
};
const STATUS_TONE: Record<ProductStatusValue, BadgeTone> = {
  draft: "neutral",
  active: "success",
  archived: "warning",
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requirePermission("catalog.read");
  const params = await searchParams;
  const search = (first(params.q) ?? "").slice(0, 100);
  const status = PRODUCT_STATUSES.find((value) => value === first(params.status));
  const page = Math.min(10_000, Math.max(1, Number.parseInt(first(params.page) ?? "1", 10) || 1));

  const result = await listProducts(tenantDb(context), context, { search, status, page });
  const canWrite = hasPermission(context, "catalog.write");
  const filtered = search !== "" || status !== undefined;

  const pageLink = (target: number) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (status) query.set("status", status);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/admin/catalog/products?${text}` : "/admin/catalog/products";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products"
        description={`${result.total} ${result.total === 1 ? "product" : "products"}${filtered ? " match" : ""} in ${context.tenantName}.`}
        actions={
          canWrite ? (
            <Link href="/admin/catalog/products/new" className={buttonClasses()}>
              Add product
            </Link>
          ) : null
        }
      />

      <form method="get" className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <Field
          label="Search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Name or SKU"
        />
        <Select
          label="Status"
          name="status"
          defaultValue={status ?? ""}
          options={[
            { value: "", label: "Any status" },
            ...PRODUCT_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] })),
          ]}
        />
        <button type="submit" className={buttonClasses("secondary")}>
          Filter
        </button>
      </form>

      {result.items.length === 0 ? (
        <EmptyState title={filtered ? "No products match" : "No products yet"}>
          {filtered ? (
            <Link href="/admin/catalog/products" className="underline underline-offset-4">
              Clear the filter
            </Link>
          ) : canWrite ? (
            "Add your first product to start building the catalog."
          ) : null}
        </EmptyState>
      ) : (
        <List testId="product-list">
          {result.items.map((product) => (
            <ListItem key={product.id} testId="product-row">
              <div className="flex min-w-0 items-center gap-3">
                {product.mainImage ? (
                  <MediaImage
                    image={viewOf(product.mainImage)}
                    alt=""
                    sizes="48px"
                    className="size-12 shrink-0 rounded-control border border-line"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="size-12 shrink-0 rounded-control border border-dashed border-line-strong bg-surface-muted"
                  />
                )}
                <div className="min-w-0">
                  <Link
                    href={`/admin/catalog/products/${product.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {product.name}
                  </Link>
                  <p className="truncate text-sm text-ink-muted">
                    {[product.categoryName ?? "No category", product.brandName]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
                <span>
                  {product.variantCount} {product.variantCount === 1 ? "variant" : "variants"}
                </span>
                {product.priceFrom ? (
                  <span>
                    {product.variantCount > 1 ? "from " : ""}
                    {formatMoney(product.priceFrom.amount, product.priceFrom.currency)}
                  </span>
                ) : null}
                <Badge tone={STATUS_TONE[product.status]}>{STATUS_LABEL[product.status]}</Badge>
              </div>
            </ListItem>
          ))}
        </List>
      )}

      {result.pageCount > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
          {result.page > 1 ? (
            <Link href={pageLink(result.page - 1)} className={buttonClasses("secondary")}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-muted">
            Page {result.page} of {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Link href={pageLink(result.page + 1)} className={buttonClasses("secondary")}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
