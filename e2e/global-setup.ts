import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

// Generates a password for this run only and creates the test users with it.
// The value lives in memory and in the worker processes' environment; it is
// never written to disk or printed.
export default function globalSetup() {
  process.env.E2E_PASSWORD = `E2e-${randomBytes(18).toString("base64url")}`;
  execSync("pnpm exec tsx scripts/prepare-test-db.ts", { stdio: "inherit", env: process.env });
  execSync("pnpm exec tsx scripts/e2e-setup.ts", { stdio: "inherit", env: process.env });
}
