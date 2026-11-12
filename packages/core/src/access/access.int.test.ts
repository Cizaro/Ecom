import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccessService } from "../identity/access-service";
import type { CurrentSession } from "../identity/auth-service";
import { SYSTEM_ROLES, type SystemRoleKey } from "../identity/permissions";
import { seedSystemData } from "../identity/seed";
import { listTeamMembers } from "../identity/team";
import { resolveStoreHost } from "../tenancy/store-host";
import { hasPermission, type RequestContext } from "./context";
import { audit, createTenantDb } from "./tenant-db";

// Request context, tenant switching, two-factor enforcement, tenant-bound data
// access and storefront host lookup, against the real (test) database.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const access = createAccessService({ prisma: admin });
const run = randomUUID().slice(0, 8);

interface Tenant {
  id: string;
  storeId: string;
}

let tenantA: Tenant;
let tenantB: Tenant;
const users: Record<string, string> = {};
const roleIds: Partial<Record<SystemRoleKey, string>> = {};

async function createTenant(label: string): Promise<Tenant> {
  const tenant = await admin.tenant.create({
    data: { name: `Access ${label} ${run}`, slug: `access-${label}-${run}` },
  });
  const store = await admin.store.create({
    data: { tenantId: tenant.id, name: `Store ${label}`, slug: "main" },
  });
  return { id: tenant.id, storeId: store.id };
}

async function createMember(label: string, tenantId: string, role: SystemRoleKey) {
  users[label] ??= (
    await admin.user.create({ data: { email: `access-${label}-${run}@example.test`, name: label } })
  ).id;
  await admin.userTenantMembership.create({
    data: { userId: users[label]!, tenantId, roleId: roleIds[role]! },
  });
}

/** Builds the session object the auth service would return, then a session row. */
async function sessionFor(label: string): Promise<CurrentSession> {
  const userId = users[label]!;
  const sessionRow = await admin.session.create({
    data: { userId, token: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const user = await admin.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      email: true,
      name: true,
      twoFactorEnabled: true,
      isPlatformAdmin: true,
      memberships: {
        where: { status: "active" },
        select: {
          tenant: { select: { id: true, slug: true, name: true, requireStaffTwoFactor: true } },
          role: { select: { key: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return {
    sessionId: sessionRow.id,
    activeTenantId: sessionRow.activeTenantId,
    user: { id: userId, ...user },
    memberships: user.memberships.map((m) => ({
      tenantId: m.tenant.id,
      tenantSlug: m.tenant.slug,
      tenantName: m.tenant.name,
      roleKey: m.role.key,
      roleName: m.role.name,
      requiresTwoFactor: false,
    })),
  };
}

const resolve = (session: CurrentSession) =>
  access.resolveContext({ session, requestId: `req-${run}`, ip: "203.0.113.9" });

async function contextFor(label: string): Promise<RequestContext> {
  const result = await resolve(await sessionFor(label));
  if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
  return result.context;
}

beforeAll(async () => {
  await seedSystemData(admin);
  for (const role of await admin.role.findMany({ where: { tenantId: null } })) {
    roleIds[role.key as SystemRoleKey] = role.id;
  }
  tenantA = await createTenant("a");
  tenantB = await createTenant("b");
  for (const role of SYSTEM_ROLES) {
    if (role.key !== "platform_admin") await createMember(role.key, tenantA.id, role.key);
  }
  await createMember("outsider", tenantB.id, "store_owner");
  // Belongs to both tenants with different roles.
  await createMember("both", tenantA.id, "marketer");
  await createMember("both", tenantB.id, "store_owner");
  await createMember("nobody-tenantless", tenantA.id, "marketer");
  await admin.userTenantMembership.deleteMany({ where: { userId: users["nobody-tenantless"] } });
});

afterAll(async () => {
  await admin.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  await admin.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await disconnectDatabase();
});

describe("request context", () => {
  it("gives each role exactly its catalogue permissions in its tenant", async () => {
    for (const role of SYSTEM_ROLES) {
      if (role.key === "platform_admin") continue;
      const context = await contextFor(role.key);
      expect(context.tenantId).toBe(tenantA.id);
      expect(context.storeId).toBe(tenantA.storeId);
      expect(context.roleKey).toBe(role.key);
      expect([...context.permissions].sort()).toEqual([...role.permissions].sort());
    }
  });

  it("never grants platform permissions through a tenant role", async () => {
    const owner = await contextFor("store_owner");
    expect([...owner.permissions].some((key) => key.startsWith("platform."))).toBe(false);
  });

  it("distinguishes a marketer from an owner", async () => {
    const owner = await contextFor("store_owner");
    const marketer = await contextFor("marketer");
    expect(hasPermission(owner, "staff.manage")).toBe(true);
    expect(hasPermission(marketer, "staff.manage")).toBe(false);
    expect(hasPermission(marketer, "marketing.write")).toBe(true);
    expect(hasPermission(marketer, "orders.refund")).toBe(false);
  });

  it("refuses users with no membership", async () => {
    expect((await resolve(await sessionFor("nobody-tenantless"))).status).toBe("no_membership");
  });

  it("asks a member of several tenants to choose", async () => {
    expect((await resolve(await sessionFor("both"))).status).toBe("choose_tenant");
  });
});

describe("tenant selection", () => {
  it("switches to a tenant the user belongs to, with that tenant's role", async () => {
    const session = await sessionFor("both");
    const changed = await access.setActiveTenant({
      session,
      tenantId: tenantB.id,
      requestId: `req-${run}`,
      ip: "203.0.113.9",
    });
    expect(changed).toBe(true);
    const row = await admin.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(row.activeTenantId).toBe(tenantB.id);

    const result = await resolve({ ...session, activeTenantId: tenantB.id });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.context.tenantId).toBe(tenantB.id);
      expect(result.context.roleKey).toBe("store_owner");
    }

    const entry = await admin.auditLog.findFirst({
      where: { action: "access.tenant_selected", actorUserId: users.both, tenantId: tenantB.id },
    });
    expect(entry?.requestId).toBe(`req-${run}`);
  });

  it("refuses a tenant the user does not belong to, changing nothing", async () => {
    const session = await sessionFor("outsider");
    for (const tenantId of [tenantA.id, randomUUID(), "not-a-uuid"]) {
      expect(
        await access.setActiveTenant({ session, tenantId, requestId: "r", ip: "203.0.113.9" }),
      ).toBe(false);
    }
    const row = await admin.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(row.activeTenantId).toBeNull();
  });

  it("ignores a stored active tenant the user is no longer a member of", async () => {
    const session = await sessionFor("outsider");
    const result = await resolve({ ...session, activeTenantId: tenantA.id });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.context.tenantId).toBe(tenantB.id);
  });
});

describe("two-factor requirement", () => {
  it("applies to owners and managers only, when the tenant turns it on", async () => {
    await admin.tenant.update({ where: { id: tenantA.id }, data: { requireStaffTwoFactor: true } });
    try {
      expect((await resolve(await sessionFor("store_owner"))).status).toBe("two_factor_required");
      expect((await resolve(await sessionFor("store_manager"))).status).toBe("two_factor_required");
      expect((await resolve(await sessionFor("marketer"))).status).toBe("ok");

      await admin.user.update({
        where: { id: users.store_owner },
        data: { twoFactorEnabled: true },
      });
      expect((await resolve(await sessionFor("store_owner"))).status).toBe("ok");
    } finally {
      await admin.tenant.update({
        where: { id: tenantA.id },
        data: { requireStaffTwoFactor: false },
      });
      await admin.user.update({
        where: { id: users.store_owner },
        data: { twoFactorEnabled: false },
      });
    }
  });
});

describe("tenant-bound data access", () => {
  it("lists only the current tenant's staff", async () => {
    const membersA = await listTeamMembers(createTenantDb(app, await contextFor("store_owner")));
    const emailsA = membersA.map((member) => member.email);
    expect(emailsA).toContain(`access-marketer-${run}@example.test`);
    expect(emailsA).not.toContain(`access-outsider-${run}@example.test`);

    const membersB = await listTeamMembers(createTenantDb(app, await contextFor("outsider")));
    expect(membersB.map((member) => member.email).sort()).toEqual(
      [`access-both-${run}@example.test`, `access-outsider-${run}@example.test`].sort(),
    );
  });

  it("writes audit entries in the context's tenant, with request ID and address", async () => {
    const context = await contextFor("store_owner");
    const db = createTenantDb(app, context);
    await db.run((tx) =>
      audit(
        tx,
        context,
        "test.audited",
        { type: "store", id: tenantA.storeId },
        { a: 1 },
        { a: 2 },
      ),
    );
    const entry = await admin.auditLog.findFirstOrThrow({
      where: { action: "test.audited", tenantId: tenantA.id },
      orderBy: { createdAt: "desc" },
    });
    expect(entry).toMatchObject({
      actorType: "user",
      actorUserId: context.userId,
      entityType: "store",
      entityId: tenantA.storeId,
      ip: "203.0.113.9",
      requestId: `req-${run}`,
      before: { a: 1 },
      after: { a: 2 },
    });
  });

  it("cannot write an audit entry into another tenant", async () => {
    const context = await contextFor("store_owner");
    const db = createTenantDb(app, context);
    await expect(
      db.run((tx) => audit(tx, { ...context, tenantId: tenantB.id }, "test.forged", { type: "x" })),
    ).rejects.toThrow();
  });
});

describe("storefront host resolution", () => {
  const host = `shop-${run}.example.test`;

  beforeAll(async () => {
    await admin.storeDomain.create({
      data: { tenantId: tenantA.id, storeId: tenantA.storeId, hostname: host, isPrimary: true },
    });
  });

  it("finds the store for a known host, ignoring case and port", async () => {
    const expected = { tenantId: tenantA.id, storeId: tenantA.storeId };
    expect(await resolveStoreHost(app, host)).toEqual(expected);
    expect(await resolveStoreHost(app, `${host.toUpperCase()}:3000`)).toEqual(expected);
  });

  it("returns nothing for unknown or malformed hosts", async () => {
    for (const value of ["unknown.example.test", "", null, "[::1]:3000", "a b", "x';--"]) {
      expect(await resolveStoreHost(app, value)).toBeNull();
    }
  });

  it("returns nothing for a suspended tenant", async () => {
    await admin.tenant.update({ where: { id: tenantA.id }, data: { status: "suspended" } });
    try {
      expect(await resolveStoreHost(app, host)).toBeNull();
    } finally {
      await admin.tenant.update({ where: { id: tenantA.id }, data: { status: "active" } });
    }
  });

  it("does not let the runtime role read the domains table outside a tenant", async () => {
    expect(await app.storeDomain.findMany({ where: { hostname: host } })).toEqual([]);
  });

  it("rejects a domain pointing at another tenant's store", async () => {
    await expect(
      admin.storeDomain.create({
        data: { tenantId: tenantB.id, storeId: tenantA.storeId, hostname: `x-${host}` },
      }),
    ).rejects.toThrow();
  });

  it("rejects a non-canonical host name", async () => {
    await expect(
      admin.storeDomain.create({
        data: { tenantId: tenantA.id, storeId: tenantA.storeId, hostname: "Shop.Example.test" },
      }),
    ).rejects.toThrow();
  });
});
