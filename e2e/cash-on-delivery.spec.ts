import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createProduct, exact, signIn } from "./catalog-helpers";
import { waitForEmail } from "./mail";
import { roleEmail } from "./users";

// Cash on delivery from both sides: a shopper orders without paying online,
// needs to give a phone number, and is told to pay the courier; staff send the
// order (stock leaves the shelf), record the cash, or record a refused
// delivery (stock comes back).

async function orderCashOnDelivery(page: Page, path: string, email: string, phone: string) {
  await page.goto(path);
  await page.getByTestId("add-to-cart").getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByTestId("cart-notice")).toBeVisible();
  await page.goto("/checkout");
  const form = page.getByTestId("checkout-form");
  await form.getByLabel("Email", exact).fill(email);
  await form.getByLabel("Full name").fill("Rami Haddad");
  await form.getByLabel("Country").selectOption("LB");
  await form.getByLabel("Address", exact).fill("Hamra Street, Building 5");
  await form.getByLabel("City").fill("Beirut");
  await form.getByLabel("Phone", exact).fill(phone);
  // Cash on delivery is chosen already.
  await expect(form.getByLabel(/Cash on delivery/)).toBeChecked();
  await form.getByRole("button", { name: "Place order" }).click();
}

test("cash on delivery: ordered, sent, paid in cash; or refused and restocked", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(150_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const name = `Olive Bowl ${tag}`;
  const productPath = `/p/olive-bowl-${tag}`;

  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(`Bowls ${tag}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  await createProduct(page, {
    name,
    category: `Bowls ${tag}`,
    sku: `BOWL-${tag}`.toUpperCase(),
    color: "Green",
    price: "15.00",
    stock: "2",
    publish: true,
  });

  // --- A shopper orders, first forgetting the phone number ----------------------
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  const email = `cod-${tag}@example.test`;
  await orderCashOnDelivery(shopper, productPath, email, "");
  await expect(shopper.getByTestId("account-error")).toContainText("phone number");
  // The form kept the address; add the phone and choose cash on delivery again.
  await shopper.getByTestId("checkout-form").getByLabel("Phone", exact).fill("+961 3 555 010");
  await shopper
    .getByTestId("checkout-form")
    .getByLabel(/Cash on delivery/)
    .check();
  await shopper.getByRole("button", { name: "Place order" }).click();

  // No payment page: the order is confirmed straight away.
  await expect(shopper).toHaveURL(/\/order\/[0-9a-f-]{36}\?key=/);
  await expect(shopper.getByTestId("order-status")).toHaveText("Confirmed");
  await expect(shopper.getByTestId("order-message")).toContainText(
    "Pay $15.00 in cash to the courier",
  );
  await expect(shopper.getByTestId("payment-method")).toHaveText("Cash on delivery");
  await expect(shopper.getByRole("button", { name: "Pay now" })).toHaveCount(0);
  await expect(shopper.getByTestId("cart-count")).toHaveText("1");
  const mail = await waitForEmail(request, email, "confirmed");
  expect(mail).toContain("You pay in cash when it arrives");
  expect(mail).toContain("To pay the courier in cash: $15.00");
  const orderUrl = shopper.url();

  // --- Staff send it, then record the cash -----------------------------------------
  await page.goto(`/admin/orders?q=${encodeURIComponent(email)}`);
  await expect(page.getByTestId("order-row")).toContainText("Confirmed, cash on delivery");
  await page.getByTestId("order-row").getByRole("link").first().click();
  await expect(page.getByTestId("admin-payment-method")).toHaveText("Cash on delivery");
  const fulfil = page.getByTestId("fulfil-form");
  await fulfil.getByLabel("Courier").fill("Toters");
  await fulfil.getByLabel("Tracking number").fill(`TT-${tag}`);
  // Only an https link is accepted.
  await fulfil.getByLabel("Tracking link").fill("http://track.example.test/1");
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(fulfil.getByTestId("form-error")).toContainText("https://");
  await fulfil.getByLabel("Courier").fill("Toters");
  await fulfil.getByLabel("Tracking number").fill(`TT-${tag}`);
  await fulfil.getByLabel("Tracking link").fill(`https://track.example.test/TT-${tag}`);
  await fulfil.getByLabel("Note").fill("Left with the concierge");
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByTestId("admin-order-status")).toHaveText("Sent");
  await expect(page.getByTestId("admin-shipment")).toContainText(
    `with Toters · tracking TT-${tag}`,
  );
  // The shopper is told by email, with the tracking staff entered.
  const shippedMail = await waitForEmail(request, email, "is on its way");
  expect(shippedMail).toContain("Courier: Toters");
  expect(shippedMail).toContain(`Tracking number: TT-${tag}`);
  expect(shippedMail).toContain("Please have $15.00 in cash ready for the courier.");
  await shopper.goto(orderUrl);
  await expect(shopper.getByTestId("order-message")).toContainText("on its way");
  await expect(shopper.getByTestId("order-shipment")).toContainText(
    `with Toters. Tracking number: TT-${tag}`,
  );
  await expect(shopper.getByRole("link", { name: "Track your parcel" })).toHaveAttribute(
    "href",
    `https://track.example.test/TT-${tag}`,
  );

  await page.getByRole("button", { name: "Cash received" }).click();
  await expect(page.getByTestId("admin-payment-method")).toContainText("cash collected");
  await expect(page.getByRole("button", { name: "Delivery refused" })).toHaveCount(0);
  await expect(page.getByTestId("order-history")).toContainText("Cash collected");
  expect(await waitForEmail(request, email, "Payment received")).toContain(
    "We have received your payment of $15.00.",
  );
  await shopper.reload();
  await expect(shopper.getByTestId("payment-method")).toHaveText("Paid in cash on delivery");
  await shopperContext.close();

  // --- A second order is refused at the door: the item comes back -----------------
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  const secondEmail = `cod2-${tag}@example.test`;
  await orderCashOnDelivery(second, productPath, secondEmail, "+961 70 123 456");
  await expect(second.getByTestId("order-status")).toHaveText("Confirmed");
  // The last one is held for this order.
  await second.goto(productPath);
  await expect(second.getByTestId("sold-out")).toBeVisible();

  await page.goto(`/admin/orders?q=${encodeURIComponent(secondEmail)}`);
  await page.getByTestId("order-row").getByRole("link").first().click();
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByTestId("admin-order-status")).toHaveText("Sent");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delivery refused" }).click();
  await expect(page.getByTestId("admin-order-status")).toHaveText("Cancelled");
  await expect(page.getByTestId("order-history")).toContainText("Delivery refused");

  // Back in stock for shoppers.
  await second.goto(productPath);
  await expect(second.getByTestId("stock-note")).toHaveText("Only a few left");
  await secondContext.close();
});
