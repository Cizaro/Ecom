import ExcelJS from "exceljs";

// Reading and writing product import spreadsheets: Excel (.xlsx) or CSV.
// The file comes from a staff member's computer, so it is treated as
// untrusted: size and row limits, a check of the unpacked size before an
// Excel file is opened, and only cell values are read (no formulas run).

export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1000;
/** An Excel file is a zip; refuse one that would unpack to more than this. */
const MAX_UNPACKED_BYTES = 40 * 1024 * 1024;

export const IMPORT_COLUMNS = [
  { key: "name", label: "Product name", required: true, aliases: ["name", "product"] },
  { key: "category", label: "Category", required: false, aliases: [] },
  { key: "brand", label: "Brand", required: false, aliases: [] },
  { key: "description", label: "Description", required: false, aliases: [] },
  { key: "color", label: "Colour", required: false, aliases: ["color"] },
  { key: "size", label: "Size", required: false, aliases: [] },
  { key: "sku", label: "SKU", required: true, aliases: [] },
  { key: "price", label: "Price", required: true, aliases: [] },
  { key: "salePrice", label: "Sale price", required: false, aliases: ["discount price"] },
  { key: "stock", label: "Stock", required: false, aliases: ["quantity", "qty"] },
  { key: "lowStock", label: "Low-stock level", required: false, aliases: ["low stock"] },
  {
    key: "pictures",
    label: "Picture links",
    required: false,
    aliases: ["pictures", "images", "image links", "image urls", "picture urls"],
  },
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number]["key"];

export interface SheetRow {
  /** As the spreadsheet numbers it (the header is row 1). */
  rowNumber: number;
  values: Partial<Record<ImportColumn, string>>;
}

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}

const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();

function columnFor(header: string): ImportColumn | null {
  const name = normalizeHeader(header);
  for (const column of IMPORT_COLUMNS) {
    if (
      normalizeHeader(column.label) === name ||
      (column.aliases as readonly string[]).includes(name)
    ) {
      return column.key;
    }
  }
  return null;
}

/** Total unpacked size of a zip file, from its central directory; null if unreadable. */
export function zipUnpackedSize(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEnd = Math.max(0, bytes.length - 65_557);
  let end = -1;
  for (let i = bytes.length - 22; i >= minEnd; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
    const size = view.getUint32(offset + 24, true);
    if (size === 0xffffffff) return null; // ZIP64: not something a spreadsheet needs
    total += size;
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  return total;
}

/** A cell's value as text, whatever Excel stored (number, link, rich text, formula result). */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      // A typed link: keep the address when it is a web address, else the text.
      return /^https?:\/\//i.test(value.hyperlink) ? value.hyperlink.trim() : cellText(value.text);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part.text)
        .join("")
        .trim();
    }
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return cellText(value.text as ExcelJS.CellValue);
  }
  return "";
}

function toRows(headers: string[], body: { rowNumber: number; cells: string[] }[]): SheetRow[] {
  const map = headers.map(columnFor);
  const missing = IMPORT_COLUMNS.filter((column) => column.required && !map.includes(column.key));
  if (missing.length > 0) {
    throw new ImportFileError(
      `The first row must name the columns. Missing: ${missing.map((column) => column.label).join(", ")}. Download the template to start from the right columns.`,
    );
  }
  const rows: SheetRow[] = [];
  for (const line of body) {
    const values: SheetRow["values"] = {};
    line.cells.forEach((cell, index) => {
      const key = map[index];
      if (key && cell !== "") values[key] = cell;
    });
    if (Object.keys(values).length === 0) continue; // blank row
    rows.push({ rowNumber: line.rowNumber, values });
  }
  if (rows.length === 0) throw new ImportFileError("The file has no products in it.");
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ImportFileError(
      `The file has ${rows.length} rows; import up to ${MAX_IMPORT_ROWS} at a time.`,
    );
  }
  return rows;
}

async function readXlsx(bytes: Uint8Array): Promise<SheetRow[]> {
  const unpacked = zipUnpackedSize(bytes);
  if (unpacked === null) throw new ImportFileError("This file could not be read as an Excel file.");
  if (unpacked > MAX_UNPACKED_BYTES) throw new ImportFileError("This Excel file is too large.");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError("This file could not be read as an Excel file.");
  }
  const sheet = workbook.getWorksheet("Products") ?? workbook.worksheets[0];
  if (!sheet) throw new ImportFileError("The Excel file has no sheets.");
  if (sheet.rowCount > MAX_IMPORT_ROWS + 50) {
    throw new ImportFileError(`Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
  }
  const width = Math.min(sheet.columnCount, 40);
  const read = (rowNumber: number) =>
    Array.from({ length: width }, (_, i) => cellText(sheet.getRow(rowNumber).getCell(i + 1).value));
  const headers = read(1);
  const body = [];
  for (let n = 2; n <= sheet.rowCount; n += 1) body.push({ rowNumber: n, cells: read(n) });
  return toRows(headers, body);
}

/** Splits CSV text into rows of fields (quotes, doubled quotes and line breaks inside quotes). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const char of firstLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char in counts) counts[char as keyof typeof counts] += 1;
  }
  // Excel in many regions saves CSV with semicolons.
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0] as string;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[i + 1] === "\n") i += 1;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

/** Reads an uploaded import file into rows. Throws ImportFileError with a message for staff. */
export async function readImportFile(fileName: string, bytes: Uint8Array): Promise<SheetRow[]> {
  if (bytes.length === 0) throw new ImportFileError("Choose a file to import.");
  if (bytes.length > MAX_IMPORT_FILE_BYTES) {
    throw new ImportFileError("The file is too large (2 MB at most). Split it into smaller files.");
  }
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip || /\.xlsx$/i.test(fileName)) {
    if (!isZip) throw new ImportFileError("This file could not be read as an Excel file.");
    return readXlsx(bytes);
  }
  if (/\.(xls)$/i.test(fileName)) {
    throw new ImportFileError("Save the file as .xlsx (Excel Workbook) or .csv, then import it.");
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const [headers = [], ...body] = parseCsv(text);
  return toRows(
    headers,
    body.map((cells, index) => ({ rowNumber: index + 2, cells })),
  );
}

/**
 * The template for this store: a Products sheet whose Category and Brand
 * columns offer the store's own lists, and a Help sheet.
 */
export async function buildImportTemplate(input: {
  storeName: string;
  currency: string;
  categories: string[];
  brands: string[];
}): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.storeName;
  const sheet = workbook.addWorksheet("Products", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = IMPORT_COLUMNS.map((column) => ({
    header: column.required ? `${column.label} *` : column.label,
    key: column.key,
    width: column.key === "description" || column.key === "pictures" ? 45 : 18,
  }));
  sheet.getRow(1).font = { bold: true };

  const lists = workbook.addWorksheet("Lists", { state: "hidden" });
  lists.getCell("A1").value = "Categories";
  lists.getCell("B1").value = "Brands";
  input.categories.forEach((name, i) => (lists.getCell(i + 2, 1).value = name));
  input.brands.forEach((name, i) => (lists.getCell(i + 2, 2).value = name));

  const columnLetter = (key: ImportColumn) =>
    String.fromCharCode(65 + IMPORT_COLUMNS.findIndex((column) => column.key === key));
  const dropdown = (key: ImportColumn, listColumn: string, count: number, label: string) => {
    if (count === 0) return;
    const letter = columnLetter(key);
    for (let row = 2; row <= MAX_IMPORT_ROWS + 1; row += 1) {
      sheet.getCell(`${letter}${row}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`Lists!$${listColumn}$2:$${listColumn}$${count + 1}`],
        showErrorMessage: true,
        errorTitle: `Choose a ${label}`,
        error: `Pick a ${label} from the list. To use a new one, add it in the admin first, then download a new template.`,
      };
    }
  };
  dropdown("category", "A", input.categories.length, "category");
  dropdown("brand", "B", input.brands.length, "brand");

  const help = workbook.addWorksheet("Help");
  help.getColumn(1).width = 110;
  [
    `How to import products into ${input.storeName}`,
    "",
    "One row per product. For a product in several colours or sizes, use one row for each, with the same Product name; the category, brand, description and picture links are read from its first row.",
    "Product name, SKU and Price are needed on every row. SKUs must be new (not already in the store) and different on every row.",
    `Prices are in ${input.currency}, written like 40 or 39.99. Sale price, when given, must be lower than the price.`,
    "Category and Brand: pick from the dropdown. To use a new category or brand, add it in the admin first, then download a new template.",
    "Stock: how many you have now (a whole number). Leave it empty if you do not count stock for this product.",
    "Picture links: web addresses of the pictures (https://...), separated by commas or new lines, up to 8 per product. The store downloads and resizes them after the import.",
    "When you upload the file, the store checks every row first and shows any problems. Nothing is saved until you press Import.",
  ].forEach((line, i) => {
    help.getCell(i + 1, 1).value = line;
    help.getCell(i + 1, 1).alignment = { wrapText: true };
  });
  help.getCell(1, 1).font = { bold: true, size: 14 };

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
