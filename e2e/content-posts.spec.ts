import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createProduct, exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// Milestone 6.1: a content editor adds a photo to the library and prepares a
// post with an AI caption (the built-in test stand-in, no outside calls); the
// editor cannot approve it; a marketer asks for a change, then approves and
// records it as published; the calendar shows it on its planned day.

test("an editor prepares a post, a marketer approves and publishes it, the calendar shows it", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const product = `Post Tote ${tag}`;
  const title = `Summer totes ${tag}`;
  const fileTitle = `Beach shot ${tag}`;
  // Next month, the 15th, at 18:30 in the store's time zone.
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 7);

  // The owner adds a product to feature.
  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(`Posts ${tag}`);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  await createProduct(page, {
    name: product,
    category: `Posts ${tag}`,
    sku: `PST-${tag}`.toUpperCase(),
    color: "Sand",
    price: "42.00",
    stock: "5",
    publish: true,
  });
  await page.context().clearCookies();

  // --- The editor adds a photo and prepares the post --------------------------------
  await signIn(page, roleEmail("content_editor"));
  await page.goto("/admin/marketing/library");
  const upload = page.getByTestId("library-upload");
  await upload.getByLabel("Photo or video").setInputFiles({
    name: "tote.png",
    mimeType: "image/png",
    buffer: readFileSync(resolve(import.meta.dirname, "fixtures/tote.png")),
  });
  await upload.getByLabel("Title", exact).fill(fileTitle);
  await upload.getByLabel("Tags", exact).fill("summer, totes");
  await upload.getByLabel("Who owns it, and your permission to use it").fill("Our own photo");
  await upload.getByRole("button", { name: "Add to library" }).click();
  await expect(upload.getByTestId("form-notice")).toHaveText("Added to the library.");
  await expect(page.getByTestId("library-items")).toContainText(fileTitle);

  await page.goto("/admin/marketing/posts/new");
  const form = page.getByTestId("post-form");
  await form.getByLabel("Name (for your team)").fill(title);
  await form.getByLabel("Where").selectOption("instagram");
  await form.getByLabel("Planned for").fill(`${month}-15T18:30`);
  await form.getByTestId("post-file-picker").getByLabel(fileTitle).check();
  await form.getByTestId("post-product-picker").getByLabel(product).check();
  await form.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/admin\/marketing\/posts\/[0-9a-f-]{36}$/);

  // A caption drafted by AI from the product's real details, then used and saved.
  const draft = page.getByTestId("caption-draft");
  await draft.getByRole("button", { name: "Draft a caption with AI" }).click();
  await expect(draft.getByTestId("caption-draft-text")).toContainText(product);
  await draft.getByRole("button", { name: "Use it in the caption" }).click();
  await expect(page.getByLabel("Caption", exact)).toHaveValue(new RegExp(product));
  await page.getByTestId("post-form").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("post-form").getByTestId("form-notice")).toBeVisible();

  await page.getByTestId("post-submit").getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByTestId("post-status")).toContainText("Waiting for approval");
  // The editor cannot approve.
  await expect(page.getByTestId("post-approve")).toHaveCount(0);
  const postUrl = page.url();
  await page.context().clearCookies();

  // --- The marketer asks for a change, the editor fixes it ---------------------------
  await signIn(page, roleEmail("marketer"));
  await page.goto(postUrl);
  const changes = page.getByTestId("post-request_changes");
  await changes.getByLabel("What should change?").fill("Mention free returns.");
  await changes.getByRole("button", { name: "Ask for changes" }).click();
  await expect(page.getByTestId("post-review-note")).toContainText("Mention free returns.");

  const caption = page.getByLabel("Caption", exact);
  await caption.fill(`${await caption.inputValue()}\nFree returns within 14 days.`);
  await page.getByTestId("post-form").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("post-form").getByTestId("form-notice")).toBeVisible();
  await page.getByTestId("post-submit").getByRole("button", { name: "Send for approval" }).click();

  // --- Approved, posted by hand, and recorded ----------------------------------------
  await page.getByTestId("post-approve").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("post-status")).toContainText("Approved");
  const publish = page.getByTestId("post-publish");
  await publish.getByLabel("Link to the live post").fill("https://www.instagram.com/p/example/");
  await publish.getByRole("button", { name: "Mark as published" }).click();
  await expect(page.getByTestId("post-status")).toContainText("Published");
  await expect(page.getByTestId("post-caption")).toContainText("Free returns within 14 days.");
  await expect(page.getByTestId("post-form")).toHaveCount(0);

  // --- The calendar shows it on the 15th ---------------------------------------------
  await page.goto(`/admin/marketing/calendar?month=${month}`);
  await expect(page.getByTestId(`calendar-day-${month}-15`)).toContainText(title);
  await expect(page.getByTestId(`calendar-day-${month}-15`)).toContainText("6:30");
});
