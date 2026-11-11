// Creates a staff user who can sign in to the admin.
//
//   pnpm admin:create --email you@example.com --name "Your Name" --tenant demo
//   pnpm admin:create --email ops@example.com --platform-admin
//
// The password is never taken as an argument (arguments end up in shell history
// and process lists). You are prompted for it; in scripts, pipe it on stdin.

import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { parseEnv } from "@ecom/config";
import {
  createStaffUser,
  PASSWORD_MIN_LENGTH,
  seedSystemData,
  StaffUserError,
  SYSTEM_ROLES,
  type SystemRoleKey,
} from "@ecom/core";
import { disconnectDatabase, getAdminPrisma } from "@ecom/db";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: variables come from the real environment.
}

const USAGE = `Usage: pnpm admin:create --email <email> [--name <name>] [--tenant <slug>] [--role <role>] [--platform-admin]

  --email            Sign-in email address (required)
  --name             Display name
  --tenant           Tenant slug to add the user to (for example: demo)
  --role             Role in that tenant (default: store_owner)
  --platform-admin   Make the user a platform administrator

At least one of --tenant or --platform-admin is required.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readHidden(question: string): Promise<string> {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    // Suppress echo of typed characters.
    (rl as unknown as { _writeToOutput: () => void })._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      done(answer);
    });
  });
}

function readPipedLine(): Promise<string> {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin });
    let first: string | undefined;
    rl.on("line", (line) => {
      first ??= line;
    });
    rl.on("close", () => done(first ?? ""));
  });
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return readPipedLine();
  const password = await readHidden(`Password (at least ${PASSWORD_MIN_LENGTH} characters): `);
  if ((await readHidden("Repeat password: ")) !== password) fail("The passwords do not match.");
  return password;
}

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    tenant: { type: "string" },
    role: { type: "string", default: "store_owner" },
    "platform-admin": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!values.email) fail(USAGE);
if (!values.tenant && !values["platform-admin"]) fail(USAGE);

const tenantRoles: string[] = SYSTEM_ROLES.map((role) => role.key).filter(
  (key) => key !== "platform_admin",
);
if (values.tenant && !tenantRoles.includes(values.role)) {
  fail(`Unknown role "${values.role}". Choose one of: ${tenantRoles.join(", ")}`);
}

const env = parseEnv(process.env);
const prisma = getAdminPrisma(env.DATABASE_ADMIN_URL);

try {
  const password = await readPassword();
  await seedSystemData(prisma);
  const user = await createStaffUser(prisma, {
    email: values.email,
    name: values.name ?? "",
    password,
    isPlatformAdmin: values["platform-admin"],
    actor: "cli",
    ...(values.tenant
      ? { membership: { tenantSlug: values.tenant, role: values.role as SystemRoleKey } }
      : {}),
  });
  console.log(`Created ${user.email}. Sign in at ${new URL("/admin/sign-in", env.APP_URL)}`);
} catch (error) {
  if (error instanceof StaffUserError) fail(`Not created: ${error.message}`);
  throw error;
} finally {
  await disconnectDatabase();
}
