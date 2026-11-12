import type { PermissionKey } from "../identity/permissions";

/**
 * Everything a tenant-scoped request handler needs to know about who is
 * asking. Built only on the server, from the session; no field comes from
 * client input.
 */
export interface RequestContext {
  requestId: string;
  ip: string;
  userId: string;
  isPlatformAdmin: boolean;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  /** The tenant's first store, until store selection exists. */
  storeId: string | null;
  roleKey: string;
  roleName: string;
  /** Tenant permissions from the membership's role. Never includes `platform.*`. */
  permissions: ReadonlySet<PermissionKey>;
}

export function hasPermission(context: RequestContext, permission: PermissionKey): boolean {
  return context.permissions.has(permission);
}

/** The user is signed in and in the right tenant but lacks a permission. */
export class ForbiddenError extends Error {
  constructor(readonly permission?: PermissionKey) {
    super(permission ? `Missing permission ${permission}` : "Forbidden");
    this.name = "ForbiddenError";
  }
}

/**
 * The record does not exist, or exists in another tenant. The two cases are
 * deliberately indistinguishable to the caller.
 */
export class NotFoundError extends Error {
  constructor(readonly entity = "record") {
    super(`${entity} not found`);
    this.name = "NotFoundError";
  }
}

export function assertPermission(context: RequestContext, permission: PermissionKey): void {
  if (!hasPermission(context, permission)) throw new ForbiddenError(permission);
}
