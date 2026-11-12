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
  E2E_TENANT_SLUG,
  e2eEmail,
  MFA_OWNER_EMAIL,
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
  await clearRedisRateLimits(env.REDIS_URL);
} finally {
  await disconnectDatabase();
}
