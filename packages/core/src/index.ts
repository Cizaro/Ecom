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
export { DEMO_OWNER_EMAIL, DEMO_TENANT_SLUG, seedDemoData, seedSystemData } from "./identity/seed";
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
export { normalizeHost, resolveStoreHost } from "./tenancy/store-host";
export type { StoreHost } from "./tenancy/store-host";
export { listTeamMembers } from "./identity/team";
export type { TeamMember } from "./identity/team";
