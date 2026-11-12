import { describe, expect, it } from "vitest";
import { isSlug, slugify } from "./slug";

describe("slugify", () => {
  it("lowercases, joins words with hyphens and drops punctuation", () => {
    expect(slugify("Leather Tote Bag")).toBe("leather-tote-bag");
    expect(slugify("  Men's   Wallets!! ")).toBe("men-s-wallets");
    expect(slugify("Watch — 42mm / Steel")).toBe("watch-42mm-steel");
  });

  it("removes accents", () => {
    expect(slugify("Crème Brûlée Édition")).toBe("creme-brulee-edition");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(slugify("حقيبة جلدية")).toBe("");
    expect(slugify("!!!")).toBe("");
  });

  it("limits the length without leaving a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(119)} b c`);
    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("always produces a valid slug or nothing", () => {
    for (const name of ["A", "a--b", "-x-", "Ünïcödé 99", "100% Silk"]) {
      const slug = slugify(name);
      expect(slug === "" || isSlug(slug), name).toBe(true);
    }
  });
});

describe("isSlug", () => {
  it("accepts lowercase words joined by single hyphens", () => {
    expect(isSlug("womens-bags")).toBe(true);
    expect(isSlug("a1")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of ["", "Bags", "a--b", "-a", "a-", "a b", "a/b", "a".repeat(121)]) {
      expect(isSlug(value), value).toBe(false);
    }
  });
});
