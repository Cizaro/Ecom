/// <reference lib="dom" />
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { makeTestImage } from "../packages/testing/src/images";
import { addVariant, createProduct, exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// The product page as a visitor uses it: choosing a colour and size changes
// the price, the SKU and the pictures; the choice lives in the address;
// related and recently viewed products appear; and the data for search
// engines says what the page says.

test("a visitor chooses a variant and sees related and recently viewed products", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const upper = tag.toUpperCase();
  const categoryName = `Satchels ${tag}`;
  const satchel = `Day Satchel ${tag}`;
  const pouch = `Coin Pouch ${tag}`;
  const satchelPath = `/p/day-satchel-${tag}`;

  // --- The owner prepares two products in one category -------------------------
  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(categoryName);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");

  // Black comes in S and M; Tan only in M, on sale.
  const satchelAdmin = await createProduct(page, {
    name: satchel,
    category: categoryName,
    sku: `SAT-BLK-S-${upper}`,
    color: "Black",
    size: "S",
    price: "30.00",
    publish: false,
  });
  await addVariant(page, satchelAdmin, {
    sku: `SAT-BLK-M-${upper}`,
    color: "Black",
    size: "M",
    price: "32.00",
  });
  await addVariant(page, satchelAdmin, {
    sku: `SAT-TAN-M-${upper}`,
    color: "Tan",
    size: "M",
    price: "35.00",
    salePrice: "28.00",
  });

  // Two pictures: one of the product in general, one of the tan variant.
  const uploader = page.getByTestId("image-uploader");
  await uploader.getByLabel("Add images").setInputFiles([
    { name: "general.jpg", mimeType: "image/jpeg", buffer: await makeTestImage() },
    { name: "tan.jpg", mimeType: "image/jpeg", buffer: await makeTestImage({ width: 700 }) },
  ]);
  await uploader.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByTestId("upload-notice")).toHaveText("2 images uploaded.");
  const items = page.getByTestId("image-item");
  await items.nth(0).getByLabel("Description").fill("Satchel overview");
  await items.nth(0).getByRole("button", { name: "Save image" }).click();
  await expect(items.nth(0).getByTestId("form-notice")).toHaveText("Saved.");
  await items.nth(1).getByLabel("Description").fill("Satchel in tan");
  await items
    .nth(1)
    .getByLabel("Shows")
    .selectOption({ label: `SAT-TAN-M-${upper} · Tan · M` });
  await items.nth(1).getByRole("button", { name: "Save image" }).click();
  await expect(items.nth(1).getByTestId("form-notice")).toHaveText("Saved.");
  await page.getByRole("button", { name: "Publish", ...exact }).click();
  await expect(page.getByTestId("product-status")).toHaveText("Published");

  await createProduct(page, {
    name: pouch,
    category: categoryName,
    sku: `POUCH-${upper}`,
    color: "Red",
    price: "12.00",
    publish: true,
  });

  // --- A visitor ----------------------------------------------------------------
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const colours = visitor.getByTestId("options-colour");
  const sizes = visitor.getByTestId("options-size");
  const slides = visitor.getByTestId("gallery-slide");

  // The default variant: black, size S. Only the general picture is shown.
  expect((await visitor.goto(satchelPath))?.status()).toBe(200);
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(satchel);
  await expect(visitor.getByTestId("price").first()).toHaveText("$30.00");
  await expect(visitor.getByTestId("sku")).toHaveText(`SKU: SAT-BLK-S-${upper}`);
  await expect(colours.getByRole("link", { name: "Black" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(sizes.getByRole("link", { name: "S", ...exact })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(slides).toHaveCount(1);
  await expect(slides.locator("img")).toHaveAttribute("alt", "Satchel overview");
  // Nothing is claimed about stock, and there is nothing to buy with yet.
  await expect(visitor.getByText(/in stock|out of stock|only \d+ left/i)).toHaveCount(0);

  // Choosing size M keeps the colour and changes price and SKU; the choice is in the address.
  await sizes.getByRole("link", { name: "M", ...exact }).click();
  await expect(visitor).toHaveURL(`${satchelPath}?color=black&size=m`);
  await expect(visitor.getByTestId("price").first()).toHaveText("$32.00");
  await expect(visitor.getByTestId("sku")).toHaveText(`SKU: SAT-BLK-M-${upper}`);

  // Choosing tan: sale price beside the regular one, and tan's own picture comes first.
  await colours.getByRole("link", { name: "Tan" }).click();
  await expect(visitor).toHaveURL(`${satchelPath}?color=tan&size=m`);
  const price = visitor.getByTestId("price").first();
  await expect(price).toContainText("$28.00");
  await expect(price.locator("s")).toContainText("$35.00");
  await expect(visitor.getByTestId("sku")).toHaveText(`SKU: SAT-TAN-M-${upper}`);
  await expect(slides).toHaveCount(2);
  await expect(slides.nth(0).locator("img")).toHaveAttribute("alt", "Satchel in tan");
  // Tan is not made in S: shown, struck through, and not a link.
  await expect(sizes.getByRole("link", { name: "S", ...exact })).toHaveCount(0);
  await expect(sizes.locator("[aria-disabled=true]")).toContainText("S");
  await expect(sizes.locator("[aria-disabled=true]")).toContainText("not made in Tan");

  // The thumbnails move through the pictures.
  await expect(visitor.getByTestId("gallery-position")).toHaveText("Picture 1 of 2");
  await visitor.getByTestId("gallery-thumbnail").nth(1).click();
  await expect(visitor.getByTestId("gallery-position")).toHaveText("Picture 2 of 2");
  await expect(visitor.getByTestId("gallery-thumbnail").nth(1)).toHaveAttribute(
    "aria-current",
    "true",
  );

  // The address alone selects the variant (a shared link), also without regard to case.
  await visitor.goto(`${satchelPath}?color=TAN`);
  await expect(visitor.getByTestId("sku")).toHaveText(`SKU: SAT-TAN-M-${upper}`);
  // A colour the product does not have shows the default rather than an error.
  expect((await visitor.goto(`${satchelPath}?color=purple&size=%27--`))?.status()).toBe(200);
  await expect(visitor.getByTestId("sku")).toHaveText(`SKU: SAT-BLK-S-${upper}`);

  // What search engines are told matches the page, and invents nothing.
  await visitor.goto(`${satchelPath}?color=tan&size=m`);
  await expect(visitor.locator("link[rel=canonical]")).toHaveAttribute(
    "href",
    new RegExp(`${satchelPath}$`),
  );
  const blocks = await visitor
    .locator('script[type="application/ld+json"]')
    .evaluateAll((elements) => elements.map((element) => JSON.parse(element.textContent ?? "{}")));
  const productData = blocks.find((block) => block["@type"] === "Product");
  expect(productData).toMatchObject({
    name: satchel,
    offers: {
      "@type": "AggregateOffer",
      lowPrice: "28.00",
      highPrice: "32.00",
      priceCurrency: "USD",
      offerCount: 3,
    },
  });
  expect(productData.image).toHaveLength(2);
  expect(JSON.stringify(blocks)).not.toMatch(/availability|aggregateRating|review|cost/i);
  expect(blocks.some((block) => block["@type"] === "BreadcrumbList")).toBe(true);
  await expect(visitor.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/original\.jpg$/,
  );

  // Related products: the other product in the category, not this one.
  const related = visitor.getByTestId("related-products");
  await expect(related.getByRole("heading", { level: 2 })).toHaveText(`More from ${categoryName}`);
  await expect(related.getByTestId("product-card").getByRole("heading")).toHaveText([pouch]);
  // Nothing has been viewed before this product.
  await expect(visitor.getByTestId("recently-viewed")).toHaveCount(0);

  // On the next product, the first one is "recently viewed".
  await related.getByRole("link", { name: pouch }).click();
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(pouch);
  // One variant, so there is nothing to choose.
  await expect(visitor.getByTestId("options-colour")).toHaveCount(0);
  const recent = visitor.getByTestId("recently-viewed");
  await expect(recent.getByTestId("product-card").getByRole("heading")).toHaveText([satchel]);
  await expect(recent.getByTestId("price")).toContainText("$28.00");

  // A cookie edited by hand cannot make the page show anything else.
  await visitorContext.addCookies([
    {
      name: "recent",
      value: `no-such-product.<script>alert(1)</script>.day-satchel-${tag}`,
      url: visitor.url(),
    },
  ]);
  expect((await visitor.reload())?.status()).toBe(200);
  await expect(recent.getByTestId("product-card").getByRole("heading")).toHaveText([satchel]);

  // The page never scrolls sideways (the gallery scrolls inside itself).
  await visitor.goto(`${satchelPath}?color=tan&size=m`);
  const overflow = await visitor.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await visitorContext.close();
});
