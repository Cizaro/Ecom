import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { makeTestImage } from "../packages/testing/src/images";
import { OTHER_OWNER_EMAIL, roleEmail } from "./users";

// Product images from a staff member's point of view: upload (good and bad
// files), describe, reorder, remove; what a read-only role and another store
// can see; and that the stored file is clean and publicly served.

const password = () => process.env.E2E_PASSWORD!;
const exact = { exact: true } as const;

async function signIn(page: Page, email: string) {
  await page.goto("/admin/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/**
 * The address of the file shown for an image on the page. Found by tag, not
 * by role: an image without a description has no "img" role.
 */
async function originalUrl(item: Locator): Promise<string> {
  const src = await item.locator("img").getAttribute("src");
  expect(src).toMatch(/\/public\/[0-9a-f-]{36}\/[0-9a-f]{32}\/(original\.(jpg|png)|w\d+\.webp)$/);
  return src!;
}

test("an owner manages product images; others are kept to their access", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const tag = `${testInfo.project.name}-${randomUUID().slice(0, 6)}`;
  const productName = `Satchel ${tag}`;
  const categoryName = `Satchels ${tag}`;

  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/products/new");
  await page.getByLabel("Name", exact).fill(productName);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { name: productName })).toBeVisible();
  const productUrl = page.url();

  const items = page.getByTestId("image-item");
  const uploader = page.getByTestId("image-uploader");
  await expect(page.getByText("No images yet")).toBeVisible();

  // Three files at once: a phone photo with location data, a PNG, and a text
  // file named like a picture. The two pictures are stored; the third is refused.
  await uploader.getByLabel("Add images").setInputFiles([
    {
      name: "front.jpg",
      mimeType: "image/jpeg",
      buffer: await makeTestImage({ width: 1000, height: 800, withLocation: true }),
    },
    {
      name: "side.png",
      mimeType: "image/png",
      buffer: await makeTestImage({ width: 700, height: 700, format: "png" }),
    },
    { name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not a picture at all") },
  ]);
  await uploader.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByTestId("upload-notice")).toHaveText("2 images uploaded.");
  await expect(page.getByTestId("upload-error")).toHaveText(
    "notes.jpg: Use a JPEG, PNG or WebP image.",
  );
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Main image");
  await expect(items.nth(1)).not.toContainText("Main image");

  // The stored file is served publicly, as an image, without the camera data.
  const firstUrl = await originalUrl(items.nth(0));
  const secondUrl = await originalUrl(items.nth(1));
  const served = await request.get(firstUrl);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toMatch(/^image\/(jpeg|webp)$/);
  const body = await served.body();
  expect(body.includes("TestCam")).toBe(false);
  expect(body.includes("GPS")).toBe(false);
  // The image is actually displayed (the Content Security Policy allows it).
  await expect
    .poll(() =>
      items
        .nth(0)
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);

  // Describe the second image; the description survives a reload.
  const second = items.nth(1);
  await second.getByLabel("Description").fill("Satchel from the side");
  await second.getByRole("button", { name: "Save image" }).click();
  await expect(second.getByTestId("form-notice")).toHaveText("Saved.");
  await page.reload();
  await expect(items.nth(1).getByLabel("Description")).toHaveValue("Satchel from the side");
  await expect(items.nth(1).locator("img")).toHaveAttribute("alt", "Satchel from the side");
  await expect(items.nth(0)).toContainText("No description");

  // Make it the main image: it moves to the front.
  await items.nth(1).getByRole("button", { name: "Make main" }).click();
  await expect(items.nth(0).getByLabel("Description")).toHaveValue("Satchel from the side");
  await expect(items.nth(0)).toContainText("Main image");
  expect(await originalUrl(items.nth(0))).toBe(secondUrl);
  await expect(items.nth(0).getByRole("button", { name: "Make main" })).toHaveCount(0);
  await expect(items.nth(1).getByRole("button", { name: "Move later" })).toHaveCount(0);

  // The product list shows the main image.
  await page.goto("/admin/catalog/products");
  const row = page.getByTestId("product-row").filter({ hasText: productName });
  await expect(row.locator("img")).toHaveAttribute("src", secondUrl);

  // A marketer sees the images but has no way to change them.
  const marketerContext = await browser.newContext();
  const marketer = await marketerContext.newPage();
  await signIn(marketer, roleEmail("marketer"));
  await marketer.goto(productUrl);
  await expect(marketer.getByTestId("image-item")).toHaveCount(2);
  await expect(marketer.getByTestId("image-item").nth(0)).toContainText("Satchel from the side");
  await expect(marketer.getByTestId("image-uploader")).toHaveCount(0);
  for (const name of ["Save image", "Make main", "Move later", "Remove"]) {
    await expect(marketer.getByRole("button", { name })).toHaveCount(0);
  }
  await marketerContext.close();

  // The owner of another store cannot open the product at all.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other, OTHER_OWNER_EMAIL);
  expect((await other.goto(productUrl))?.status()).toBe(404);
  await otherContext.close();

  // Removing an image removes its file from storage too.
  await page.goto(productUrl);
  page.on("dialog", (dialog) => void dialog.accept());
  await items.nth(1).getByRole("button", { name: "Remove" }).click();
  await expect(items).toHaveCount(1);
  expect((await request.get(firstUrl)).status()).toBe(404);
  expect((await request.get(secondUrl)).status()).toBe(200);

  // A category image: upload, then remove.
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(categoryName);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  await page
    .getByTestId("category-row")
    .filter({ hasText: categoryName })
    .getByRole("link", { name: /Edit/ })
    .click();
  await expect(page.getByRole("heading", { name: categoryName })).toBeVisible();
  await expect(page.getByTestId("single-image-empty")).toBeVisible();
  await page.getByLabel("Choose the image").setInputFiles({
    name: "category.webp",
    mimeType: "image/webp",
    buffer: await makeTestImage({ width: 600, height: 400, format: "webp" }),
  });
  await page.getByRole("button", { name: "Upload image" }).click();
  await expect(page.getByTestId("upload-notice")).toHaveText("1 image uploaded.");
  const categoryImage = page.getByTestId("single-image").locator("img");
  await expect(categoryImage).toHaveAttribute("alt", categoryName);
  const categoryImageUrl = (await categoryImage.getAttribute("src"))!;
  expect((await request.get(categoryImageUrl)).status()).toBe(200);
  await page.getByRole("button", { name: "Remove image" }).click();
  await expect(page.getByTestId("single-image-empty")).toBeVisible();
  expect((await request.get(categoryImageUrl)).status()).toBe(404);
});
