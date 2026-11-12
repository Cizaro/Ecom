import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { OTHER_OWNER_EMAIL, roleEmail } from "./users";

// The catalog from a staff member's point of view: an owner builds a product
// from nothing to published; a read-only role can look but not change; a
// member of another store cannot see it at all.

const password = () => process.env.E2E_PASSWORD!;

async function signIn(page: Page, email: string) {
  await page.goto("/admin/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

const exact = { exact: true } as const;

test("an owner builds and publishes a product; others are kept to their access", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  // Both browser projects work in the same test store, so names are unique per run.
  const tag = `${testInfo.project.name}-${randomUUID().slice(0, 6)}`;
  const categoryName = `Bags ${tag}`;
  const brandName = `Maker ${tag}`;
  const productName = `Tote ${tag}`;
  const sku = `TOTE-${tag}`.toUpperCase();

  await signIn(page, roleEmail("store_owner"));

  // Category and brand.
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(categoryName);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  await expect(page.getByTestId("category-row").filter({ hasText: categoryName })).toBeVisible();

  // The same name again is refused, and what was typed is kept.
  await page.getByLabel("Name", exact).fill(categoryName);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-error")).toContainText("already uses this URL name");
  await expect(page.getByLabel("Name", exact)).toHaveValue(categoryName);

  await page.goto("/admin/catalog/brands");
  await page.getByLabel("Name", exact).fill(brandName);
  await page.getByRole("button", { name: "Add brand" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Brand added.");

  // A draft product.
  await page.goto("/admin/catalog/products");
  await page.getByRole("link", { name: "Add product" }).click();
  await expect(page.getByRole("heading", { name: "Add product" })).toBeVisible();
  await page.getByLabel("Name", exact).fill(productName);
  await page.getByLabel("Category", exact).selectOption({ label: categoryName });
  await page.getByLabel("Brand", exact).selectOption({ label: brandName });
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { name: productName })).toBeVisible();
  await expect(page.getByTestId("product-status")).toHaveText("Draft");
  const productUrl = page.url();

  // Nothing to sell yet, so it cannot be published.
  await page.getByRole("button", { name: "Publish", ...exact }).click();
  await expect(page.getByTestId("form-error")).toContainText("at least one active variant");
  await expect(page.getByTestId("product-status")).toHaveText("Draft");

  // A variant: an impossible sale price is refused and the form keeps its values.
  await page.getByRole("link", { name: "Add variant" }).click();
  await expect(page.getByRole("heading", { name: "Add variant" })).toBeVisible();
  await page.getByLabel("SKU", exact).fill(sku);
  await page.getByLabel("Color", exact).fill("Black");
  await page.getByLabel("Price (USD)", exact).fill("49.90");
  await page.getByLabel("Sale price (USD)", exact).fill("59");
  await page.getByRole("button", { name: "Add variant" }).click();
  await expect(page.getByTestId("form-error")).toContainText("lower than the price");
  await expect(page.getByLabel("SKU", exact)).toHaveValue(sku);
  await expect(page.getByLabel("Price (USD)", exact)).toHaveValue("49.90");

  await page.getByLabel("Sale price (USD)", exact).fill("39.90");
  await page.getByRole("button", { name: "Add variant" }).click();
  await expect(page).toHaveURL(productUrl);
  const variantRow = page.getByTestId("variant-row").filter({ hasText: sku });
  await expect(variantRow).toContainText("$39.90");
  await expect(variantRow).toContainText("$49.90");
  await expect(variantRow).toContainText("Black");

  // Now it can be published.
  await page.getByRole("button", { name: "Publish", ...exact }).click();
  await expect(page.getByTestId("product-status")).toHaveText("Published");

  // Details are saved and survive a reload.
  const details = page.getByTestId("product-details");
  await details.getByLabel("Short description").fill("Roomy everyday tote.");
  await details.getByLabel("Specifications").fill("Strap length: 60 cm\nClosure: Zip");
  await details.getByLabel("Featured").check();
  await details.getByRole("button", { name: "Save details" }).click();
  await expect(details.getByTestId("form-notice")).toHaveText("Saved.");
  await page.reload();
  await expect(details.getByLabel("Short description")).toHaveValue("Roomy everyday tote.");
  await expect(details.getByLabel("Specifications")).toHaveValue(
    "Strap length: 60 cm\nClosure: Zip",
  );
  await expect(details.getByLabel("Featured")).toBeChecked();
  await expect(details.getByLabel("Best seller")).not.toBeChecked();
  await expect(details.getByLabel("Category", exact)).toHaveValue(/.+/);

  // The list finds it by SKU.
  await page.goto("/admin/catalog/products");
  await page.getByLabel("Search").fill(sku.toLowerCase());
  await page.getByRole("button", { name: "Filter" }).click();
  const row = page.getByTestId("product-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(productName);
  await expect(row).toContainText("Published");
  await expect(row).toContainText(categoryName);

  // A marketer can read the catalog but not change it.
  const marketerContext = await browser.newContext();
  const marketer = await marketerContext.newPage();
  await signIn(marketer, roleEmail("marketer"));
  expect((await marketer.goto(productUrl))?.status()).toBe(200);
  await expect(marketer.getByRole("heading", { name: productName })).toBeVisible();
  await expect(marketer.getByTestId("product-details").getByLabel("Name", exact)).toBeDisabled();
  await expect(marketer.getByRole("button", { name: "Save details" })).toHaveCount(0);
  await expect(marketer.getByRole("button", { name: "Archive" })).toHaveCount(0);
  await expect(marketer.getByRole("link", { name: "Add variant" })).toHaveCount(0);
  expect((await marketer.goto(`${productUrl}/variants/new`))?.status()).toBe(403);
  expect((await marketer.goto("/admin/catalog/products/new"))?.status()).toBe(403);
  await marketer.goto("/admin/catalog/categories");
  await expect(
    marketer.getByTestId("category-row").filter({ hasText: categoryName }),
  ).toBeVisible();
  await expect(marketer.getByRole("button", { name: "Add category" })).toHaveCount(0);
  await marketerContext.close();

  // The owner of another store cannot find it, even with the address.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other, OTHER_OWNER_EMAIL);
  expect((await other.goto(productUrl))?.status()).toBe(404);
  expect((await other.goto(`${productUrl}/variants/new`))?.status()).toBe(404);
  await other.goto("/admin/catalog/products");
  await expect(other.getByText(productName)).toHaveCount(0);
  await other.goto("/admin/catalog/categories");
  await expect(other.getByText(categoryName)).toHaveCount(0);
  await otherContext.close();
});
