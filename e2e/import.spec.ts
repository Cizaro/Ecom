import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// Bulk product import: staff download the template, upload a file, see its
// problems, fix it, import, and the products appear with their pictures.
// Pictures come from a small web server started by this test (the app is
// allowed to reach private addresses only in the tests).

let pictures: Server;
let pictureBase = "";

test.beforeAll(async () => {
  const photo = readFileSync(resolve(import.meta.dirname, "fixtures/tote.png"));
  pictures = createServer((request, response) => {
    if (request.url === "/tote.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(photo);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((done) => pictures.listen(0, "127.0.0.1", done));
  pictureBase = `http://127.0.0.1:${(pictures.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  pictures.close();
});

const HEADER = "Product name,Category,Description,Colour,SKU,Price,Stock,Picture links";

test("staff import products from a spreadsheet, after fixing its problems", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const category = `Totes ${tag}`;
  const name = `Imported Tote ${tag}`;
  const sku = `IMP-${tag}`.toUpperCase();

  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/catalog/categories");
  await page.getByLabel("Name", exact).fill(category);
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByTestId("form-notice")).toHaveText("Category added.");

  await page.goto("/admin/catalog/products");
  await page.getByRole("link", { name: "Import from a spreadsheet" }).click();
  await expect(page.getByRole("heading", { name: "Import products" })).toBeVisible();

  // The template is an Excel file made for this store.
  const template = await page.request.get(
    (await page.getByTestId("download-template").getAttribute("href"))!,
  );
  expect(template.status()).toBe(200);
  expect(template.headers()["content-type"]).toContain("spreadsheetml");
  expect((await template.body()).subarray(0, 2).toString()).toBe("PK");

  // --- A file with a mistake: the category is spelled wrong ---------------------------
  const upload = async (rows: string[]) => {
    await page.goto("/admin/catalog/import");
    await page.getByLabel("Spreadsheet").setInputFiles({
      name: `products-${tag}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from([HEADER, ...rows].join("\n")),
    });
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page).toHaveURL(/\/admin\/catalog\/import\/[0-9a-f-]{36}$/);
  };
  await upload([`${name},Totse ${tag},,Sand,${sku},45,4,${pictureBase}/tote.png`]);
  await expect(page.getByTestId("import-problems-alert")).toContainText("1 problem found");
  await expect(page.getByTestId("import-problems")).toContainText(
    `no category called "Totse ${tag}"`,
  );
  await expect(page.getByTestId("run-import-form")).toHaveCount(0);

  // --- Fixed: import and publish ----------------------------------------------------------
  await upload([`${name},${category},Roomy and light.,Sand,${sku},45,4,${pictureBase}/tote.png`]);
  await expect(page.getByTestId("import-ready")).toContainText("1 product with 1 variant");
  const run = page.getByTestId("run-import-form");
  await run.getByLabel(/Publish them now/).check();
  await run.getByRole("button", { name: "Import 1 product" }).click();
  await expect(page.getByTestId("import-done")).toHaveText(
    "Imported 1 product and published them.",
  );
  await expect(page.getByTestId("import-images")).toContainText("1 added");
  await page.getByTestId("import-products").getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // Shoppers can find it, with its price and stock.
  await page.goto(`/p/imported-tote-${tag}`);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByTestId("stock-note")).toBeVisible();
});
