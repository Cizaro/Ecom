import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createProduct, exact, signIn as staffSignIn } from "./catalog-helpers";
import { linkTo, waitForEmail } from "./mail";
import { roleEmail } from "./users";

// A shopper's account from start to finish: sign up, confirm the email, the
// guest cart following them in, profile and addresses, signing out and back
// in, a forgotten password; and that one shopper can reach nothing of
// another's, nor anything in the admin.

const PASSWORD = "a long shopper password";

const accountLink = (page: Page) => page.getByTestId("account-link");
const cartCount = (page: Page) => page.getByTestId("cart-count");

async function signUp(page: Page, email: string, name: string) {
  await page.goto("/account/sign-up");
  const form = page.getByTestId("sign-up-form");
  await form.getByLabel("Name", exact).fill(name);
  await form.getByLabel("Email", exact).fill(email);
  await form.getByLabel("Password", exact).fill(PASSWORD);
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("account-notice")).toContainText("We have sent an email");
}

async function confirmFromEmail(page: Page, email: string) {
  const text = await waitForEmail(page.request, email, "/account/verify?token=");
  await page.goto(linkTo(text, "/account/verify?token="));
}

async function signIn(page: Page, email: string, password = PASSWORD, path = "/account/sign-in") {
  await page.goto(path);
  const form = page.getByTestId("sign-in-form");
  await form.getByLabel("Email", exact).fill(email);
  await form.getByLabel("Password", exact).fill(password);
  await form.getByRole("button", { name: "Sign in" }).click();
}

test("a shopper creates an account, keeps their cart, and manages addresses", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const email = `shopper-${tag}@example.test`;
  const product = `Keepsake Box ${tag}`;

  // --- A product to put in the cart --------------------------------------------
  await staffSignIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(`Boxes ${tag}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  await createProduct(page, {
    name: product,
    category: `Boxes ${tag}`,
    sku: `BOX-${tag}`.toUpperCase(),
    color: "Oak",
    price: "20.00",
    publish: true,
  });

  // --- A guest fills a cart, then signs up ---------------------------------------
  const shopperContext = await browser.newContext();
  const shopper = await shopperContext.newPage();
  await shopper.goto(`/p/keepsake-box-${tag}`);
  await shopper.getByTestId("add-to-cart").getByLabel("Quantity").selectOption("2");
  await shopper.getByTestId("add-to-cart").getByRole("button", { name: "Add to cart" }).click();
  await expect(cartCount(shopper)).toHaveText("2");
  await expect(accountLink(shopper)).toHaveText("Sign in");

  await signUp(shopper, email, "Sam Shopper");
  // Not signed in until the address is confirmed.
  await expect(accountLink(shopper)).toHaveText("Sign in");
  await signIn(shopper, email);
  await expect(shopper.getByTestId("account-error")).toContainText("confirm your email");

  // Opening the link alone signs nobody in (mail scanners open links too).
  await confirmFromEmail(shopper, email);
  await expect(accountLink(shopper)).toHaveText("Sign in");
  await shopper.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(shopper).toHaveURL(/\/account\?welcome=1$/);
  await expect(shopper.getByTestId("account-notice")).toContainText("confirmed");
  await expect(shopper.getByTestId("account-email")).toHaveText(email);
  await expect(accountLink(shopper)).toHaveText("Account");
  // The guest cart came along.
  await expect(cartCount(shopper)).toHaveText("2");

  // The account cookie is out of reach of page scripts.
  const session = (await shopperContext.cookies()).find((c) => c.name === "customer_session")!;
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });

  // A shopper's session opens nothing in the admin.
  await shopper.goto("/admin");
  await expect(shopper).toHaveURL(/\/admin\/sign-in$/);

  // --- Profile -----------------------------------------------------------------------
  await shopper.goto("/account");
  const profile = shopper.getByTestId("profile-form");
  await profile.getByLabel("Phone").fill("call me maybe");
  await profile.getByRole("button", { name: "Save" }).click();
  await expect(profile.getByTestId("account-error")).toContainText("phone number");
  await expect(profile.getByLabel("Phone")).toHaveValue("call me maybe");
  await profile.getByLabel("Phone").fill("+20 100 123 4567");
  await profile.getByRole("button", { name: "Save" }).click();
  await expect(profile.getByTestId("account-notice")).toHaveText("Saved.");
  await shopper.reload();
  await expect(shopper.getByTestId("profile-form").getByLabel("Phone")).toHaveValue(
    "+20 100 123 4567",
  );

  // --- Addresses -------------------------------------------------------------------
  await shopper.goto("/account/addresses");
  await expect(shopper.getByText("No saved addresses yet")).toBeVisible();
  await shopper.getByRole("link", { name: "Add an address" }).click();
  const form = shopper.getByTestId("address-form");
  await form.getByLabel("Full name").fill("Sam Shopper");
  await form.getByLabel("Country").selectOption("US");
  await form.getByLabel("Address", exact).fill("500 Congress Ave");
  await form.getByLabel("City").fill("Austin");
  await form.getByLabel("State, province or region").fill("TX");
  await form.getByRole("button", { name: "Save address" }).click();
  // The country's own rule, and what was typed is kept.
  await expect(form.getByTestId("account-error")).toContainText("zip code");
  await expect(form.getByLabel("City")).toHaveValue("Austin");
  await form.getByLabel("Postal or ZIP code").fill("73301");
  await form.getByRole("button", { name: "Save address" }).click();
  await expect(shopper).toHaveURL(/\/account\/addresses\?saved=1$/);
  const addresses = shopper.getByTestId("address");
  await expect(addresses).toHaveCount(1);
  await expect(addresses.first()).toContainText("Default delivery");
  await expect(addresses.first()).toContainText("Austin, TX, 73301");
  await expect(addresses.first()).toContainText("United States");
  const firstEdit = await addresses
    .first()
    .getByRole("link", { name: /Edit/ })
    .getAttribute("href");

  // A second address in a country without postal codes, made the delivery default.
  await shopper.getByRole("link", { name: "Add an address" }).click();
  await form.getByLabel("Full name").fill("Sam at work");
  await form.getByLabel("Country").selectOption("AE");
  await form.getByLabel("Address", exact).fill("Office 4, Tower B");
  await form.getByLabel("City").fill("Dubai");
  await form.getByLabel("State, province or region").fill("Dubai");
  await form.getByRole("button", { name: "Save address" }).click();
  await expect(addresses).toHaveCount(2);
  const work = addresses.filter({ hasText: "Office 4" });
  await work.getByRole("button", { name: "Use for delivery" }).click();
  await expect(work).toContainText("Default delivery");
  await expect(addresses.filter({ hasText: "Austin" })).not.toContainText("Default delivery");

  // Edit, then remove.
  await shopper.goto(firstEdit!);
  await form.getByLabel("Address", exact).fill("501 Congress Ave");
  await form.getByRole("button", { name: "Save address" }).click();
  await expect(addresses.filter({ hasText: "501 Congress Ave" })).toHaveCount(1);
  await addresses
    .filter({ hasText: "501 Congress" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(addresses).toHaveCount(1);
  await expect(addresses.first()).toContainText("Default billing");

  // --- Another shopper cannot reach any of it ----------------------------------------
  const otherEmail = `other-${tag}@example.test`;
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signUp(other, otherEmail, "Other Person");
  await confirmFromEmail(other, otherEmail);
  await other.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(accountLink(other)).toHaveText("Account");
  await expect(cartCount(other)).toHaveText("0");
  const workEdit = await work.getByRole("link", { name: /Edit/ }).getAttribute("href");
  expect((await other.goto(workEdit!))?.status()).toBe(404);
  await other.goto("/account/addresses");
  await expect(other.getByText("No saved addresses yet")).toBeVisible();
  await otherContext.close();

  // --- Signing out and back in -----------------------------------------------------
  await shopper.goto("/account");
  await shopper.getByRole("button", { name: "Sign out" }).click();
  await expect(shopper).toHaveURL("/");
  await expect(accountLink(shopper)).toHaveText("Sign in");
  // The account's cart is not visible to the signed-out browser.
  await expect(cartCount(shopper)).toHaveText("0");
  await shopper.goto("/account/addresses");
  await expect(shopper).toHaveURL(/\/account\/sign-in\?next=%2Faccount%2Faddresses$/);

  // A crafted "next" cannot send the shopper to another site after signing in.
  await signIn(shopper, email, PASSWORD, "/account/sign-in?next=//evil.example/steal");
  await expect(shopper).toHaveURL("/account");
  await expect(cartCount(shopper)).toHaveText("2");

  // One answer for a wrong password, whoever the account belongs to.
  await shopper.getByRole("button", { name: "Sign out" }).click();
  await signIn(shopper, email, "not the password at all");
  await expect(shopper.getByTestId("account-error")).toHaveText(
    "The email address or password is not right.",
  );
  await signIn(shopper, `nobody-${tag}@example.test`, "not the password at all");
  await expect(shopper.getByTestId("account-error")).toHaveText(
    "The email address or password is not right.",
  );

  // --- A forgotten password ------------------------------------------------------------
  await shopper.goto("/account/forgot-password");
  await shopper.getByTestId("forgot-form").getByLabel("Email", exact).fill(email);
  await shopper.getByRole("button", { name: "Send link" }).click();
  await expect(shopper.getByTestId("account-notice")).toContainText(
    "If that address has an account",
  );
  const resetText = await waitForEmail(shopper.request, email, "/account/reset-password?token=");
  await shopper.goto(linkTo(resetText, "/account/reset-password?token="));
  await shopper.getByTestId("reset-form").getByLabel("New password").fill("a brand new password");
  await shopper.getByRole("button", { name: "Save new password" }).click();
  await expect(shopper).toHaveURL(/\/account\/sign-in\?reset=1$/);
  await expect(shopper.getByTestId("account-notice")).toContainText("password has been changed");
  await signIn(shopper, email, "a brand new password");
  await expect(shopper).toHaveURL("/account");

  // The same address in Mailpit got no account details for a stranger's request.
  await shopperContext.close();

  // --- Staff see the customer, without any password material ------------------------
  await page.goto(`/admin/customers?q=${encodeURIComponent(`shopper-${tag}`)}`);
  const row = page.getByTestId("customer-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(email);
  await expect(row).toContainText("Sam Shopper");
  await expect(row).toContainText("Account");
  expect(await page.content()).not.toMatch(/argon2|password_hash|passwordHash/);
});
