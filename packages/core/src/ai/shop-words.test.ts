import { describe, expect, it } from "vitest";
import { normalizeArabic, shopWordsFor } from "./shop-words";

describe("shop words in Arabic, Lebanese and Arabizi", () => {
  it("finds the catalog's English for shoppers' words", () => {
    expect(shopWordsFor(["عندكن", "شنطة", "سودا"]).sort()).toEqual(["bag", "black"]);
    expect(shopWordsFor(["3endkon", "shanta", "sawda"]).sort()).toEqual(["bag", "black"]);
    expect(shopWordsFor(["ma7fazeh", "lal", "rjel"])).toEqual(["wallet"]);
    expect(shopWordsFor(["الساعة"])).toEqual(["watch"]);
  });

  it("spells Arabic one way", () => {
    expect(normalizeArabic("الشنطة")).toBe("شنطه");
    expect(normalizeArabic("أسوَد")).toBe("اسود");
  });
});
