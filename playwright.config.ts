import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
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

const port = 3100;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
