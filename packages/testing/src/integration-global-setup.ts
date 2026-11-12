import { execSync } from "node:child_process";
import { resolve } from "node:path";

// Vitest global setup for integration tests: makes sure the test database
// exists and is migrated before any test file runs.
export default function setup() {
  execSync("pnpm exec tsx scripts/prepare-test-db.ts", {
    cwd: resolve(import.meta.dirname, "../../.."),
    stdio: "inherit",
  });
}
