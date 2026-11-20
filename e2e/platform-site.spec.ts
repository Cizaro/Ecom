import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// The platform site (D121): public pages and self-service sign-up on the
// platform's own host; never on a shop's address.

const platform = (baseURL: string | undefined) =>
  baseURL!.replace("localhost", "platform.localhost");

test("the platform site answers on its own host only", async ({ page, baseURL }) => {
  await page.goto(platform(baseURL));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sell online");
  await page.goto(`${platform(baseURL)}/templates`);
  await expect(page.getByTestId("template-list").getByRole("listitem")).toHaveCount(4);

  // A shop's address shows the shop, and the platform pages' folder is not reachable there.
  const direct = await page.goto("/platform-site/signup");
  expect(direct?.status()).toBe(404);
  const nested = await page.goto(`${platform(baseURL)}/platform-site`);
  expect(nested?.status()).toBe(404);
});

test("a shop owner signs up, lands in their new admin and their shop is online", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const run = randomUUID().slice(0, 8);
  await page.goto(`${platform(baseURL)}/signup?template=fresh`);
  const form = page.getByTestId("signup-form");
  await form.getByLabel("Your name").fill("E2E Owner");
  await form.getByLabel("Email").fill(`signup-${run}@example.test`);
  await form.getByLabel("Password").fill("e2e-signup-password");
  await form.getByLabel("Shop name").fill(`Shop ${run}`);
  await form.getByLabel("Web address").fill(`shop-${run}`);
  await expect(form.getByRole("radio", { name: /Fresh/ })).toBeChecked();

  // The terms must be accepted; what was typed is kept.
  await form.getByRole("button", { name: "Create my shop" }).click();
  await expect(page.getByText("Please accept the terms to continue.").first()).toBeVisible();
  await expect(form.getByLabel("Shop name")).toHaveValue(`Shop ${run}`);

  await form.getByLabel("Password").fill("e2e-signup-password");
  await form.getByLabel(/I agree to the terms/).check();
  await form.getByRole("button", { name: "Create my shop" }).click();

  await page.waitForURL(/\/admin\?welcome=1$/);
  await expect(page.getByTestId("welcome")).toBeVisible();
  await expect(page.getByTestId("trial-banner")).toContainText("14 days left");
  await expect(page.getByTestId("setup-guide")).toContainText("0 of 6 done");

  // The new shop answers on its free address.
  const port = new URL(baseURL!).port;
  await page.goto(`http://shop-${run}.localhost:${port}/`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Shop ${run}`);
});

test("an address that is taken is refused", async ({ page, baseURL }) => {
  await page.goto(`${platform(baseURL)}/signup`);
  const form = page.getByTestId("signup-form");
  await form.getByLabel("Your name").fill("E2E Owner");
  await form.getByLabel("Email").fill(`taken-${randomUUID().slice(0, 8)}@example.test`);
  await form.getByLabel("Password").fill("e2e-signup-password");
  await form.getByLabel("Shop name").fill("Taken");
  await form.getByLabel("Web address").fill("admin");
  await form.getByLabel(/I agree to the terms/).check();
  await form.getByRole("button", { name: "Create my shop" }).click();
  await expect(page.getByText("That address is reserved. Choose another.").first()).toBeVisible();
});
