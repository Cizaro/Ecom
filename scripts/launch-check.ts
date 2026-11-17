// Before going live: checks the server's settings, its services and one
// store's setup, and lists what is not ready.
//
//   pnpm launch:check --tenant <store slug>
//
// Run it on the live server (with its environment). Exits non-zero if
// anything would affect real customers. Prints no secrets.

import { resolve } from "node:path";
import { EnvValidationError, parseEnv } from "@ecom/config";
import {
  checkLaunchSettings,
  checkLaunchStore,
  checkReadiness,
  closeReadinessConnections,
  type LaunchFinding,
} from "@ecom/core";
import { disconnectDatabase } from "@ecom/db";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: the live server sets real environment variables.
}

const args = process.argv.slice(2);
const tenantIndex = args.indexOf("--tenant");
const tenantSlug = tenantIndex >= 0 ? args[tenantIndex + 1] : undefined;
if (!tenantSlug) {
  console.error("Usage: pnpm launch:check --tenant <store slug>");
  process.exit(2);
}

const MARK = { pass: "[ ok ]", warn: "[warn]", fail: "[FAIL]" } as const;
const print = (title: string, findings: LaunchFinding[]) => {
  console.log(`\n${title}`);
  for (const item of findings) console.log(`${MARK[item.status]} ${item.label}: ${item.detail}`);
};

let env;
try {
  env = parseEnv(process.env);
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.log("[FAIL] Settings are not valid:");
    for (const issue of error.issues) console.log(`         ${issue}`);
    process.exit(1);
  }
  throw error;
}

const findings: LaunchFinding[] = [];
try {
  const settings = checkLaunchSettings(env);
  print("Server settings", settings);
  findings.push(...settings);

  const readiness = await checkReadiness(env);
  const services: LaunchFinding[] = readiness.checks.map((check) => ({
    status: check.ok ? "pass" : "fail",
    area: "settings",
    label: `Service: ${check.name}`,
    detail: check.ok ? "reachable" : (check.error ?? "not reachable"),
  }));
  print("Services", services);
  findings.push(...services);

  const store = await checkLaunchStore(env.DATABASE_ADMIN_URL, tenantSlug);
  print(`Store "${tenantSlug}"`, store);
  findings.push(...store);
} finally {
  await closeReadinessConnections();
  await disconnectDatabase();
}

const failed = findings.filter((item) => item.status === "fail").length;
const warned = findings.filter((item) => item.status === "warn").length;
console.log(
  `\n${failed === 0 ? "Ready to launch" : "Not ready"}: ${failed} to fix, ${warned} to review.`,
);
process.exit(failed === 0 ? 0 : 1);
