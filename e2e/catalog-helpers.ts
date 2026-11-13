import { expect, type Page } from "@playwright/test";
import { makeTestImage } from "../packages/testing/src/images";

// Steps shared by the storefront tests: signing in and preparing products
// through the admin, the way a member of staff would.

const password = () => process.env.E2E_PASSWORD!;
export const exact = { exact: true } as const;

export async function signIn(page: Page, email: string) {
  await page.goto("/admin/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

export interface NewProduct {
  name: string;
  category: string;
  sku: string;
  color: string;
  size?: string;
  price: string;
  salePrice?: string;
  withImage?: boolean;
  publish: boolean;
}

/** Creates a product with one variant and returns the address of its admin page. */
export async function createProduct(page: Page, product: NewProduct): Promise<string> {
  await page.goto("/admin/catalog/products/new");
  await page.getByLabel("Name", exact).fill(product.name);
  await page.getByLabel("Category", exact).selectOption({ label: product.category });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { name: product.name })).toBeVisible();
  const productUrl = page.url();

  await page.getByRole("link", { name: "Add variant" }).click();
  await page.getByLabel("SKU", exact).fill(product.sku);
  await page.getByLabel("Color", exact).fill(product.color);
  if (product.size) await page.getByLabel("Size", exact).fill(product.size);
  await page.getByLabel("Price (USD)", exact).fill(product.price);
  if (product.salePrice) await page.getByLabel("Sale price (USD)", exact).fill(product.salePrice);
  await page.getByRole("button", { name: "Add variant" }).click();
  await expect(page).toHaveURL(productUrl);

  if (product.withImage) {
    const uploader = page.getByTestId("image-uploader");
    await uploader.getByLabel("Add images").setInputFiles({
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: await makeTestImage({ width: 800, height: 1000 }),
    });
    await uploader.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByTestId("upload-notice")).toHaveText("1 image uploaded.");
    const item = page.getByTestId("image-item");
    await item.getByLabel("Description").fill(`${product.name} photo`);
    await item.getByRole("button", { name: "Save image" }).click();
    await expect(item.getByTestId("form-notice")).toHaveText("Saved.");
  }
  if (product.publish) {
    await page.getByRole("button", { name: "Publish", ...exact }).click();
    await expect(page.getByTestId("product-status")).toHaveText("Published");
  }
  return productUrl;
}

/** Adds another variant to a product, given the address of its admin page. */
export async function addVariant(
  page: Page,
  productUrl: string,
  variant: { sku: string; color: string; size?: string; price: string; salePrice?: string },
) {
  await page.goto(`${productUrl}/variants/new`);
  await page.getByLabel("SKU", exact).fill(variant.sku);
  await page.getByLabel("Color", exact).fill(variant.color);
  if (variant.size) await page.getByLabel("Size", exact).fill(variant.size);
  await page.getByLabel("Price (USD)", exact).fill(variant.price);
  if (variant.salePrice) await page.getByLabel("Sale price (USD)", exact).fill(variant.salePrice);
  await page.getByRole("button", { name: "Add variant" }).click();
  await expect(page).toHaveURL(productUrl);
}
