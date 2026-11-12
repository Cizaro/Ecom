import type { AdminPrismaClient } from "@ecom/db";
import { PERMISSIONS, SYSTEM_ROLES } from "./permissions";

export interface SeedSummary {
  permissions: number;
  systemRoles: number;
  removedPermissions: number;
}

/**
 * Makes the database match the permission catalogue and system roles defined in
 * code. Safe to run any number of times, in every environment.
 */
export async function seedSystemData(prisma: AdminPrismaClient): Promise<SeedSummary> {
  return prisma.$transaction(async (tx) => {
    const keys = Object.keys(PERMISSIONS);

    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await tx.permission.upsert({
        where: { key },
        create: { key, description },
        update: { description },
      });
    }
    // A permission removed from the catalogue disappears from every role.
    const removed = await tx.permission.deleteMany({ where: { key: { notIn: keys } } });

    const permissionIds = new Map(
      (await tx.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]),
    );

    for (const definition of SYSTEM_ROLES) {
      const data = {
        name: definition.name,
        description: definition.description,
        isSystem: true,
      };
      const existing = await tx.role.findFirst({
        where: { tenantId: null, key: definition.key },
        select: { id: true },
      });
      const role = existing
        ? await tx.role.update({ where: { id: existing.id }, data, select: { id: true } })
        : await tx.role.create({ data: { ...data, key: definition.key }, select: { id: true } });

      const wanted = definition.permissions.map((key) => permissionIds.get(key)!);
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: wanted } },
      });
      await tx.rolePermission.createMany({
        data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }

    return {
      permissions: keys.length,
      systemRoles: SYSTEM_ROLES.length,
      removedPermissions: removed.count,
    };
  });
}

export const DEMO_TENANT_SLUG = "demo";
export const DEMO_OWNER_EMAIL = "owner@example.com";
export const DEMO_STORE_HOST = "localhost";

/**
 * Local-development data: one tenant, one store, one owner. The owner has no
 * password, so nobody can sign in as them until one is set (Milestone 1.3).
 * Never run in production.
 */
export async function seedDemoData(prisma: AdminPrismaClient): Promise<{ tenantId: string }> {
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.upsert({
      where: { slug: DEMO_TENANT_SLUG },
      create: { slug: DEMO_TENANT_SLUG, name: "Demo Store" },
      update: {},
    });
    const store = await tx.store.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: "main" } },
      create: { tenantId: tenant.id, slug: "main", name: "Demo Store" },
      update: {},
    });
    // The local storefront at http://localhost:3000 shows the demo store.
    // Left alone if another tenant already claimed localhost.
    if (!(await tx.storeDomain.findUnique({ where: { hostname: DEMO_STORE_HOST } }))) {
      await tx.storeDomain.create({
        data: {
          tenantId: tenant.id,
          storeId: store.id,
          hostname: DEMO_STORE_HOST,
          isPrimary: true,
        },
      });
    }
    const owner = await tx.user.upsert({
      where: { email: DEMO_OWNER_EMAIL },
      create: { email: DEMO_OWNER_EMAIL, name: "Demo Owner" },
      update: {},
    });
    const ownerRole = await tx.role.findFirstOrThrow({
      where: { tenantId: null, key: "store_owner" },
    });
    await tx.userTenantMembership.upsert({
      where: { userId_tenantId: { userId: owner.id, tenantId: tenant.id } },
      create: { userId: owner.id, tenantId: tenant.id, roleId: ownerRole.id },
      update: {},
    });
    return { tenantId: tenant.id };
  });
}
