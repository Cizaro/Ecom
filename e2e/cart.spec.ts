/// <reference lib="dom" />
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { addVariant, createProduct, exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// The cart as a visitor uses it: adding the chosen variant, the count in the
// header, changing and removing lines, prices that follow the catalog, items
// that stop being for sale, and that one visitor never sees another's cart.

const count = (page: Page) => page.getByTestId("cart-count");

test("a visitor fills a cart; prices follow the catalog; carts are private", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const upper = tag.toUpperCase();
  const categoryName = `Carriers ${tag}`;
  const bag = `Carry Bag ${tag}`;
  const bagPath = `/p/carry-bag-${tag}`;

  // --- The owner prepares one product with two colours -----------------------
  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(categoryName);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  const bagAdmin = await createProduct(page, {
    name: bag,
    category: categoryName,
    sku: `BAG-BLK-${upper}`,
    color: "Black",
    price: "30.00",
    publish: false,
  });
  await addVariant(page, bagAdmin, { sku: `BAG-TAN-${upper}`, color: "Tan", price: "35.00" });
  await page.getByRole("button", { name: "Publish", ...exact }).click();
  await expect(page.getByTestId("product-status")).toHaveText("Published");

  // --- A visitor ----------------------------------------------------------------
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();

  await visitor.goto("/cart");
  await expect(visitor.getByText("Your cart is empty")).toBeVisible();
  await expect(count(visitor)).toHaveText("0");
  // No cart cookie until something is added.
  expect((await visitorContext.cookies()).some((cookie) => cookie.name === "cart")).toBe(false);

  // Add two of the tan one. The page stays put and says so.
  await visitor.goto(`${bagPath}?color=tan`);
  const addForm = visitor.getByTestId("add-to-cart");
  await addForm.getByLabel("Quantity").selectOption("2");
  await addForm.getByRole("button", { name: "Add to cart" }).click();
  await expect(visitor.getByTestId("cart-notice")).toHaveText("Added to your cart.");
  await expect(count(visitor)).toHaveText("2");
  await expect(visitor).toHaveURL(`${bagPath}?color=tan`);

  // The cart cookie cannot be read by scripts and is sent to this site only.
  const cookie = (await visitorContext.cookies()).find((candidate) => candidate.name === "cart")!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await visitor.evaluate(() => document.cookie)).not.toContain("cart=");

  // Adding more is held at ten of one item.
  await addForm.getByLabel("Quantity").selectOption("9");
  await addForm.getByRole("button", { name: "Add to cart" }).click();
  await expect(visitor.getByTestId("cart-notice")).toContainText("the most allowed");
  await expect(count(visitor)).toHaveText("10");

  // The cart page: the right variant, price each, line total and subtotal.
  await visitor.getByRole("link", { name: "View cart" }).click();
  await expect(visitor).toHaveURL("/cart");
  const lines = visitor.getByTestId("cart-line");
  await expect(lines).toHaveCount(1);
  await expect(lines.first()).toContainText(bag);
  await expect(lines.first()).toContainText("Tan");
  await expect(lines.first()).toContainText("$35.00 each");
  await expect(lines.first().getByTestId("line-total")).toHaveText("$350.00");
  await expect(visitor.getByTestId("cart-subtotal")).toHaveText("$350.00");
  await expect(lines.first().getByRole("link", { name: bag })).toHaveAttribute(
    "href",
    `${bagPath}?color=tan`,
  );

  // Change the quantity.
  await lines
    .first()
    .getByLabel(/Quantity/)
    .selectOption("3");
  await lines.first().getByRole("button", { name: "Update" }).click();
  await expect(visitor.getByTestId("cart-subtotal")).toHaveText("$105.00");
  await expect(count(visitor)).toHaveText("3");

  // Add the black one too.
  await visitor.goto(bagPath);
  await visitor.getByTestId("add-to-cart").getByRole("button", { name: "Add to cart" }).click();
  await expect(visitor.getByTestId("cart-notice")).toBeVisible();
  await visitor.goto("/cart");
  await expect(lines).toHaveCount(2);
  await expect(visitor.getByTestId("cart-subtotal")).toHaveText("$135.00");

  // --- Another visitor sees none of it ---------------------------------------
  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await stranger.goto("/cart");
  await expect(stranger.getByText("Your cart is empty")).toBeVisible();
  await expect(count(stranger)).toHaveText("0");
  // A made-up or malformed cart cookie opens nothing and breaks nothing.
  for (const value of ["A".repeat(43), "not-a-token", "..%2F..%2Fadmin"]) {
    await strangerContext.addCookies([{ name: "cart", value, url: stranger.url() }]);
    expect((await stranger.reload())?.status()).toBe(200);
    await expect(stranger.getByText("Your cart is empty")).toBeVisible();
  }
  await strangerContext.close();

  // --- The price changes in the catalog ----------------------------------------
  await page.goto(bagAdmin);
  await page.getByRole("link", { name: `Edit BAG-TAN-${upper}` }).click();
  await page.getByLabel("Price (USD)", exact).fill("40.00");
  await page.getByRole("button", { name: "Save variant" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Saved.");

  await visitor.reload();
  const tanLine = lines.filter({ hasText: "Tan" });
  await expect(tanLine.getByTestId("line-price-changed")).toHaveText(
    "The price changed from $35.00 to $40.00 since you added this.",
  );
  await expect(tanLine.getByTestId("line-total")).toHaveText("$120.00");
  await expect(visitor.getByTestId("cart-subtotal")).toHaveText("$150.00");

  // --- The product is withdrawn, then returns ------------------------------------
  await page.goto(bagAdmin);
  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByTestId("product-status")).toHaveText("Draft");
  await visitor.reload();
  await expect(visitor.getByTestId("line-unavailable")).toHaveCount(2);
  await expect(visitor.getByTestId("cart-subtotal")).toHaveText("$0.00");
  await page.getByRole("button", { name: "Publish", ...exact }).click();
  await expect(page.getByTestId("product-status")).toHaveText("Published");
  await visitor.reload();
  await expect(visitor.getByTestId("line-unavailable")).toHaveCount(0);
  await expect(visitor.getByTestId("cart-subtotal")).toHaveText("$150.00");

  // Remove a line.
  await lines
    .filter({ hasText: "Black" })
    .getByRole("button", { name: /Remove/ })
    .click();
  await expect(lines).toHaveCount(1);
  await expect(visitor.getByTestId("cart-subtotal")).toHaveText("$120.00");
  await expect(count(visitor)).toHaveText("3");

  // The page never scrolls sideways.
  const overflow = await visitor.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Nothing is promised that does not exist yet.
  await expect(visitor.getByText("Checkout is not open yet")).toBeVisible();
  await expect(visitor.getByRole("button", { name: /checkout|pay|buy/i })).toHaveCount(0);

  await visitorContext.close();

  // --- Without JavaScript the cart still works ----------------------------------
  const plainContext = await browser.newContext({ javaScriptEnabled: false });
  const plain = await plainContext.newPage();
  await plain.goto(`${bagPath}?color=tan`);
  await plain.getByTestId("add-to-cart").getByLabel("Quantity").selectOption("2");
  await plain.getByTestId("add-to-cart").getByRole("button", { name: "Add to cart" }).click();
  await expect(plain.getByTestId("cart-notice")).toHaveText("Added to your cart.");
  await plain.goto("/cart");
  await expect(plain.getByTestId("cart-line")).toHaveCount(1);
  await expect(plain.getByTestId("cart-subtotal")).toHaveText("$80.00");
  await plain
    .getByTestId("cart-line")
    .getByRole("button", { name: /Remove/ })
    .click();
  await expect(plain.getByText("Your cart is empty")).toBeVisible();
  await plainContext.close();
});
