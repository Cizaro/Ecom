// Proves the backups can be restored (launch hardening, D118). Run monthly:
//
//   pnpm db:restore-test
//
// Makes a fresh backup (pnpm db:backup), restores it into a spare database
// next to the real one, checks that every table has the same number of rows
// as the database it came from, then removes the spare database. The real
// database is only read. Exits non-zero when anything differs.

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const root = resolve(import.meta.dirname, "..");
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch {
  // No .env file: the server sets real environment variables.
}
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("db:restore-test: DATABASE_ADMIN_URL must be set.");
  process.exit(1);
}

const source = new URL(adminUrl);
const sourceName = decodeURIComponent(source.pathname.slice(1));
const spareName = `${sourceName}_restore_check`;
const spare = new URL(adminUrl);
spare.pathname = `/${spareName}`;
const maintenance = new URL(adminUrl);
maintenance.pathname = "/postgres";

async function onMaintenance(sql: (client: pg.Client) => Promise<void>) {
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    await sql(client);
  } finally {
    await client.end();
  }
}

async function dropSpare() {
  await onMaintenance(async (client) => {
    const { rows } = await client.query<{ statement: string }>(
      "SELECT format('DROP DATABASE IF EXISTS %I WITH (FORCE)', $1::text) AS statement",
      [spareName],
    );
    await client.query(rows[0]!.statement);
  });
}

/** Rows per table in the public schema. */
async function rowCounts(url: string): Promise<Map<string, number>> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: tables } = await client.query<{ name: string }>(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const counts = new Map<string, number>();
    for (const { name } of tables) {
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public."${name.replace(/"/g, '""')}"`,
      );
      counts.set(name, Number(rows[0]!.n));
    }
    return counts;
  } finally {
    await client.end();
  }
}

// 1. A fresh backup.
// The backup script itself, run by this Node with the same TypeScript loader.
execFileSync(process.execPath, ["--import", "tsx", resolve(root, "scripts/backup-db.ts")], {
  cwd: root,
  stdio: "inherit",
});
const backups = resolve(process.env.BACKUP_DIR ?? resolve(root, "backups"));
const newest = readdirSync(backups)
  .filter((name) => name.startsWith(`${sourceName}-`) && name.endsWith(".dump"))
  .map((name) => ({ name, time: statSync(resolve(backups, name)).mtimeMs }))
  .sort((a, b) => b.time - a.time)[0];
if (!newest) {
  console.error("db:restore-test: no backup file was made.");
  process.exit(1);
}
const file = resolve(backups, newest.name);

// 2. Restore it into a spare database.
await dropSpare();
await onMaintenance(async (client) => {
  const { rows } = await client.query<{ statement: string }>(
    "SELECT format('CREATE DATABASE %I', $1::text) AS statement",
    [spareName],
  );
  await client.query(rows[0]!.statement);
});
const hasLocalPgRestore = spawnSync("pg_restore", ["--version"], { stdio: "ignore" }).status === 0;
const restoreArgs = ["--no-owner", "--no-privileges", "--exit-on-error"];
try {
  if (hasLocalPgRestore) {
    execFileSync("pg_restore", [...restoreArgs, "--dbname", spare.toString(), file], {
      stdio: "inherit",
    });
  } else {
    // The local development database runs in Docker; restore from inside the container.
    const inside = new URL(spare.toString());
    inside.hostname = "localhost";
    execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "postgres",
        "pg_restore",
        ...restoreArgs,
        "--dbname",
        inside.toString(),
      ],
      { cwd: root, input: readFileSync(file), stdio: ["pipe", "inherit", "inherit"] },
    );
  }

  // 3. Same tables, same number of rows.
  const [before, after] = [await rowCounts(adminUrl), await rowCounts(spare.toString())];
  const problems: string[] = [];
  for (const [table, count] of before) {
    const restored = after.get(table);
    if (restored === undefined) problems.push(`${table}: missing after restore`);
    else if (restored !== count)
      problems.push(`${table}: ${count} rows, ${restored} after restore`);
  }
  const total = [...before.values()].reduce((sum, n) => sum + n, 0);
  if (problems.length > 0) {
    console.error(`db:restore-test: FAILED\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(
      `db:restore-test: OK. ${newest.name} restored: ${before.size} tables, ${total} rows, all matching.`,
    );
  }
} finally {
  // 4. The spare database is removed whatever happened.
  await dropSpare();
}
