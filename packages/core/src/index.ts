// Public surface of the domain layer. Each domain module (identity, tenancy,
// catalog, ...) is added under src/<module> and exported from here; modules must
// not import each other's internals. See ARCHITECTURE.md section 3.

export {
  ALL_PERMISSIONS,
  isPermissionKey,
  PERMISSIONS,
  SYSTEM_ROLES,
  TENANT_PERMISSIONS,
} from "./identity/permissions";
export type { PermissionKey, SystemRole, SystemRoleKey } from "./identity/permissions";
export { DEMO_OWNER_EMAIL, DEMO_TENANT_SLUG, seedDemoData, seedSystemData } from "./identity/seed";
export { createLogger } from "./platform/logger";
export type { Logger } from "./platform/logger";
export { checkReadiness, closeReadinessConnections } from "./platform/readiness";
export type { ReadinessCheck, ReadinessResult } from "./platform/readiness";
export { redisConnectionOptions } from "./platform/redis";
