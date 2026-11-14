import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createProduct, exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// What search engines are told: robots rules, the sitemap, page titles with
// the store's name, and which address stands for each page. The test server
// runs with indexing switched on (playwright.config.ts), as a live store would.

const STORE = "End-to-end Test Store";

const robotsMeta = (page: Page) => page.locator('meta[name="robots"]');
const canonical = (page: Page) => page.locator('link[rel="canonical"]');

test("robots.txt opens the shop and closes the private parts", async ({ request, baseURL }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  const lines = (await response.text()).split("\n");
  expect(lines).toContain("Allow: /");
  for (const path of ["/admin", "/api/", "/cart", "/search"]) {
    expect(lines).toContain(`Disallow: ${path}`);
  }
  expect(lines).not.toContain("Disallow: /");
  expect(lines).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
});

test("a host no store answers to has no robots.txt or sitemap", async ({ request }) => {
  const headers = { host: "nobody.example.test" };
  expect((await request.get("/robots.txt", { headers })).status()).toBe(404);
  expect((await request.get("/sitemap.xml", { headers })).status()).toBe(404);
});

test("the sitemap lists published products and categories, never drafts", async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const categoryName = `Listed ${tag}`;

  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(categoryName);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");
  await createProduct(page, {
    name: `Shown Item ${tag}`,
    category: categoryName,
    sku: `SHOWN-${tag}`.toUpperCase(),
    color: "Black",
    price: "10.00",
    publish: true,
  });
  await createProduct(page, {
    name: `Hidden Item ${tag}`,
    category: categoryName,
    sku: `HIDDEN-${tag}`.toUpperCase(),
    color: "Black",
    price: "10.00",
    publish: false,
  });

  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/xml");
  const xml = await response.text();
  expect(xml).toContain(`<loc>${baseURL}/</loc>`);
  expect(xml).toContain(`<loc>${baseURL}/products</loc>`);
  expect(xml).toContain(`<loc>${baseURL}/c/listed-${tag}</loc>`);
  expect(xml).toContain(`<loc>${baseURL}/p/shown-item-${tag}</loc>`);
  expect(xml).not.toContain(`hidden-item-${tag}`);
  expect(xml).not.toMatch(/\/admin|\/cart|\/search|\/api\//);
  // Every address in it belongs to this store's own host.
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
  expect(locations.length).toBeGreaterThan(3);
  for (const location of locations) expect(location.startsWith(`${baseURL}/`)).toBe(true);

  // --- Titles carry the store's name; each page names its real address ---------
  const visitorContext = await page.context().browser()!.newContext();
  const visitor = await visitorContext.newPage();

  await visitor.goto("/");
  await expect(visitor).toHaveTitle(STORE);
  // With or without the final slash: the same address.
  const home = (await canonical(visitor).getAttribute("href")) ?? "";
  expect(home.replace(/\/$/, "")).toBe(baseURL);
  await expect(robotsMeta(visitor)).toHaveAttribute("content", "index, follow");

  const categoryPath = `/c/listed-${tag}`;
  await visitor.goto(categoryPath);
  await expect(visitor).toHaveTitle(`${categoryName} | ${STORE}`);
  await expect(canonical(visitor)).toHaveAttribute("href", `${baseURL}${categoryPath}`);
  await expect(robotsMeta(visitor)).toHaveAttribute("content", "index, follow");

  // A sorted or filtered view is the same list: unindexed, pointing at the plain one.
  for (const query of ["?sort=name", "?color=black", "?max=50&page=2"]) {
    await visitor.goto(`${categoryPath}${query}`);
    await expect(robotsMeta(visitor), query).toHaveAttribute("content", "noindex, follow");
    await expect(canonical(visitor), query).toHaveAttribute("href", `${baseURL}${categoryPath}`);
  }
  // A further page of the plain list keeps its own address.
  await visitor.goto("/products?page=2");
  await expect(canonical(visitor)).toHaveAttribute("href", `${baseURL}/products?page=2`);
  await expect(visitor).toHaveTitle(`All products | ${STORE}`);

  await visitor.goto(`/p/shown-item-${tag}`);
  await expect(visitor).toHaveTitle(`Shown Item ${tag} | ${STORE}`);

  // Personal and endless pages stay out of search results.
  await visitor.goto("/search?q=item");
  await expect(robotsMeta(visitor)).toHaveAttribute("content", "noindex, follow");
  await visitor.goto("/cart");
  await expect(robotsMeta(visitor)).toHaveAttribute("content", "noindex, nofollow");
  await visitor.goto("/admin/sign-in");
  await expect(robotsMeta(visitor)).toHaveAttribute("content", "noindex, nofollow");

  // A page that does not exist: a real 404, shown inside the shop.
  expect((await visitor.goto(`/p/hidden-item-${tag}`))?.status()).toBe(404);
  await expect(visitor.getByTestId("shop-not-found")).toBeVisible();
  await expect(visitor.getByTestId("store-name")).toHaveText(STORE);
  await visitor.getByRole("link", { name: "See all products" }).click();
  await expect(visitor).toHaveURL("/products");

  await visitorContext.close();
});
