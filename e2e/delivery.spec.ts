import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { exact, signIn } from "./catalog-helpers";
import { E2E_SHIPPING_HOST, E2E_SHIPPING_PRODUCT_SLUG, roleEmail } from "./users";

// Delivery areas and tax. The shopper side runs on the delivery test store
// (reached at 127.0.0.1, set up with two areas in Lebanon and 11% VAT
// included in prices), so the main test store's checkout stays free of fees.
// The staff side runs on the main store with an area that is not offered.

test("the shopper picks a delivery area, sees it in the total, and the order keeps it", async ({
  browser,
}, testInfo) => {
  const base = String(testInfo.project.use.baseURL).replace("localhost", E2E_SHIPPING_HOST);
  const context = await browser.newContext({ baseURL: base });
  const page = await context.newPage();

  await page.goto(`/p/${E2E_SHIPPING_PRODUCT_SLUG}`);
  await page.getByTestId("add-to-cart").getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByTestId("cart-notice")).toBeVisible();
  await page.goto("/checkout");

  const form = page.getByTestId("checkout-form");
  await form.getByLabel("Email", exact).fill(`delivery-${randomUUID().slice(0, 8)}@example.test`);
  await form.getByLabel("Full name").fill("Maya Khoury");
  await form.getByLabel("Country").selectOption("LB");
  await form.getByLabel("Address", exact).fill("Mar Mikhael, Armenia Street 12");
  await form.getByLabel("City").fill("Beirut");
  await form.getByLabel("Phone", exact).fill("+961 71 000 111");

  // Before an area is picked the summary says so, and placing the order asks for one.
  const summary = page.getByTestId("checkout-summary");
  await expect(summary.getByTestId("checkout-amount").filter({ hasText: "Delivery" })).toHaveText(
    /Choose your area/,
  );
  await form.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByTestId("account-error")).toHaveText(/Choose a delivery area/);

  // Each area shows its price; the total follows the choice.
  const area = page.getByTestId("checkout-form").getByLabel("Delivery area");
  await area.selectOption({ label: "Mount Lebanon: $5.00" });
  await expect(summary.getByTestId("checkout-total")).toHaveText("$45.00");
  await area.selectOption({ label: "Beirut: $3.00" });
  await expect(summary.getByTestId("checkout-total")).toHaveText("$43.00");
  await expect(summary.getByTestId("checkout-amount").filter({ hasText: "VAT" })).toHaveText(
    /VAT 11% included\s*\$4\.26/,
  );
  // Cash on delivery is chosen already; the form kept the address.
  await page.getByTestId("checkout-form").getByRole("button", { name: "Place order" }).click();

  await expect(page).toHaveURL(/\/order\/[0-9a-f-]{36}\?key=/);
  await expect(page.getByTestId("order-status")).toHaveText("Confirmed");
  await expect(page.getByTestId("order-message")).toContainText("Pay $43.00 in cash");
  await expect(page.getByTestId("order-amount").filter({ hasText: "Delivery" })).toHaveText(
    /Delivery \(Beirut\)\s*\$3\.00/,
  );
  await expect(page.getByTestId("order-amount").filter({ hasText: "VAT" })).toHaveText(
    /VAT 11% included\s*\$4\.26/,
  );
  await expect(page.getByTestId("order-total")).toHaveText("$43.00");
  await context.close();
});

test("staff manage delivery areas and tax, with clear messages for mistakes", async ({
  page,
}, testInfo) => {
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const name = `Test area ${tag}`;
  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin");
  await page.getByRole("link", { name: "Delivery and tax" }).first().click();
  await expect(page.getByRole("heading", { name: "Delivery and tax" })).toBeVisible();

  // Added switched off, so the main store's checkout is unaffected.
  const create = page.getByTestId("zone-create-form");
  await create.getByLabel("Area name").fill(name);
  await create.getByLabel("Country codes").fill("lb");
  await create.getByLabel(/Delivery price/).fill("2.50");
  await create.getByLabel(/Free delivery over/).fill("80");
  await create.getByLabel("Offer this area at checkout").uncheck();
  await create.getByRole("button", { name: "Add area" }).click();
  await expect(create.getByTestId("form-notice")).toHaveText("Delivery area added.");

  const row = page.getByTestId("zone-row").filter({ hasText: name });
  await expect(row.getByTestId("zone-summary")).toHaveText(`${name}: $2.50, free over $80.00`);
  await expect(row).toContainText("Not offered");

  // A mistake is explained and nothing changes.
  await row.getByText(`Edit ${name}`).click();
  const edit = row.getByTestId("zone-edit-form");
  await edit.getByLabel(/Delivery price/).fill("two");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit.getByTestId("form-error")).toContainText("Enter the delivery price");
  await edit.getByLabel(/Delivery price/).fill("3");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(row.getByTestId("zone-summary")).toHaveText(`${name}: $3.00, free over $80.00`);

  // Tax: an impossible rate is refused.
  const tax = page.getByTestId("tax-form");
  await tax.getByLabel("Tax rate (%)").fill("75");
  await tax.getByRole("button", { name: "Save tax" }).click();
  await expect(tax.getByTestId("form-error")).toContainText("from 0 to 50");

  // Deleting asks first.
  page.once("dialog", (dialog) => void dialog.accept());
  await row.getByRole("button", { name: "Delete area" }).click();
  await expect(page.getByTestId("zone-row").filter({ hasText: name })).toHaveCount(0);
});
