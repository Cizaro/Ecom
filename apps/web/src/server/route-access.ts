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
];

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
