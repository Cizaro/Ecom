import { expect, test } from "@playwright/test";

test("health endpoint reports the process is up", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok" });
});

test("readiness endpoint reports all dependencies reachable", async ({ request }) => {
  const response = await request.get("/api/ready");
  const body = await response.json();
  expect(body.checks.map((check: { name: string }) => check.name)).toEqual([
    "database",
    "redis",
    "storage",
  ]);
  expect(response.status(), JSON.stringify(body)).toBe(200);
});

test("storefront shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("admin shell renders", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("security headers are set", async ({ request }) => {
  const headers = (await request.get("/")).headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
});
