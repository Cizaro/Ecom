// pnpm sync: bring this computer up to date with GitHub in one step.
//
// For working from more than one computer: run it first thing in a session.
// It pulls the latest main (fast-forward only), installs packages if they
// changed, starts the local services, adds new settings from .env.example to
// .env, updates the development and test databases, and refreshes the
// system roles and permissions. It stops with a plain message, changing
// nothing, if there are uncommitted changes or the branches have diverged.
//
// Plain Node on purpose (no tsx): it reinstalls packages while running, and
// on Windows a script running from node_modules can lock files it replaces.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Keys in the example file that the .env file lacks, as their example lines. */
export function missingEnvLines(exampleText, envText) {
  const key = (line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
  const have = new Set(envText.split(/\r?\n/).map(key).filter(Boolean));
  return exampleText.split(/\r?\n/).filter((line) => {
    const name = key(line);
    return name !== undefined && !have.has(name);
  });
}

function run(command, args, { quiet = false, allowFail = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    // pnpm and docker are .cmd shims on Windows and need the shell; git does
    // not, and through the shell its "--format=%h %s" would be split in two.
    shell: process.platform === "win32" && command !== "git",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0 && !allowFail) {
    if (quiet) process.stderr.write(`${result.stdout ?? ""}${result.stderr ?? ""}`);
    stop(`"${command} ${args.join(" ")}" failed (exit code ${result.status ?? "none"}).`);
  }
  return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
}

const git = (...args) => run("git", args, { quiet: true }).out;

function stop(message) {
  console.error(`\nsync stopped: ${message}`);
  process.exit(1);
}

function step(title) {
  console.log(`\n== ${title}`);
}

function main() {
  // 1. Safe to pull?
  step("Checking this copy");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main")
    stop(`you are on branch "${branch}". Switch to main first: git switch main`);
  const dirty = git("status", "--porcelain");
  if (dirty) {
    stop(
      "there are changes not committed yet. Commit them (or ask Claude to), then run pnpm sync again:\n" +
        dirty,
    );
  }

  // 2. Pull.
  step("Fetching from GitHub");
  run("git", ["fetch", "origin", "--prune"], { quiet: true });
  const before = git("rev-parse", "HEAD");
  const ahead = Number(git("rev-list", "--count", "origin/main..main"));
  const behind = Number(git("rev-list", "--count", "main..origin/main"));
  if (ahead > 0 && behind > 0) {
    stop(
      `this computer has ${ahead} commit(s) GitHub lacks, and GitHub has ${behind} this computer lacks. ` +
        "Both computers changed main. Ask Claude to combine them (rebase), then push.",
    );
  }
  if (behind > 0) {
    console.log(git("log", "--oneline", "main..origin/main"));
    run("git", ["merge", "--ff-only", "origin/main"], { quiet: true });
    console.log(`Pulled ${behind} new commit(s).`);
  } else {
    console.log("Already up to date with GitHub.");
  }
  if (ahead > 0)
    console.log(`Note: ${ahead} commit(s) here are not on GitHub yet. Push them: git push`);
  const changed =
    before === git("rev-parse", "HEAD")
      ? []
      : git("diff", "--name-only", before, "HEAD").split("\n");
  const touched = (pattern) => changed.some((file) => pattern.test(file));

  // 3. Packages, only when they changed (installing takes minutes).
  step("Packages");
  if (
    !existsSync(resolve(root, "node_modules")) ||
    touched(/(^|\/)package\.json$|^pnpm-lock\.yaml$|^pnpm-workspace\.yaml$/)
  ) {
    run("pnpm", ["install", "--frozen-lockfile"]);
  } else {
    console.log("No package changes.");
  }

  // 4. Settings.
  step("Settings (.env)");
  const envPath = resolve(root, ".env");
  const example = readFileSync(resolve(root, ".env.example"), "utf8");
  if (!existsSync(envPath)) {
    stop(
      "there is no .env file. Copy .env.example to .env and fill in the secrets (see README.md).",
    );
  }
  const envText = readFileSync(envPath, "utf8");
  const missing = missingEnvLines(example, envText);
  if (missing.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(
      envPath,
      `${envText.replace(/\s*$/, "")}\n\n# Added by pnpm sync on ${today} (values from .env.example)\n${missing.join("\n")}\n`,
    );
    console.log(`Added: ${missing.map((line) => line.split("=")[0]).join(", ")}`);
  } else {
    console.log("Nothing new.");
  }

  // 5. Services: also re-applies one-off set-up such as the storage bucket's rules.
  step("Local services (Docker)");
  const docker = run("docker", ["compose", "up", "-d", "--wait"], { allowFail: true });
  if (!docker.ok) stop("the services did not start. Is Docker Desktop running?");

  // 6. Databases.
  step("Development database");
  run("pnpm", ["db:migrate"]);
  if (touched(/^packages\/db\/prisma\/schema\.prisma$/)) run("pnpm", ["db:generate"]);
  run("pnpm", ["db:seed"]);
  step("Test database");
  run("pnpm", ["db:test:prepare"]);

  console.log(`\nIn sync with GitHub at ${git("log", "-1", "--format=%h %s")}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
