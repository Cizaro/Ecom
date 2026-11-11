// Prepares the database for the end-to-end tests. Called by Playwright's global
// setup, which generates a random password for the run and passes it in
// E2E_PASSWORD. Recreates the test users from scratch each time so earlier runs
// (changed passwords, two-factor switched on, lockouts) cannot affect this one.

import { resolve } from "node:path";
import { parseEnv } from "@ecom/config";
import { clearRedisRateLimits, createStaffUser, seedSystemData } from "@ecom/core";
import { disconnectDatabase, getAdminPrisma } from "@ecom/db";
import { E2E_TENANT_SLUG, e2eEmail, E2E_PROJECTS, E2E_PURPOSES } from "../e2e/users";

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
  await prisma.tenant.upsert({
    where: { slug: E2E_TENANT_SLUG },
    create: { slug: E2E_TENANT_SLUG, name: "End-to-end Test Store" },
    update: {},
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
