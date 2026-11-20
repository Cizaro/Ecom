import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// Accessibility (launch hardening, D119): the main shop and admin pages are
// checked against WCAG 2.1 A and AA with axe. Any violation fails the test
// and is listed with the page, the rule and the elements involved.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return result.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
}

const SHOP = [
  "/",
  "/products",
  "/search?q=bag",
  "/cart",
  "/account/sign-in",
  "/account/sign-up",
  "/contact",
];

test("shop pages meet WCAG 2.1 AA", async ({ page }) => {
  test.setTimeout(120_000);
  const found: Record<string, unknown> = {};
  for (const path of SHOP) {
    await page.goto(path);
    const list = await violations(page);
    if (list.length > 0) found[path] = list;
  }
  // A product page, whichever is listed first.
  await page.goto("/products");
  const product = page.locator('a[href^="/p/"]').first();
  if (await product.count()) {
    await product.click();
    await page.waitForURL(/\/p\//);
    const list = await violations(page);
    if (list.length > 0) found["/p/..."] = list;
  }
  expect(found).toEqual({});
});

const ADMIN = [
  "/admin",
  "/admin/orders",
  "/admin/catalog/products",
  "/admin/inbox",
  "/admin/ai",
  "/admin/marketing/posts",
  "/admin/reports",
  "/admin/team",
  "/admin/marketing/calendar",
  "/admin/marketing/campaigns",
  "/admin/marketing/library",
  "/admin/research",
  "/admin/social",
  "/admin/settings/store",
  "/admin/settings/shipping",
  "/admin/inventory",
  "/admin/customers",
  "/admin/reviews",
  "/admin/promotions",
  "/admin/account/security",
];

test("admin pages meet WCAG 2.1 AA", async ({ page }) => {
  test.setTimeout(120_000);
  const found: Record<string, unknown> = {};
  await page.goto("/admin/sign-in");
  const signInList = await violations(page);
  if (signInList.length > 0) found["/admin/sign-in"] = signInList;
  await signIn(page, roleEmail("store_owner"));
  for (const path of ADMIN) {
    await page.goto(path);
    const list = await violations(page);
    if (list.length > 0) found[path] = list;
  }
  expect(found).toEqual({});
});
