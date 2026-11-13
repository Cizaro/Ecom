import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  clearedHref,
  hasEmptyParams,
  listingHref,
  parseListing,
  toListInput,
} from "./listing";

describe("product list address parameters", () => {
  it("reads filters, sort, search and page", () => {
    const state = parseListing({
      q: "  leather tote ",
      sort: "price_asc",
      brand: ["Aria", "nord", "aria"],
      color: "Black",
      min: "10",
      max: "49.90",
      page: "3",
    });
    expect(state).toEqual({
      q: "leather tote",
      sort: "price_asc",
      brands: ["aria", "nord"],
      colors: ["black"],
      min: "10",
      max: "49.90",
      page: 3,
    });
    expect(activeFilterCount(state)).toBe(5);
  });

  it("drops anything unknown or malformed instead of trusting it", () => {
    const state = parseListing({
      sort: "price; DROP TABLE products",
      page: "-4",
      brand: ["", "   ", "x".repeat(200)],
      color: Array.from({ length: 60 }, (_, index) => `c${index}`),
      q: "a".repeat(500),
    });
    expect(state.sort).toBeNull();
    expect(state.page).toBe(1);
    expect(state.brands).toEqual([]);
    expect(state.colors).toHaveLength(20);
    expect(state.q).toHaveLength(100);
    expect(parseListing({ page: "9999999" }).page).toBe(1);
    expect(parseListing({ page: "2abc" }).page).toBe(2);
    expect(parseListing({}).page).toBe(1);
  });

  it("turns typed prices into minor units and ignores invalid ones", () => {
    const input = toListInput(parseListing({ min: "10", max: "49.90" }), "USD");
    expect(input).toMatchObject({ priceMin: 1000, priceMax: 4990 });
    const bad = toListInput(parseListing({ min: "abc", max: "-5" }), "USD");
    expect(bad).toMatchObject({ priceMin: null, priceMax: null });
    expect(toListInput(parseListing({ max: "1500" }), "JPY").priceMax).toBe(1500);
    expect(toListInput(parseListing({}), "USD")).toMatchObject({
      search: undefined,
      sort: undefined,
      priceMin: null,
      priceMax: null,
      page: 1,
    });
  });

  it("builds short, stable addresses and round-trips them", () => {
    const state = parseListing({
      brand: ["nord", "aria"],
      color: "black",
      sort: "name",
      page: "2",
    });
    const href = listingHref("/c/bags", state);
    expect(href).toBe("/c/bags?sort=name&brand=nord&brand=aria&color=black&page=2");
    const again = parseListing(
      Object.fromEntries(
        [...new Set(new URL(href, "http://x").searchParams.keys())].map((key) => [
          key,
          new URL(href, "http://x").searchParams.getAll(key),
        ]),
      ),
    );
    expect(again).toEqual(state);

    expect(listingHref("/products", parseListing({}))).toBe("/products");
    expect(listingHref("/c/bags", state, { page: 1 })).not.toContain("page=");
    expect(listingHref("/search", parseListing({ q: "a&b=c d" }))).toBe("/search?q=a%26b%3Dc+d");
  });

  it("notices the blank fields a submitted form adds to the address", () => {
    expect(hasEmptyParams({ sort: "name", min: "", max: "" })).toBe(true);
    expect(hasEmptyParams({ color: ["red", " "] })).toBe(true);
    expect(hasEmptyParams({ sort: "name", color: ["red"] })).toBe(false);
    expect(hasEmptyParams({})).toBe(false);
  });

  it("clears filters but keeps the search and the sort", () => {
    const state = parseListing({ q: "tote", sort: "newest", brand: "aria", min: "5", page: "4" });
    expect(clearedHref("/search", state)).toBe("/search?q=tote&sort=newest");
  });
});
