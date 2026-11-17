import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// Policy pages: the template cannot be published with blanks left; once the
// store's own rules are written it is published, linked in the footer, and
// listed for search engines.

test("staff publish a returns page only after filling the blanks", async ({ page, browser }) => {
  const marker = randomUUID().slice(0, 6);
  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin");
  await page.getByRole("link", { name: "Policy pages" }).first().click();
  const form = page.getByTestId("page-form-returns");
  const text = form.getByLabel("Text");

  // A page with a blank left is refused. (Earlier runs may have saved this
  // page already, so the template itself is checked by the unit tests.)
  await text.fill(
    `You can return unused items within [NUMBER OF DAYS] days.\n\n## Refunds\n- Cash refunds ${marker}`,
  );
  await form.getByLabel(/Published/).check();
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByTestId("form-error")).toContainText("Fill in the blanks");

  await form
    .getByLabel("Text")
    .fill(
      `You can return unused items within 14 days of receiving them.\n\n## Refunds\n- Cash refunds within 3 days ${marker}`,
    );
  await form.getByLabel(/Published/).check();
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByTestId("form-notice")).toHaveText("Saved and published.");

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto("/");
  await visitor.getByTestId("policy-link-returns").click();
  const shown = visitor.getByTestId("policy-page");
  await expect(shown.getByRole("heading", { level: 2, name: "Refunds" })).toBeVisible();
  // The desktop and phone runs save the same page at the same time, so check
  // the shared wording rather than this run's marker.
  await expect(shown.getByText(/Cash refunds within 3 days/)).toBeVisible();
  const sitemap = await visitor.request.get("/sitemap.xml");
  expect(await sitemap.text()).toContain("/policies/returns");
  await visitorContext.close();
});
