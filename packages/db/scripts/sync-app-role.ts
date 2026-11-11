// Gives the runtime database role (app_user) the password found in DATABASE_URL.
// Runs after `prisma migrate deploy` (see the migrate:deploy script), connecting
// with DATABASE_ADMIN_URL. This keeps credentials out of migrations while making
// a fresh checkout, CI and production all work the same way.

import { resolve } from "node:path";
import pg from "pg";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file: variables come from the real environment.
}

const APP_ROLE = "app_user";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!appUrl || !adminUrl) {
  console.error("sync-app-role: DATABASE_URL and DATABASE_ADMIN_URL must both be set.");
  process.exit(1);
}

const app = new URL(appUrl);
const username = decodeURIComponent(app.username);
const password = decodeURIComponent(app.password);

if (username !== APP_ROLE) {
  console.error(
    `sync-app-role: DATABASE_URL must connect as "${APP_ROLE}" (found "${username}"). ` +
      "The owner role belongs in DATABASE_ADMIN_URL only.",
  );
  process.exit(1);
}
if (!password) {
  console.error("sync-app-role: DATABASE_URL has no password.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  // ALTER ROLE cannot take bind parameters, so let the server quote the literal.
  const { rows } = await client.query<{ statement: string }>(
    `SELECT format('ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD %L', $1::text) AS statement`,
    [password],
  );
  await client.query(rows[0]!.statement);
  console.log(`sync-app-role: ${APP_ROLE} can log in with the DATABASE_URL credentials.`);
} finally {
  await client.end();
}
