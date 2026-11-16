import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createProduct, exact, signIn } from "./catalog-helpers";
import { linkTo, waitForEmail } from "./mail";
import { roleEmail } from "./users";

// Checkout from start to finish with the mock payment provider: a guest is
// declined, tries again and pays; the order keeps what was bought; the
// stock leaves the shelf; the confirmation email links back to the order;
// nobody else can open it; staff see it and mark it sent; a signed-in
// customer's order lands in their account. And a forged payment
// notification changes nothing.

const PASSWORD = "a long shopper password";

async function fillAddress(page: Page) {
  const form = page.getByTestId("checkout-form");
  await form.getByLabel("Full name").fill("Sam Shopper");
  await form.getByLabel("Country").selectOption("EG");
  await form.getByLabel("Address", exact).fill("12 Nile Corniche");
  await form.getByLabel("City").fill("Cairo");
}

async function addToCart(page: Page, path: string, quantity: string) {
  await page.goto(path);
  await page.getByTestId("add-to-cart").getByLabel("Quantity").selectOption(quantity);
  await page.getByTestId("add-to-cart").getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByTestId("cart-notice")).toBeVisible();
}

test("a guest pays after a decline; a customer's order lands in their account", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const name = `Lantern ${tag}`;
  const productPath = `/p/lantern-${tag}`;
  const guestEmail = `buyer-${tag}@example.test`;

  // --- A product with 3 in stock --------------------------------------------------
  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(`Lanterns ${tag}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  await createProduct(page, {
    name,
    category: `Lanterns ${tag}`,
    sku: `LAN-${tag}`.toUpperCase(),
    color: "Brass",
    price: "20.00",
    stock: "3",
    publish: true,
  });

  // --- A guest checks out --------------------------------------------------------------
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await addToCart(guest, productPath, "2");
  await guest.goto("/cart");
  await guest.getByTestId("checkout-link").click();
  await expect(guest).toHaveURL("/checkout");
  await expect(guest.getByTestId("checkout-total")).toHaveText("$40.00");

  // A refused address keeps what was typed.
  await guest.getByTestId("checkout-form").getByLabel("Email", exact).fill(guestEmail);
  await guest.getByTestId("checkout-form").getByLabel("Full name").fill("Sam Shopper");
  await guest.getByRole("button", { name: "Continue to payment" }).click();
  await expect(guest.getByTestId("account-error")).toContainText("country");
  await expect(guest.getByTestId("checkout-form").getByLabel("Email", exact)).toHaveValue(
    guestEmail,
  );
  await fillAddress(guest);
  await guest.getByRole("button", { name: "Continue to payment" }).click();

  // The mock provider's page: test mode, the right amount, no card fields.
  await expect(guest).toHaveURL(/\/checkout\/pay\?payment=mock_/);
  await expect(guest.getByTestId("test-mode")).toBeVisible();
  await expect(guest.getByTestId("pay-amount")).toHaveText("$40.00");
  await expect(guest.locator("input[autocomplete^='cc-'], input[name*='card' i]")).toHaveCount(0);

  // Declined: the order waits; the cart is still there; the stock is held.
  await guest.getByRole("button", { name: "Decline (test: card refused)" }).click();
  await expect(guest).toHaveURL(/\/order\/[0-9a-f-]{36}\?key=/);
  const orderUrl = guest.url();
  await expect(guest.getByTestId("order-status")).toHaveText("Waiting for payment");
  await expect(guest.getByTestId("payment-failed")).toContainText("declined");
  await expect(guest.getByTestId("cart-count")).toHaveText("2");
  await guest.goto(productPath);
  await expect(guest.getByTestId("stock-note")).toHaveText("Only a few left");

  // Try again and pay.
  await guest.goto(orderUrl);
  await guest.getByRole("button", { name: "Pay now" }).click();
  await expect(guest).toHaveURL(/\/checkout\/pay\?payment=mock_/);
  await guest.getByRole("button", { name: "Pay (test: succeeds)" }).click();
  await expect(guest).toHaveURL(orderUrl);
  await expect(guest.getByTestId("order-status")).toHaveText("Paid");
  await expect(guest.getByTestId("order-message")).toContainText(guestEmail);
  await expect(guest.getByTestId("order-total")).toHaveText("$40.00");
  await expect(guest.getByTestId("order-items")).toContainText(name);
  await expect(guest.getByTestId("order-items")).toContainText("2 × $20.00");
  await expect(guest.getByText("Test card ending 4242")).toBeVisible();
  // The cart is closed; two of three have left the shelf.
  await expect(guest.getByTestId("cart-count")).toHaveText("0");
  await guest.goto(productPath);
  await expect(guest.getByTestId("stock-note")).toHaveText("Only a few left");
  await expect(
    guest.getByTestId("add-to-cart").getByLabel("Quantity").locator("option"),
  ).toHaveCount(1);

  // The confirmation email links back to the order, key and all.
  const mail = await waitForEmail(request, guestEmail, "confirmed");
  expect(mail).toContain(name);
  expect(mail).toContain("$40.00");
  const emailed = linkTo(mail, "/order/");
  const fromEmail = await guestContext.newPage();
  // The link is built from the configured APP_URL, whose port differs from the
  // test server's; its path and key are what must be right.
  const { pathname, search } = new URL(emailed);
  expect(search).toMatch(/^\?key=[A-Za-z0-9_-]{43}$/);
  expect((await fromEmail.goto(pathname + search))?.status()).toBe(200);
  await expect(fromEmail.getByTestId("order-status")).toHaveText("Paid");
  await guestContext.close();

  // Nobody without the key can open it.
  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  const bare = orderUrl.split("?")[0]!;
  expect((await stranger.goto(bare))?.status()).toBe(404);
  expect((await stranger.goto(`${bare}?key=${"x".repeat(43)}`))?.status()).toBe(404);
  expect((await stranger.goto(orderUrl))?.status()).toBe(200); // the full link is the key
  await strangerContext.close();

  // A forged notification is refused and changes nothing.
  const forged = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: "payment.succeeded",
    data: { payment: "mock_forged", amount: 1, currency: "USD" },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const badSignature = createHmac("sha256", "not-the-secret")
    .update(`${timestamp}.${forged}`)
    .digest("hex");
  const refused = await request.post("/api/webhooks/payments/mock", {
    data: forged,
    headers: {
      "content-type": "application/json",
      "x-mock-signature": `t=${timestamp},v1=${badSignature}`,
    },
  });
  expect(refused.status()).toBe(400);
  expect((await request.post("/api/webhooks/payments/mock", { data: forged })).status()).toBe(400);

  // --- Staff see the order and mark it sent ------------------------------------------
  await page.goto(`/admin/orders?q=${encodeURIComponent(guestEmail)}`);
  const row = page.getByTestId("order-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("$40.00");
  await expect(row).toContainText("Paid");
  await row.getByRole("link").first().click();
  await expect(page.getByTestId("admin-order-items")).toContainText(`LAN-${tag}`.toUpperCase());
  await expect(page.getByTestId("order-history")).toContainText("Payment declined");
  await expect(page.getByTestId("order-history")).toContainText("Payment received");
  await page.getByTestId("fulfil-form").getByLabel("Note").fill("Courier 123");
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByTestId("admin-order-status")).toHaveText("Sent");
  await expect(page.getByTestId("order-history")).toContainText("Courier 123");

  // --- A signed-in customer ------------------------------------------------------------
  const customerEmail = `member-${tag}@example.test`;
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto("/account/sign-up");
  const signUp = member.getByTestId("sign-up-form");
  await signUp.getByLabel("Name", exact).fill("Member");
  await signUp.getByLabel("Email", exact).fill(customerEmail);
  await signUp.getByLabel("Password", exact).fill(PASSWORD);
  await signUp.getByRole("button", { name: "Create account" }).click();
  await expect(member.getByTestId("account-notice")).toBeVisible();
  await member.goto(
    linkTo(await waitForEmail(request, customerEmail, "/account/verify"), "/account/verify?token="),
  );
  await member.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(member).toHaveURL(/\/account\?welcome=1$/);

  await addToCart(member, productPath, "1");
  await member.goto("/checkout");
  await expect(member.getByTestId("checkout-email")).toContainText(customerEmail);
  await fillAddress(member);
  await member.getByTestId("checkout-form").getByLabel("Save this address to my account").check();
  await member.getByRole("button", { name: "Continue to payment" }).click();
  await member.getByRole("button", { name: "Pay (test: succeeds)" }).click();
  await expect(member).toHaveURL(/\/account\/orders\/[0-9a-f-]{36}$/);
  await expect(member.getByTestId("order-status")).toHaveText("Paid");
  const memberOrderUrl = member.url();
  await member.goto("/account/orders");
  await expect(member.getByTestId("account-orders")).toContainText("$20.00");
  await member.goto("/account/addresses");
  await expect(member.getByTestId("address")).toContainText("12 Nile Corniche");

  // The last one is sold: the product is sold out.
  await member.goto(productPath);
  await expect(member.getByTestId("sold-out")).toBeVisible();
  await memberContext.close();

  // Another visitor cannot open the customer's order.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.goto(memberOrderUrl);
  await expect(other).toHaveURL(/\/account\/sign-in\?next=/);
  await otherContext.close();
});
