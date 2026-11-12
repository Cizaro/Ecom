import type { PermissionKey } from "@ecom/core";

/**
 * Who may reach each admin page, server action and API route. This list is
 * the contract the guards implement:
 *
 * - A unit test fails when a page, action or API route exists without an
 *   entry here, or when its source does not call the matching guard.
 * - The end-to-end isolation suite visits every page and API route as every
 *   role, as a member of another tenant and signed out, and checks the result.
 */
export type RouteAccess =
  /** Anyone, signed in or not (sign-in, password reset). */
  | { level: "public" }
  /** Any signed-in staff user, with or without a tenant. Guard: requireSession(). */
  | { level: "session" }
  /** Signed in with a chosen tenant. Guard: requireTenantContext(). */
  | { level: "tenant" }
  /** Signed in, chosen tenant, and this permission. Guard: requirePermission(). */
  | { level: "permission"; permission: PermissionKey };

export interface PageEntry {
  path: string;
  access: RouteAccess;
}

export interface ActionEntry {
  /** `<file relative to src/app>#<exported function>` */
  id: string;
  access: RouteAccess;
}

export interface ApiEntry {
  path: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  access: RouteAccess;
}

const CATALOG_READ: RouteAccess = { level: "permission", permission: "catalog.read" };
const CATALOG_WRITE: RouteAccess = { level: "permission", permission: "catalog.write" };

/**
 * A path segment in square brackets (`[id]`) stands for a record identifier.
 * The guard runs before the record is looked up, so an unknown identifier
 * answers 404 to a user with access and 403 to one without.
 */
export const ADMIN_PAGES: readonly PageEntry[] = [
  { path: "/admin/sign-in", access: { level: "public" } },
  { path: "/admin/two-factor", access: { level: "public" } },
  { path: "/admin/forgot-password", access: { level: "public" } },
  { path: "/admin/reset-password", access: { level: "public" } },
  { path: "/admin", access: { level: "session" } },
  { path: "/admin/account/security", access: { level: "session" } },
  { path: "/admin/select-store", access: { level: "session" } },
  { path: "/admin/access", access: { level: "tenant" } },
  { path: "/admin/team", access: { level: "permission", permission: "staff.manage" } },
  { path: "/admin/catalog/products", access: CATALOG_READ },
  { path: "/admin/catalog/products/new", access: CATALOG_WRITE },
  // Viewing a product needs catalog.read; its edit form is read-only without catalog.write.
  { path: "/admin/catalog/products/[id]", access: CATALOG_READ },
  { path: "/admin/catalog/products/[id]/variants/new", access: CATALOG_WRITE },
  { path: "/admin/catalog/products/[id]/variants/[variantId]", access: CATALOG_WRITE },
  { path: "/admin/catalog/categories", access: CATALOG_READ },
  { path: "/admin/catalog/categories/[id]", access: CATALOG_WRITE },
  { path: "/admin/catalog/brands", access: CATALOG_READ },
  { path: "/admin/catalog/brands/[id]", access: CATALOG_WRITE },
];

const CATALOG_ACTIONS = "(admin)/admin/(protected)/catalog/actions.ts";

const CATALOG_ACTION_ENTRIES: readonly ActionEntry[] = [
  "createCategoryAction",
  "updateCategoryAction",
  "deleteCategoryAction",
  "createBrandAction",
  "updateBrandAction",
  "deleteBrandAction",
  "createProductAction",
  "updateProductAction",
  "setProductStatusAction",
  "addVariantAction",
  "updateVariantAction",
  "deleteVariantAction",
  "uploadProductImageAction",
  "updateProductImageAction",
  "moveProductImageAction",
  "removeProductImageAction",
  "setCategoryImageAction",
  "removeCategoryImageAction",
  "setBrandLogoAction",
  "removeBrandLogoAction",
].map((name) => ({ id: `${CATALOG_ACTIONS}#${name}`, access: CATALOG_WRITE }));

const AUTH_ACTIONS = "(admin)/admin/actions.ts";

export const ADMIN_ACTIONS: readonly ActionEntry[] = [
  { id: `${AUTH_ACTIONS}#signInAction`, access: { level: "public" } },
  { id: `${AUTH_ACTIONS}#verifySecondFactorAction`, access: { level: "public" } },
  { id: `${AUTH_ACTIONS}#requestPasswordResetAction`, access: { level: "public" } },
  { id: `${AUTH_ACTIONS}#resetPasswordAction`, access: { level: "public" } },
  // Signing out without a session is a harmless no-op.
  { id: `${AUTH_ACTIONS}#signOutAction`, access: { level: "public" } },
  { id: `${AUTH_ACTIONS}#signOutEverywhereAction`, access: { level: "public" } },
  { id: `${AUTH_ACTIONS}#beginTwoFactorSetupAction`, access: { level: "session" } },
  { id: `${AUTH_ACTIONS}#confirmTwoFactorSetupAction`, access: { level: "session" } },
  { id: `${AUTH_ACTIONS}#disableTwoFactorAction`, access: { level: "session" } },
  {
    id: "(admin)/admin/(protected)/select-store/actions.ts#selectStoreAction",
    access: { level: "session" },
  },
  ...CATALOG_ACTION_ENTRIES,
];

export const ADMIN_API: readonly ApiEntry[] = [
  { path: "/api/v1/admin/me", method: "GET", access: { level: "tenant" } },
];

/** The guard call each access level requires in the route's source. */
export function guardCallFor(access: RouteAccess): string | null {
  switch (access.level) {
    case "public":
      return null;
    case "session":
      return "requireSession()";
    case "tenant":
      return "requireTenantContext()";
    case "permission":
      return `requirePermission("${access.permission}")`;
  }
}
