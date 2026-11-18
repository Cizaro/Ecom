import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createProduct, exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// Milestone 7.4: shop events, the reports page, questions about the figures
// (built-in test stand-in, no outside calls) and the CSV download.

// The headless browser calls itself "HeadlessChrome", which is skipped as a
// bot; the shopper here uses an ordinary browser's name.
const SHOPPER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

test("shop visits show up in the reports, and the owner asks about them", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const categoryName = `Reports ${tag}`;
  const name = `Cedar Belt ${tag}`;

  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(categoryName);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  const before = await page.goto("/admin/reports?days=7");
  expect(before?.status()).toBe(200);
  const viewsBefore = Number(
    (
      await page
        .getByTestId("reports-funnel")
        .locator("li")
        .first()
        .locator("span.tabular-nums")
        .innerText()
    ).split(" ")[0],
  );
  await createProduct(page, {
    name,
    category: categoryName,
    sku: `REP-${tag.toUpperCase()}`,
    color: "Black",
    price: "25.00",
    publish: true,
  });

  // A shopper opens the product and searches for something the store does not sell.
  const shopper = await browser.newContext({ userAgent: SHOPPER_AGENT });
  const shop = await shopper.newPage();
  await shop.goto(`/p/cedar-belt-${tag}`);
  await expect(shop.getByRole("heading", { level: 1 })).toHaveText(name);
  await shop.goto(`/search?q=${encodeURIComponent(`zebra ${tag}`)}`);
  await expect(shop.getByTestId("search-title")).toBeVisible();
  await shopper.close();

  // The owner sees the visit and the search that found nothing.
  await page.goto("/admin/reports?days=7");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByTestId("reports-sales-chart")).toBeVisible();
  const viewsAfter = Number(
    (
      await page
        .getByTestId("reports-funnel")
        .locator("li")
        .first()
        .locator("span.tabular-nums")
        .innerText()
    ).split(" ")[0],
  );
  expect(viewsAfter).toBeGreaterThan(viewsBefore);

  // A question answered from the figures, with the figures it used.
  const ask = page.getByTestId("reports-ask-form");
  await ask.getByLabel("Your question").fill("How many product views and adds to cart were there?");
  await ask.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByTestId("reports-answer")).toContainText("product views");
  await expect(page.getByTestId("reports-answer-figures")).toContainText("product views");

  // The period switch and the CSV download.
  await page.getByRole("link", { name: "30 days" }).click();
  await expect(page).toHaveURL(/days=30/);
  const csv = await page.request.get("/api/v1/admin/reports/products?days=30");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect((await csv.text()).split("\r\n")[0]).toBe("Product,Units,Sales (USD),Views,Added to cart");
});

test("reports follow each role's permissions", async ({ page, browser }) => {
  // Inventory managers see the reports but cannot ask the AI.
  await signIn(page, roleEmail("inventory_manager"));
  await page.goto("/admin/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByTestId("reports-ask-form")).toHaveCount(0);

  // Customer service does not see reports at all.
  const other = await browser.newContext();
  const service = await other.newPage();
  await signIn(service, roleEmail("customer_service"));
  const response = await service.goto("/admin/reports");
  expect(response?.status()).toBe(403);
  const csv = await service.request.get("/api/v1/admin/reports/products");
  expect(csv.status()).toBe(403);
  await other.close();
});
