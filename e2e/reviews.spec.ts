import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createProduct, exact, signIn as staffSignIn } from "./catalog-helpers";
import { linkTo, waitForEmail } from "./mail";
import { roleEmail } from "./users";

// Reviews from real buyers only: a customer can review a product once it has
// been sent to them; staff approve it and reply; only then do shoppers see it.

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
  await expect(page.getByTestId("account-link")).toHaveText("Account");
}

test("a customer reviews a product they received; staff approve and reply", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const name = `Review Tote ${tag}`;
  const path = `/p/review-tote-${tag}`;

  await staffSignIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(`Reviewed ${tag}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  await createProduct(page, {
    name,
    category: `Reviewed ${tag}`,
    sku: `REV-${tag}`.toUpperCase(),
    color: "Olive",
    price: "50.00",
    stock: "5",
    publish: true,
  });

  // --- A customer buys it -----------------------------------------------------------
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  const email = `reviewer-${tag}@example.test`;
  await newCustomer(shopper, email, "Maya Khoury");
  await shopper.goto(path);
  // Before buying: no reviews, and no way to write one.
  await expect(shopper.getByTestId("no-reviews")).toBeVisible();
  await expect(shopper.getByTestId("review-write")).toContainText("once you have received it");
  await shopper.getByTestId("add-to-cart").getByRole("button", { name: "Add to cart" }).click();
  await expect(shopper.getByTestId("cart-notice")).toBeVisible();
  await shopper.goto("/checkout");
  const form = shopper.getByTestId("checkout-form");
  await form.getByLabel("Full name").fill("Maya Khoury");
  await form.getByLabel("Country").selectOption("LB");
  await form.getByLabel("Address", exact).fill("Badaro, Main Street 4");
  await form.getByLabel("City").fill("Beirut");
  await form.getByLabel("Phone", exact).fill("+961 70 999 000");
  await form.getByRole("button", { name: "Place order" }).click();
  await expect(shopper.getByTestId("order-status")).toHaveText("Confirmed");

  // Not sent yet: still no review.
  await shopper.goto(path);
  await expect(shopper.getByTestId("review-form")).toHaveCount(0);

  // --- Staff send it -----------------------------------------------------------------
  await page.goto(`/admin/orders?q=${encodeURIComponent(email)}`);
  await page.getByTestId("order-row").getByRole("link").first().click();
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByTestId("admin-order-status")).toHaveText("Sent");

  // --- The customer writes a review ----------------------------------------------------
  await shopper.goto(path);
  const review = shopper.getByTestId("review-form");
  await review.getByLabel("Your review").fill("Nice");
  await review.getByRole("button", { name: "Send review" }).click();
  await expect(review.getByTestId("account-error")).toContainText("Choose a rating");
  await review.getByLabel("4 stars").check();
  await review.getByLabel("Title").fill("Roomy and well made");
  await review
    .getByLabel("Your review")
    .fill("Holds my laptop and lunch. The strap is comfortable.");
  await review.getByRole("button", { name: "Send review" }).click();
  await expect(shopper.getByTestId("review-status")).toContainText("once the store has checked it");
  // Not shown until approved.
  await expect(shopper.getByTestId("no-reviews")).toBeVisible();

  // --- Staff approve and reply -----------------------------------------------------------
  await page.goto("/admin");
  await page.getByRole("link", { name: "Reviews" }).first().click();
  const row = page.getByTestId("moderation-row").filter({ hasText: name });
  await expect(row.getByTestId("moderation-body")).toHaveText(
    "Holds my laptop and lunch. The strap is comfortable.",
  );
  await row.getByText("Reply publicly").click();
  await row.getByLabel("Reply").fill("Thank you, Maya!");
  await row.getByRole("button", { name: "Save reply" }).click();
  await expect(row.getByTestId("form-notice")).toHaveText("Reply saved.");
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("moderation-row").filter({ hasText: name })).toHaveCount(0);

  // --- Everyone sees it now ----------------------------------------------------------
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(path);
  await expect(visitor.getByTestId("rating-line")).toContainText("4.0 (1 review)");
  const shown = visitor.getByTestId("review");
  await expect(shown).toContainText("Roomy and well made");
  await expect(shown).toContainText("Maya K. · Verified purchase");
  await expect(shown.getByTestId("review-reply")).toContainText("Thank you, Maya!");
  await expect(visitor.getByTestId("review-write")).toContainText("Sign in");
  // Search engines get the rating too.
  const jsonLd = await visitor.locator('script[type="application/ld+json"]').allTextContents();
  expect(jsonLd.join("")).toContain('"reviewCount":1');
  await visitorContext.close();
  await shopperContext.close();
});
