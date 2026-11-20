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
  | { level: "permission"; permission: PermissionKey }
  /**
   * The platform owner's panel (D120): signed in as a platform administrator,
   * no tenant needed and no tenant permission enough. Guard: requirePlatformAdmin().
   */
  | { level: "platform" };

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
const INVENTORY_READ: RouteAccess = { level: "permission", permission: "inventory.read" };
const INVENTORY_ADJUST: RouteAccess = { level: "permission", permission: "inventory.adjust" };
const SETTINGS_WRITE: RouteAccess = { level: "permission", permission: "settings.write" };
const CONTENT_WRITE: RouteAccess = { level: "permission", permission: "content.write" };
const MARKETING_WRITE: RouteAccess = { level: "permission", permission: "marketing.write" };
const RESEARCH_WRITE: RouteAccess = { level: "permission", permission: "research.write" };
const SOCIAL_CONNECT: RouteAccess = { level: "permission", permission: "social.connect" };

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
  { path: "/admin/catalog/import", access: CATALOG_WRITE },
  { path: "/admin/catalog/import/[id]", access: CATALOG_WRITE },
  { path: "/admin/customers", access: { level: "permission", permission: "customers.read" } },
  {
    path: "/admin/customers/[id]",
    access: { level: "permission", permission: "customers.read" },
  },
  { path: "/admin/inbox", access: { level: "permission", permission: "inbox.read" } },
  { path: "/admin/inbox/[id]", access: { level: "permission", permission: "inbox.read" } },
  { path: "/admin/inventory", access: INVENTORY_READ },
  { path: "/admin/inventory/[variantId]", access: INVENTORY_READ },
  { path: "/admin/inventory/locations", access: INVENTORY_READ },
  { path: "/admin/orders", access: { level: "permission", permission: "orders.read" } },
  { path: "/admin/orders/[id]", access: { level: "permission", permission: "orders.read" } },
  { path: "/admin/settings/shipping", access: SETTINGS_WRITE },
  { path: "/admin/settings/notifications", access: SETTINGS_WRITE },
  { path: "/admin/settings/store", access: SETTINGS_WRITE },
  { path: "/admin/settings/pages", access: SETTINGS_WRITE },
  { path: "/admin/settings/billing", access: SETTINGS_WRITE },
  { path: "/admin/promotions", access: { level: "permission", permission: "promotions.write" } },
  { path: "/admin/reviews", access: { level: "permission", permission: "reviews.moderate" } },
  { path: "/admin/content", access: { level: "permission", permission: "reviews.moderate" } },
  { path: "/admin/ai", access: { level: "permission", permission: "ai.use" } },
  { path: "/admin/reports", access: { level: "permission", permission: "reports.read" } },
  // Content planning: approving and publishing need more, checked per step.
  { path: "/admin/marketing/library", access: CONTENT_WRITE },
  { path: "/admin/marketing/library/[id]", access: CONTENT_WRITE },
  { path: "/admin/marketing/posts", access: CONTENT_WRITE },
  { path: "/admin/marketing/posts/new", access: CONTENT_WRITE },
  { path: "/admin/marketing/posts/[id]", access: CONTENT_WRITE },
  { path: "/admin/marketing/calendar", access: CONTENT_WRITE },
  // Marketing plan (D107). A segment's member list also needs customers.read
  // and its export customers.export, checked by the services.
  { path: "/admin/marketing/campaigns", access: MARKETING_WRITE },
  { path: "/admin/marketing/campaigns/new", access: MARKETING_WRITE },
  { path: "/admin/marketing/campaigns/[id]", access: MARKETING_WRITE },
  { path: "/admin/marketing/segments", access: MARKETING_WRITE },
  { path: "/admin/marketing/segments/[id]", access: MARKETING_WRITE },
  { path: "/admin/marketing/links", access: MARKETING_WRITE },
  // Competitor research (D108); drafting ideas also needs ai.use.
  { path: "/admin/research", access: RESEARCH_WRITE },
  { path: "/admin/research/[id]", access: RESEARCH_WRITE },
  { path: "/admin/research/ideas", access: RESEARCH_WRITE },
  // Instagram and Facebook connection (D112): owners only.
  { path: "/admin/social", access: SOCIAL_CONNECT },
  // The platform owner's panel (D120): platform administrators only.
  { path: "/admin/platform", access: { level: "platform" } },
  { path: "/admin/platform/shops", access: { level: "platform" } },
  { path: "/admin/platform/shops/new", access: { level: "platform" } },
  { path: "/admin/platform/shops/[id]", access: { level: "platform" } },
  { path: "/admin/platform/plans", access: { level: "platform" } },
  { path: "/admin/platform/plans/new", access: { level: "platform" } },
  { path: "/admin/platform/plans/[id]", access: { level: "platform" } },
  { path: "/admin/platform/billing", access: { level: "platform" } },
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
  "saveProductTranslationAction",
  "saveCategoryTranslationAction",
].map((name) => ({ id: `${CATALOG_ACTIONS}#${name}`, access: CATALOG_WRITE }));

const IMPORT_ACTIONS = "(admin)/admin/(protected)/catalog/import/actions.ts";

// Opening stock in an import also needs inventory.adjust, which the service checks.
const IMPORT_ACTION_ENTRIES: readonly ActionEntry[] = [
  "checkImportAction",
  "runImportAction",
  "discardImportAction",
].map((name) => ({ id: `${IMPORT_ACTIONS}#${name}`, access: CATALOG_WRITE }));

const INVENTORY_ACTIONS = "(admin)/admin/(protected)/inventory/actions.ts";

const INVENTORY_ACTION_ENTRIES: readonly ActionEntry[] = [
  "changeStockAction",
  "setTrackingAction",
  "createLocationAction",
  "updateLocationAction",
  "setDefaultLocationAction",
].map((name) => ({ id: `${INVENTORY_ACTIONS}#${name}`, access: INVENTORY_ADJUST }));

const ORDER_ACTIONS = "(admin)/admin/(protected)/orders/actions.ts";

const ORDER_ACTION_ENTRIES: readonly ActionEntry[] = [
  "fulfilOrderAction",
  "cancelOrderAction",
  "cashCollectedAction",
  "deliveryRefusedAction",
].map((name) => ({
  id: `${ORDER_ACTIONS}#${name}`,
  access: { level: "permission", permission: "orders.manage" } as const,
}));

// Recording a return needs returns.manage; giving money back with it also
// needs orders.refund, which the service checks.
const RETURN_ACTION_ENTRIES: readonly ActionEntry[] = [
  {
    id: `${ORDER_ACTIONS}#recordReturnAction`,
    access: { level: "permission", permission: "returns.manage" },
  },
];

const SETTINGS_ACTIONS = "(admin)/admin/(protected)/settings/actions.ts";

const SETTINGS_ACTION_ENTRIES: readonly ActionEntry[] = [
  "createShippingZoneAction",
  "updateShippingZoneAction",
  "deleteShippingZoneAction",
  "saveTaxSettingsAction",
  "saveNotificationSettingsAction",
  "retryEmailAction",
  "updateStoreDetailsAction",
  "updateStoreBrandingAction",
  "setStoreLogoAction",
  "removeStoreLogoAction",
  "saveStorePageAction",
].map((name) => ({ id: `${SETTINGS_ACTIONS}#${name}`, access: SETTINGS_WRITE }));

const PROMOTION_ACTIONS = "(admin)/admin/(protected)/promotions/actions.ts";

const PROMOTION_ACTION_ENTRIES: readonly ActionEntry[] = [
  "createDiscountCodeAction",
  "updateDiscountCodeAction",
  "deleteDiscountCodeAction",
].map((name) => ({
  id: `${PROMOTION_ACTIONS}#${name}`,
  access: { level: "permission", permission: "promotions.write" } as const,
}));

const REVIEW_ACTION_ENTRIES: readonly ActionEntry[] = [
  "moderateReviewAction",
  "replyToReviewAction",
].map((name) => ({
  id: `(admin)/admin/(protected)/reviews/actions.ts#${name}`,
  access: { level: "permission", permission: "reviews.moderate" } as const,
}));

const CONTENT_ACTIONS = "(admin)/admin/(protected)/content/actions.ts";

// Adding a creator's content needs content.write; moderating needs reviews.moderate.
const CONTENT_ACTION_ENTRIES: readonly ActionEntry[] = [
  ...["moderateUgcAction", "removeUgcAction"].map((name) => ({
    id: `${CONTENT_ACTIONS}#${name}`,
    access: { level: "permission", permission: "reviews.moderate" } as const,
  })),
  {
    id: `${CONTENT_ACTIONS}#addStaffUgcAction`,
    access: { level: "permission", permission: "content.write" },
  },
];

// Content planning. Moving a post also needs content.approve to approve or
// ask for changes, and social.publish to mark it published: the action and
// the service check the step. Drafting a caption also needs ai.use.
const MARKETING_ACTION_ENTRIES: readonly ActionEntry[] = [
  "addLibraryFileAction",
  "updateLibraryFileAction",
  "makeVersionAction",
  "createPostAction",
  "updatePostAction",
  "movePostAction",
  "deletePostAction",
  "draftCaptionAction",
].map((name) => ({
  id: `(admin)/admin/(protected)/marketing/actions.ts#${name}`,
  access: CONTENT_WRITE,
}));

const CAMPAIGN_ACTION_ENTRIES: readonly ActionEntry[] = [
  "createCampaignAction",
  "updateCampaignAction",
  "deleteCampaignAction",
  "saveSegmentAction",
  "deleteSegmentAction",
  "createLinkAction",
  "deleteLinkAction",
].map((name) => ({
  id: `(admin)/admin/(protected)/marketing/campaigns/actions.ts#${name}`,
  access: MARKETING_WRITE,
}));

const RESEARCH_ACTION_ENTRIES: readonly ActionEntry[] = [
  "saveCompetitorAction",
  "addObservationAction",
  "deleteObservationAction",
  "draftIdeasAction",
  "decideIdeaAction",
].map((name) => ({
  id: `(admin)/admin/(protected)/research/actions.ts#${name}`,
  access: RESEARCH_WRITE,
}));

const INBOX_ACTION_ENTRIES: readonly ActionEntry[] = [
  "replyToConversationStaffAction",
  "updateConversationAction",
  // Drafting also needs ai.use, which the service checks.
  "draftSupportReplyAction",
  "dismissSupportDraftAction",
  // Social inbox (D113): sending again through Meta, and the backup check.
  "retrySocialReplyAction",
  "checkInstagramNowAction",
].map((name) => ({
  id: `(admin)/admin/(protected)/inbox/actions.ts#${name}`,
  access: { level: "permission", permission: "inbox.reply" } as const,
}));

const CUSTOMER_ACTION_ENTRIES: readonly ActionEntry[] = [
  {
    id: "(admin)/admin/(protected)/customers/actions.ts#addCustomerNoteAction",
    access: { level: "permission", permission: "customers.write" },
  },
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
  ...CATALOG_ACTION_ENTRIES,
  ...IMPORT_ACTION_ENTRIES,
  ...INVENTORY_ACTION_ENTRIES,
  ...ORDER_ACTION_ENTRIES,
  ...RETURN_ACTION_ENTRIES,
  ...SETTINGS_ACTION_ENTRIES,
  ...PROMOTION_ACTION_ENTRIES,
  ...REVIEW_ACTION_ENTRIES,
  ...CONTENT_ACTION_ENTRIES,
  ...MARKETING_ACTION_ENTRIES,
  // Publishing through Meta (D114): social.publish, approved posts only.
  ...["publishPostAction", "setAutoPublishAction"].map((name) => ({
    id: `(admin)/admin/(protected)/marketing/actions.ts#${name}`,
    access: { level: "permission", permission: "social.publish" } as const,
  })),
  ...CAMPAIGN_ACTION_ENTRIES,
  ...RESEARCH_ACTION_ENTRIES,
  ...["connectMetaAction", "choosePageAction", "disconnectMetaAction"].map((name) => ({
    id: `(admin)/admin/(protected)/social/actions.ts#${name}`,
    access: SOCIAL_CONNECT,
  })),
  ...INBOX_ACTION_ENTRIES,
  ...CUSTOMER_ACTION_ENTRIES,
  // The platform owner's panel (D120).
  ...["createShopAction", "setShopStatusAction"].map((name) => ({
    id: `(admin)/admin/(platform)/platform/actions.ts#${name}`,
    access: { level: "platform" } as const,
  })),
  // Plans and payments (D122).
  ...[
    "savePlanAction",
    "savePaymentInstructionsAction",
    "setShopPlanAction",
    "createInvoiceAction",
    "markInvoicePaidAction",
    "voidInvoiceAction",
  ].map((name) => ({
    id: `(admin)/admin/(platform)/platform/billing-actions.ts#${name}`,
    access: { level: "platform" } as const,
  })),
  // Requiring two-factor for owners and managers: the service also requires the owner role.
  {
    id: "(admin)/admin/(protected)/team/actions.ts#setRequireTwoFactorAction",
    access: { level: "permission", permission: "staff.manage" },
  },
  // AI: settings and the profile need ai.configure; trying an answer needs ai.use.
  ...["saveAiSettingsAction", "saveBusinessProfileAction"].map((name) => ({
    id: `(admin)/admin/(protected)/ai/actions.ts#${name}`,
    access: { level: "permission", permission: "ai.configure" } as const,
  })),
  {
    id: "(admin)/admin/(protected)/ai/actions.ts#tryAnswerAction",
    access: { level: "permission", permission: "ai.use" },
  },
  // Questions about the reports: the service also requires ai.use.
  {
    id: "(admin)/admin/(protected)/reports/actions.ts#askReportsAction",
    access: { level: "permission", permission: "reports.read" },
  },
  // AI drafts for a product: the services also require ai.use.
  ...[
    "draftProductCopyAction",
    "draftProductTranslationAction",
    "applyProductSuggestionAction",
    "dismissProductSuggestionAction",
  ].map((name) => ({
    id: `(admin)/admin/(protected)/catalog/ai-actions.ts#${name}`,
    access: CATALOG_WRITE,
  })),
];

export const ADMIN_API: readonly ApiEntry[] = [
  {
    path: "/api/v1/admin/reports/products",
    method: "GET",
    access: { level: "permission", permission: "reports.read" },
  },
  { path: "/api/v1/admin/me", method: "GET", access: { level: "tenant" } },
  // Meta's sign-in returns here (D112); it answers with a redirect to /admin/social.
  { path: "/api/v1/admin/social/meta/callback", method: "GET", access: SOCIAL_CONNECT },
  { path: "/api/v1/admin/catalog/import-template", method: "GET", access: CATALOG_WRITE },
  // Holds customers' contact details, so it needs customers.export (the
  // service also checks orders.read).
  {
    path: "/api/v1/admin/orders/export",
    method: "GET",
    access: { level: "permission", permission: "customers.export" },
  },
  // Emails of a segment's customers who agreed to marketing (D107).
  {
    path: "/api/v1/admin/marketing/segment-export",
    method: "GET",
    access: { level: "permission", permission: "customers.export" },
  },
];

const CART_ACTIONS = "(storefront)/cart/actions.ts";

/**
 * Server actions visitors can call without signing in. Each must find its
 * store from the host name (storefrontDb) and act only on what the
 * visitor's own cookie identifies; the unit test checks the first and the
 * cart tests check the second.
 */
const ACCOUNT_ACTIONS = "(storefront)/account/actions.ts";
const CHECKOUT_ACTIONS = "(storefront)/checkout/actions.ts";

export const STOREFRONT_ACTIONS: readonly ActionEntry[] = [
  ...["addToCartAction", "updateCartItemAction", "removeCartItemAction"].map((name) => ({
    id: `${CART_ACTIONS}#${name}`,
    access: { level: "public" } as const,
  })),
  // Account actions that act on an account take the customer from their own
  // session (requireCustomer); the customer tests check that one customer
  // cannot reach another's data.
  ...[
    "signUpAction",
    "verifyEmailAction",
    "signInAction",
    "requestPasswordResetAction",
    "resetPasswordAction",
    "signOutAction",
    "updateProfileAction",
    "createAddressAction",
    "updateAddressAction",
    "deleteAddressAction",
    "setDefaultAddressAction",
  ].map((name) => ({ id: `${ACCOUNT_ACTIONS}#${name}`, access: { level: "public" } as const })),
  // Checkout: the order is built from the shopper's own cart on the server;
  // paying again needs the order's key or its owner's session; the mock
  // provider's buttons go through the same verified path as the webhook;
  // previewing a discount code reads only the shopper's own cart.
  // Reviews: the customer comes from their own session and the service checks
  // they received the product; reports are once per customer.
  // Sharing photos: the customer comes from their own session; the service
  // checks they received the product and records their permission.
  // Writing to the store: a guest's conversation opens only with its key,
  // a customer's only from their own session.
  ...["startConversationAction", "replyToConversationAction"].map((name) => ({
    id: `(storefront)/support/actions.ts#${name}`,
    access: { level: "public" } as const,
  })),
  ...["shareUgcAction", "withdrawUgcAction"].map((name) => ({
    id: `(storefront)/ugc/actions.ts#${name}`,
    access: { level: "public" } as const,
  })),
  ...["submitReviewAction", "reportReviewAction"].map((name) => ({
    id: `(storefront)/reviews/actions.ts#${name}`,
    access: { level: "public" } as const,
  })),
  // The language switch: keeps one of the store's languages in a cookie.
  { id: "(storefront)/language/actions.ts#setLanguageAction", access: { level: "public" } },
  ...["placeOrderAction", "retryPaymentAction", "mockPayAction", "previewDiscountAction"].map(
    (name) => ({
      id: `${CHECKOUT_ACTIONS}#${name}`,
      access: { level: "public" } as const,
    }),
  ),
];

/** The call every storefront action's source must contain. */
export const STOREFRONT_GUARD = "storefrontDb()";

/**
 * The platform site (D121): public pages on the platform's own host, where
 * shop owners sign up. Every page and action must check the host, so none
 * of them answers on a shop's address.
 */
export const PLATFORM_SITE_PAGES: readonly string[] = [
  "/platform-site",
  "/platform-site/templates",
  "/platform-site/signup",
];
export const PLATFORM_SITE_ACTIONS: readonly ActionEntry[] = [
  { id: "platform-site/signup/actions.ts#signUpShopAction", access: { level: "public" } },
];
/** The call every platform-site page and action must contain. */
export const PLATFORM_SITE_GUARD = "requirePlatformSite()";

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
    case "platform":
      return "requirePlatformAdmin()";
  }
}
