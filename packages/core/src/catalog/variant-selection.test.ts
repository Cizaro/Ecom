import { describe, expect, it } from "vitest";
import { selectVariant } from "./variant-selection";

const v = (id: string, color: string | null, size: string | null) => ({ id, color, size });

// Black comes in S and M; Tan comes in M and L.
const variants = [
  v("black-s", "Black", "S"),
  v("black-m", "Black", "M"),
  v("tan-m", "Tan", "M"),
  v("tan-l", "Tan", "L"),
];

const summary = (choices: { label: string; selected: boolean; available: boolean }[]) =>
  choices.map((c) => `${c.label}${c.selected ? "*" : ""}${c.available ? "" : "(x)"}`).join(" ");

describe("selectVariant", () => {
  it("selects the first variant when nothing is asked for", () => {
    const selection = selectVariant(variants);
    expect(selection.variant.id).toBe("black-s");
    expect(summary(selection.colors)).toBe("Black* Tan");
    expect(summary(selection.sizes)).toBe("S* M L(x)");
    expect(selection.unknownRequest).toBe(false);
  });

  it("selects by colour and size without regard to letter case or spaces", () => {
    const selection = selectVariant(variants, { color: " TAN ", size: "l" });
    expect(selection.variant.id).toBe("tan-l");
    expect(summary(selection.colors)).toBe("Black Tan*");
    expect(summary(selection.sizes)).toBe("S(x) M L*");
  });

  it("keeps the chosen size when changing colour, if that colour has it", () => {
    const onBlackM = selectVariant(variants, { color: "black", size: "m" });
    expect(onBlackM.colors.find((c) => c.label === "Tan")?.variantId).toBe("tan-m");
    const onBlackS = selectVariant(variants, { color: "black", size: "s" });
    // Tan has no S: choosing Tan leads to its first size.
    expect(onBlackS.colors.find((c) => c.label === "Tan")?.variantId).toBe("tan-m");
  });

  it("marks sizes the chosen colour does not come in, and offers no way to pick them", () => {
    const selection = selectVariant(variants, { color: "tan" });
    expect(selection.variant.id).toBe("tan-m");
    const small = selection.sizes.find((size) => size.label === "S")!;
    expect(small).toMatchObject({ available: false, variantId: null, selected: false });
    expect(selection.sizes.find((size) => size.label === "L")?.variantId).toBe("tan-l");
  });

  it("keeps the colour when the size asked for does not exist in it", () => {
    const selection = selectVariant(variants, { color: "black", size: "l" });
    expect(selection.variant.id).toBe("black-s");
    expect(selection.unknownRequest).toBe(true);
  });

  it("falls back to the default for values the product does not have", () => {
    const selection = selectVariant(variants, { color: "purple", size: "xxl" });
    expect(selection.variant.id).toBe("black-s");
    expect(selection.unknownRequest).toBe(true);
    expect(selectVariant(variants, { color: "'; DROP TABLE" }).variant.id).toBe("black-s");
  });

  it("finds a size across colours when only a size is asked for", () => {
    expect(selectVariant(variants, { size: "L" }).variant.id).toBe("tan-l");
    expect(selectVariant(variants, { size: "M" }).variant.id).toBe("black-m");
  });

  it("handles products with one kind of option or none", () => {
    const coloursOnly = selectVariant([v("a", "Gold", null), v("b", "Silver", null)], {
      color: "silver",
    });
    expect(coloursOnly.variant.id).toBe("b");
    expect(coloursOnly.sizes).toEqual([]);
    expect(summary(coloursOnly.colors)).toBe("Gold Silver*");

    const sizesOnly = selectVariant([v("a", null, "38"), v("b", null, "40")], { size: "40" });
    expect(sizesOnly.variant.id).toBe("b");
    expect(sizesOnly.colors).toEqual([]);
    expect(summary(sizesOnly.sizes)).toBe("38 40*");

    const single = selectVariant([v("only", null, null)], { color: "red" });
    expect(single.variant.id).toBe("only");
    expect(single.colors).toEqual([]);
    expect(single.sizes).toEqual([]);
  });

  it("lists each value once, as first written", () => {
    const selection = selectVariant([
      v("a", "Black", "M"),
      v("b", "black", "L"),
      v("c", " BLACK ", "S"),
    ]);
    expect(selection.colors.map((c) => c.label)).toEqual(["Black"]);
    expect(selection.sizes.map((s) => s.label)).toEqual(["M", "L", "S"]);
  });

  it("refuses an empty list", () => {
    expect(() => selectVariant([])).toThrow();
  });
});
