import { expect, test } from "@playwright/test";
import { signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// One storefront template, each store with its own look: staff change the
// colours, corners, font and contact details, and the shop shows them. Only
// the look is changed here (not the store's name), so other tests running at
// the same time are not affected.

test("staff change the store's look and contact details; the shop shows them", async ({
  page,
  browser,
}) => {
  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin");
  await page.getByRole("link", { name: "Store and look" }).first().click();
  await expect(page.getByRole("heading", { name: "Store and look" })).toBeVisible();

  // A colour too pale to read is refused with an explanation.
  const look = page.getByTestId("store-look-form");
  await look.getByLabel("Accent colour").fill("#fde68a");
  await look.getByRole("button", { name: "Save look" }).click();
  await expect(look.getByTestId("form-error")).toContainText("too light to read");

  // A ready-made look.
  await look.getByLabel("Start from a ready-made look").selectOption("ocean");
  await look.getByRole("button", { name: "Save look" }).click();
  await expect(look.getByTestId("form-notice")).toContainText("Look saved");
  await expect(page.getByTestId("look-preview")).toHaveAttribute(
    "style",
    /--color-brand:\s*#1e3a8a/,
  );

  // Contact details and a tagline.
  const details = page.getByTestId("store-details-form");
  await details.getByLabel("Tagline").fill("Bags and accessories, delivered across Lebanon");
  await details.getByLabel("Contact email").fill("hello@example.test");
  await details.getByLabel("Contact phone").fill("+961 1 234 567");
  await details.getByRole("button", { name: "Save details" }).click();
  await expect(details.getByTestId("form-notice")).toHaveText("Store details saved.");

  // --- The shop, as a visitor sees it ------------------------------------------------
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto("/");
  const shop = visitor.getByTestId("storefront");
  await expect(shop).toHaveAttribute("style", /--color-brand:\s*#1e3a8a/);
  // The cart badge uses the brand colour, with readable text chosen for it.
  const badge = visitor.getByTestId("cart-count");
  await expect(badge).toHaveCSS("background-color", "rgb(30, 58, 138)");
  await expect(badge).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(visitor.getByTestId("store-tagline")).toHaveText(
    "Bags and accessories, delivered across Lebanon",
  );
  await expect(visitor.getByTestId("store-contact")).toContainText("hello@example.test");
  await expect(visitor.getByTestId("store-contact")).toContainText("+961 1 234 567");
  await visitorContext.close();

  // The admin keeps its own neutral look.
  await expect(page.locator("body")).not.toHaveAttribute("style", /--color-brand/);
});
