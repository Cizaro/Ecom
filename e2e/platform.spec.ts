import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signIn } from "./catalog-helpers";
import { PLATFORM_ADMIN_EMAIL, roleEmail } from "./users";

// The platform owner's panel (D120): the platform administrator sees every
// shop, creates one with its owner, suspends and resumes it. A shop's own
// owner cannot open the panel.

test("the platform owner creates a shop, then suspends and resumes it", async ({ page }) => {
  test.setTimeout(90_000);
  const tag = randomUUID().slice(0, 8);
  await page.goto("/admin/sign-in");
  await page.getByLabel("Email").fill(PLATFORM_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  // No shop of its own: straight to the platform panel.
  await expect(page).toHaveURL(/\/admin\/platform$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
  await expect(page.getByTestId("stat-shops")).toBeVisible();

  await page
    .getByRole("navigation", { name: "Platform" })
    .getByRole("link", { name: "New shop" })
    .click();
  const form = page.getByTestId("new-shop-form");
  await form.getByLabel("Shop name").fill(`Tamara ${tag}`);
  await form.getByLabel("Short name").fill(`tamara-${tag}`);
  await form.getByLabel("Web address").fill(`tamara-${tag}.platform.test`);
  await form.getByLabel("Owner's email").fill(`tamara-${tag}@example.test`);
  await form.getByLabel("Owner's name").fill("Tamara");
  await form.getByRole("button", { name: "Create shop" }).click();

  await expect(page).toHaveURL(/\/admin\/platform\/shops\/[0-9a-f-]{36}\?created=1$/);
  await expect(page.getByTestId("shop-created")).toContainText(`tamara-${tag}@example.test`);
  await expect(page.getByTestId("shop-team")).toContainText("Store owner");

  const status = page.getByTestId("shop-status-form");
  await status.getByRole("button", { name: "Suspend" }).click();
  await expect(status.getByRole("alert")).toContainText("why");
  await status.getByLabel(/Reason/).fill("Testing the switch");
  await status.getByRole("button", { name: "Suspend" }).click();
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Suspended");
  await page.getByTestId("shop-status-form").getByRole("button", { name: "Resume" }).click();
  await expect(
    page.getByTestId("shop-status-form").getByRole("button", { name: "Suspend" }),
  ).toBeVisible();

  await page.goto(`/admin/platform/shops?q=tamara-${tag}`);
  await expect(page.getByTestId("platform-shop-row")).toHaveCount(1);
  await expect(page.getByTestId("platform-shop-row")).toContainText("Active");
});

test("a shop's own owner cannot open the platform panel", async ({ page }) => {
  await signIn(page, roleEmail("store_owner"));
  await expect(page.getByTestId("platform-link")).toHaveCount(0);
  const response = await page.goto("/admin/platform");
  expect(response?.status()).toBe(403);
});
