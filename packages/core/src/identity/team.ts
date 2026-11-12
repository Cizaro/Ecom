import type { TenantDb } from "../access/tenant-db";

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
