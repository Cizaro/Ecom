import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PLATFORM_ADMIN_EMAIL } from "./users";

// Plans and payments (D122): the platform owner sets a plan and how to pay,
// bills a shop that signed up and records its payment; the shop owner sees
// the plan, the paid invoice and the instructions; the public pricing shows
// the plan.

test("the platform owner bills a shop and records its payment", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const run = randomUUID().slice(0, 8);
  const platform = baseURL!.replace("localhost", "platform.localhost");
  const planName = `Starter ${run}`;

  // A shop owner signs up.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto(`${platform}/signup`);
  const form = owner.getByTestId("signup-form");
  await form.getByLabel("Your name").fill("Billing Owner");
  await form.getByLabel("Email").fill(`signup-bill-${run}@example.test`);
  await form.getByLabel("Password").fill("e2e-signup-password");
  await form.getByLabel("Shop name").fill(`Shop ${run}`);
  await form.getByLabel("Web address").fill(`shop-${run}`);
  await form.getByLabel(/I agree to the terms/).check();
  await form.getByRole("button", { name: "Create my shop" }).click();
  await owner.waitForURL(/\/admin\?welcome=1$/);

  // The platform owner creates a plan and says how to pay.
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await admin.goto("/admin/sign-in");
  await admin.getByLabel("Email").fill(PLATFORM_ADMIN_EMAIL);
  await admin.getByLabel("Password").fill(process.env.E2E_PASSWORD!);
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin).toHaveURL(/\/admin\/platform$/);

  await admin.goto("/admin/platform/plans/new");
  const plan = admin.getByTestId("plan-form");
  await plan.getByLabel("Name").fill(planName);
  await plan.getByLabel("Key").fill(`e2e_${run}`);
  await plan.getByLabel("Monthly price").fill("19");
  await plan.getByLabel("Products included").fill("200");
  await plan.getByRole("button", { name: "Create plan" }).click();
  await expect(admin.getByTestId("plan-saved")).toBeVisible();
  await expect(admin.getByTestId("plan-table")).toContainText(planName);

  const instructions = admin.getByTestId("payment-instructions-form");
  await instructions.getByLabel("Payment instructions").fill(`Whish to 70 000 000 (${run})`);
  await instructions.getByRole("button", { name: "Save" }).click();
  await expect(instructions.getByTestId("form-notice")).toBeVisible();

  // It shows on the public pricing section.
  await admin.goto(`${platform}/#pricing`);
  await expect(admin.getByTestId("pricing-plans")).toContainText(planName);
  await expect(admin.getByTestId("pricing-plans")).toContainText("$19.00");

  // The shop: on the plan, an invoice, the payment recorded.
  await admin.goto(`/admin/platform/shops?q=shop-${run}`);
  await admin.getByRole("link", { name: `Shop ${run}` }).click();
  const planForm = admin.getByTestId("shop-plan-form");
  await planForm.getByLabel("Plan").selectOption(`e2e_${run}`);
  await planForm.getByRole("button", { name: "Change plan" }).click();
  await expect(planForm.getByTestId("form-notice")).toBeVisible();

  const invoiceForm = admin.getByTestId("invoice-form");
  await invoiceForm.getByRole("button", { name: "Create invoice" }).click();
  await expect(invoiceForm.getByTestId("form-notice")).toContainText("Invoice INV-");
  const list = admin.getByTestId("invoice-list");
  await expect(list).toContainText("$19.00");

  const pay = list.locator('[data-testid^="pay-"]').first();
  await pay.getByLabel("Paid by").selectOption("omt");
  await pay.getByLabel("Reference (optional)").fill(`OMT-${run}`);
  await pay.getByRole("button", { name: "Record payment" }).click();
  await expect(admin.getByTestId("invoice-list")).toContainText(`by OMT (OMT-${run})`);

  // The shop owner sees it on their billing page.
  await owner.goto(`${platform}/admin/settings/billing`);
  await expect(owner.getByTestId("current-plan")).toContainText(planName);
  await expect(owner.getByTestId("current-plan")).toContainText("Paid");
  await expect(owner.getByTestId("payment-instructions")).toContainText(run);
  await expect(owner.getByTestId("shop-invoices")).toContainText("Paid");

  await ownerContext.close();
  await adminContext.close();
});
