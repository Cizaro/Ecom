// Public surface of the domain layer. Each domain module (identity, tenancy,
// catalog, ...) is added under src/<module> and exported from here; modules must
// not import each other's internals. See ARCHITECTURE.md section 3.

export {
  ALL_PERMISSIONS,
  isPermissionKey,
  PERMISSIONS,
  SYSTEM_ROLES,
  TENANT_PERMISSIONS,
  TWO_FACTOR_ROLES,
} from "./identity/permissions";
export type { PermissionKey, SystemRole, SystemRoleKey } from "./identity/permissions";
export {
  DEMO_OWNER_EMAIL,
  DEMO_STORE_HOST,
  DEMO_TENANT_SLUG,
  seedDemoData,
  seedSystemData,
} from "./identity/seed";
export { createAuth, RESET_PASSWORD_PATH, SESSION_LIFETIME_SECONDS } from "./identity/auth";
export type { Auth, AuthDependencies } from "./identity/auth";
export { createAuthService } from "./identity/auth-service";
export type {
  AuthService,
  BeginTwoFactorResult,
  CurrentSession,
  RequestInfo,
  ResetPasswordResult,
  SecondFactorResult,
  SessionMembership,
  SignInResult,
} from "./identity/auth-service";
export {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
  verifyPassword,
} from "./identity/password";
export { createStaffUser, StaffUserError } from "./identity/staff-users";
export type { CreateStaffUserInput } from "./identity/staff-users";
export {
  createConsoleEmailProvider,
  createEmailProvider,
  createMemoryEmailProvider,
  createSmtpEmailProvider,
} from "./notifications/email";
export type { EmailMessage, EmailProvider } from "./notifications/email";
export {
  clearRedisRateLimits,
  createMemoryRateLimiter,
  createRedisRateLimiter,
} from "./platform/rate-limit";
export type { RateLimiter, RateLimitRule, RateLimitStatus } from "./platform/rate-limit";
export { createLogger } from "./platform/logger";
export type { Logger } from "./platform/logger";
export { checkReadiness, closeReadinessConnections } from "./platform/readiness";
export type { ReadinessCheck, ReadinessResult } from "./platform/readiness";
export { redisConnectionOptions } from "./platform/redis";
export { recordAudit, recordAuditBestEffort } from "./platform/audit";
export type { AuditActorType, AuditEntry, AuditJson, AuditWriter } from "./platform/audit";
export { assertPermission, ForbiddenError, hasPermission, NotFoundError } from "./access/context";
export type { RequestContext } from "./access/context";
export { audit, createTenantDb } from "./access/tenant-db";
export type { AuditTarget, TenantDb } from "./access/tenant-db";
export { createAccessService } from "./identity/access-service";
export type { AccessService, ContextResult } from "./identity/access-service";
export { loadStorefront, normalizeHost, resolveStoreHost } from "./tenancy/store-host";
export type { StoreHost, Storefront } from "./tenancy/store-host";
export { listTeamMembers } from "./identity/team";
export type { TeamMember } from "./identity/team";
export { CatalogError } from "./catalog/errors";
export type { CatalogErrorCode } from "./catalog/errors";
export { isSlug, slugify } from "./catalog/slug";
export {
  currencyExponent,
  formatMoney,
  isCurrencyCode,
  moneyToInput,
  parseMoney,
} from "./catalog/money";
export {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  updateCategory,
} from "./catalog/categories";
export type { CategoryDetail, CategoryInput, CategoryNode } from "./catalog/categories";
export { createBrand, deleteBrand, getBrand, listBrands, updateBrand } from "./catalog/brands";
export type { BrandInput, BrandSummary } from "./catalog/brands";
export {
  addVariant,
  createProduct,
  deleteVariant,
  getCatalogCurrency,
  getProduct,
  getVariant,
  listProducts,
  PRODUCT_STATUSES,
  setProductStatus,
  updateProduct,
  updateVariant,
  VARIANT_STATUSES,
} from "./catalog/products";
export type {
  Money,
  ProductCreateInput,
  ProductDetail,
  ProductList,
  ProductListInput,
  ProductStatusValue,
  ProductSummary,
  ProductUpdateInput,
  VariantDetail,
  VariantInput,
  VariantStatusValue,
} from "./catalog/products";
export { seedDemoCatalog } from "./catalog/demo-seed";
export {
  addProductImage,
  getBrandLogo,
  getCategoryImage,
  IMAGE_MOVES,
  listProductImages,
  MAX_ALT_TEXT_LENGTH,
  MAX_PRODUCT_IMAGES,
  moveProductImage,
  removeBrandLogo,
  removeCategoryImage,
  removeProductImage,
  setBrandLogo,
  setCategoryImage,
  updateProductImage,
} from "./catalog/images";
export type { ImageMove, ProductImageDetail, ProductImageUpdateInput } from "./catalog/images";
export { imageView, markMediaAssetFailed, processMediaAsset } from "./media/assets";
export type {
  ImageView,
  MediaDeps,
  MediaProcessingJob,
  MediaStatusValue,
  ProcessOutcome,
  StoredImage,
  StoredVariant,
} from "./media/assets";
export { MAX_UPLOAD_BYTES } from "./media/image";
export { createMemoryStorage, createS3Storage } from "./storage/storage";
export type { MemoryStorage, StorageEnv, StorageProvider } from "./storage/storage";
export {
  closeQueues,
  enqueueMediaProcessing,
  MAINTENANCE_JOBS,
  MEDIA_JOBS,
  QUEUES,
} from "./platform/queues";
export { listUnprocessedMedia } from "./platform/media-sweep";
export {
  getPublicCategory,
  getPublicProduct,
  listPublicProducts,
  listPublicProductsBySlug,
  listRelatedProducts,
  listTopCategories,
  loadHomeSections,
  MAX_RECENT_PRODUCTS,
  PRODUCT_FLAGS,
  PUBLIC_PAGE_SIZE,
  PUBLIC_SORTS,
  searchTerms,
} from "./catalog/public";
export type {
  HomeSections,
  ProductFlag,
  PublicCategory,
  PublicCategoryLink,
  PublicFacets,
  PublicListInput,
  PublicProduct,
  PublicProductCard,
  PublicProductList,
  PublicSort,
  PublicVariant,
} from "./catalog/public";
export { selectVariant } from "./catalog/variant-selection";
export type {
  OptionChoice,
  SelectableVariant,
  VariantSelection,
} from "./catalog/variant-selection";
