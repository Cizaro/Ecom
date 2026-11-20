import { assertPermission, ForbiddenError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  roleKey: string;
  roleName: string;
  status: string;
  twoFactorEnabled: boolean;
}

/**
 * Staff of the current tenant. Runs on the tenant-bound runtime connection,
 * so Row-Level Security alone guarantees no other tenant's staff appear.
 */
export async function listTeamMembers(db: TenantDb): Promise<TeamMember[]> {
  const rows = await db.run((tx) =>
    tx.userTenantMembership.findMany({
      select: {
        status: true,
        user: { select: { id: true, name: true, email: true, twoFactorEnabled: true } },
        role: { select: { key: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  );
  return rows.map((row) => ({
    userId: row.user.id,
    name: row.user.name,
    email: row.user.email,
    roleKey: row.role.key,
    roleName: row.role.name,
    status: row.status,
    twoFactorEnabled: row.user.twoFactorEnabled,
  }));
}

/** Whether owners and managers must use two-factor sign-in (they are sent to set it up). */
export async function getRequireStaffTwoFactor(db: TenantDb): Promise<boolean> {
  const tenant = await db.run((tx) =>
    tx.tenant.findUnique({ where: { id: db.tenantId }, select: { requireStaffTwoFactor: true } }),
  );
  return tenant?.requireStaffTwoFactor ?? false;
}

/**
 * Requires (or stops requiring) two-factor sign-in for owners and managers.
 * Only an owner may change it (staff.manage and the owner role): it is about
 * owners' own accounts. Audited.
 */
export async function setRequireStaffTwoFactor(
  db: TenantDb,
  context: RequestContext,
  on: boolean,
): Promise<void> {
  assertPermission(context, "staff.manage");
  if (context.roleKey !== "store_owner") throw new ForbiddenError("staff.manage");
  await db.run(async (tx) => {
    const before = await tx.tenant.findUnique({
      where: { id: db.tenantId },
      select: { requireStaffTwoFactor: true },
    });
    await tx.tenant.update({ where: { id: db.tenantId }, data: { requireStaffTwoFactor: on } });
    await audit(
      tx,
      context,
      "staff.two_factor_requirement_changed",
      { type: "tenant", id: db.tenantId },
      { requireStaffTwoFactor: before?.requireStaffTwoFactor ?? false },
      { requireStaffTwoFactor: on },
    );
  });
}
