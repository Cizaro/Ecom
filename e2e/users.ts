// Test users for the end-to-end suite. Each browser project gets its own user
// per scenario, because the scenarios change account state and run in parallel.

export const E2E_TENANT_SLUG = "e2e";
export const E2E_PROJECTS = ["desktop", "mobile"] as const;
export const E2E_PURPOSES = ["signin", "reset", "mfa"] as const;

export type E2EPurpose = (typeof E2E_PURPOSES)[number];

export const e2eEmail = (purpose: E2EPurpose, project: string) =>
  `e2e-${purpose}-${project}@example.test`;

// Isolation suite: one user per tenant role in the main test tenant, an owner
// of a second tenant, a user who belongs to both, and an owner of a tenant
// that requires two-factor. These scenarios only read, so the browser
// projects share them.
export const E2E_OTHER_TENANT_SLUG = "e2e-other";
export const E2E_MFA_TENANT_SLUG = "e2e-mfa";

// A store reached at 127.0.0.1 with delivery areas and tax already set, so
// its checkout charges delivery without changing the main test store.
export const E2E_SHIPPING_TENANT_SLUG = "e2e-shipping";
export const E2E_SHIPPING_HOST = "127.0.0.1";
export const E2E_SHIPPING_PRODUCT_SLUG = "e2e-delivery-tote";
/** Staff address the delivery test store tells about new orders. */
export const E2E_SHIPPING_ORDERS_EMAIL = "e2e-shipping-orders@example.test";
export const E2E_ROLES = [
  "store_owner",
  "store_manager",
  "inventory_manager",
  "marketer",
  "customer_service",
  "content_editor",
] as const;
export type E2ERole = (typeof E2E_ROLES)[number];

export const roleEmail = (role: E2ERole) => `e2e-role-${role}@example.test`;
export const OTHER_OWNER_EMAIL = "e2e-other-owner@example.test";
export const BOTH_TENANTS_EMAIL = "e2e-both-tenants@example.test";
export const MFA_OWNER_EMAIL = "e2e-mfa-owner@example.test";
