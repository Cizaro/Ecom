import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { totpCode } from "../packages/testing/src/totp";
import { e2eEmail, type E2EPurpose } from "./users";

const MAILPIT = "http://localhost:8025";
const password = () => process.env.E2E_PASSWORD!;

async function signIn(page: Page, email: string, pass: string) {
  await page.goto("/admin/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Waits for the newest email to an address in the local Mailpit inbox. */
async function latestEmailText(request: APIRequestContext, to: string): Promise<string> {
  let text = "";
  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAILPIT}/api/v1/search`, {
          params: { query: `to:${to}` },
        });
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        if (!messages[0]) return false;
        const message = await request.get(`${MAILPIT}/api/v1/message/${messages[0].ID}`);
        text = ((await message.json()) as { Text: string }).Text;
        return true;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return text;
}

test.describe("staff sign-in", () => {
  const user = (purpose: E2EPurpose, project: string) => e2eEmail(purpose, project);

  test("protected pages send visitors to sign-in", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
    await page.goto("/admin/account/security");
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
  });

  test("wrong password is refused; right password signs in; sign-out ends access", async ({
    page,
    context,
  }, testInfo) => {
    const email = user("signin", testInfo.project.name);

    await signIn(page, email, "definitely-not-the-password");
    await expect(page.getByTestId("form-error")).toHaveText("Email or password is incorrect.");
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
    // The email is kept for the next attempt; the password is not.
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await expect(page.getByLabel("Password")).toHaveValue("");

    await signIn(page, email, password());
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("signed-in-email")).toHaveText(email);
    await expect(page.getByRole("main").getByText("End-to-end Test Store")).toBeVisible();
    await expect(page.getByRole("main").getByText("Store owner")).toBeVisible();

    const session = (await context.cookies()).find((c) => c.name === "ecom.session_token");
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });

    // Already signed in: the sign-in page sends you on.
    await page.goto("/admin/sign-in");
    await expect(page).toHaveURL(/\/admin$/);

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
  });

  test("password can be reset from an emailed link", async ({ page, request }, testInfo) => {
    const email = user("reset", testInfo.project.name);
    const newPassword = `${password()}-changed`;

    await page.goto("/admin/sign-in");
    await page.getByRole("link", { name: "Forgot your password?" }).click();
    // Wait for the new page: the sign-in page also has an "Email" field.
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByTestId("form-notice")).toContainText("If an account exists");

    const text = await latestEmailText(request, email);
    const link = new URL(/https?:\/\/\S+/.exec(text)![0]);
    // The link uses APP_URL; the test server runs on another port.
    await page.goto(link.pathname + link.search);

    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Repeat new password").fill("something-else-entirely");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("form-error")).toHaveText("The two passwords do not match.");

    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Repeat new password").fill(newPassword);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page).toHaveURL(/\/admin\/sign-in\?reset=1$/);
    await expect(page.getByRole("status")).toContainText("password has been changed");

    await signIn(page, email, password());
    await expect(page.getByTestId("form-error")).toHaveText("Email or password is incorrect.");
    await signIn(page, email, newPassword);
    await expect(page).toHaveURL(/\/admin$/);

    // The link is single-use.
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.goto(link.pathname + link.search);
    await page.getByLabel("New password", { exact: true }).fill(`${newPassword}-again`);
    await page.getByLabel("Repeat new password").fill(`${newPassword}-again`);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("form-error")).toContainText("invalid or has expired");
  });

  test("two-factor can be turned on and is then required at sign-in", async ({
    page,
  }, testInfo) => {
    const email = user("mfa", testInfo.project.name);

    await signIn(page, email, password());
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("link", { name: "Turn it on" }).click();
    await expect(page.getByRole("heading", { name: "Security", level: 1 })).toBeVisible();
    await expect(page.getByTestId("two-factor-status")).toContainText("Off.");

    await page.getByLabel("Confirm your password").fill("not-my-password");
    await page.getByRole("button", { name: "Set up two-factor" }).click();
    await expect(page.getByTestId("form-error")).toHaveText("Password is incorrect.");

    await page.getByLabel("Confirm your password").fill(password());
    await page.getByRole("button", { name: "Set up two-factor" }).click();
    await expect(page.getByTestId("totp-qr")).toBeVisible();
    const secret = (await page.getByTestId("totp-secret").innerText()).trim();
    await expect(page.getByTestId("backup-codes").getByRole("listitem")).not.toHaveCount(0);

    await page.getByLabel("Code from your authenticator app").fill(totpCode(secret));
    await page.getByRole("button", { name: "Turn on two-factor" }).click();
    await expect(page.getByTestId("two-factor-status")).toContainText("On.");

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await signIn(page, email, password());
    await expect(page).toHaveURL(/\/admin\/two-factor$/);

    // Password alone is not enough.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/sign-in$/);

    await signIn(page, email, password());
    await page.getByLabel("Code from your authenticator app").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByTestId("form-error")).toContainText("not valid");

    await page.getByLabel("Code from your authenticator app").fill(totpCode(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("signed-in-email")).toHaveText(email);
  });
});
