"use server";

import {
  addProductImage,
  addVariant,
  createBrand,
  createCategory,
  createProduct,
  deleteBrand,
  deleteCategory,
  deleteVariant,
  getCatalogCurrency,
  getVariant,
  IMAGE_MOVES,
  moveProductImage,
  PRODUCT_STATUSES,
  removeBrandLogo,
  removeCategoryImage,
  removeProductImage,
  setBrandLogo,
  setCategoryImage,
  setProductStatus,
  updateBrand,
  updateCategory,
  updateProduct,
  updateProductImage,
  updateVariant,
  VARIANT_STATUSES,
  type ProductStatusValue,
  type VariantInput,
  type VariantStatusValue,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import {
  attempt,
  echo,
  field,
  moneyField,
  specificationLines,
  tagList,
  wholeNumberField,
} from "@/server/catalog-forms";
import { mediaDeps, uploadedImage } from "@/server/media";
import type { FormState } from "../../actions";

// Server actions for the catalog. Every action checks the permission itself;
// the services check it again and run inside the signed-in user's tenant.

const PRODUCTS = "/admin/catalog/products";
const CATEGORIES = "/admin/catalog/categories";
const BRANDS = "/admin/catalog/brands";

// --- Categories ---------------------------------------------------------------

const CATEGORY_FIELDS = [
  "name",
  "slug",
  "parentId",
  "description",
  "position",
  "seoTitle",
  "seoDescription",
] as const;

function categoryInput(formData: FormData) {
  return {
    name: field(formData, "name"),
    slug: field(formData, "slug"),
    parentId: field(formData, "parentId"),
    description: field(formData, "description"),
    position: field(formData, "position") || "0",
    seoTitle: field(formData, "seoTitle"),
    seoDescription: field(formData, "seoDescription"),
  };
}

export async function createCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const result = await attempt(
    () => createCategory(tenantDb(context), context, categoryInput(formData)),
    echo(formData, CATEGORY_FIELDS),
  );
  if (!result.ok) return result.state;
  revalidatePath(CATEGORIES);
  return { notice: "Category added." };
}

export async function updateCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const result = await attempt(
    () =>
      updateCategory(tenantDb(context), context, field(formData, "id"), categoryInput(formData)),
    echo(formData, CATEGORY_FIELDS),
  );
  if (!result.ok) return result.state;
  revalidatePath(CATEGORIES);
  return { notice: "Saved." };
}

export async function deleteCategoryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const result = await attempt(() =>
    deleteCategory(tenantDb(context), context, field(formData, "id")),
  );
  if (!result.ok) return result.state;
  revalidatePath(CATEGORIES);
  redirect(CATEGORIES);
}

// --- Brands -------------------------------------------------------------------

const BRAND_FIELDS = ["name", "slug"] as const;

export async function createBrandAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const result = await attempt(
    () =>
      createBrand(tenantDb(context), context, {
        name: field(formData, "name"),
        slug: field(formData, "slug"),
      }),
    echo(formData, BRAND_FIELDS),
  );
  if (!result.ok) return result.state;
  revalidatePath(BRANDS);
  return { notice: "Brand added." };
}

export async function updateBrandAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const result = await attempt(
    () =>
      updateBrand(tenantDb(context), context, field(formData, "id"), {
        name: field(formData, "name"),
        slug: field(formData, "slug"),
      }),
    echo(formData, BRAND_FIELDS),
  );
  if (!result.ok) return result.state;
  revalidatePath(BRANDS);
  return { notice: "Saved." };
}

export async function deleteBrandAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const result = await attempt(() =>
    deleteBrand(tenantDb(context), context, field(formData, "id")),
  );
  if (!result.ok) return result.state;
  revalidatePath(BRANDS);
  redirect(BRANDS);
}

// --- Products -----------------------------------------------------------------

const PRODUCT_FIELDS = [
  "name",
  "slug",
  "categoryId",
  "brandId",
  "shortDescription",
  "description",
  "seoTitle",
  "seoDescription",
  "audienceTags",
  "material",
  "careInfo",
  "taxClass",
  "specifications",
  "isFeatured",
  "isNewArrival",
  "isBestSeller",
] as const;

export async function createProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const result = await attempt(
    () =>
      createProduct(tenantDb(context), context, {
        name: field(formData, "name"),
        slug: field(formData, "slug"),
        categoryId: field(formData, "categoryId"),
        brandId: field(formData, "brandId"),
      }),
    echo(formData, PRODUCT_FIELDS),
  );
  if (!result.ok) return result.state;
  revalidatePath(PRODUCTS);
  redirect(`${PRODUCTS}/${result.value.id}`);
}

export async function updateProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const id = field(formData, "id");
  const result = await attempt(
    async () =>
      updateProduct(tenantDb(context), context, id, {
        name: field(formData, "name"),
        slug: field(formData, "slug"),
        categoryId: field(formData, "categoryId"),
        brandId: field(formData, "brandId"),
        shortDescription: field(formData, "shortDescription"),
        description: field(formData, "description"),
        seoTitle: field(formData, "seoTitle"),
        seoDescription: field(formData, "seoDescription"),
        audienceTags: tagList(field(formData, "audienceTags")),
        material: field(formData, "material"),
        careInfo: field(formData, "careInfo"),
        taxClass: field(formData, "taxClass"),
        isFeatured: formData.get("isFeatured") === "on",
        isNewArrival: formData.get("isNewArrival") === "on",
        isBestSeller: formData.get("isBestSeller") === "on",
        attributes: specificationLines(field(formData, "specifications")),
      }),
    echo(formData, PRODUCT_FIELDS),
  );
  if (!result.ok) return result.state;
  revalidatePath(PRODUCTS);
  revalidatePath(`${PRODUCTS}/${id}`);
  return { notice: "Saved." };
}

const STATUS_NOTICE: Record<ProductStatusValue, string> = {
  active: "Published.",
  draft: "Moved back to draft.",
  archived: "Archived.",
};

export async function setProductStatusAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const id = field(formData, "id");
  const requested = field(formData, "status");
  const status = PRODUCT_STATUSES.find((value) => value === requested);
  if (!status) return { error: "Unknown status." };
  const result = await attempt(() => setProductStatus(tenantDb(context), context, id, status));
  if (!result.ok) return result.state;
  revalidatePath(PRODUCTS);
  revalidatePath(`${PRODUCTS}/${id}`);
  return { notice: STATUS_NOTICE[status] };
}

// --- Variants -----------------------------------------------------------------

const VARIANT_FIELDS = [
  "sku",
  "barcode",
  "color",
  "size",
  "price",
  "salePrice",
  "compareAtPrice",
  "cost",
  "weightGrams",
  "lowStockThreshold",
  "status",
] as const;

function variantInput(formData: FormData, currency: string): VariantInput {
  const price = moneyField(formData, "price", "price", currency);
  const requested = field(formData, "status");
  const status: VariantStatusValue =
    VARIANT_STATUSES.find((value) => value === requested) ?? "active";
  return {
    sku: field(formData, "sku"),
    barcode: field(formData, "barcode"),
    color: field(formData, "color"),
    size: field(formData, "size"),
    // A missing price is reported by the service as "Enter the price."
    priceAmount: price as number,
    discountPriceAmount: moneyField(formData, "salePrice", "sale price", currency),
    compareAtAmount: moneyField(formData, "compareAtPrice", "compare-at price", currency),
    costAmount: moneyField(formData, "cost", "cost", currency),
    weightGrams: wholeNumberField(formData, "weightGrams", "The weight"),
    lowStockThreshold: wholeNumberField(formData, "lowStockThreshold", "The low-stock level"),
    status,
  };
}

export async function addVariantAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const productId = field(formData, "productId");
  const db = tenantDb(context);
  const result = await attempt(
    async () =>
      addVariant(
        db,
        context,
        productId,
        variantInput(formData, await getCatalogCurrency(db, context)),
      ),
    echo(formData, VARIANT_FIELDS),
  );
  if (!result.ok) return result.state;
  revalidatePath(`${PRODUCTS}/${productId}`);
  redirect(`${PRODUCTS}/${productId}`);
}

export async function updateVariantAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const id = field(formData, "id");
  const db = tenantDb(context);
  const result = await attempt(
    async () => {
      const variant = await getVariant(db, context, id);
      await updateVariant(db, context, id, variantInput(formData, variant.currency));
      return variant.productId;
    },
    echo(formData, VARIANT_FIELDS),
  );
  if (!result.ok) return result.state;
  revalidatePath(PRODUCTS);
  revalidatePath(`${PRODUCTS}/${result.value}`);
  return { notice: "Saved." };
}

export async function deleteVariantAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const result = await attempt(() =>
    deleteVariant(tenantDb(context), context, field(formData, "id")),
  );
  if (!result.ok) return result.state;
  revalidatePath(PRODUCTS);
  redirect(`${PRODUCTS}/${result.value.productId}`);
}

// --- Images -------------------------------------------------------------------
// One image per request. The file's content, not its name, decides whether it
// is accepted (see packages/core/src/media/image.ts).

export async function uploadProductImageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const productId = field(formData, "productId");
  const result = await attempt(async () =>
    addProductImage(tenantDb(context), context, mediaDeps(), productId, {
      bytes: await uploadedImage(formData),
    }),
  );
  if (!result.ok) return result.state;
  revalidatePath(PRODUCTS);
  revalidatePath(`${PRODUCTS}/${productId}`);
  return { notice: "Image added." };
}

export async function updateProductImageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const result = await attempt(
    () =>
      updateProductImage(tenantDb(context), context, field(formData, "id"), {
        altText: field(formData, "altText"),
        variantId: field(formData, "variantId"),
      }),
    echo(formData, ["altText", "variantId"]),
  );
  if (!result.ok) return result.state;
  revalidatePath(PRODUCTS);
  revalidatePath(`${PRODUCTS}/${result.value.productId}`);
  return { notice: "Saved." };
}

export async function moveProductImageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const requested = field(formData, "move");
  const move = IMAGE_MOVES.find((value) => value === requested);
  if (!move) return { error: "Unknown move." };
  const result = await attempt(() =>
    moveProductImage(tenantDb(context), context, field(formData, "id"), move),
  );
  if (!result.ok) return result.state;
  revalidatePath(PRODUCTS);
  revalidatePath(`${PRODUCTS}/${result.value.productId}`);
  return {};
}

export async function removeProductImageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const result = await attempt(() =>
    removeProductImage(tenantDb(context), context, mediaDeps(), field(formData, "id")),
  );
  if (!result.ok) return result.state;
  revalidatePath(PRODUCTS);
  revalidatePath(`${PRODUCTS}/${result.value.productId}`);
  return {};
}

export async function setCategoryImageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const id = field(formData, "id");
  const result = await attempt(async () =>
    setCategoryImage(tenantDb(context), context, mediaDeps(), id, await uploadedImage(formData)),
  );
  if (!result.ok) return result.state;
  revalidatePath(`${CATEGORIES}/${id}`);
  return { notice: "Image saved." };
}

export async function removeCategoryImageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const id = field(formData, "id");
  const result = await attempt(() =>
    removeCategoryImage(tenantDb(context), context, mediaDeps(), id),
  );
  if (!result.ok) return result.state;
  revalidatePath(`${CATEGORIES}/${id}`);
  return {};
}

export async function setBrandLogoAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const id = field(formData, "id");
  const result = await attempt(async () =>
    setBrandLogo(tenantDb(context), context, mediaDeps(), id, await uploadedImage(formData)),
  );
  if (!result.ok) return result.state;
  revalidatePath(`${BRANDS}/${id}`);
  return { notice: "Logo saved." };
}

export async function removeBrandLogoAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const id = field(formData, "id");
  const result = await attempt(() => removeBrandLogo(tenantDb(context), context, mediaDeps(), id));
  if (!result.ok) return result.state;
  revalidatePath(`${BRANDS}/${id}`);
  return {};
}
