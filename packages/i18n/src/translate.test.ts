import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createTranslator, isTranslated, LOCALE_INFO, msg } from "./translate";

const ROOT = resolve(import.meta.dirname, "../../..");

describe("translator", () => {
  const en = createTranslator("en");
  const ar = createTranslator("ar");

  it("shows English as written and Arabic from the catalog", () => {
    expect(en("Add to cart")).toBe("Add to cart");
    expect(ar("Add to cart")).toBe("أضف إلى السلة");
    expect(ar.dir).toBe("rtl");
    expect(en.dir).toBe("ltr");
  });

  it("falls back to the English when a translation is missing", () => {
    expect(ar("Wording nobody translated")).toBe("Wording nobody translated");
  });

  it("fills in values and picks the plural form", () => {
    expect(en("Order #{number}", { number: 1042 })).toBe("Order #1042");
    expect(ar("Order #{number}", { number: 1042 })).toBe("الطلب رقم 1042");
    expect(en("{count} items", { count: 1 })).toBe("1 item");
    expect(en("{count} items", { count: 3 })).toBe("3 items");
    expect(ar("{count} items", { count: 1 })).toBe("قطعة واحدة");
    expect(ar("{count} items", { count: 2 })).toBe("قطعتان");
    expect(ar("{count} items", { count: 5 })).toBe("5 قطع");
    expect(ar("{count} items", { count: 11 })).toBe("11 قطعة");
  });

  it("translates service messages, including ones with values inside", () => {
    expect(ar.message("Your cart is empty.")).toBe("سلتك فارغة.");
    expect(ar.message("Only 3 of this item are left.")).toBe("بقي 3 فقط من هذه القطعة.");
    // A value that is itself wording is translated too.
    expect(ar.message("Enter the city.")).toBe("أدخل المدينة.");
    expect(ar.message("10% off")).toBe("خصم 10%");
    // English, and text that is already Arabic, stay as they are.
    expect(en.message("Your cart is empty.")).toBe("Your cart is empty.");
    expect(ar.message("سلتك فارغة.")).toBe("سلتك فارغة.");
  });

  it("formats money and dates for the language, keeping Western digits in Arabic", () => {
    expect(en.money(4990, "USD")).toBe("$49.90");
    expect(ar.money(4990, "USD")).toMatch(/49\.90/);
    expect(ar.date(new Date("2026-11-20T10:00:00Z"), { year: "numeric" })).toMatch(/2026/);
    expect(LOCALE_INFO.ar.label).toBe("العربية");
  });

  it("msg marks wording without changing it", () => {
    expect(msg("Closed")).toBe("Closed");
  });
});

// --- Completeness: every piece of shop wording has Arabic ------------------------

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** The literal text of every t("...") and msg("...") call in these files. */
function wordingIn(paths: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const path of paths) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(source);
        const first = node.arguments[0];
        if (
          (callee === "t" || callee === "msg") &&
          first &&
          (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
        ) {
          found.set(first.text, path);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

/** Sentences in these files (service messages shoppers can see). */
function sentencesIn(paths: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const path of paths) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest);
    const visit = (node: ts.Node) => {
      let text: string | null = null;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
      else if (ts.isTemplateExpression(node)) {
        // A value inside: stand in a sample value, as the code would.
        text = node.head.text + node.templateSpans.map((span) => `7${span.literal.text}`).join("");
      }
      if (text && /^[A-Z]/.test(text) && /[.?!]$/.test(text) && text.includes(" ")) {
        found.set(text, path);
      }
      if (!ts.isTemplateExpression(node)) ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

describe("Arabic catalog", () => {
  it("translates every piece of shop and email wording", () => {
    const wording = wordingIn([
      ...files(join(ROOT, "apps/web/src/app/(storefront)")),
      ...files(join(ROOT, "apps/web/src/components")),
      join(ROOT, "apps/web/src/server/checkout-pricing.ts"),
      join(ROOT, "packages/core/src/notifications/order-emails.ts"),
      join(ROOT, "packages/core/src/customers/accounts.ts"),
      join(ROOT, "packages/core/src/orders/orders.ts"),
      join(ROOT, "packages/core/src/reviews/reviews.ts"),
    ]);
    expect(wording.size).toBeGreaterThan(300);
    const missing = [...wording].filter(([text]) => !isTranslated("ar", text));
    expect(missing).toEqual([]);
  });

  it("translates the messages shoppers can get from the shop's own services and actions", () => {
    const sentences = sentencesIn([
      // Everything in these is about the shopper's own cart, account or address.
      join(ROOT, "packages/core/src/cart/cart.ts"),
      join(ROOT, "packages/core/src/customers/accounts.ts"),
      join(ROOT, "packages/core/src/customers/addresses.ts"),
      join(ROOT, "packages/core/src/identity/password.ts"),
      ...files(join(ROOT, "apps/web/src/app/(storefront)")).filter((p) => p.endsWith("actions.ts")),
    ]);
    // Wording for emails is checked above; these lines are inside emails.
    const missing = [...sentences].filter(
      ([text]) => !isTranslated("ar", text) && !/^(Someone|If |The link|Open this)/.test(text),
    );
    expect(missing).toEqual([]);
  });
});
