import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createProduct, exact, signIn } from "./catalog-helpers";
import { waitForEmail } from "./mail";
import { roleEmail } from "./users";

// Staff tools for orders: a return with money given back (stock comes back,
// the shopper sees it and is emailed), the dashboard, the order filters and
// the CSV export.

test("staff record a return with a refund; the dashboard, filters and export work", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(150_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const name = `Linen Pouch ${tag}`;
  const sku = `POUCH-${tag}`.toUpperCase();

  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(`Pouches ${tag}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  await createProduct(page, {
    name,
    category: `Pouches ${tag}`,
    sku,
    color: "Natural",
    price: "12.00",
    stock: "5",
    publish: true,
  });

  // --- A shopper buys two, cash on delivery ----------------------------------------
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  const email = `returns-${tag}@example.test`;
  await shopper.goto(`/p/linen-pouch-${tag}`);
  await shopper.getByTestId("add-to-cart").getByLabel("Quantity").selectOption("2");
  await shopper.getByTestId("add-to-cart").getByRole("button", { name: "Add to cart" }).click();
  await expect(shopper.getByTestId("cart-notice")).toBeVisible();
  await shopper.goto("/checkout");
  const form = shopper.getByTestId("checkout-form");
  await form.getByLabel("Email", exact).fill(email);
  await form.getByLabel("Full name").fill("Nour Saad");
  await form.getByLabel("Country").selectOption("LB");
  await form.getByLabel("Address", exact).fill("Gemmayzeh, Gouraud Street 3");
  await form.getByLabel("City").fill("Beirut");
  await form.getByLabel("Phone", exact).fill("+961 76 222 333");
  await form.getByRole("button", { name: "Place order" }).click();
  await expect(shopper.getByTestId("order-status")).toHaveText("Confirmed");
  const orderUrl = shopper.url();

  // --- Staff send it and take the cash ------------------------------------------------
  await page.goto(`/admin/orders?q=${encodeURIComponent(email)}`);
  await page.getByTestId("order-row").getByRole("link").first().click();
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByTestId("admin-order-status")).toHaveText("Sent");
  await page.getByRole("button", { name: "Cash received" }).click();
  await expect(page.getByTestId("admin-payment-method")).toContainText("cash collected");

  // --- One comes back; the money for it is given back in cash ----------------------
  await page.getByText("Record a return").click();
  const returnForm = page.getByTestId("return-form");
  await returnForm.getByLabel(`How many: ${name}`).fill("3");
  await returnForm.getByLabel("Reason").selectOption("changed_mind");
  await returnForm.getByRole("button", { name: "Record return" }).click();
  await expect(returnForm.getByTestId("form-error")).toContainText("Only 2");
  await returnForm.getByLabel(`How many: ${name}`).fill("1");
  await returnForm.getByLabel("Reason").selectOption("changed_mind");
  await returnForm.getByLabel(/Money given back/).fill("12.00");
  await returnForm.getByLabel("Given back by").selectOption("cash");
  await returnForm.getByRole("button", { name: "Record return" }).click();
  await expect(page.getByTestId("admin-returns")).toContainText(`1 × ${name}`);
  await expect(page.getByTestId("admin-returns")).toContainText("$12.00 given back by cash");
  await expect(page.getByTestId("admin-refunded")).toContainText("$12.00");
  await expect(page.getByTestId("order-history")).toContainText("Return recorded");

  // The returned pouch is for sale again: 5 - 2 sold + 1 back.
  await page.goto(`/admin/inventory?q=${encodeURIComponent(sku)}`);
  await expect(
    page.getByTestId("stock-row").filter({ hasText: sku }).getByTestId("stock-available"),
  ).toContainText("4 available");

  // The shopper sees it and is told by email.
  await shopper.goto(orderUrl);
  await expect(shopper.getByTestId("order-refunded")).toContainText("$12.00");
  await expect(shopper.getByTestId("order-returns")).toContainText(`1 × ${name} received`);
  expect(await waitForEmail(request, email, "Return recorded")).toContain(
    "We have given back $12.00.",
  );
  await shopperContext.close();

  // --- Dashboard ----------------------------------------------------------------------
  await page.goto("/admin");
  const dashboard = page.getByTestId("dashboard");
  await expect(
    dashboard.getByTestId("dashboard-today").getByTestId("dashboard-sales"),
  ).toBeVisible();
  await expect(dashboard.getByTestId("dashboard-daily").locator("tbody tr")).toHaveCount(14);

  // --- Filters and export ---------------------------------------------------------------
  await page.goto(`/admin/orders?q=${encodeURIComponent(email)}&payment=cash_on_delivery`);
  await expect(page.getByTestId("order-row")).toHaveCount(1);
  await page.goto(`/admin/orders?q=${encodeURIComponent(email)}&payment=online`);
  await expect(page.getByTestId("order-row")).toHaveCount(0);

  await page.goto(`/admin/orders?q=${encodeURIComponent(email)}`);
  const href = await page.getByTestId("export-orders").getAttribute("href");
  expect(href).toContain(`q=${encodeURIComponent(email)}`);
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const text = await csv.text();
  expect(text).toContain(email);
  expect(text).toContain("'+961 76 222 333");
  expect(text.trim().split("\r\n")).toHaveLength(2);
});

test("staff without permission to export customer data do not get the export", async ({ page }) => {
  await signIn(page, roleEmail("inventory_manager"));
  const response = await page.request.get("/api/v1/admin/orders/export");
  expect(response.status()).toBe(403);
});
