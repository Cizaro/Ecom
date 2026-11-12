// Creates the test database if it does not exist and applies all migrations to
// it. Run automatically before integration tests (Vitest global setup) and
// end-to-end tests (Playwright global setup); safe to run any number of times.

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { toTestDatabaseUrl, useTestDatabase } from "../packages/testing/src/test-database";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: variables come from the real environment (CI).
}

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl || !process.env.DATABASE_URL) {
  console.error("prepare-test-db: DATABASE_URL and DATABASE_ADMIN_URL must be set.");
  process.exit(1);
}

const testAdminUrl = new URL(toTestDatabaseUrl(adminUrl));
const testName = decodeURIComponent(testAdminUrl.pathname.slice(1));

// Connect to the server's maintenance database to create the test database.
const maintenanceUrl = new URL(adminUrl);
maintenanceUrl.pathname = "/postgres";
const client = new pg.Client({ connectionString: maintenanceUrl.toString() });
await client.connect();
try {
  const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    testName,
  ]);
  if (!rowCount) {
    const { rows } = await client.query<{ statement: string }>(
      "SELECT format('CREATE DATABASE %I', $1::text) AS statement",
      [testName],
    );
    await client.query(rows[0]!.statement);
    console.log(`prepare-test-db: created ${testName}`);
  }
} finally {
  await client.end();
}

const env = { ...process.env };
useTestDatabase(env);
execSync("pnpm --filter @ecom/db migrate:deploy", { stdio: "pipe", env });
console.log(`prepare-test-db: ${testName} is migrated`);
