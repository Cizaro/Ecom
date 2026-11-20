import { resolve } from "node:path";
import { useTestAi } from "./test-ai";
import { useTestDatabase } from "./test-database";
import { useTestEmail } from "./test-email";

// Vitest setup file for integration tests: loads the root .env if present
// (in CI the variables come from the workflow environment instead), then
// points the database URLs at the separate test database.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file.
}
useTestDatabase(process.env);
useTestAi(process.env);
// Never a real email account in automated tests.
useTestEmail(process.env);
