import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { CatalogError } from "../catalog/errors";
import { createProduct, setProductStatus } from "../catalog/products";
import { SYSTEM_ROLES, type PermissionKey } from "../identity/permissions";
import { seedSystemData } from "../identity/seed";
import { createStaffUser, StaffUserError } from "../identity/staff-users";
import { savePlan, setShopPlan } from "../platform/billing";
import { signUpShop } from "../platform/signup";
import { featureProblem, getPlanLimits, getPlanUsage, productLimitProblem } from "./plan-limits";

// Plan limits against the real (test) database (D123).

const env = getEnv();
const url = env.DATABASE_ADMIN_URL;
const admin = getAdminPrisma(url);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tiny = `it_tiny_${run.replace(/-/g, "")}`;
const actor = { userId: randomUUID() };
const tenants: string[] = [];
const emails: string[] = [];
let tenantId: string;
let slug: string;
let context: RequestContext;

beforeAll(async () => {
  await seedSystemData(admin);
  slug = `limits-${run}`;
  emails.push(`limits-${run}@example.test`);
  const shop = await signUpShop(
    url,
    {
      name: "Limits Owner",
      email: `limits-${run}@example.test`,
      password: "a-long-test-password",
      shopName: "Limits Shop",
      address: slug,
      template: "classic",
      acceptTerms: "on",
    },
    { suffix: "limits.test", platformHost: "platform.limits.test" },
  );
  tenantId = shop.tenantId;
  tenants.push(tenantId);
  const owner = await admin.user.findUniqueOrThrow({
    where: { email: `limits-${run}@example.test` },
  });
  const store = await admin.store.findFirstOrThrow({ where: { tenantId } });
  context = {
    requestId: `req-${run}`,
    ip: "203.0.113.123",
    userId: owner.id,
    isPlatformAdmin: false,
    tenantId,
    tenantSlug: slug,
    tenantName: "Limits Shop",
    storeId: store.id,
    roleKey: "store_owner",
    roleName: "Owner",
    permissions: new Set<PermissionKey>(
      SYSTEM_ROLES.find((r) => r.key === "store_owner")!.permissions as readonly PermissionKey[],
    ),
  };
  await savePlan(url, actor, {
    key: tiny,
    name: "Tiny",
    price: "1",
    productLimit: "1",
    staffLimit: "1",
    features: ["own_domain"],
  });
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenants } } });
  await admin.user.deleteMany({ where: { email: { in: emails } } });
  await admin.platformPlan.deleteMany({ where: { key: tiny } });
  await disconnectDatabase();
});

describe("plan limits", () => {
  it("puts no limits on a shop during its trial", async () => {
    const db = createTenantDb(app, context);
    const limits = await getPlanLimits(db);
    expect(limits).toMatchObject({ plan: "trial", limited: false, productLimit: null });
    expect(await db.run((tx) => featureProblem(tx, "campaigns"))).toBeNull();
  });

  it("stops products at the plan's limit, and counts archived ones out", async () => {
    await setShopPlan(url, actor, tenantId, tiny);
    const db = createTenantDb(app, context);
    expect(await getPlanLimits(db)).toMatchObject({
      limited: true,
      productLimit: 1,
      staffLimit: 1,
      features: ["own_domain"],
    });

    const first = await createProduct(db, context, { name: `First ${run}` });
    const second = createProduct(db, context, { name: `Second ${run}` });
    await expect(second).rejects.toBeInstanceOf(CatalogError);
    await expect(second).rejects.toMatchObject({ code: "plan_limit" });
    // An import of several products is checked as a whole.
    expect(await db.run((tx) => productLimitProblem(tx, 3))).toMatch(/1 products/);

    // Archiving makes room; bringing it back is checked again.
    await setProductStatus(db, context, first.id, "archived");
    const replacement = await createProduct(db, context, { name: `Replacement ${run}` });
    await expect(setProductStatus(db, context, first.id, "draft")).rejects.toMatchObject({
      code: "plan_limit",
    });
    expect(replacement.id).toBeTruthy();

    const usage = await getPlanUsage(db);
    expect(usage).toMatchObject({ products: 1, staff: 1 });
  });

  it("includes only the plan's features", async () => {
    const db = createTenantDb(app, context);
    expect(await db.run((tx) => featureProblem(tx, "own_domain"))).toBeNull();
    expect(await db.run((tx) => featureProblem(tx, "scheduled_posts"))).toMatch(/not included/);
    expect(await db.run((tx) => featureProblem(tx, "campaigns"))).toMatch(/not included/);
  });

  it("stops staff accounts at the plan's limit", async () => {
    emails.push(`limits-staff-${run}@example.test`);
    const adding = createStaffUser(admin, {
      email: `limits-staff-${run}@example.test`,
      name: "Extra",
      password: "a-long-test-password",
      membership: { tenantSlug: slug, role: "marketer" },
      actor: "test",
    });
    await expect(adding).rejects.toBeInstanceOf(StaffUserError);
    await expect(adding).rejects.toMatchObject({ code: "plan_limit" });
    expect(
      await admin.user.findUnique({ where: { email: `limits-staff-${run}@example.test` } }),
    ).toBeNull();
  });
});
