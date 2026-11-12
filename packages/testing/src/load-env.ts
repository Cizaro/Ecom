import { resolve } from "node:path";
import { useTestDatabase } from "./test-database";

// Vitest setup file for integration tests: loads the root .env if present
// (in CI the variables come from the workflow environment instead), then
// points the database URLs at the separate test database.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file.
}
useTestDatabase(process.env);
