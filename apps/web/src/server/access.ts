import "server-only";

import { getEnv } from "@ecom/config";
import {
  createAccessService,
  createTenantDb,
  hasPermission,
  type AccessService,
  type ContextResult,
  type CurrentSession,
  type PermissionKey,
  type RequestContext,
  type TenantDb,
} from "@ecom/core";
import { getAdminPrisma, getAppPrisma } from "@ecom/db";
import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import { getCurrentSession, getRequestInfo, SIGN_IN_PATH } from "./auth";
import { REQUEST_ID_HEADER } from "./request-id";

export const SELECT_STORE_PATH = "/admin/select-store";
export const SECURITY_PATH = "/admin/account/security";

const globalForAccess = globalThis as typeof globalThis & { __accessService?: AccessService };

export function getAccessService(): AccessService {
  globalForAccess.__accessService ??= createAccessService({
    // Identity module: reads memberships across tenants for the switcher.
    prisma: getAdminPrisma(getEnv().DATABASE_ADMIN_URL),
  });
  return globalForAccess.__accessService;
}

/** Set by the proxy on every request; generated here only as a fallback. */
export async function getRequestId(): Promise<string> {
  return (await headers()).get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
}

export type AccessOutcome =
  | { status: "unauthenticated" }
  | { status: "no_membership"; session: CurrentSession }
  | { status: "choose_tenant"; session: CurrentSession }
  | { status: "two_factor_required"; session: CurrentSession; context: RequestContext }
  | { status: "ok"; session: CurrentSession; context: RequestContext };

/** Session plus tenant context for this request. Computed once per request. */
export const getAccessOutcome = cache(async (): Promise<AccessOutcome> => {
  const session = await getCurrentSession();
  if (!session) return { status: "unauthenticated" };
  const [{ ip }, requestId] = await Promise.all([getRequestInfo(), getRequestId()]);
  const result: ContextResult = await getAccessService().resolveContext({
    session,
    requestId,
    ip,
  });
  return { ...result, session };
});

/**
 * Guard for admin pages and server actions that need a tenant but no specific
 * permission. Redirects when there is no session, no chosen tenant, or
 * two-factor setup is required.
 */
export async function requireTenantContext(): Promise<{
  session: CurrentSession;
  context: RequestContext;
}> {
  const outcome = await getAccessOutcome();
  switch (outcome.status) {
    case "unauthenticated":
      return redirect(SIGN_IN_PATH);
    case "no_membership":
      return redirect("/admin");
    case "choose_tenant":
      return redirect(SELECT_STORE_PATH);
    case "two_factor_required":
      return redirect(`${SECURITY_PATH}?required=1`);
    case "ok":
      return { session: outcome.session, context: outcome.context };
  }
}

/** Guard for admin pages and server actions: 403 page without the permission. */
export async function requirePermission(permission: PermissionKey): Promise<{
  session: CurrentSession;
  context: RequestContext;
}> {
  const access = await requireTenantContext();
  if (!hasPermission(access.context, permission)) forbidden();
  return access;
}

/**
 * Guard for platform administration. Platform administrators get no implicit
 * access to tenant data: tenant pages still require a membership.
 */
export async function requirePlatformAdmin(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect(SIGN_IN_PATH);
  if (!session.user.isPlatformAdmin) forbidden();
  return session;
}

/** Tenant-bound database handle for domain services. */
export function tenantDb(context: RequestContext): TenantDb {
  return createTenantDb(getAppPrisma(getEnv().DATABASE_URL), context);
}
