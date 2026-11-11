import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export type { PrismaClient };

let client: PrismaClient | undefined;

/**
 * Process-wide Prisma client.
 *
 * This is the UNSCOPED client. From Milestone 1.4, domain services must use the
 * tenant-scoped client instead; this one is reserved for migrations, health
 * checks and platform-administration code.
 */
export function getPrisma(databaseUrl: string): PrismaClient {
  client ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 3_000 }),
  });
  return client;
}

/** Resolves if the database answers a trivial query. */
export async function pingDatabase(databaseUrl: string): Promise<void> {
  await getPrisma(databaseUrl).$queryRaw`SELECT 1`;
}

export async function disconnectDatabase(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
