import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createProduct, exact, signIn as staffSignIn } from "./catalog-helpers";
import { linkTo, waitForEmail } from "./mail";
import { roleEmail } from "./users";

// Customer photos: a customer who received a product shares a photo with
// permission; staff approve it; it shows on the product page and in the
// gallery; the customer withdraws permission and it is gone.

const PASSWORD = "a long shopper password";

async function newCustomer(page: Page, email: string, name: string) {
  await page.goto("/account/sign-up");
  const form = page.getByTestId("sign-up-form");
  await form.getByLabel("Name", exact).fill(name);
  await form.getByLabel("Email", exact).fill(email);
  await form.getByLabel("Password", exact).fill(PASSWORD);
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("account-notice")).toContainText("We have sent an email");
  const text = await waitForEmail(page.request, email, "/account/verify?token=");
  await page.goto(linkTo(text, "/account/verify?token="));
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page).toHaveURL(/\/account\?welcome=1$/);
}

test("a customer shares a photo with permission, staff approve it, and it can be withdrawn", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const name = `Photo Tote ${tag}`;
  const path = `/p/photo-tote-${tag}`;
  const caption = `On the Corniche ${tag}`;

  await staffSignIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(`Photos ${tag}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  await createProduct(page, {
    name,
    category: `Photos ${tag}`,
    sku: `PHO-${tag}`.toUpperCase(),
    color: "Sand",
    price: "35.00",
    stock: "5",
    publish: true,
  });

  // --- A customer buys it and receives it -------------------------------------------
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  const email = `photos-${tag}@example.test`;
  await newCustomer(shopper, email, "Nour Saad");
  await shopper.goto("/account/photos");
  await expect(shopper.getByTestId("ugc-not-eligible")).toBeVisible();
  await shopper.goto(path);
  await shopper.getByTestId("add-to-cart").getByRole("button", { name: "Add to cart" }).click();
  await expect(shopper.getByTestId("cart-notice")).toBeVisible();
  await shopper.goto("/checkout");
  const form = shopper.getByTestId("checkout-form");
  await form.getByLabel("Full name").fill("Nour Saad");
  await form.getByLabel("Country").selectOption("LB");
  await form.getByLabel("Address", exact).fill("Raouche, Corniche 1");
  await form.getByLabel("City").fill("Beirut");
  await form.getByLabel("Phone", exact).fill("+961 76 111 222");
  await form.getByRole("button", { name: "Place order" }).click();
  await expect(shopper.getByTestId("order-status")).toHaveText("Confirmed");

  await page.goto(`/admin/orders?q=${encodeURIComponent(email)}`);
  await page.getByTestId("order-row").getByRole("link").first().click();
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByTestId("admin-order-status")).toHaveText("Sent");

  // --- The customer shares a photo, first forgetting to give permission -------------
  await shopper.goto(path);
  await shopper.getByRole("link", { name: "Share your photo" }).click();
  const share = shopper.getByTestId("ugc-form");
  await expect(share.getByLabel("Product")).toHaveValue(/[0-9a-f-]{36}/);
  await share.getByLabel("Photo or video", exact).setInputFiles({
    name: "tote.png",
    mimeType: "image/png",
    buffer: readFileSync(resolve(import.meta.dirname, "fixtures/tote.png")),
  });
  await share.getByLabel("Caption").fill(caption);
  await share.getByRole("button", { name: "Share" }).click();
  await expect(share.getByTestId("account-error")).toContainText("permission");
  await share.getByLabel("Photo or video", exact).setInputFiles({
    name: "tote.png",
    mimeType: "image/png",
    buffer: readFileSync(resolve(import.meta.dirname, "fixtures/tote.png")),
  });
  await share.getByLabel(/I took this photo or video/).check();
  await share.getByRole("button", { name: "Share" }).click();
  await expect(share.getByTestId("account-notice")).toContainText("once the store has checked it");
  await shopper.reload();
  await expect(shopper.getByTestId("my-ugc-status").first()).toHaveText("Waiting to be checked");

  // --- Staff approve it --------------------------------------------------------------
  await page.goto("/admin");
  await page.getByRole("link", { name: "Customer photos" }).first().click();
  const row = page.getByTestId("ugc-moderation-row").filter({ hasText: caption });
  await row.getByText("Permission record").click();
  await expect(row.getByTestId("ugc-permission")).toContainText("I took this photo or video");
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("ugc-moderation-row").filter({ hasText: caption })).toHaveCount(0);

  // --- Shown to everyone -------------------------------------------------------------
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(path);
  await expect(visitor.getByTestId("customer-photos").getByTestId("ugc-item")).toContainText(
    "Nour S.",
  );
  await visitor.goto("/gallery");
  await expect(visitor.getByTestId("ugc-item").filter({ hasText: caption })).toBeVisible();

  // --- The customer withdraws permission: gone at once --------------------------------
  await shopper.goto("/account/photos");
  await shopper.getByRole("button", { name: "Withdraw permission and delete" }).first().click();
  // The page updates itself once the action is done.
  await expect(shopper.getByTestId("my-ugc-status").first()).toHaveText(
    "Permission withdrawn, deleted",
  );
  await visitor.goto("/gallery");
  await expect(visitor.getByTestId("ugc-item").filter({ hasText: caption })).toHaveCount(0);
  await visitorContext.close();
  await shopperContext.close();
});
