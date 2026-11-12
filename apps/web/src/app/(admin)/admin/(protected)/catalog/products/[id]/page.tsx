import {
  formatMoney,
  getProduct,
  hasPermission,
  listBrands,
  listCategories,
  listProductImages,
  type ProductStatusValue,
} from "@ecom/core";
import {
  Badge,
  buttonClasses,
  Card,
  EmptyState,
  List,
  ListItem,
  PageHeader,
  type BadgeTone,
} from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { categoryOptions, orNotFound } from "@/server/catalog-forms";
import {
  ActionForm,
  CheckboxField,
  SelectField,
  TextAreaField,
  TextField,
} from "../../../../_components/form";
import { ProductImages } from "../../_components/product-images";
import { setProductStatusAction, updateProductAction } from "../../actions";

export const metadata: Metadata = { title: "Product" };

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
const STATUS_HELP: Record<ProductStatusValue, string> = {
  draft: "Not visible to shoppers.",
  active: "Visible to shoppers once the storefront is live.",
  archived: "Withdrawn from sale and hidden from shoppers.",
};

/** The status changes offered from each status. */
const NEXT_STATUS: Record<ProductStatusValue, { status: ProductStatusValue; label: string }[]> = {
  draft: [
    { status: "active", label: "Publish" },
    { status: "archived", label: "Archive" },
  ],
  active: [
    { status: "draft", label: "Unpublish" },
    { status: "archived", label: "Archive" },
  ],
  archived: [{ status: "draft", label: "Restore as draft" }],
};

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("catalog.read");
  const { id } = await params;
  const db = tenantDb(context);
  const product = await orNotFound(getProduct(db, context, id));
  const [categories, brands, images] = await Promise.all([
    listCategories(db, context),
    listBrands(db, context),
    listProductImages(db, context, id),
  ]);
  const canWrite = hasPermission(context, "catalog.write");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={product.name}
        description={
          <Link href="/admin/catalog/products" className="underline underline-offset-4">
            Back to products
          </Link>
        }
      />

      <Card title="Status" description={STATUS_HELP[product.status]}>
        <div>
          <span data-testid="product-status">
            <Badge tone={STATUS_TONE[product.status]}>{STATUS_LABEL[product.status]}</Badge>
          </span>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap items-start gap-3">
            {NEXT_STATUS[product.status].map((next) => (
              <ActionForm
                key={next.status}
                action={setProductStatusAction}
                submitLabel={next.label}
                submitTone={next.status === "active" ? "primary" : "secondary"}
              >
                <input type="hidden" name="id" value={product.id} />
                <input type="hidden" name="status" value={next.status} />
              </ActionForm>
            ))}
          </div>
        ) : null}
      </Card>

      <ProductImages
        productId={product.id}
        images={images}
        variants={product.variants}
        canWrite={canWrite}
      />

      <Card
        title="Variants"
        description="Each variant is one thing you sell: its own SKU and price."
      >
        {product.variants.length === 0 ? (
          <EmptyState title="No variants yet">
            A product needs at least one variant with a price before it can be published.
          </EmptyState>
        ) : (
          <List testId="variant-list">
            {product.variants.map((variant) => (
              <ListItem key={variant.id} testId="variant-row">
                <div className="min-w-0">
                  <p className="truncate font-medium">{variant.sku}</p>
                  <p className="truncate text-sm text-ink-muted">
                    {[variant.color, variant.size].filter(Boolean).join(" · ") || "No options"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  {variant.discountPriceAmount !== null ? (
                    <span>
                      <span className="font-medium">
                        {formatMoney(variant.discountPriceAmount, variant.currency)}
                      </span>{" "}
                      <s className="text-ink-muted">
                        {formatMoney(variant.priceAmount, variant.currency)}
                      </s>
                    </span>
                  ) : (
                    <span className="font-medium">
                      {formatMoney(variant.priceAmount, variant.currency)}
                    </span>
                  )}
                  {variant.status === "inactive" ? (
                    <Badge tone="warning">Not for sale</Badge>
                  ) : null}
                  {canWrite ? (
                    <Link
                      href={`/admin/catalog/products/${product.id}/variants/${variant.id}`}
                      className="underline underline-offset-4"
                    >
                      Edit<span className="sr-only"> {variant.sku}</span>
                    </Link>
                  ) : null}
                </div>
              </ListItem>
            ))}
          </List>
        )}
        {canWrite ? (
          <div>
            <Link
              href={`/admin/catalog/products/${product.id}/variants/new`}
              className={buttonClasses("secondary")}
            >
              Add variant
            </Link>
          </div>
        ) : null}
      </Card>

      <Card title="Details">
        <ActionForm
          action={updateProductAction}
          submitLabel="Save details"
          readOnly={!canWrite}
          testId="product-details"
        >
          <input type="hidden" name="id" value={product.id} />
          <TextField
            label="Name"
            name="name"
            required
            maxLength={200}
            defaultValue={product.name}
          />
          <TextField
            label="URL name"
            name="slug"
            hint="Lowercase letters, digits and hyphens. Changing it changes the product's web address."
            maxLength={120}
            defaultValue={product.slug}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Category"
              name="categoryId"
              defaultValue={product.categoryId ?? ""}
              options={categoryOptions(categories, "No category")}
            />
            <SelectField
              label="Brand"
              name="brandId"
              defaultValue={product.brandId ?? ""}
              options={[
                { value: "", label: "No brand" },
                ...brands.map((brand) => ({ value: brand.id, label: brand.name })),
              ]}
            />
          </div>
          <TextField
            label="Short description"
            name="shortDescription"
            hint="One or two sentences shown in product lists."
            maxLength={500}
            defaultValue={product.shortDescription}
          />
          <TextAreaField
            label="Description"
            name="description"
            rows={6}
            defaultValue={product.description}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Material"
              name="material"
              maxLength={200}
              defaultValue={product.material ?? ""}
            />
            <TextField
              label="Audience tags"
              name="audienceTags"
              hint="Separated by commas, for example: women, gift"
              defaultValue={product.audienceTags.join(", ")}
            />
          </div>
          <TextAreaField
            label="Care information"
            name="careInfo"
            rows={3}
            defaultValue={product.careInfo ?? ""}
          />
          <TextAreaField
            label="Specifications"
            name="specifications"
            rows={4}
            hint="One per line, written as Name: value. For example: Strap length: 60 cm"
            defaultValue={product.attributes.map((a) => `${a.key}: ${a.value}`).join("\n")}
          />
          <fieldset className="flex flex-col">
            <legend className="text-sm font-medium">Merchandising</legend>
            <CheckboxField label="Featured" name="isFeatured" defaultChecked={product.isFeatured} />
            <CheckboxField
              label="New arrival"
              name="isNewArrival"
              defaultChecked={product.isNewArrival}
            />
            <CheckboxField
              label="Best seller"
              name="isBestSeller"
              defaultChecked={product.isBestSeller}
              hint="Only tick this when it is true: shoppers will see the label."
            />
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Search engine title"
              name="seoTitle"
              hint="Optional. The product name is used when empty."
              maxLength={200}
              defaultValue={product.seoTitle ?? ""}
            />
            <TextField
              label="Tax class"
              name="taxClass"
              hint="Optional. Used when tax rules are set up."
              maxLength={60}
              defaultValue={product.taxClass ?? ""}
            />
          </div>
          <TextAreaField
            label="Search engine description"
            name="seoDescription"
            rows={2}
            maxLength={500}
            defaultValue={product.seoDescription ?? ""}
          />
        </ActionForm>
      </Card>
    </div>
  );
}
