import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import {
  disconnectDatabase,
  getAdminPrisma,
  getAppPrisma,
  GLOBAL_TABLES,
  withTenant,
} from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedSystemData } from "./seed";

// Integration test against the real database (docker compose services running,
// migrations applied). Proves that the runtime database role cannot cross
// tenant boundaries even when application code forgets to filter.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);

interface Fixture {
  tenantId: string;
  storeId: string;
  userId: string;
  customRoleId: string;
}

let a: Fixture;
let b: Fixture;
let systemRoleId: string;
let permissionId: string;

async function createFixture(label: string): Promise<Fixture> {
  const tenant = await admin.tenant.create({
    data: { name: `Test ${label} ${run}`, slug: `test-${label}-${run}` },
  });
  const store = await admin.store.create({
    data: { tenantId: tenant.id, name: `Store ${label}`, slug: "main" },
  });
  const user = await admin.user.create({
    data: { email: `user-${label}-${run}@example.test`, name: label },
  });
  const customRole = await admin.role.create({
    data: { tenantId: tenant.id, key: "custom", name: `Custom ${label}` },
  });
  await admin.rolePermission.create({ data: { roleId: customRole.id, permissionId } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId: tenant.id, roleId: customRole.id },
  });
  return { tenantId: tenant.id, storeId: store.id, userId: user.id, customRoleId: customRole.id };
}

const asTenant = <T>(fixture: Fixture, work: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(app, { tenantId: fixture.tenantId, userId: fixture.userId }, work);

beforeAll(async () => {
  await seedSystemData(admin);
  systemRoleId = (
    await admin.role.findFirstOrThrow({
      where: { tenantId: null, key: "store_owner" },
    })
  ).id;
  permissionId = (await admin.permission.findUniqueOrThrow({ where: { key: "catalog.read" } })).id;

  a = await createFixture("a");
  b = await createFixture("b");
  // User A also belongs to tenant B, to exercise the "own memberships" rule.
  await admin.userTenantMembership.create({
    data: { userId: a.userId, tenantId: b.tenantId, roleId: systemRoleId },
  });
});

afterAll(async () => {
  const tenantIds = [a?.tenantId, b?.tenantId].filter(Boolean);
  await admin.userTenantMembership.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: [a?.userId, b?.userId].filter(Boolean) } } });
  await disconnectDatabase();
});

describe("runtime database role", () => {
  it("is app_user, not a superuser, cannot bypass RLS and owns no tables", async () => {
    const [role] = await app.$queryRaw<
      { name: string; rolsuper: boolean; rolbypassrls: boolean; owned: bigint }[]
    >`
      SELECT current_user::text AS name, r.rolsuper, r.rolbypassrls,
             (SELECT count(*) FROM pg_tables
               WHERE schemaname = 'public' AND tableowner = current_user) AS owned
      FROM pg_roles r WHERE r.rolname = current_user`;
    expect(role).toEqual({ name: "app_user", rolsuper: false, rolbypassrls: false, owned: 0n });
  });

  it("cannot read migration bookkeeping", async () => {
    await expect(app.$queryRaw`SELECT 1 FROM _prisma_migrations LIMIT 1`).rejects.toThrow();
  });
});

describe("every table is protected", () => {
  it("has Row-Level Security enabled unless listed as a global table", async () => {
    const tables = await admin.$queryRaw<{ name: string; rls: boolean }[]>`
      SELECT c.relname::text AS name, c.relrowsecurity AS rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    expect(tables.length).toBeGreaterThan(10);

    const unprotected = tables.filter((t) => !t.rls).map((t) => t.name);
    expect(unprotected.sort()).toEqual(Object.keys(GLOBAL_TABLES).sort());
  });
});

describe("without a tenant context", () => {
  it("sees no tenant data at all", async () => {
    const tenantIds = [a.tenantId, b.tenantId];
    expect(await app.tenant.findMany({ where: { id: { in: tenantIds } } })).toEqual([]);
    expect(await app.store.findMany({ where: { tenantId: { in: tenantIds } } })).toEqual([]);
    expect(await app.user.findMany({ where: { id: { in: [a.userId, b.userId] } } })).toEqual([]);
    expect(
      await app.userTenantMembership.findMany({ where: { tenantId: { in: tenantIds } } }),
    ).toEqual([]);
    expect(await app.role.findMany({ where: { tenantId: { in: tenantIds } } })).toEqual([]);
  });

  it("cannot write tenant data", async () => {
    await expect(
      app.store.create({ data: { tenantId: a.tenantId, name: "x", slug: `x-${run}` } }),
    ).rejects.toThrow();
  });
});

describe("withTenant", () => {
  it("rejects identifiers that are not UUIDs", async () => {
    await expect(withTenant(app, { tenantId: "x' OR '1'='1" }, async () => 1)).rejects.toThrow(
      /not a UUID/,
    );
    await expect(
      withTenant(app, { tenantId: a.tenantId, userId: "nope" }, async () => 1),
    ).rejects.toThrow(/not a UUID/);
  });

  it("does not leak the context to later queries", async () => {
    await asTenant(a, (tx) => tx.store.findMany());
    expect(await app.store.findMany({ where: { id: a.storeId } })).toEqual([]);
  });
});

describe("tenant A's context", () => {
  it("sees only its own tenant and stores, even with no filter", async () => {
    const { tenants, stores } = await asTenant(a, async (tx) => ({
      tenants: await tx.tenant.findMany(),
      stores: await tx.store.findMany(),
    }));
    expect(tenants.map((t) => t.id)).toEqual([a.tenantId]);
    expect(stores.map((s) => s.id)).toEqual([a.storeId]);
  });

  it("cannot read tenant B's rows by id", async () => {
    const found = await asTenant(a, (tx) => tx.store.findUnique({ where: { id: b.storeId } }));
    expect(found).toBeNull();
  });

  it("cannot insert a row for tenant B", async () => {
    await expect(
      asTenant(a, (tx) =>
        tx.store.create({ data: { tenantId: b.tenantId, name: "intruder", slug: `i-${run}` } }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move its own row into tenant B", async () => {
    await expect(
      asTenant(a, (tx) =>
        tx.store.update({ where: { id: a.storeId }, data: { tenantId: b.tenantId } }),
      ),
    ).rejects.toThrow();
  });

  it("cannot update or delete tenant B's rows", async () => {
    const result = await asTenant(a, async (tx) => ({
      updated: await tx.store.updateMany({ where: { id: b.storeId }, data: { name: "hacked" } }),
      deleted: await tx.store.deleteMany({ where: { id: b.storeId } }),
      tenantUpdated: await tx.tenant.updateMany({
        where: { id: b.tenantId },
        data: { name: "hacked" },
      }),
    }));
    expect(result).toEqual({
      updated: { count: 0 },
      deleted: { count: 0 },
      tenantUpdated: { count: 0 },
    });
    const store = await admin.store.findUniqueOrThrow({ where: { id: b.storeId } });
    expect(store.name).toBe("Store b");
  });

  it("cannot create or delete tenants", async () => {
    await expect(
      asTenant(a, (tx) => tx.tenant.create({ data: { name: "new", slug: `new-${run}` } })),
    ).rejects.toThrow();
    await expect(asTenant(a, (tx) => tx.tenant.deleteMany())).rejects.toThrow();
  });
});

describe("users", () => {
  it("shows members of the current tenant only", async () => {
    const users = await asTenant(a, (tx) => tx.user.findMany());
    expect(users.map((u) => u.id)).toEqual([a.userId]);
  });

  it("never exposes the platform-admin flag", async () => {
    const [user] = await asTenant(a, (tx) => tx.user.findMany());
    expect(user).not.toHaveProperty("isPlatformAdmin");
    await expect(
      asTenant(a, (tx) => tx.$queryRaw`SELECT is_platform_admin FROM users`),
    ).rejects.toThrow();
  });

  it("lets a user change their own name and nothing else", async () => {
    await asTenant(a, (tx) => tx.user.update({ where: { id: a.userId }, data: { name: "A2" } }));
    expect((await admin.user.findUniqueOrThrow({ where: { id: a.userId } })).name).toBe("A2");

    await expect(
      asTenant(a, (tx) => tx.$executeRaw`UPDATE users SET email = 'x@example.test'`),
    ).rejects.toThrow();
    await expect(
      asTenant(a, (tx) => tx.$executeRaw`UPDATE users SET is_platform_admin = true`),
    ).rejects.toThrow();
  });

  it("cannot rename another user, even a fellow member", async () => {
    // In tenant B's context user A is a visible member, but only B's user is "self".
    const result = await asTenant(b, (tx) =>
      tx.user.updateMany({ where: { id: a.userId }, data: { name: "hacked" } }),
    );
    expect(result.count).toBe(0);
  });
});

describe("authentication tables", () => {
  it.each(["sessions", "accounts", "verifications", "two_factors"])(
    "%s cannot be read or written by the runtime role",
    async (table) => {
      await expect(
        asTenant(a, (tx) => tx.$queryRawUnsafe(`SELECT 1 FROM ${table} LIMIT 1`)),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(a, (tx) => tx.$executeRawUnsafe(`DELETE FROM ${table}`)),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it("live in the public schema, not the helper schema", async () => {
    const rows = await admin.$queryRaw<{ schemaname: string; tablename: string }[]>`
      SELECT schemaname::text, tablename::text FROM pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'public')`;
    expect(rows).toEqual([]);
  });
});

describe("memberships", () => {
  it("shows the tenant's memberships plus the user's own in other tenants", async () => {
    const rows = await asTenant(a, (tx) => tx.userTenantMembership.findMany());
    const pairs = rows.map((m) => `${m.userId}@${m.tenantId}`).sort();
    expect(pairs).toEqual([`${a.userId}@${a.tenantId}`, `${a.userId}@${b.tenantId}`].sort());
  });

  it("cannot grant itself membership of tenant B", async () => {
    await expect(
      asTenant(b, async (tx) => {
        // Run as tenant B's user trying to join tenant A.
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${b.tenantId}, true)`;
        return tx.userTenantMembership.create({
          data: { userId: b.userId, tenantId: a.tenantId, roleId: systemRoleId },
        });
      }),
    ).rejects.toThrow();
  });
});

describe("roles", () => {
  it("shows system roles and the tenant's own custom roles", async () => {
    const roles = await asTenant(a, (tx) => tx.role.findMany());
    const ids = roles.map((r) => r.id);
    expect(ids).toContain(systemRoleId);
    expect(ids).toContain(a.customRoleId);
    expect(ids).not.toContain(b.customRoleId);
  });

  it("cannot change system roles or their permissions", async () => {
    const result = await asTenant(a, async (tx) => ({
      updated: await tx.role.updateMany({ where: { id: systemRoleId }, data: { name: "hacked" } }),
      deleted: await tx.role.deleteMany({ where: { id: systemRoleId } }),
      stripped: await tx.rolePermission.deleteMany({ where: { roleId: systemRoleId } }),
    }));
    expect(result).toEqual({
      updated: { count: 0 },
      deleted: { count: 0 },
      stripped: { count: 0 },
    });
    await expect(
      asTenant(a, (tx) =>
        tx.rolePermission.create({
          data: {
            roleId: systemRoleId,
            permissionId: "00000000-0000-7000-8000-000000000000",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot create a system role or a role for another tenant", async () => {
    await expect(
      asTenant(a, (tx) =>
        tx.role.create({ data: { tenantId: a.tenantId, key: "sys", name: "s", isSystem: true } }),
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(a, (tx) => tx.role.create({ data: { tenantId: b.tenantId, key: "x", name: "x" } })),
    ).rejects.toThrow();
  });

  it("can manage its own custom roles", async () => {
    const created = await asTenant(a, async (tx) => {
      const role = await tx.role.create({
        data: { tenantId: a.tenantId, key: `own-${run}`, name: "Own" },
      });
      await tx.rolePermission.create({ data: { roleId: role.id, permissionId } });
      return role;
    });
    expect(created.tenantId).toBe(a.tenantId);
  });

  it("cannot see or change tenant B's custom role permissions", async () => {
    const result = await asTenant(a, async (tx) => ({
      visible: await tx.rolePermission.findMany({ where: { roleId: b.customRoleId } }),
      deleted: await tx.rolePermission.deleteMany({ where: { roleId: b.customRoleId } }),
    }));
    expect(result).toEqual({ visible: [], deleted: { count: 0 } });
  });
});

describe("audit log", () => {
  const entry = (tenantId: string) => ({
    tenantId,
    actorType: "system",
    action: `test.${run}`,
    entityType: "test",
  });

  it("accepts entries for the current tenant only", async () => {
    await asTenant(a, (tx) => tx.auditLog.create({ data: entry(a.tenantId) }));
    await expect(
      asTenant(a, (tx) => tx.auditLog.create({ data: entry(b.tenantId) })),
    ).rejects.toThrow();
  });

  it("hides other tenants' entries", async () => {
    await admin.auditLog.create({ data: entry(b.tenantId) });
    const rows = await asTenant(a, (tx) =>
      tx.auditLog.findMany({ where: { action: `test.${run}` } }),
    );
    expect(rows.map((r) => r.tenantId)).toEqual([a.tenantId]);
  });

  it("cannot be changed or deleted by the runtime role", async () => {
    await expect(
      asTenant(a, (tx) => tx.auditLog.updateMany({ data: { action: "tampered" } })),
    ).rejects.toThrow();
    await expect(asTenant(a, (tx) => tx.auditLog.deleteMany())).rejects.toThrow();
  });

  it("cannot be changed, deleted or truncated even by the owner role", async () => {
    const where = { action: `test.${run}` };
    await expect(
      admin.auditLog.updateMany({ where, data: { action: "tampered" } }),
    ).rejects.toThrow(/append-only/);
    await expect(admin.auditLog.deleteMany({ where })).rejects.toThrow(/append-only/);
    await expect(admin.$executeRaw`TRUNCATE audit_logs`).rejects.toThrow(/append-only/);
    expect(await admin.auditLog.count({ where })).toBe(2);
  });
});
