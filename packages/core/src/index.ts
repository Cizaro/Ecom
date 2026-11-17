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
export {
  loadStorefront,
  normalizeHost,
  resolveStoreHost,
  storefrontRequestHost,
} from "./tenancy/store-host";
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
  listSitemapSource,
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
  SitemapSource,
} from "./catalog/public";
export { selectVariant } from "./catalog/variant-selection";
export type {
  OptionChoice,
  SelectableVariant,
  VariantSelection,
} from "./catalog/variant-selection";
export {
  addToCart,
  CART_LIFETIME_DAYS,
  CartError,
  claimCartForCustomer,
  EMPTY_CART,
  getCart,
  getCartCount,
  isCartToken,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  removeCartItem,
  setCartItemQuantity,
} from "./cart/cart";
export type { AddToCartResult, CartErrorCode, CartLine, CartOwner, CartView } from "./cart/cart";
export {
  CUSTOMER_SESSION_DAYS,
  CustomerError,
  getMarketingConsent,
  getSessionCustomer,
  listCustomers,
  normalizeEmail,
  requestPasswordReset,
  resetPassword,
  setMarketingConsent,
  signIn as signInCustomer,
  signOut as signOutCustomer,
  signUp as signUpCustomer,
  updateProfile as updateCustomerProfile,
  verifyEmail as verifyCustomerEmail,
} from "./customers/accounts";
export type {
  CustomerDeps,
  CustomerErrorCode,
  CustomerList,
  CustomerProfile,
  CustomerRequest,
  CustomerSummary,
  SignUpInput,
} from "./customers/accounts";
export {
  createAddress,
  deleteAddress,
  formatAddress,
  getAddress,
  listAddresses,
  MAX_ADDRESSES,
  setDefaultAddress,
  updateAddress,
  validateAddress,
} from "./customers/addresses";
export type { AddressInput, AddressUse, SavedAddress, ValidAddress } from "./customers/addresses";
export {
  addressRules,
  COUNTRY_CODES,
  countryName,
  countryOptions,
  isCountryCode,
} from "./customers/countries";
export type { AddressRules } from "./customers/countries";
export {
  availabilityIn,
  changeStock,
  commitReservations,
  createLocation,
  DEFAULT_HOLD_MINUTES,
  DEFAULT_LOW_STOCK,
  getAvailability,
  getVariantStock,
  InventoryError,
  listLocations,
  listStock,
  releaseExpiredReservations,
  releaseReservations,
  reserveStockIn,
  returnCommittedIn,
  settleReservationsIn,
  reserveStock,
  setDefaultLocation,
  setTracking,
  STOCK_OPERATIONS,
  STOCK_PAGE_SIZE,
  stockStatus,
  updateLocation,
} from "./inventory/stock";
export type {
  Availability,
  InventoryErrorCode,
  LocationSummary,
  ReservationRequest,
  StockChangeInput,
  StockOperation,
  StockRow,
  StockStatus,
  VariantStock,
} from "./inventory/stock";
export { listTenantsWithExpiredReservations } from "./platform/stock-sweep";
export { checkoutCartIn, convertCartIn } from "./cart/cart";
export {
  createMockPaymentProvider,
  MOCK_SIGNATURE_HEADER,
  WebhookError,
} from "./payments/provider";
export type {
  CreatedPayment,
  CreatePaymentRequest,
  MockOutcome,
  MockPaymentProvider,
  PaymentNotification,
  PaymentProvider,
} from "./payments/provider";
export {
  cancelUnpaidOrder,
  COD_HOLD_DAYS,
  expireUnpaidOrders,
  fulfilOrder,
  getOrderForShopper,
  getOrderForStaff,
  getPaymentForPayPage,
  handlePaymentNotification,
  listCustomerOrders,
  listOrders,
  ORDER_PAGE_SIZE,
  ORDER_STATUSES,
  orderAccessKey,
  OrderError,
  orderAmountLines,
  orderWhere,
  PAY_WITHIN_MINUTES,
  PAYMENT_METHODS,
  placeOrder,
  recordCashCollected,
  recordDeliveryRefused,
  startPayment,
} from "./orders/orders";
export type {
  FulfilInput,
  OrderFilters,
  HandledNotification,
  NotificationOutcome,
  OrderErrorCode,
  OrderStatusValue,
  OrderSummary,
  OrderView,
  PaymentMethodValue,
  PlacedOrder,
  PlaceOrderInput,
  StaffOrderView,
} from "./orders/orders";
export { findPaymentTenant, listTenantsWithExpiredOrders } from "./platform/payment-lookup";

export {
  createShippingZone,
  deleteShippingZone,
  deliveryFee,
  describeZone,
  formatTaxRate,
  getCheckoutOptions,
  getTaxSettings,
  listShippingZones,
  MAX_TAX_RATE_BASIS_POINTS,
  MAX_ZONES,
  NO_TAX,
  parseCountries,
  parseTaxRate,
  priceOrder,
  pricingVersion,
  quoteDeliveryIn,
  saveTaxSettings,
  ShippingError,
  updateShippingZone,
  zoneFormValues,
} from "./shipping/shipping";
export type {
  CheckoutOptions,
  DeliveryQuote,
  OrderPricing,
  PricingDiscount,
  ShippingZoneView,
  TaxSettings,
  ZoneInput,
} from "./shipping/shipping";

export { EMAIL_EVENTS, enqueueEmailIn } from "./notifications/enqueue";
export type { EmailEventType, EmailPayload } from "./notifications/enqueue";
export {
  orderCancelledEmail,
  orderConfirmationEmail,
  orderShippedEmail,
  paymentReceivedEmail,
  returnRecordedEmail,
  staffLowStockEmail,
  staffNewOrderEmail,
} from "./notifications/order-emails";
export type { LowStockItem, StoreLinks } from "./notifications/order-emails";
export {
  deliverPendingEmails,
  MAX_EMAIL_ATTEMPTS,
  shopperOrderUrl,
  storeLinksIn,
} from "./notifications/delivery";
export type { EmailDeliveryOptions } from "./notifications/delivery";
export {
  getNotificationSettings,
  listUndeliveredEmails,
  MAX_STAFF_ADDRESSES,
  NotificationSettingsError,
  parseAddressList,
  retryEmail,
  saveNotificationSettings,
} from "./notifications/settings";
export type { NotificationSettingsView, UndeliveredEmail } from "./notifications/settings";
export { listTenantsWithPendingEmails } from "./platform/email-lookup";

export {
  recordReturn,
  REFUND_METHOD_LABEL,
  REFUND_METHODS,
  RETURN_REASON_LABEL,
  RETURN_REASONS,
} from "./orders/returns";
export type { RefundMethod, ReturnInput, ReturnReason } from "./orders/returns";
export { csvField, EXPORT_LIMIT, exportOrdersCsv, getDashboard } from "./reports/reports";
export type { Dashboard, PeriodFigures } from "./reports/reports";
export { addDays, isCalendarDate, safeTimeZone, zonedDay, zonedDayStart } from "./platform/time";

export {
  checkDiscountCode,
  createDiscountCode,
  deleteDiscountCode,
  describeDiscount,
  DISCOUNT_KINDS,
  DiscountError,
  discountFormValues,
  listDiscountCodes,
  normalizeCode,
  resolveDiscountIn,
  updateDiscountCode,
} from "./promotions/discounts";
export type {
  AppliedDiscount,
  DiscountCodeView,
  DiscountInput,
  DiscountKind,
} from "./promotions/discounts";

export {
  checkProductImport,
  discardProductImport,
  getProductImport,
  ImportError,
  importTemplateFor,
  listProductImports,
  MAX_PICTURES_PER_PRODUCT,
  processImportImages,
  runProductImport,
  splitPictureLinks,
} from "./catalog/import";
export type { ImportProblem, ImportSummary } from "./catalog/import";
export {
  buildImportTemplate,
  IMPORT_COLUMNS,
  ImportFileError,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  parseCsv,
  readImportFile,
  zipUnpackedSize,
} from "./catalog/import-file";
export type { SheetRow } from "./catalog/import-file";
export { fetchImageFromUrl, ImageFetchError, isPublicAddress } from "./media/fetch-image";
export { listTenantsWithPendingImportImages } from "./platform/import-lookup";

export {
  authorNameFrom,
  listProductReviews,
  listReviewsForModeration,
  moderateReview,
  replyToReview,
  REPORT_REASON_LABEL,
  REPORT_REASONS,
  reportReview,
  REVIEW_STATUSES,
  ReviewError,
  reviewEligibility,
  REVIEWS_PAGE_SIZE,
  submitReview,
} from "./reviews/reviews";
export type {
  ModerationReview,
  PublicReview,
  RatingSummary,
  ReportReason,
  ReviewEligibility,
  ReviewStatus,
} from "./reviews/reviews";

export {
  BRANDING_PRESETS,
  contrastRatio,
  CORNER_STYLES,
  DEFAULT_BRANDING,
  FONT_STYLES,
  normalizeHex,
  parseBranding,
  readableOn,
  themeVariables,
} from "./tenancy/branding";
export type { CornerStyle, FontStyle, StoreBranding } from "./tenancy/branding";
export {
  getStoreSettings,
  removeStoreLogo,
  setStoreLogo,
  StoreSettingsError,
  updateStoreBranding,
  updateStoreDetails,
} from "./tenancy/store-settings";
export type { StoreSettingsView } from "./tenancy/store-settings";

export {
  addStaffUgc,
  countApprovedUgc,
  listApprovedUgc,
  listMyUgc,
  listUgcForModeration,
  MAX_PENDING_PER_CUSTOMER,
  moderateUgc,
  productsCustomerReceived,
  removeUgc,
  shareUgc,
  UGC_PERMISSION_VERSION,
  UGC_STATUSES,
  UgcError,
  ugcPermissionText,
  withdrawUgc,
} from "./ugc/ugc";
export type { ModerationUgcItem, MyUgcItem, PublicUgcItem, UgcMedia, UgcStatus } from "./ugc/ugc";
export {
  MAX_VIDEO_BYTES,
  sniffVideoType,
  storeVideo,
  videoDimensions,
  VideoError,
} from "./media/video";

export {
  getConversationForShopper,
  getConversationForStaff,
  listConversations,
  listCustomerConversations,
  replyAsShopper,
  replyAsStaff,
  startConversation,
  SUPPORT_STATUSES,
  supportAccessKey,
  SupportError,
  updateConversation,
} from "./support/support";
export type {
  ConversationSummary,
  ConversationView,
  SupportMessageView,
  SupportStatus,
} from "./support/support";
export { addCustomerNote, CustomerNoteError, getCustomerForStaff } from "./customers/profile";
export type { StaffCustomerView, TimelineEntry, TimelineKind } from "./customers/profile";

export {
  DEFAULT_PAGE_TITLES,
  getPublishedPage,
  listPublishedPages,
  listStorePages,
  PAGE_SLUGS,
  pageBlocks,
  pageTemplate,
  saveStorePage,
  StorePageError,
  unfilledBlanks,
} from "./tenancy/store-pages";
export type { PageBlock, PageSlug, StorePageView } from "./tenancy/store-pages";
export { checkLaunchSettings, checkLaunchStore } from "./platform/launch-check";
export type { LaunchFinding, LaunchStatus } from "./platform/launch-check";
