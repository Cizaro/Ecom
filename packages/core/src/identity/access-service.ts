import type { AdminPrismaClient } from "@ecom/db";
import type { RequestContext } from "../access/context";
import { recordAudit } from "../platform/audit";
import type { CurrentSession } from "./auth-service";
import {
  isPermissionKey,
  TENANT_PERMISSIONS,
  TWO_FACTOR_ROLES,
  type PermissionKey,
} from "./permissions";

const TENANT_PERMISSION_SET: ReadonlySet<string> = new Set(TENANT_PERMISSIONS);

export type ContextResult =
  | { status: "ok"; context: RequestContext }
  /** Signed in, but not an active member of any active tenant. */
  | { status: "no_membership" }
  /** Member of several tenants and none chosen yet. */
  | { status: "choose_tenant" }
  /** The tenant requires two-factor for this role and the user has not set it up. */
  | { status: "two_factor_required"; context: RequestContext };

export interface AccessService {
  /** Turns a signed-in session into a request context, or says why it cannot. */
  resolveContext(input: {
    session: CurrentSession;
    requestId: string;
    ip: string;
  }): Promise<ContextResult>;
  /**
   * Makes `tenantId` the session's working tenant. Returns false, changing
   * nothing, when the user is not an active member of that active tenant, so
   * a forged tenant ID behaves exactly like a nonexistent one.
   */
  setActiveTenant(input: {
    session: CurrentSession;
    tenantId: string;
    requestId: string;
    ip: string;
  }): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identity-module service: reads memberships and roles with the admin
 * connection (the runtime role cannot see other tenants' memberships, which
 * the tenant switcher needs) and hands out contexts that the rest of the
 * application uses with the restricted connection.
 */
export function createAccessService(deps: { prisma: AdminPrismaClient }): AccessService {
  const { prisma } = deps;

  async function loadMembership(userId: string, tenantId: string) {
    return prisma.userTenantMembership.findFirst({
      where: { userId, tenantId, status: "active", tenant: { status: "active" } },
      select: {
        tenant: {
          select: {
            id: true,
            slug: true,
            name: true,
            requireStaffTwoFactor: true,
            stores: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
          },
        },
        role: {
          select: {
            key: true,
            name: true,
            tenantId: true,
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });
  }

  return {
    async resolveContext({ session, requestId, ip }) {
      const { memberships } = session;
      if (memberships.length === 0) return { status: "no_membership" };

      const chosen =
        memberships.find((membership) => membership.tenantId === session.activeTenantId) ??
        (memberships.length === 1 ? memberships[0] : undefined);
      if (!chosen) return { status: "choose_tenant" };

      const membership = await loadMembership(session.user.id, chosen.tenantId);
      // Membership ended between loading the session and now.
      if (!membership) return { status: "choose_tenant" };
      // A custom role of another tenant can never grant anything here.
      const roleUsable =
        membership.role.tenantId === null || membership.role.tenantId === membership.tenant.id;

      const permissions = new Set<PermissionKey>();
      if (roleUsable) {
        for (const { permission } of membership.role.permissions) {
          if (isPermissionKey(permission.key) && TENANT_PERMISSION_SET.has(permission.key)) {
            permissions.add(permission.key);
          }
        }
      }

      const context: RequestContext = {
        requestId,
        ip,
        userId: session.user.id,
        isPlatformAdmin: session.user.isPlatformAdmin,
        tenantId: membership.tenant.id,
        tenantSlug: membership.tenant.slug,
        tenantName: membership.tenant.name,
        storeId: membership.tenant.stores[0]?.id ?? null,
        roleKey: membership.role.key,
        roleName: membership.role.name,
        permissions,
      };

      if (
        membership.tenant.requireStaffTwoFactor &&
        TWO_FACTOR_ROLES.includes(membership.role.key) &&
        !session.user.twoFactorEnabled
      ) {
        return { status: "two_factor_required", context };
      }
      return { status: "ok", context };
    },

    async setActiveTenant({ session, tenantId, requestId, ip }) {
      if (!UUID.test(tenantId)) return false;
      const membership = await loadMembership(session.user.id, tenantId);
      if (!membership) return false;

      await prisma.$transaction(async (tx) => {
        await tx.session.update({
          where: { id: session.sessionId },
          data: { activeTenantId: tenantId },
        });
        await recordAudit(tx, {
          tenantId,
          actorType: "user",
          actorUserId: session.user.id,
          action: "access.tenant_selected",
          entityType: "tenant",
          entityId: tenantId,
          ip,
          requestId,
        });
      });
      return true;
    },
  };
}
