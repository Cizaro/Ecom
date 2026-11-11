// Test users for the end-to-end suite. Each browser project gets its own user
// per scenario, because the scenarios change account state and run in parallel.

export const E2E_TENANT_SLUG = "e2e";
export const E2E_PROJECTS = ["desktop", "mobile"] as const;
export const E2E_PURPOSES = ["signin", "reset", "mfa"] as const;

export type E2EPurpose = (typeof E2E_PURPOSES)[number];

export const e2eEmail = (purpose: E2EPurpose, project: string) =>
  `e2e-${purpose}-${project}@example.test`;
