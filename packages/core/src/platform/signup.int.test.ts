import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenantDb } from "../access/tenant-db";
import { verifyPassword } from "../identity/password";
import { seedSystemData } from "../identity/seed";
import { getSetupChecklist } from "../tenancy/setup-checklist";
import { resolveStoreHost } from "../tenancy/store-host";
import { PlatformError } from "./shops";
import { signUpShop, TRIAL_DAYS } from "./signup";

// Self-service sign-up against the real (test) database (D121).

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const suffix = "signup.test";
const options = { suffix, platformHost: `platform.${suffix}`, ip: "203.0.113.121" };
const emails: string[] = [];
const tenants: string[] = [];

const input = (overrides: Record<string, unknown> = {}) => ({
  name: "Lina Haddad",
  email: `lina-${run}@example.test`,
  password: "a-long-test-password",
  shopName: "Lina Bags",
  address: `lina-${run}`,
  template: "boutique",
  acceptTerms: "on",
  ...overrides,
});

beforeAll(async () => {
  await seedSystemData(admin);
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenants } } });
  await admin.user.deleteMany({ where: { email: { in: emails } } });
  await disconnectDatabase();
});

describe("signUpShop", () => {
  it("creates the owner, a trial shop at its address with the chosen look, and an audit entry", async () => {
    emails.push(`lina-${run}@example.test`);
    const now = new Date("2026-12-01T10:00:00Z");
    const shop = await signUpShop(env.DATABASE_ADMIN_URL, input(), { ...options, now });
    tenants.push(shop.tenantId);

    expect(shop.hostname).toBe(`lina-${run}.${suffix}`);
    expect(shop.trialEndsAt.getTime() - now.getTime()).toBe(TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const tenant = await admin.tenant.findUniqueOrThrow({
      where: { id: shop.tenantId },
      select: {
        plan: true,
        trialEndsAt: true,
        status: true,
        stores: { select: { branding: true, name: true } },
        memberships: {
          select: { role: { select: { key: true } }, user: { select: { email: true } } },
        },
      },
    });
    expect(tenant.plan).toBe("trial");
    expect(tenant.status).toBe("active");
    expect(tenant.stores[0]!.name).toBe("Lina Bags");
    expect(tenant.stores[0]!.branding).toMatchObject({ brandColor: "#6b214f", font: "serif" });
    expect(tenant.memberships).toEqual([
      { role: { key: "store_owner" }, user: { email: `lina-${run}@example.test` } },
    ]);

    const account = await admin.account.findFirstOrThrow({
      where: { user: { email: `lina-${run}@example.test` }, providerId: "credential" },
      select: { password: true },
    });
    expect(await verifyPassword(account.password!, "a-long-test-password")).toBe(true);

    // The shop's address answers to the runtime role.
    expect(await resolveStoreHost(app, shop.hostname)).toMatchObject({ tenantId: shop.tenantId });

    const audit = await admin.auditLog.findFirst({
      where: { tenantId: shop.tenantId, action: "platform.signup" },
    });
    expect(audit).not.toBeNull();

    // The new shop's setup guide starts with nothing done and the trial dates.
    const checklist = await getSetupChecklist(createTenantDb(app, { tenantId: shop.tenantId }));
    expect(checklist.done).toBe(0);
    expect(checklist.steps).toHaveLength(6);
    expect(checklist.plan).toBe("trial");
    expect(checklist.trialEndsAt?.getTime()).toBe(shop.trialEndsAt.getTime());
  });

  it("refuses a taken address and an email that already has an account", async () => {
    await expect(
      signUpShop(env.DATABASE_ADMIN_URL, input({ email: `other-${run}@example.test` }), options),
    ).rejects.toMatchObject({ field: "address" });
    await expect(
      signUpShop(env.DATABASE_ADMIN_URL, input({ address: `else-${run}` }), options),
    ).rejects.toMatchObject({ field: "email" });
  });

  it("checks every field before writing anything", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ name: "" }, "name"],
      [{ email: "not-an-email" }, "email"],
      [{ password: "short" }, "password"],
      [{ shopName: "" }, "shopName"],
      [{ address: "admin" }, "address"],
      [{ address: "Bad Name" }, "address"],
      [{ template: "nope" }, "template"],
      [{ acceptTerms: "" }, "acceptTerms"],
    ];
    for (const [overrides, field] of cases) {
      const attempt = signUpShop(
        env.DATABASE_ADMIN_URL,
        input({ email: `case-${run}@example.test`, address: `case-${run}`, ...overrides }),
        options,
      );
      await expect(attempt, field).rejects.toBeInstanceOf(PlatformError);
      await expect(attempt, field).rejects.toMatchObject({ field });
    }
    expect(
      await admin.user.findUnique({ where: { email: `case-${run}@example.test` } }),
    ).toBeNull();
    expect(await admin.tenant.findUnique({ where: { slug: `case-${run}` } })).toBeNull();
  });

  it("never gives a shop the platform's own host", async () => {
    await expect(
      signUpShop(
        env.DATABASE_ADMIN_URL,
        input({ email: `host-${run}@example.test`, address: "myplatform" }),
        { ...options, platformHost: `myplatform.${suffix}` },
      ),
    ).rejects.toMatchObject({ field: "address" });
  });
});
