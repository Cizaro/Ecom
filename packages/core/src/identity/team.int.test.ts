import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "./permissions";
import { getRequireStaffTwoFactor, setRequireStaffTwoFactor } from "./team";

// Requiring two-factor sign-in for owners and managers (launch hardening).

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];

function contextFor(
  tenantId: string,
  role: SystemRoleKey,
  permissions?: PermissionKey[],
): RequestContext {
  return {
    requestId: `req-${run}`,
    ip: "203.0.113.101",
    userId: randomUUID(),
    isPlatformAdmin: false,
    tenantId,
    tenantSlug: "x",
    tenantName: "x",
    storeId: null,
    roleKey: role,
    roleName: role,
    permissions: new Set<PermissionKey>(
      permissions ??
        (SYSTEM_ROLES.find((r) => r.key === role)!.permissions as readonly PermissionKey[]),
    ),
  };
}

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await disconnectDatabase();
});

describe("two-factor requirement", () => {
  it("is set by an owner only, for its own store, and audited", async () => {
    const a = await admin.tenant.create({ data: { name: `TF A ${run}`, slug: `tf-a-${run}` } });
    const b = await admin.tenant.create({ data: { name: `TF B ${run}`, slug: `tf-b-${run}` } });
    tenantIds.push(a.id, b.id);
    const dbA = createTenantDb(app, { tenantId: a.id });
    const dbB = createTenantDb(app, { tenantId: b.id });
    expect(await getRequireStaffTwoFactor(dbA)).toBe(false);

    await expect(
      setRequireStaffTwoFactor(dbA, contextFor(a.id, "store_manager"), true),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Even with staff.manage granted, only the owner role may change it.
    await expect(
      setRequireStaffTwoFactor(dbA, contextFor(a.id, "store_manager", ["staff.manage"]), true),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await setRequireStaffTwoFactor(dbA, contextFor(a.id, "store_owner"), true);
    expect(await getRequireStaffTwoFactor(dbA)).toBe(true);
    expect(await getRequireStaffTwoFactor(dbB)).toBe(false);
    expect(
      await admin.auditLog.count({
        where: { tenantId: a.id, action: "staff.two_factor_requirement_changed" },
      }),
    ).toBe(1);
  });
});
