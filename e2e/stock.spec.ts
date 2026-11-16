import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createProduct, exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// Stock from both sides: staff receive, count and write off stock and see
// the history; shoppers see honest wording, cannot add more than there is,
// and are told when items in their cart run low or sell out.

const NOTICE: Record<string, string> = {
  receive: "Stock received.",
  count: "Count saved.",
  damage: "Marked as damaged.",
  remove_damaged: "Damaged items removed.",
};

/** Submits a stock change and waits until the server has answered and the page shows it. */
async function changeStock(page: Page, operation: string, quantity: string, note = "") {
  const form = page.getByTestId("stock-change");
  await form.getByLabel("What happened").selectOption(operation);
  await form.getByLabel("Quantity", exact).fill(quantity);
  await form.getByLabel("Note").fill(note);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && !!response.request().headers()["next-action"],
  );
  await form.getByRole("button", { name: "Save change" }).click();
  await saved;
  await expect(form.getByTestId("form-notice")).toHaveText(NOTICE[operation]!);
  await expect(form.getByRole("button", { name: "Save change" })).toBeEnabled();
}

test("stock counts drive what shoppers see and can buy", async ({ page, browser }, testInfo) => {
  test.setTimeout(150_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const name = `Vase ${tag}`;
  const sku = `VASE-${tag}`.toUpperCase();
  const productPath = `/p/vase-${tag}`;

  // --- The owner adds a product with 5 in stock -----------------------------------
  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(`Vases ${tag}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  const productAdmin = await createProduct(page, {
    name,
    category: `Vases ${tag}`,
    sku,
    color: "Blue",
    price: "15.00",
    stock: "5",
    publish: true,
  });
  await expect(page.getByTestId("variant-stock-link")).toHaveText(`5 in stock for ${sku}`);

  // --- A shopper: in stock, then only a few left -----------------------------------
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  await shopper.goto(productPath);
  await expect(shopper.getByTestId("stock-note")).toHaveText("In stock");
  // The quantity list stops at what there is.
  await expect(
    shopper.getByTestId("add-to-cart").getByLabel("Quantity").locator("option"),
  ).toHaveCount(5);
  await shopper.getByTestId("add-to-cart").getByLabel("Quantity").selectOption("4");
  await shopper.getByTestId("add-to-cart").getByRole("button", { name: "Add to cart" }).click();
  await expect(shopper.getByTestId("cart-notice")).toHaveText("Added to your cart.");
  // Asking for more than is left is refused, with how many there are.
  await shopper.getByTestId("add-to-cart").getByLabel("Quantity").selectOption("2");
  await shopper.getByTestId("add-to-cart").getByRole("button", { name: "Add to cart" }).click();
  await expect(shopper.getByTestId("cart-error")).toHaveText("Only 5 of this item are left.");
  await expect(shopper.getByTestId("cart-count")).toHaveText("4");

  // --- Staff count the shelf: only 2 are really there ---------------------------------
  await page.goto("/admin/inventory");
  const row = page.getByTestId("stock-row").filter({ hasText: sku });
  await expect(row.getByTestId("stock-available")).toContainText("5 available");
  await row.getByRole("link", { name }).click();
  await expect(page.getByTestId("variant-stock-totals")).toContainText("5 available");
  // A count needs a reason.
  await page.getByTestId("stock-change").getByLabel("What happened").selectOption("count");
  await page.getByTestId("stock-change").getByLabel("Quantity", exact).fill("2");
  await page.getByTestId("stock-change").getByRole("button", { name: "Save change" }).click();
  await expect(page.getByTestId("stock-change").getByTestId("form-error")).toContainText(
    "Say why the count changed",
  );
  await changeStock(page, "count", "2", "Shelf count");
  await expect(page.getByTestId("variant-stock-totals")).toContainText("2 available");
  await expect(page.getByTestId("variant-stock-status")).toHaveText("Low");

  // The shopper is told, and sees "only a few left" on the product.
  await shopper.goto("/cart");
  await expect(shopper.getByTestId("line-only-left")).toContainText("Only 2 left");
  await shopper.goto(productPath);
  await expect(shopper.getByTestId("stock-note")).toHaveText("Only a few left");

  // --- One is found damaged, then the last is sold elsewhere (counted to 0) ------------
  await page.reload();
  await changeStock(page, "damage", "1");
  await expect(page.getByTestId("variant-stock-totals")).toContainText("1 available");
  await changeStock(page, "remove_damaged", "1", "Broken in storage");
  await changeStock(page, "count", "0", "Sold in the shop");
  await expect(page.getByTestId("variant-stock-status")).toHaveText("Out of stock");

  // The history explains every number, newest first, with who made each change.
  const history = page.getByTestId("stock-movement");
  // Received, count, damaged, two rows for the removal (damaged and on hand), count.
  await expect(history).toHaveCount(6);
  await expect(history.first()).toContainText("Count");
  await expect(history.first()).toContainText("Sold in the shop");
  await expect(history.last()).toContainText("Received +5 on hand");
  await expect(history.last()).toContainText("Opening stock");

  // Sold out for the shopper: no buy button, a label on the card, the cart line flagged.
  await shopper.goto(productPath);
  await expect(shopper.getByTestId("sold-out")).toHaveText("Sold out for now.");
  await expect(shopper.getByTestId("add-to-cart")).toHaveCount(0);
  await expect(shopper.getByTestId("stock-note")).toHaveCount(0);
  await shopper.goto(`/c/vases-${tag}`);
  await expect(shopper.getByTestId("product-card").filter({ hasText: name })).toContainText(
    "Sold out",
  );
  await shopper.goto("/cart");
  await expect(shopper.getByTestId("line-out-of-stock")).toBeVisible();
  await expect(shopper.getByTestId("cart-subtotal")).toHaveText("$0.00");

  // --- Restocked: buyable again --------------------------------------------------------
  await changeStock(page, "receive", "10");
  await shopper.reload();
  await expect(shopper.getByTestId("line-out-of-stock")).toHaveCount(0);
  await expect(shopper.getByTestId("cart-subtotal")).toHaveText("$60.00");
  await shopperContext.close();

  // --- A second location -----------------------------------------------------------------
  await page.goto("/admin/inventory/locations");
  await page.getByLabel("Name", exact).last().fill(`Back room ${tag}`);
  await page.getByRole("button", { name: "Add location" }).click();
  await expect(
    page.getByTestId("location-row").filter({ hasText: `Back room ${tag}` }),
  ).toBeVisible();

  // --- Customer service can look but not change -------------------------------------------
  const supportContext = await browser.newContext();
  const support = await supportContext.newPage();
  await signIn(support, roleEmail("customer_service"));
  await support.goto(productAdmin);
  await support.getByTestId("variant-stock-link").click();
  await expect(support.getByTestId("variant-stock-totals")).toContainText("10 available");
  await expect(support.getByTestId("stock-change")).toHaveCount(0);
  await expect(support.getByRole("button", { name: "Stop counting stock" })).toHaveCount(0);
  await supportContext.close();
});
