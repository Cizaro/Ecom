/// <reference lib="dom" />
// Browser globals are used inside page.evaluate callbacks below.
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

test("storefront shell renders the store for this host", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("store-name")).toHaveText("End-to-end Test Store");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("End-to-end Test Store");
});

test("a host name no store answers to gets 404", async ({ request }) => {
  const response = await request.get("/", { headers: { host: "nobody.example.test" } });
  expect(response.status()).toBe(404);
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

test("content security policy uses a fresh nonce on every response", async ({ request }) => {
  const first = (await request.get("/admin/sign-in")).headers()["content-security-policy"];
  const second = (await request.get("/admin/sign-in")).headers()["content-security-policy"];
  expect(first).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(first).toContain("object-src 'none'");
  expect(first).toContain("frame-ancestors 'none'");
  expect(first).not.toEqual(second);
});

for (const path of ["/", "/admin/sign-in", "/admin/forgot-password"]) {
  test(`${path} runs under the policy without violations`, async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
    });
    const response = await page.goto(path);
    const nonce = /'nonce-([^']+)'/.exec(response!.headers()["content-security-policy"]!)![1];

    // Every script Next.js rendered carries this response's nonce...
    const scripts = await page
      .locator("script")
      .evaluateAll((elements) => elements.map((element) => (element as HTMLScriptElement).nonce));
    expect(scripts.length).toBeGreaterThan(0);
    for (const scriptNonce of scripts) expect(scriptNonce).toBe(nonce);

    // ...nothing the page itself loads is blocked...
    await page.waitForLoadState("networkidle");
    expect(violations).toEqual([]);
    // ...and injected markup cannot run code: the classic XSS payload, an
    // inline event handler, is refused and reported.
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<img src="data:," alt="" onerror="window.__injected = true">',
      );
    });
    await expect.poll(() => violations.length).toBeGreaterThan(0);
    const injectedRan = await page.evaluate(
      () => (window as unknown as { __injected?: boolean }).__injected === true,
    );
    expect(injectedRan).toBe(false);
  });
}
