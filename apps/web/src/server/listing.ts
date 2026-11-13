import { parseMoney, PUBLIC_SORTS, type PublicListInput, type PublicSort } from "@ecom/core";

// A product list's filters live in the page address, so a filtered list can
// be shared, bookmarked and reached with the back button. This file turns
// address parameters into a list request and back. Everything in the address
// is typed by a visitor: unknown or malformed values are dropped, never
// trusted.

export type RawParams = Record<string, string | string[] | undefined>;

export interface ListingState {
  /** Search words, on the search page. */
  q: string;
  sort: PublicSort | null;
  brands: string[];
  colors: string[];
  /** As typed, for showing again in the form. */
  min: string;
  max: string;
  page: number;
}

const MAX_VALUES = 20;

const all = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const first = (value: string | string[] | undefined): string => all(value)[0] ?? "";

const cleanList = (value: string | string[] | undefined): string[] =>
  [
    ...new Set(
      all(value)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item !== "" && item.length <= 60),
    ),
  ].slice(0, MAX_VALUES);

export function parseListing(params: RawParams): ListingState {
  const sort = PUBLIC_SORTS.find((value) => value === first(params.sort)) ?? null;
  const page = Number.parseInt(first(params.page), 10);
  return {
    q: first(params.q).trim().slice(0, 100),
    sort,
    brands: cleanList(params.brand),
    colors: cleanList(params.color),
    min: first(params.min).trim().slice(0, 12),
    max: first(params.max).trim().slice(0, 12),
    page: Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1,
  };
}

/** The filters a shopper has switched on (not counting sort, search or page). */
export function activeFilterCount(state: ListingState): number {
  return state.brands.length + state.colors.length + (state.min ? 1 : 0) + (state.max ? 1 : 0);
}

/** What to ask the catalog for. A price that is not a valid amount is ignored. */
export function toListInput(
  state: ListingState,
  currency: string,
): Pick<
  PublicListInput,
  "search" | "sort" | "brandSlugs" | "colors" | "priceMin" | "priceMax" | "page"
> {
  return {
    search: state.q || undefined,
    sort: state.sort ?? undefined,
    brandSlugs: state.brands,
    colors: state.colors,
    priceMin: state.min ? parseMoney(state.min, currency) : null,
    priceMax: state.max ? parseMoney(state.max, currency) : null,
    page: state.page,
  };
}

/** The address of a list with this state. Defaults are left out to keep it short. */
export function listingHref(
  basePath: string,
  state: ListingState,
  change: Partial<ListingState> = {},
): string {
  const next = { ...state, ...change };
  const query = new URLSearchParams();
  if (next.q) query.set("q", next.q);
  if (next.sort) query.set("sort", next.sort);
  for (const brand of next.brands) query.append("brand", brand);
  for (const color of next.colors) query.append("color", color);
  if (next.min) query.set("min", next.min);
  if (next.max) query.set("max", next.max);
  if (next.page > 1) query.set("page", String(next.page));
  const text = query.toString();
  return text ? `${basePath}?${text}` : basePath;
}

/** The same list with every filter removed (search and sort are kept). */
export function clearedHref(basePath: string, state: ListingState): string {
  return listingHref(basePath, state, { brands: [], colors: [], min: "", max: "", page: 1 });
}

/**
 * True when the address carries empty parameters (`?min=&max=`), which a
 * browser adds for every blank field of a submitted form. Pages redirect to
 * the tidy address so one list has one address.
 */
export function hasEmptyParams(params: RawParams): boolean {
  return Object.values(params).some((value) => all(value).some((item) => item.trim() === ""));
}
