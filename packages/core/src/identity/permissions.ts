/**
 * The permission catalogue and the built-in roles. This file is the source of
 * truth; `seedSystemData` copies it into the database.
 *
 * A permission is `module.action`. Sensitive actions (refunds, draws, ad
 * launches, data export and deletion, staff management) each have their own
 * permission so they can be granted narrowly and audited.
 */
export const PERMISSIONS = {
  "catalog.read": "View products, categories and brands in the admin",
  "catalog.write": "Create, edit, archive, import and export products",

  "inventory.read": "View stock levels and stock movement history",
  "inventory.adjust": "Adjust stock and receive purchase orders",
  "suppliers.manage": "Manage suppliers and purchase orders",

  "orders.read": "View orders, payments and shipments",
  "orders.manage": "Update order status, add notes, create shipments, cancel orders",
  "orders.refund": "Issue refunds",
  "returns.manage": "Approve, reject and receive returns",

  "customers.read": "View customer profiles and history",
  "customers.write": "Edit customer profiles, add notes, assign agents",
  "customers.export": "Export customer data",
  "customers.delete": "Process customer deletion requests",

  "reviews.moderate": "Approve, reject, hide and reply to reviews and customer content",
  "promotions.write": "Create and edit coupons and promotions",

  "content.write": "Upload assets and create content drafts",
  "content.approve": "Approve content for publishing",
  "social.connect": "Connect and disconnect social accounts",
  "social.publish": "Schedule and publish approved content",

  "inbox.read": "View social and support conversations",
  "inbox.reply": "Reply to conversations and comments",
  "inbox.configure": "Manage saved replies and automation rules",

  "ai.use": "Run AI tasks and review AI drafts",
  "ai.configure": "Change AI automation level, budget, prompts, and pause or resume automation",

  "marketing.write": "Create marketing plans, campaigns, segments and tracking links",
  "ads.draft": "Create and edit advertising campaign drafts",
  "ads.launch": "Launch and pause paid advertising campaigns",
  "research.write": "Manage competitor profiles and research",

  "giveaways.read": "View giveaway campaigns, entries and results",
  "giveaways.manage": "Create and configure giveaways, review and refund entries",
  "giveaways.draw": "Run winner draws and redraws, verify and disqualify winners",

  "reports.read": "View dashboards and reports",
  "settings.write": "Change store settings, shipping, tax and notifications",
  "staff.manage": "Invite staff, assign roles and manage custom roles",
  "jobs.read": "View background job status",
  "audit.read": "View the audit log",

  "platform.tenants.manage": "Create, suspend and export tenants",
  "platform.plans.manage": "Manage subscription plans and tenant limits",
  "platform.impersonate": "Act inside a tenant for support, with audit and a visible banner",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.hasOwn(PERMISSIONS, value);
}

const isPlatformPermission = (key: PermissionKey) => key.startsWith("platform.");

/** Everything a tenant can grant to its own staff. */
export const TENANT_PERMISSIONS = ALL_PERMISSIONS.filter((key) => !isPlatformPermission(key));

/** Held back from store managers; the owner decides who else gets them. */
const OWNER_ONLY: PermissionKey[] = [
  "staff.manage",
  "customers.delete",
  "ads.launch",
  "giveaways.draw",
  "ai.configure",
  "social.connect",
];

export interface SystemRole {
  key: string;
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}

export const SYSTEM_ROLES = [
  {
    key: "platform_admin",
    name: "Platform administrator",
    description:
      "Operates the platform across all tenants. Granted through the user's platform-admin flag, not through a tenant membership.",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "store_owner",
    name: "Store owner",
    description: "Full control of the store, including staff, refunds, draws and ad spend.",
    permissions: TENANT_PERMISSIONS,
  },
  {
    key: "store_manager",
    name: "Store manager",
    description:
      "Runs day-to-day operations. Cannot manage staff, delete customers, launch ads, run draws, reconfigure AI or connect social accounts.",
    permissions: TENANT_PERMISSIONS.filter((key) => !OWNER_ONLY.includes(key)),
  },
  {
    key: "inventory_manager",
    name: "Inventory manager",
    description: "Manages products, stock, suppliers and purchase orders.",
    permissions: [
      "catalog.read",
      "catalog.write",
      "inventory.read",
      "inventory.adjust",
      "suppliers.manage",
      "orders.read",
      "reports.read",
    ],
  },
  {
    key: "marketer",
    name: "Marketer",
    description:
      "Plans campaigns, creates and publishes approved content, drafts ads and configures giveaways. Cannot launch ads or run draws.",
    permissions: [
      "catalog.read",
      "customers.read",
      "promotions.write",
      "content.write",
      "content.approve",
      "social.publish",
      "inbox.read",
      "ai.use",
      "marketing.write",
      "ads.draft",
      "research.write",
      "giveaways.read",
      "giveaways.manage",
      "reports.read",
    ],
  },
  {
    key: "customer_service",
    name: "Customer-service agent",
    description:
      "Answers customers, handles returns and moderates reviews. Cannot issue refunds or export customer data.",
    permissions: [
      "catalog.read",
      "inventory.read",
      "orders.read",
      "returns.manage",
      "customers.read",
      "customers.write",
      "reviews.moderate",
      "inbox.read",
      "inbox.reply",
      "ai.use",
      "giveaways.read",
    ],
  },
  {
    key: "content_editor",
    name: "Content editor",
    description: "Edits product content and prepares content drafts. Cannot approve or publish.",
    permissions: ["catalog.read", "catalog.write", "content.write", "reviews.moderate", "ai.use"],
  },
] as const satisfies readonly SystemRole[];

export type SystemRoleKey = (typeof SYSTEM_ROLES)[number]["key"];

/** Roles that must use two-factor when their tenant requires it. */
export const TWO_FACTOR_ROLES: readonly string[] = ["store_owner", "store_manager"];
