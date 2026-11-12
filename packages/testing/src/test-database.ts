// Integration and end-to-end tests run against their own database, named after
// the development one with a `_test` suffix (ecommerce -> ecommerce_test), on
// the same server and with the same roles. Tests can then create and delete
// data freely without touching the development database.

const TEST_SUFFIX = "_test";

/** Same URL with the database name switched to its test twin. */
export function toTestDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!name) throw new Error("Database URL has no database name.");
  if (!name.endsWith(TEST_SUFFIX)) parsed.pathname = `/${name}${TEST_SUFFIX}`;
  return parsed.toString();
}

/**
 * Points DATABASE_URL and DATABASE_ADMIN_URL in `env` at the test database.
 * Call after loading .env and before anything reads the configuration.
 */
export function useTestDatabase(env: Record<string, string | undefined>): void {
  for (const key of ["DATABASE_URL", "DATABASE_ADMIN_URL"] as const) {
    const value = env[key];
    if (value) env[key] = toTestDatabaseUrl(value);
  }
}
