// Development environment health check. Run with: pnpm healthcheck
// Confirms the tools, configuration and local services needed to work on the
// project are in place. Exits non-zero if anything required is missing.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EnvValidationError, parseEnv, type Env } from "@ecom/config";
import { checkReadiness, closeReadinessConnections } from "@ecom/core";

const root = resolve(import.meta.dirname, "..");
let failures = 0;

function report(ok: boolean, label: string, detail = "", fix = "") {
  if (!ok) failures += 1;
  const line = `${ok ? "[ ok ]" : "[FAIL]"} ${label}${detail ? `: ${detail}` : ""}`;
  console.log(!ok && fix ? `${line}\n         -> ${fix}` : line);
}

/** Runs a fixed command line (never user input) and returns its output, if it succeeds. */
function commandOutput(commandLine: string): string | undefined {
  try {
    return execSync(commandLine, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

// --- Tools ---
const wantedNode = readFileSync(resolve(root, ".nvmrc"), "utf8").trim();
const wantedMajor = wantedNode.split(".")[0];
const actualNode = process.versions.node;
report(
  actualNode.split(".")[0] === wantedMajor,
  "Node.js",
  `${actualNode} (project uses ${wantedNode})`,
  `Install Node.js ${wantedMajor}.x`,
);

const pnpmVersion = commandOutput("pnpm --version");
report(!!pnpmVersion, "pnpm", pnpmVersion ?? "not found", "npm install -g pnpm");

const dockerVersion = commandOutput("docker --version");
report(!!dockerVersion, "Docker CLI", dockerVersion ?? "not found", "Install Docker Desktop");

const dockerEngine = commandOutput('docker info --format "{{.ServerVersion}}"');
report(
  !!dockerEngine,
  "Docker engine",
  dockerEngine ? `running (${dockerEngine})` : "not running",
  "Start Docker Desktop and wait until it says it is running",
);

report(existsSync(resolve(root, "node_modules")), "Dependencies installed", "", "pnpm install");

// --- Configuration ---
const envPath = resolve(root, ".env");
const hasEnvFile = existsSync(envPath);
report(hasEnvFile, ".env file", "", "Copy .env.example to .env");
if (hasEnvFile) process.loadEnvFile(envPath);

let env: Env | undefined;
try {
  env = parseEnv(process.env);
  report(true, "Environment variables", "valid");
} catch (error) {
  const detail =
    error instanceof EnvValidationError ? error.issues.join("; ") : (error as Error).message;
  report(false, "Environment variables", detail, "Fix the listed variables in .env");
}

// --- Services ---
if (env) {
  const fixes = {
    database: "docker compose up -d --wait, then pnpm db:migrate",
    redis: "docker compose up -d --wait",
    storage: "docker compose up -d --wait (the storage-init service creates the bucket)",
  };
  const { checks } = await checkReadiness(env);
  for (const check of checks) {
    report(
      check.ok,
      `Service: ${check.name}`,
      check.ok ? `reachable (${check.latencyMs} ms)` : (check.error ?? "unreachable"),
      fixes[check.name],
    );
  }
  await closeReadinessConnections();
} else {
  report(false, "Services", "skipped because the environment is invalid");
}

console.log(
  failures === 0
    ? "\nEnvironment is ready."
    : `\n${failures} problem(s) found. Fix them and run pnpm healthcheck again.`,
);
process.exit(failures === 0 ? 0 : 1);
