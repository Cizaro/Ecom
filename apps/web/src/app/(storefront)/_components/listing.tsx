import {
  formatMoney,
  listPublicProducts,
  type PublicListInput,
  type PublicSort,
  type TenantDb,
} from "@ecom/core";
import { buttonClasses, EmptyState, inputClasses } from "@ecom/ui";
import Link from "next/link";
import {
  activeFilterCount,
  clearedHref,
  listingHref,
  toListInput,
  type ListingState,
} from "@/server/listing";
import { ProductGrid } from "./product-card";
import { SortSelect } from "./sort-select";

const SORT_LABELS: Record<PublicSort, string> = {
  relevance: "Best match",
  newest: "Newest",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  name: "Name",
};

function CheckboxGroup({
  legend,
  name,
  options,
  selected,
}: {
  legend: string;
  name: string;
  options: readonly { value: string; label: string; count: number }[];
  selected: readonly string[];
}) {
  if (options.length === 0) return null;
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-1 flex flex-col">
        {options.map((option) => {
          const id = `${name}-${option.value.replace(/[^a-z0-9]+/g, "-")}`;
          return (
            <label key={option.value} htmlFor={id} className="flex min-h-11 items-center gap-3">
              <input
                id={id}
                type="checkbox"
                name={name}
                value={option.value}
                defaultChecked={selected.includes(option.value)}
                className="size-5 rounded border-line-strong accent-brand"
              />
              <span className="min-w-0 truncate text-sm">{option.label}</span>
              <span className="text-sm text-ink-muted">({option.count})</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A product list with sorting, filters and paging, all carried in the page
 * address. Used by category pages, "all products" and search. Works without
 * JavaScript: the controls are one GET form.
 */
export async function ProductListing({
  db,
  basePath,
  state,
  currency,
  scope,
  emptyTitle,
}: {
  db: TenantDb;
  basePath: string;
  state: ListingState;
  currency: string;
  /** What the page is about: a category, a search, or nothing (all products). */
  scope: Pick<PublicListInput, "categoryId" | "flag">;
  emptyTitle: string;
}) {
  const list = await listPublicProducts(db, { ...scope, ...toListInput(state, currency) });
  const filterCount = activeFilterCount(state);
  const sorts = (Object.keys(SORT_LABELS) as PublicSort[]).filter(
    (sort) => sort !== "relevance" || state.q !== "",
  );
  const currentSort = state.sort ?? (state.q ? "relevance" : "newest");
  const hasFilterOptions =
    list.facets.brands.length > 0 || list.facets.colors.length > 0 || list.facets.price !== null;
  const beyondLastPage = list.items.length === 0 && list.total > 0;

  return (
    <div className="flex flex-col gap-6">
      {list.total > 0 || filterCount > 0 ? (
        <form
          method="get"
          action={basePath}
          aria-label="Sort and filter"
          className="flex flex-col gap-3"
          data-testid="listing-controls"
        >
          {state.q ? <input type="hidden" name="q" value={state.q} /> : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted" data-testid="result-count" role="status">
              {list.total} {list.total === 1 ? "product" : "products"}
            </p>
            <SortSelect
              value={currentSort}
              options={sorts.map((sort) => ({ value: sort, label: SORT_LABELS[sort] }))}
            />
          </div>

          {hasFilterOptions ? (
            <details
              open={filterCount > 0}
              className="rounded-card border border-line"
              data-testid="filters"
            >
              <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium">
                Filters{filterCount > 0 ? ` (${filterCount})` : ""}
              </summary>
              <div className="grid gap-6 border-t border-line p-4 sm:grid-cols-3">
                <CheckboxGroup
                  legend="Brand"
                  name="brand"
                  selected={state.brands}
                  options={list.facets.brands.map((brand) => ({
                    value: brand.slug,
                    label: brand.name,
                    count: brand.count,
                  }))}
                />
                <CheckboxGroup
                  legend="Colour"
                  name="color"
                  selected={state.colors}
                  options={list.facets.colors.map((color) => ({
                    value: color.value.toLowerCase(),
                    label: color.value,
                    count: color.count,
                  }))}
                />
                {list.facets.price ? (
                  <fieldset className="min-w-0">
                    <legend className="text-sm font-medium">Price ({currency})</legend>
                    <div className="mt-2 flex items-end gap-2">
                      <div className="flex min-w-0 flex-col gap-1">
                        <label htmlFor="min" className="text-sm text-ink-muted">
                          From
                        </label>
                        <input
                          id="min"
                          name="min"
                          inputMode="decimal"
                          defaultValue={state.min}
                          className={inputClasses}
                        />
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        <label htmlFor="max" className="text-sm text-ink-muted">
                          To
                        </label>
                        <input
                          id="max"
                          name="max"
                          inputMode="decimal"
                          defaultValue={state.max}
                          className={inputClasses}
                        />
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">
                      Prices here run from{" "}
                      {formatMoney(list.facets.price.min, list.facets.price.currency)} to{" "}
                      {formatMoney(list.facets.price.max, list.facets.price.currency)}.
                    </p>
                  </fieldset>
                ) : null}
                <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                  <button type="submit" className={buttonClasses()}>
                    Apply filters
                  </button>
                  {filterCount > 0 ? (
                    <Link
                      href={clearedHref(basePath, state)}
                      className="text-sm underline underline-offset-4"
                    >
                      Clear filters
                    </Link>
                  ) : null}
                </div>
              </div>
            </details>
          ) : null}
        </form>
      ) : null}

      {list.items.length > 0 ? (
        <ProductGrid products={list.items} priorityCount={4} />
      ) : beyondLastPage ? (
        <EmptyState title="There is no such page">
          <Link
            href={listingHref(basePath, state, { page: 1 })}
            className="underline underline-offset-4"
          >
            Go to the first page
          </Link>
        </EmptyState>
      ) : filterCount > 0 ? (
        <EmptyState title="Nothing matches these filters">
          <Link href={clearedHref(basePath, state)} className="underline underline-offset-4">
            Clear filters
          </Link>
        </EmptyState>
      ) : (
        <EmptyState title={emptyTitle}>
          <Link href="/products" className="underline underline-offset-4">
            See all products
          </Link>
        </EmptyState>
      )}

      {list.pageCount > 1 && list.items.length > 0 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
          {list.page > 1 ? (
            <Link
              rel="prev"
              href={listingHref(basePath, state, { page: list.page - 1 })}
              className={buttonClasses("secondary")}
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-muted">
            Page {list.page} of {list.pageCount}
          </span>
          {list.page < list.pageCount ? (
            <Link
              rel="next"
              href={listingHref(basePath, state, { page: list.page + 1 })}
              className={buttonClasses("secondary")}
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
