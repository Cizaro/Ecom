/// <reference lib="dom" />
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createProduct, exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// The shop as a visitor sees it. An owner prepares a category with two
// published products and one draft; a visitor who is not signed in then
// browses, sorts, filters and searches, and never meets the draft.

/**
 * Chooses a sort order. The drop-down submits by script, and right after a
 * page arrives that script may not be attached yet, so the choice is made
 * again until the address shows it (as a person would).
 */
async function sortBy(page: Page, sort: string) {
  await expect(async () => {
    const select = page.getByLabel("Sort by");
    await select.selectOption(sort === "newest" ? "name" : "newest");
    await select.selectOption(sort);
    await expect(page).toHaveURL(new RegExp(`[?&]sort=${sort}(&|$)`), { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

const cardNames = (page: Page) => page.getByTestId("product-card").getByRole("heading");

test("a visitor browses, sorts, filters and searches published products only", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const categoryName = `Clutches ${tag}`;
  const categoryPath = `/c/clutches-${tag}`;
  const alpha = `Clutch Alpha ${tag}`;
  const beta = `Clutch Beta ${tag}`;
  const draft = `Clutch Draft ${tag}`;

  // --- The owner prepares the catalog ---------------------------------------
  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(categoryName);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");

  await createProduct(page, {
    name: alpha,
    category: categoryName,
    sku: `ALPHA-${tag}`.toUpperCase(),
    color: "Black",
    price: "30.00",
    withImage: true,
    publish: true,
  });
  await createProduct(page, {
    name: beta,
    category: categoryName,
    sku: `BETA-${tag}`.toUpperCase(),
    color: "Red",
    price: "50.00",
    salePrice: "40.00",
    publish: true,
  });
  await createProduct(page, {
    name: draft,
    category: categoryName,
    sku: `DRAFT-${tag}`.toUpperCase(),
    color: "Black",
    price: "10.00",
    publish: false,
  });

  // --- A visitor, not signed in -----------------------------------------------
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();

  // The category is in the navigation and on the home page.
  await visitor.goto("/");
  await expect(
    visitor.getByTestId("category-tile").filter({ hasText: categoryName }),
  ).toBeVisible();
  await visitor
    .getByRole("navigation", { name: "Shop" })
    .getByRole("link", { name: categoryName })
    .click();
  await expect(visitor).toHaveURL(categoryPath);
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(categoryName);

  // Two products: the draft is not there. Newest first by default.
  await expect(visitor.getByTestId("result-count")).toHaveText("2 products");
  await expect(cardNames(visitor)).toHaveText([beta, alpha]);
  await expect(visitor.getByText(draft)).toHaveCount(0);

  // Prices: a plain price, and a sale price beside the regular one.
  const alphaCard = visitor.getByTestId("product-card").filter({ hasText: alpha });
  const betaCard = visitor.getByTestId("product-card").filter({ hasText: beta });
  await expect(alphaCard.getByTestId("price")).toHaveText("$30.00");
  await expect(betaCard.getByTestId("price")).toContainText("$40.00");
  await expect(betaCard.getByTestId("price").locator("s")).toContainText("$50.00");
  await expect(betaCard).toContainText("Sale");
  // The uploaded photo is displayed with its description.
  const photo = alphaCard.locator("img");
  await expect(photo).toHaveAttribute("alt", `${alpha} photo`);
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  // Nothing about cost or drafts leaks into the page.
  expect(await visitor.content()).not.toMatch(/costAmount|cost_amount|"draft"/);

  // Sorting is carried in the address.
  await sortBy(visitor, "price_asc");
  await expect(visitor).toHaveURL(`${categoryPath}?sort=price_asc`);
  await expect(cardNames(visitor)).toHaveText([alpha, beta]);
  await sortBy(visitor, "price_desc");
  await expect(cardNames(visitor)).toHaveText([beta, alpha]);

  // Filter by colour, then by price, then clear.
  await visitor.getByTestId("filters").locator("summary").click();
  await visitor.getByLabel("Red").check();
  await visitor.getByRole("button", { name: "Apply filters" }).click();
  await expect(visitor).toHaveURL(/color=red/);
  await expect(visitor.getByTestId("result-count")).toHaveText("1 product");
  await expect(cardNames(visitor)).toHaveText([beta]);
  await expect(visitor.getByLabel("Red")).toBeChecked();

  await visitor.getByLabel("Red").uncheck();
  await visitor.getByLabel("To", exact).fill("35");
  await visitor.getByRole("button", { name: "Apply filters" }).click();
  await expect(cardNames(visitor)).toHaveText([alpha]);
  await visitor.getByLabel("To", exact).fill("5");
  await visitor.getByRole("button", { name: "Apply filters" }).click();
  await expect(visitor.getByText("Nothing matches these filters")).toBeVisible();
  await visitor.getByRole("main").getByRole("link", { name: "Clear filters" }).first().click();
  await expect(visitor.getByTestId("result-count")).toHaveText("2 products");

  // The page never scrolls sideways (the navigation scrolls inside itself).
  const overflow = await visitor.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Search from the header: word beginnings match; the draft is never found.
  await visitor.getByLabel("Search products").fill(`clut ${tag}`);
  await visitor.getByRole("button", { name: "Search" }).click();
  await expect(visitor).toHaveURL(/\/search\?q=/);
  await expect(visitor.getByTestId("search-title")).toContainText(tag);
  await expect(visitor.getByTestId("result-count")).toHaveText("2 products");
  await expect(cardNames(visitor)).toHaveText([beta, alpha], { ignoreCase: true });
  await visitor.goto(`/search?q=${encodeURIComponent(`draft ${tag}`)}`);
  await expect(visitor.getByText(`Nothing found for “draft ${tag}”`)).toBeVisible();
  await visitor.goto(`/search?q=${encodeURIComponent(`ALPHA-${tag}`)}`);
  await expect(cardNames(visitor)).toHaveText([alpha]);
  await visitor.goto("/search?q=%27%29%3B+DROP+TABLE+products%3B--");
  expect(await visitor.getByRole("heading", { level: 1 }).textContent()).toContain("DROP TABLE");
  await visitor.goto("/search");
  await expect(visitor.getByText("Type what you are looking for")).toBeVisible();

  // A card leads to the product; a draft's address and unknown addresses are 404.
  await visitor.goto(categoryPath);
  await visitor.getByRole("link", { name: alpha }).click();
  await expect(visitor).toHaveURL(`/p/clutch-alpha-${tag}`);
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(alpha);
  await expect(visitor.getByTestId("price").first()).toHaveText("$30.00");
  expect((await visitor.goto(`/p/clutch-draft-${tag}`))?.status()).toBe(404);
  expect((await visitor.goto("/p/no-such-product"))?.status()).toBe(404);
  expect((await visitor.goto("/c/no-such-category"))?.status()).toBe(404);
  expect((await visitor.goto(`${categoryPath}?page=99`))?.status()).toBe(200);
  await expect(visitor.getByText("There is no such page")).toBeVisible();

  // Publishing the draft makes it appear; unpublishing takes it away again.
  await page.goto("/admin/catalog/products");
  await page.getByLabel("Search").fill(draft);
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("link", { name: draft }).click();
  await page.getByRole("button", { name: "Publish", ...exact }).click();
  await expect(page.getByTestId("product-status")).toHaveText("Published");
  await visitor.goto(categoryPath);
  await expect(visitor.getByTestId("result-count")).toHaveText("3 products");
  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByTestId("product-status")).toHaveText("Draft");
  await visitor.reload();
  await expect(visitor.getByTestId("result-count")).toHaveText("2 products");

  await visitorContext.close();
});
