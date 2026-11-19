import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// Milestone 6.3: the owner connects the store's Facebook Page and Instagram
// account through the sign-in (the built-in Meta stand-in, which never calls
// out), Meta's webhook notifications are checked and stored, and the owner
// disconnects. The test keys come from playwright.config.ts.

const APP_SECRET = "e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0";
const VERIFY_TOKEN = "e2e-meta-verify-token";
const INSTAGRAM_ID = "17800000000000001";

const sign = (body: string) =>
  `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;

test("the owner connects Facebook and Instagram, receives notifications and disconnects", async ({
  page,
  request,
}, testInfo) => {
  // One Meta connection per store: run once, not in both browser projects at once.
  test.skip(testInfo.project.name !== "desktop", "one connection per store");
  test.setTimeout(120_000);

  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/social");
  await expect(page.getByTestId("meta-fake-mode")).toBeVisible();
  // A connection left over from an earlier run is removed first.
  if (await page.getByTestId("meta-disconnect").isVisible()) {
    await page.getByTestId("meta-disconnect").getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByTestId("meta-disconnect")).toBeHidden();
  }

  await page
    .getByTestId("meta-connect")
    .getByRole("button", { name: "Connect Facebook and Instagram" })
    .click();
  await expect(page).toHaveURL(/\/admin\/social\?choose=1/);
  const choice = page.getByTestId("meta-page").filter({ hasText: "Test Shop Page" });
  await expect(choice).toContainText("@testshop");
  await choice.getByRole("button", { name: "Connect this Page" }).click();
  await expect(page.getByTestId("meta-connected-notice")).toHaveText(
    "Connected to Test Shop Page.",
  );
  const connection = page.getByTestId("meta-connection");
  await expect(connection).toContainText("Test Shop Page");
  await expect(connection).toContainText("@testshop");
  await expect(connection).toContainText("Working");

  // Meta's subscription check: only with the right token.
  const ok = await request.get(
    `/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=4815162342`,
  );
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toBe("4815162342");
  const wrong = await request.get(
    "/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1",
  );
  expect(wrong.status()).toBe(403);

  // A notification is acted on only when signed with the App Secret.
  const body = JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: INSTAGRAM_ID,
        changes: [{ field: "comments", value: { id: `${Date.now()}`, text: "How much?" } }],
      },
    ],
  });
  const unsigned = await request.post("/api/webhooks/meta", {
    data: body,
    headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=00" },
  });
  expect(unsigned.status()).toBe(401);
  const signed = await request.post("/api/webhooks/meta", {
    data: body,
    headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
  });
  expect(signed.status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId("meta-events")).toContainText("instagram comment");
  await expect(connection).not.toContainText("None yet");

  await page.getByTestId("meta-disconnect").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByTestId("meta-disconnected-notice")).toBeVisible();
  await expect(page.getByTestId("meta-connection")).toBeHidden();
});

test("only the owner can open the Instagram and Facebook page", async ({ page }) => {
  await signIn(page, roleEmail("marketer"));
  const response = await page.goto("/admin/social");
  expect(response?.status()).toBe(403);
});
