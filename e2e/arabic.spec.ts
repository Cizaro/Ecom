import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createProduct, exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// The Arabic shop: English is the default; a shopper switches to Arabic in
// the header, the page turns right to left, shop wording, product names and
// messages are Arabic, and the choice is kept until they switch back.

test("a shopper switches the shop to Arabic and back", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const categoryName = `Arabic ${tag}`;
  const name = `Cedar Tote ${tag}`;
  const arabicName = `حقيبة الأرز ${tag}`;

  // The owner writes the product's Arabic name.
  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(categoryName);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  const productAdmin = await createProduct(page, {
    name,
    category: categoryName,
    sku: `AR-${tag.toUpperCase()}`,
    color: "Black",
    price: "40.00",
    publish: true,
  });
  await page.goto(productAdmin);
  const arabicForm = page.getByTestId("product-arabic-form");
  await arabicForm.getByLabel(/Name/).fill(arabicName);
  await arabicForm.getByRole("button", { name: "Save Arabic" }).click();
  await expect(arabicForm.getByTestId("form-notice")).toHaveText("Arabic wording saved.");

  // A shopper sees the English shop first.
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  await shopper.goto(`/p/cedar-tote-${tag}`);
  await expect(shopper.locator("html")).toHaveAttribute("lang", "en");
  await expect(shopper.getByRole("heading", { level: 1 })).toHaveText(name);

  // Switching to Arabic keeps them on the same page.
  await shopper.getByTestId("language-switch").click();
  await expect(shopper.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(shopper.locator("html")).toHaveAttribute("lang", "ar");
  await expect(shopper).toHaveURL(new RegExp(`/p/cedar-tote-${tag}$`));
  await expect(shopper.getByRole("heading", { level: 1 })).toHaveText(arabicName);
  await expect(shopper.getByRole("button", { name: "أضف إلى السلة" })).toBeVisible();
  await expect(shopper.getByTestId("price")).toContainText("$40.00");

  // Messages from the shop come back in Arabic.
  await shopper.getByRole("button", { name: "أضف إلى السلة" }).click();
  await expect(shopper.getByTestId("cart-notice")).toHaveText("أُضيفت إلى سلتك.");

  // The choice is kept on other pages.
  await shopper.goto("/cart");
  await expect(shopper.getByRole("heading", { level: 1 })).toHaveText("سلتك");
  await expect(shopper.getByTestId("cart")).toContainText(arabicName);

  // And switching back returns to English.
  await shopper.getByTestId("language-switch").click();
  await expect(shopper.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(shopper.getByRole("heading", { level: 1 })).toHaveText("Your cart");
  await expect(shopper.getByTestId("cart")).toContainText(name);
  await shopperContext.close();
});
