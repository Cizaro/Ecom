import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { fetchImageFromUrl, ImageFetchError, isPublicAddress } from "../media/fetch-image";
import { splitPictureLinks } from "./import";
import {
  buildImportTemplate,
  ImportFileError,
  parseCsv,
  readImportFile,
  zipUnpackedSize,
} from "./import-file";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("CSV files", () => {
  it("handle quotes, doubled quotes, line breaks and Excel's semicolons", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
    expect(parseCsv("﻿name;price\r\nTote;40\r\n")).toEqual([
      ["name", "price"],
      ["Tote", "40"],
    ]);
    expect(parseCsv('a,b\n"two\nlines",2')).toEqual([
      ["a", "b"],
      ["two\nlines", "2"],
    ]);
  });

  it("are read into rows by column name, skipping blank rows", async () => {
    const rows = await readImportFile(
      "products.csv",
      bytes(
        "Product name *,SKU,Price,Colour,Picture links\nTote,T-1,40,Sand,https://x.test/a.jpg\n,,,,\nTote,T-2,40,Black,\n",
      ),
    );
    expect(rows).toEqual([
      {
        rowNumber: 2,
        values: {
          name: "Tote",
          sku: "T-1",
          price: "40",
          color: "Sand",
          pictures: "https://x.test/a.jpg",
        },
      },
      { rowNumber: 4, values: { name: "Tote", sku: "T-2", price: "40", color: "Black" } },
    ]);
  });

  it("explain what is wrong with the file itself", async () => {
    await expect(readImportFile("p.csv", bytes("Name,Price\nTote,40\n"))).rejects.toThrow(
      /Missing: SKU/,
    );
    await expect(readImportFile("p.csv", bytes("Product name,SKU,Price\n"))).rejects.toThrow(
      "The file has no products in it.",
    );
    await expect(readImportFile("p.xls", bytes("old"))).rejects.toThrow(/Save the file as .xlsx/);
    await expect(readImportFile("p.csv", new Uint8Array(3 * 1024 * 1024))).rejects.toThrow(
      ImportFileError,
    );
  });
});

describe("Excel files", () => {
  it("come with the store's categories as a dropdown in the template", async () => {
    const file = await buildImportTemplate({
      storeName: "Cedar Bags",
      currency: "USD",
      categories: ["Bags", "Wallets"],
      brands: [],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(file) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Products")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Product name *");
    expect(sheet.getCell("B2").dataValidation).toMatchObject({
      type: "list",
      formulae: ["Lists!$A$2:$A$3"],
    });
    // No brands yet: no brand dropdown.
    expect(sheet.getCell("C2").dataValidation).toBeFalsy();
    expect(workbook.getWorksheet("Lists")!.getCell("A3").value).toBe("Wallets");
    // The empty template has no products.
    await expect(readImportFile("template.xlsx", file)).rejects.toThrow("no products");
  });

  it("are read with numbers, links and rich text as plain values", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Products");
    sheet.addRow(["Product name *", "Category", "SKU *", "Price *", "Stock", "Picture links"]);
    sheet.addRow([
      "Leather Tote",
      "Bags",
      "TOTE-1",
      39.99,
      5,
      { text: "photo", hyperlink: "https://cdn.example.test/tote.jpg" },
    ]);
    sheet.addRow([
      { richText: [{ text: "Card " }, { text: "Wallet" }] },
      "Wallets",
      "W-1",
      15,
      null,
      null,
    ]);
    const file = new Uint8Array(await workbook.xlsx.writeBuffer());
    const rows = await readImportFile("mine.xlsx", file);
    expect(rows[0]!.values).toMatchObject({
      name: "Leather Tote",
      price: "39.99",
      stock: "5",
      pictures: "https://cdn.example.test/tote.jpg",
    });
    expect(rows[1]!.values.name).toBe("Card Wallet");
  });

  it("are refused when they would unpack to something huge", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Products").addRow(["Product name", "SKU", "Price"]);
    const file = new Uint8Array(await workbook.xlsx.writeBuffer());
    expect(zipUnpackedSize(file)).toBeGreaterThan(0);
    expect(zipUnpackedSize(bytes("not a zip at all"))).toBeNull();
    await expect(readImportFile("broken.xlsx", bytes("PK not really"))).rejects.toThrow(
      "could not be read as an Excel file",
    );
  });
});

describe("picture links", () => {
  it("are split on commas, spaces and new lines", () => {
    expect(
      splitPictureLinks("https://a.test/1.jpg, https://a.test/2.jpg\nhttps://a.test/3.jpg"),
    ).toEqual(["https://a.test/1.jpg", "https://a.test/2.jpg", "https://a.test/3.jpg"]);
  });

  it("only reach public addresses", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "not-an-ip",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("are refused before any request when they point somewhere private or odd", async () => {
    for (const link of [
      "file:///etc/passwd",
      "ftp://example.test/a.jpg",
      "http://127.0.0.1/a.jpg",
      "http://[::1]/a.jpg",
      "http://localhost/a.jpg",
      "http://169.254.169.254/latest/meta-data",
      "https://user:pass@example.test/a.jpg",
      "https://example.test:8443/a.jpg",
      "not a link",
    ]) {
      await expect(fetchImageFromUrl(link), link).rejects.toBeInstanceOf(ImageFetchError);
    }
  });
});
