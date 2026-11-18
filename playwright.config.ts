import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { useTestAi } from "./packages/testing/src/test-ai";
import { useTestDatabase } from "./packages/testing/src/test-database";

// End-to-end tests use the separate test database (see prepare-test-db.ts).
// Setting it here, before the web server starts, means the server, the global
// setup and the tests all see the same database.
try {
  process.loadEnvFile(resolve(import.meta.dirname, ".env"));
} catch {
  // No .env file: variables come from the real environment (CI).
}
useTestDatabase(process.env);
// Never a real AI service in automated tests (see test-ai.ts).
useTestAi(process.env);
// The browser tests check what a live store tells search engines.
process.env.ALLOW_SEARCH_INDEXING = "true";
// The browser tests run the production build and pay with the mock provider.
process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION = "true";
// The import test serves its picture from a local server, which is a private address.
process.env.IMPORT_ALLOW_PRIVATE_IMAGE_HOSTS = "true";
// The tests act from one address all day; real limits would stop them.
process.env.RATE_LIMIT_SCALE = "100";

const port = 3100;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // All tests share one web server process, which renders pages on a single
  // thread. On a computer with many cores the default (half the cores) starts
  // more browsers than that server can keep up with, and tests time out.
  workers: process.env.CI ? undefined : 4,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  // Runs the production build, so run `pnpm build` first.
  webServer: {
    command: `pnpm --filter @ecom/web exec next start --port ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
