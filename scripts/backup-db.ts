// Database backup: a full copy in PostgreSQL's own format, one file per run,
// in ./backups (or BACKUP_DIR), keeping the newest BACKUP_KEEP files (14 by
// default). Uses pg_dump if it is installed, otherwise the one in the local
// Docker database container.
//
//   pnpm db:backup
//
// Restore (stops nothing by itself; do it with the app stopped):
//   pg_restore --clean --if-exists --no-owner --dbname "<admin database URL>" backups/<file>.dump
//
// Uploaded pictures live in the file storage, not in the database: back that
// bucket up with your storage provider's own versioning or replication.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: the server sets real environment variables.
}

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("db:backup: DATABASE_ADMIN_URL must be set.");
  process.exit(1);
}
const dir = resolve(process.env.BACKUP_DIR ?? resolve(import.meta.dirname, "../backups"));
const keep = Math.max(1, Number.parseInt(process.env.BACKUP_KEEP ?? "14", 10) || 14);
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const database = new URL(url).pathname.slice(1) || "database";
const file = resolve(dir, `${database}-${stamp}.dump`);

function hasLocalPgDump(): boolean {
  return spawnSync("pg_dump", ["--version"], { stdio: "ignore" }).status === 0;
}

let dump: Buffer;
if (hasLocalPgDump()) {
  dump = execFileSync("pg_dump", ["--format=custom", "--no-owner", url], {
    maxBuffer: 1024 * 1024 * 1024,
  });
} else {
  // The local development database runs in Docker; reach it from inside the container.
  const inside = new URL(url);
  inside.hostname = "localhost";
  dump = execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_dump",
      "--format=custom",
      "--no-owner",
      inside.toString(),
    ],
    { cwd: resolve(import.meta.dirname, ".."), maxBuffer: 1024 * 1024 * 1024 },
  );
}
if (dump.length < 1024 || dump.subarray(0, 5).toString() !== "PGDMP") {
  console.error("db:backup: the backup does not look like a PostgreSQL dump; nothing was kept.");
  process.exit(1);
}
writeFileSync(file, dump, { mode: 0o600 });
console.log(`db:backup: saved ${file} (${Math.round(dump.length / 1024)} KB)`);

// Keep the newest files only.
const old = readdirSync(dir)
  .filter((name) => name.startsWith(`${database}-`) && name.endsWith(".dump"))
  .map((name) => ({ name, time: statSync(resolve(dir, name)).mtimeMs }))
  .sort((a, b) => b.time - a.time)
  .slice(keep);
for (const item of old) rmSync(resolve(dir, item.name));
if (old.length > 0)
  console.log(`db:backup: removed ${old.length} older backup(s), keeping ${keep}`);
