// Prepares the database for the end-to-end tests. Called by Playwright's global
// setup, which generates a random password for the run and passes it in
// E2E_PASSWORD. Recreates the test users from scratch each time so earlier runs
// (changed passwords, two-factor switched on, lockouts) cannot affect this one.

import { resolve } from "node:path";
import { parseEnv } from "@ecom/config";
import { clearRedisRateLimits, createStaffUser, seedSystemData } from "@ecom/core";
import { disconnectDatabase, getAdminPrisma } from "@ecom/db";
import {
  BOTH_TENANTS_EMAIL,
  E2E_MFA_TENANT_SLUG,
  E2E_OTHER_TENANT_SLUG,
  E2E_PROJECTS,
  E2E_PURPOSES,
  E2E_ROLES,
  E2E_SHIPPING_HOST,
  E2E_SHIPPING_ORDERS_EMAIL,
  E2E_SHIPPING_PRODUCT_SLUG,
  E2E_SHIPPING_TENANT_SLUG,
  E2E_TENANT_SLUG,
  e2eEmail,
  MFA_OWNER_EMAIL,
  PLATFORM_ADMIN_EMAIL,
  OTHER_OWNER_EMAIL,
  roleEmail,
} from "../e2e/users";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: variables come from the real environment.
}

const password = process.env.E2E_PASSWORD;
if (!password) {
  console.error("e2e-setup: E2E_PASSWORD is not set. Run through `pnpm test:e2e`.");
  process.exit(1);
}

const env = parseEnv(process.env);
const prisma = getAdminPrisma(env.DATABASE_ADMIN_URL);

try {
  await seedSystemData(prisma);
  const tenants = [
    { slug: E2E_TENANT_SLUG, name: "End-to-end Test Store", requireStaffTwoFactor: false },
    { slug: E2E_OTHER_TENANT_SLUG, name: "Other Test Store", requireStaffTwoFactor: false },
    { slug: E2E_MFA_TENANT_SLUG, name: "Two-factor Test Store", requireStaffTwoFactor: true },
    { slug: E2E_SHIPPING_TENANT_SLUG, name: "Delivery Test Store", requireStaffTwoFactor: false },
  ];
  for (const tenant of tenants) {
    const row = await prisma.tenant.upsert({
      where: { slug: tenant.slug },
      create: tenant,
      update: { requireStaffTwoFactor: tenant.requireStaffTwoFactor },
    });
    if (!(await prisma.store.findFirst({ where: { tenantId: row.id } }))) {
      await prisma.store.create({ data: { tenantId: row.id, name: tenant.name, slug: "main" } });
    }
  }

  // The end-to-end server runs at localhost, so localhost shows the main test store.
  const mainTenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug: E2E_TENANT_SLUG },
    include: { stores: { take: 1, orderBy: { createdAt: "asc" } } },
  });
  // The main test store is offered in Arabic too (the language switch).
  await prisma.store.update({
    where: { id: mainTenant.stores[0]!.id },
    data: { languages: ["en", "ar"] },
  });
  await prisma.storeDomain.deleteMany({ where: { hostname: "localhost" } });
  await prisma.storeDomain.create({
    data: {
      tenantId: mainTenant.id,
      storeId: mainTenant.stores[0]!.id,
      hostname: "localhost",
      isPrimary: true,
    },
  });

  const createUser = async (
    email: string,
    tenantSlug: string,
    role: (typeof E2E_ROLES)[number],
  ) => {
    await prisma.user.deleteMany({ where: { email } });
    return createStaffUser(prisma, {
      email,
      name: email.split("@")[0]!,
      password,
      actor: "test",
      membership: { tenantSlug, role },
    });
  };

  for (const role of E2E_ROLES) await createUser(roleEmail(role), E2E_TENANT_SLUG, role);
  await createUser(OTHER_OWNER_EMAIL, E2E_OTHER_TENANT_SLUG, "store_owner");
  await createUser(MFA_OWNER_EMAIL, E2E_MFA_TENANT_SLUG, "store_owner");
  // Marketer in the main tenant, owner of the other one.
  const both = await createUser(BOTH_TENANTS_EMAIL, E2E_TENANT_SLUG, "marketer");
  await prisma.userTenantMembership.create({
    data: {
      userId: both.id,
      tenantId: (await prisma.tenant.findUniqueOrThrow({ where: { slug: E2E_OTHER_TENANT_SLUG } }))
        .id,
      roleId: (
        await prisma.role.findFirstOrThrow({ where: { tenantId: null, key: "store_owner" } })
      ).id,
    },
  });

  // Shops and owners left by earlier runs of the sign-up tests (D121).
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: "shop-" }, plan: "trial" } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "signup-", endsWith: "@example.test" } },
  });

  // The platform owner: no shop membership, platform administrator (D120).
  await prisma.user.deleteMany({ where: { email: PLATFORM_ADMIN_EMAIL } });
  await createStaffUser(prisma, {
    email: PLATFORM_ADMIN_EMAIL,
    name: "Platform Admin",
    password,
    actor: "test",
    isPlatformAdmin: true,
  });

  for (const project of E2E_PROJECTS) {
    for (const purpose of E2E_PURPOSES) {
      const email = e2eEmail(purpose, project);
      await prisma.user.deleteMany({ where: { email } });
      await createStaffUser(prisma, {
        email,
        name: `E2E ${purpose}`,
        password,
        actor: "test",
        membership: { tenantSlug: E2E_TENANT_SLUG, role: "store_owner" },
      });
    }
  }
  // The delivery test store: two areas in Lebanon, 11% VAT included in
  // prices, and one product that is always available.
  const shipping = await prisma.tenant.findUniqueOrThrow({
    where: { slug: E2E_SHIPPING_TENANT_SLUG },
    include: { stores: { take: 1, orderBy: { createdAt: "asc" } } },
  });
  await prisma.storeDomain.deleteMany({ where: { hostname: E2E_SHIPPING_HOST } });
  await prisma.storeDomain.create({
    data: {
      tenantId: shipping.id,
      storeId: shipping.stores[0]!.id,
      hostname: E2E_SHIPPING_HOST,
      isPrimary: true,
    },
  });
  await prisma.shippingZone.deleteMany({ where: { tenantId: shipping.id } });
  await prisma.shippingZone.createMany({
    data: [
      {
        tenantId: shipping.id,
        name: "Beirut",
        countries: ["LB"],
        rateAmount: 300,
        freeOverAmount: 10_000,
        currency: "USD",
        position: 1,
      },
      {
        tenantId: shipping.id,
        name: "Mount Lebanon",
        countries: ["LB"],
        rateAmount: 500,
        currency: "USD",
        position: 2,
      },
    ],
  });
  await prisma.checkoutSettings.upsert({
    where: { tenantId: shipping.id },
    create: { tenantId: shipping.id, taxRateBasisPoints: 1100, taxIncluded: true, taxLabel: "VAT" },
    update: { taxRateBasisPoints: 1100, taxIncluded: true, taxLabel: "VAT" },
  });
  await prisma.notificationSettings.upsert({
    where: { tenantId: shipping.id },
    create: { tenantId: shipping.id, orderEmails: [E2E_SHIPPING_ORDERS_EMAIL], stockEmails: [] },
    update: { orderEmails: [E2E_SHIPPING_ORDERS_EMAIL], stockEmails: [] },
  });
  if (
    !(await prisma.product.findFirst({
      where: { tenantId: shipping.id, slug: E2E_SHIPPING_PRODUCT_SLUG },
    }))
  ) {
    const product = await prisma.product.create({
      data: {
        tenantId: shipping.id,
        name: "Delivery Tote",
        slug: E2E_SHIPPING_PRODUCT_SLUG,
        status: "active",
      },
    });
    await prisma.productVariant.create({
      data: {
        tenantId: shipping.id,
        productId: product.id,
        sku: "E2E-TOTE",
        color: "Sand",
        priceAmount: 4000,
        currency: "USD",
        trackInventory: false,
      },
    });
  }

  await clearRedisRateLimits(env.REDIS_URL);
} finally {
  await disconnectDatabase();
}
