// Makes an existing staff account a platform administrator (or removes it),
// so it can open the platform panel at /admin/platform (D120).
//
//   pnpm platform:admin --email you@example.com [--remove]

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseEnv } from "@ecom/config";
import { recordAudit } from "@ecom/core";
import { disconnectDatabase, getAdminPrisma } from "@ecom/db";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: the server sets real environment variables.
}

const { values } = parseArgs({
  options: { email: { type: "string" }, remove: { type: "boolean", default: false } },
});
const email = values.email?.trim().toLowerCase();
if (!email) {
  console.error("Usage: pnpm platform:admin --email <address> [--remove]");
  process.exit(1);
}
const prisma = getAdminPrisma(parseEnv(process.env).DATABASE_ADMIN_URL);
try {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    console.error(`No account with ${email}. Create it first (pnpm admin:create).`);
    process.exit(1);
  }
  const on = !values.remove;
  await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: on } });
  await recordAudit(prisma, {
    tenantId: null,
    actorType: "system",
    actorUserId: null,
    action: on ? "platform.admin_granted" : "platform.admin_removed",
    entityType: "user",
    entityId: user.id,
    after: { via: "cli" },
  });
  console.log(`platform:admin: ${email} is ${on ? "now" : "no longer"} a platform administrator.`);
} finally {
  await disconnectDatabase();
}
