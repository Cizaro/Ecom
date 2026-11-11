import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

/**
 * Two database connections, two very different levels of trust.
 *
 * App client (DATABASE_URL, role app_user): what request handling uses. It is
 * subject to Row-Level Security, so outside `withTenant` it sees no tenant data
 * at all, and it cannot read credentials, sessions or platform-admin flags.
 *
 * Admin client (DATABASE_ADMIN_URL, the schema owner): bypasses Row-Level
 * Security. Reserved for migrations, seeding, authentication, platform
 * administration and cross-tenant worker jobs. Never use it to serve a
 * tenant-scoped request.
 */

function createAppClient(databaseUrl: string) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 3_000 }),
    // This column is not granted to app_user; selecting it would fail.
    omit: { user: { isPlatformAdmin: true } },
  });
}

function createAdminClient(databaseUrl: string) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 3_000 }),
  });
}

export type AppPrismaClient = ReturnType<typeof createAppClient>;
export type AdminPrismaClient = ReturnType<typeof createAdminClient>;

/** Transaction handle passed to `withTenant` callbacks. */
export type AppTransaction = Parameters<Parameters<AppPrismaClient["$transaction"]>[0]>[0];

let appClient: AppPrismaClient | undefined;
let adminClient: AdminPrismaClient | undefined;

export function getAppPrisma(databaseUrl: string): AppPrismaClient {
  appClient ??= createAppClient(databaseUrl);
  return appClient;
}

export function getAdminPrisma(adminDatabaseUrl: string): AdminPrismaClient {
  adminClient ??= createAdminClient(adminDatabaseUrl);
  return adminClient;
}

/** Resolves if the database answers a trivial query as the runtime role. */
export async function pingDatabase(databaseUrl: string): Promise<void> {
  await getAppPrisma(databaseUrl).$queryRaw`SELECT 1`;
}

export async function disconnectDatabase(): Promise<void> {
  await Promise.all([appClient?.$disconnect(), adminClient?.$disconnect()]);
  appClient = undefined;
  adminClient = undefined;
}
