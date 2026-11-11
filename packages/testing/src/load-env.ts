import { resolve } from "node:path";

// Vitest setup file for integration tests: loads the root .env if present.
// In CI the variables come from the workflow environment instead.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file.
}
