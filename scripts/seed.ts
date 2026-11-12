// Seeds the database. Run with: pnpm db:seed
// System data (permissions and built-in roles) is always written. Demo data
// (a tenant, store and owner) is written only outside production.

import { resolve } from "node:path";
import { parseEnv } from "@ecom/config";
import { seedDemoCatalog, seedDemoData, seedSystemData } from "@ecom/core";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: variables come from the real environment.
}

const env = parseEnv(process.env);
const prisma = getAdminPrisma(env.DATABASE_ADMIN_URL);

try {
  const system = await seedSystemData(prisma);
  console.log(
    `Seed: ${system.permissions} permissions, ${system.systemRoles} system roles` +
      (system.removedPermissions ? `, removed ${system.removedPermissions} stale permissions` : ""),
  );

  if (env.NODE_ENV === "production") {
    console.log("Seed: production environment, demo data skipped.");
  } else {
    const { tenantId } = await seedDemoData(prisma);
    console.log("Seed: demo tenant, store and owner present.");

    // Written through the runtime connection, inside the demo tenant.
    const app = getAppPrisma(env.DATABASE_URL);
    const catalog = await seedDemoCatalog({
      tenantId,
      run: (work) => withTenant(app, { tenantId }, work),
    });
    console.log(
      catalog.created
        ? `Seed: demo catalog added (${catalog.categories} categories, ${catalog.products} sample products).`
        : "Seed: demo catalog left as it is (the demo store already has categories).",
    );
  }
} finally {
  await disconnectDatabase();
}
