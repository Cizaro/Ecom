import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createProduct, exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// Discount codes: staff make one, a shopper applies it at checkout and sees
// the new total before ordering, the order keeps it, and staff see the use.

test("a shopper applies a discount code made by staff; the order keeps it", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const code = `SAVE${tag}`.toUpperCase().replace(/[^A-Z0-9]/g, "");

  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(`Scarves ${tag}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  await createProduct(page, {
    name: `Silk Scarf ${tag}`,
    category: `Scarves ${tag}`,
    sku: `SCARF-${tag}`.toUpperCase(),
    color: "Blue",
    price: "40.00",
    stock: "5",
    publish: true,
  });

  // --- Staff make a code, after a mistake -----------------------------------------
  await page.goto("/admin");
  await page.getByRole("link", { name: "Discount codes" }).first().click();
  const create = page.getByTestId("code-create-form");
  await create.getByLabel("Code").fill(code);
  await create.getByLabel("Gives").selectOption("percent");
  await create.getByLabel(/Percent or amount/).fill("150");
  await create.getByRole("button", { name: "Add code" }).click();
  await expect(create.getByTestId("form-error")).toContainText("from 1 to 100");
  await create.getByLabel(/Percent or amount/).fill("25");
  await create.getByLabel(/Minimum order/).fill("30");
  await create.getByRole("button", { name: "Add code" }).click();
  await expect(create.getByTestId("form-notice")).toHaveText("Discount code added.");
  const row = page.getByTestId("code-row").filter({ hasText: code });
  await expect(row.getByTestId("code-summary")).toHaveText("25% off");
  await expect(row.getByTestId("code-used")).toHaveText("Used 0");

  // --- A shopper uses it --------------------------------------------------------------
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  await shopper.goto(`/p/silk-scarf-${tag}`);
  await shopper.getByTestId("add-to-cart").getByRole("button", { name: "Add to cart" }).click();
  await expect(shopper.getByTestId("cart-notice")).toBeVisible();
  await shopper.goto("/checkout");
  const summary = shopper.getByTestId("checkout-summary");
  await expect(summary.getByTestId("checkout-total")).toHaveText("$40.00");

  const form = shopper.getByTestId("checkout-form");
  await form.getByLabel("Code", exact).fill("NOT-A-CODE");
  await form.getByTestId("apply-discount").click();
  await expect(form.getByTestId("discount-message")).toHaveText("That discount code is not valid.");
  await form.getByLabel("Code", exact).fill(code.toLowerCase());
  await form.getByTestId("apply-discount").click();
  await expect(form.getByTestId("discount-message")).toHaveText(`${code}: 25% off applied.`);
  await expect(summary.getByTestId("checkout-total")).toHaveText("$30.00");
  await expect(summary.getByTestId("checkout-amount").filter({ hasText: "Discount" })).toHaveText(
    new RegExp(`Discount \\(${code}\\)\\s*-\\$10\\.00`),
  );

  await form.getByLabel("Email", exact).fill(`discount-${tag}@example.test`);
  await form.getByLabel("Full name").fill("Lea Hanna");
  await form.getByLabel("Country").selectOption("LB");
  await form.getByLabel("Address", exact).fill("Achrafieh, Sursock Street 9");
  await form.getByLabel("City").fill("Beirut");
  await form.getByLabel("Phone", exact).fill("+961 81 444 555");
  await form.getByRole("button", { name: "Place order" }).click();

  await expect(shopper.getByTestId("order-status")).toHaveText("Confirmed");
  await expect(shopper.getByTestId("order-total")).toHaveText("$30.00");
  await expect(shopper.getByTestId("order-amount").filter({ hasText: "Discount" })).toHaveText(
    new RegExp(`Discount \\(${code}\\)\\s*-\\$10\\.00`),
  );
  await expect(shopper.getByTestId("order-message")).toContainText("Pay $30.00 in cash");
  await shopperContext.close();

  // --- Staff see the use ----------------------------------------------------------------
  await page.reload();
  await expect(
    page.getByTestId("code-row").filter({ hasText: code }).getByTestId("code-used"),
  ).toHaveText("Used 1");
});
