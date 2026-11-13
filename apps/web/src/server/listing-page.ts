import "server-only";

import { redirect } from "next/navigation";
import {
  hasEmptyParams,
  listingHref,
  parseListing,
  type ListingState,
  type RawParams,
} from "./listing";

/**
 * The list state for a page, from its address. Redirects to the tidy form of
 * the address when the browser sent blank form fields along.
 */
export function listingState(
  basePath: string,
  params: RawParams,
  options: { search: boolean },
): ListingState {
  const parsed = parseListing(params);
  const state = options.search ? parsed : { ...parsed, q: "" };
  if (hasEmptyParams(params)) redirect(listingHref(basePath, state));
  return state;
}
