import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createProduct, exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// The AI assistant page with the built-in test stand-in (no outside calls):
// staff try a question and see a draft built only from the store's facts,
// with the facts it used; the owner edits the business profile and settings.

test("staff try the AI assistant and the owner sets it up", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const categoryName = `AI ${tag}`;
  const name = `Harbor Satchel ${tag}`;

  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(categoryName);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  await createProduct(page, {
    name,
    category: categoryName,
    sku: `AI-${tag.toUpperCase()}`,
    color: "Brown",
    price: "75.00",
    publish: true,
  });

  await page.goto("/admin");
  await page.getByRole("link", { name: "AI assistant" }).first().click();
  await expect(page.getByTestId("ai-mock-notice")).toContainText("Test mode");

  // A question the store's facts answer: the draft quotes the product fact.
  const form = page.getByTestId("ai-try-form");
  await form.getByLabel("A customer's question").fill(`How much is the Harbor Satchel ${tag}?`);
  await form.getByRole("button", { name: "Draft an answer" }).click();
  const result = page.getByTestId("ai-try-result");
  await expect(result).toContainText("Answered from the facts");
  await expect(page.getByTestId("ai-try-reply")).toContainText("$75.00");
  await expect(page.getByTestId("ai-try-citations")).toContainText(`product:harbor-satchel-${tag}`);
  await expect(page.getByTestId("ai-runs")).toContainText("customer.answer");

  // The owner describes the business and chooses what the AI may do alone.
  const profile = page.getByTestId("ai-profile-form");
  await profile.getByLabel("What the business does").fill(`Leather bags and wallets, ${tag}.`);
  await profile.getByRole("button", { name: "Save profile" }).click();
  await expect(profile.getByTestId("form-notice")).toHaveText("Business profile saved.");
  const settings = page.getByTestId("ai-settings-form");
  await settings.getByLabel("What the AI may do alone").selectOption("draft");
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(settings.getByTestId("form-notice")).toHaveText("AI settings saved.");
});

test("a member of staff without AI access cannot open the AI page", async ({ page }) => {
  await signIn(page, roleEmail("inventory_manager"));
  const response = await page.goto("/admin/ai");
  expect(response?.status()).toBe(403);
});
