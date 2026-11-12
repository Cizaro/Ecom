import { expect, test, type Page } from "@playwright/test";
import { ADMIN_API, ADMIN_PAGES, type RouteAccess } from "../apps/web/src/server/route-access";
import { SYSTEM_ROLES } from "../packages/core/src/identity/permissions";
import {
  BOTH_TENANTS_EMAIL,
  E2E_ROLES,
  MFA_OWNER_EMAIL,
  OTHER_OWNER_EMAIL,
  roleEmail,
  type E2ERole,
} from "./users";

// Isolation harness. Every admin page and API route in the access registry is
// visited signed out, as every role, and as a member of another tenant. A new
// route added to the registry is covered automatically; a route missing from
// the registry fails the unit test in apps/web/src/server/route-access.test.ts.

const password = () => process.env.E2E_PASSWORD!;
const guarded = ADMIN_PAGES.filter((page) => page.access.level !== "public");

// A registry path such as /admin/catalog/products/[id] is visited with an
// identifier that matches no record. The guard runs first, so the answer is
// 403 without access and 404 with it; nobody learns whether a record exists.
const UNKNOWN_ID = "00000000-0000-7000-8000-000000000000";
const isDynamic = (path: string) => path.includes("[");
const urlFor = (path: string) => path.replace(/\[\w+\]/g, UNKNOWN_ID);

async function signIn(page: Page, email: string) {
  await page.goto("/admin/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin(\/[a-z-/]+)?(\?.*)?$/);
  await expect(page).not.toHaveURL(/sign-in/);
}

function allowed(role: E2ERole, access: RouteAccess): boolean {
  if (access.level !== "permission") return true;
  const permissions: readonly string[] = SYSTEM_ROLES.find((r) => r.key === role)!.permissions;
  return permissions.includes(access.permission);
}

// The matrix only reads, so one browser project is enough.
// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "isolation matrix runs on desktop only");
});

test.describe("signed out", () => {
  for (const { path } of guarded) {
    test(`${path} redirects to sign-in`, async ({ page }) => {
      await page.goto(urlFor(path));
      await expect(page).toHaveURL(/\/admin\/sign-in$/);
    });
  }

  for (const { path, method } of ADMIN_API) {
    test(`${method} ${path} answers 401 in the standard error format`, async ({ request }) => {
      const response = await request.fetch(path, { method });
      expect(response.status()).toBe(401);
      const requestId = response.headers()["x-request-id"];
      expect(requestId).toBeTruthy();
      expect(await response.json()).toEqual({
        error: { code: "unauthenticated", message: expect.any(String), requestId },
      });
    });
  }
});

test.describe("each role in its own tenant", () => {
  for (const role of E2E_ROLES) {
    test(`${role} reaches exactly the pages its permissions allow`, async ({ page }) => {
      await signIn(page, roleEmail(role));

      for (const { path, access } of guarded) {
        const response = await page.goto(urlFor(path));
        const expected = !allowed(role, access) ? 403 : isDynamic(path) ? 404 : 200;
        expect(response?.status(), `${role} at ${path}`).toBe(expected);
        expect(page.url(), `${role} at ${path} was redirected`).toMatch(
          new RegExp(`${urlFor(path)}$`),
        );
      }

      for (const { path, method, access } of ADMIN_API) {
        const response = await page.request.fetch(path, { method });
        expect(response.status(), `${role} ${method} ${path}`).toBe(
          allowed(role, access) ? 200 : 403,
        );
      }

      const me = await (await page.request.get("/api/v1/admin/me")).json();
      expect(me.tenant.slug).toBe("e2e");
      expect(me.role.key).toBe(role);
      expect([...me.permissions].sort()).toEqual(
        [...SYSTEM_ROLES.find((r) => r.key === role)!.permissions].sort(),
      );
    });
  }

  test("a marketer and an owner see different things on the access page", async ({ browser }) => {
    const owner = await browser.newPage();
    const marketer = await browser.newPage();
    await signIn(owner, roleEmail("store_owner"));
    await signIn(marketer, roleEmail("marketer"));
    await owner.goto("/admin/access");
    await marketer.goto("/admin/access");

    await expect(owner.getByTestId("capability-staff.manage")).toHaveAttribute(
      "data-allowed",
      "true",
    );
    await expect(marketer.getByTestId("capability-staff.manage")).toHaveAttribute(
      "data-allowed",
      "false",
    );
    await expect(marketer.getByTestId("capability-marketing.write")).toHaveAttribute(
      "data-allowed",
      "true",
    );
    await expect(marketer.getByTestId("capability-orders.refund")).toHaveAttribute(
      "data-allowed",
      "false",
    );
    await expect(owner.getByRole("link", { name: "Team" })).toBeVisible();
    await expect(marketer.getByRole("link", { name: "Team" })).toHaveCount(0);
  });
});

test.describe("other tenant", () => {
  test("an owner of another tenant sees none of this tenant's staff", async ({ page }) => {
    await signIn(page, OTHER_OWNER_EMAIL);
    await page.goto("/admin/team");
    const emails = await page.getByTestId("team-member-email").allTextContents();
    expect(emails).toContain(OTHER_OWNER_EMAIL);
    for (const role of E2E_ROLES) expect(emails).not.toContain(roleEmail(role));

    const me = await (await page.request.get("/api/v1/admin/me")).json();
    expect(me.tenant.slug).toBe("e2e-other");
  });

  test("a member of two tenants chooses one and gets that tenant's role", async ({ page }) => {
    await signIn(page, BOTH_TENANTS_EMAIL);
    await page.goto("/admin/access");
    await expect(page).toHaveURL(/\/admin\/select-store$/);

    const otherStore = page.getByRole("listitem").filter({ hasText: "Other Test Store" });
    await otherStore.getByRole("button", { name: "Work in this store" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/access");
    await expect(page.getByTestId("access-role")).toHaveText("Store owner");
    expect((await page.goto("/admin/team"))?.status()).toBe(200);

    await page.goto("/admin/select-store");
    const mainStore = page.getByRole("listitem").filter({ hasText: "End-to-end Test Store" });
    await mainStore.getByRole("button", { name: "Work in this store" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/access");
    await expect(page.getByTestId("access-role")).toHaveText("Marketer");
    expect((await page.goto("/admin/team"))?.status()).toBe(403);
  });
});

test.describe("two-factor requirement", () => {
  test("an owner without two-factor is sent to set it up", async ({ page }) => {
    await signIn(page, MFA_OWNER_EMAIL);
    await page.goto("/admin/access");
    await expect(page).toHaveURL(/\/admin\/account\/security\?required=1$/);
    await expect(page.getByTestId("two-factor-required")).toContainText("Two-factor Test Store");
    expect((await page.request.get("/api/v1/admin/me")).status()).toBe(403);
  });
});
