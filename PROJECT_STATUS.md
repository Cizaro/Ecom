# Project Status

Last updated: 2026-11-11

## Current phase

**Phase 1 (foundation). Milestones 1.1 and 1.2 complete.** Next: Milestone 1.3 (authentication).

## Completed

- **Phase 0:** assessment and planning documents.
- **Milestone 1.1, scaffold:**
  - pnpm workspace: `apps/web`, `apps/worker`, `packages/core`, `packages/db`, `packages/config`, `packages/ui`, `packages/testing`.
  - TypeScript strict, ESLint, Prettier.
  - Next.js app with placeholder storefront (`/`) and admin (`/admin`) pages, `/api/health`, `/api/ready`, baseline security headers.
  - Worker process (BullMQ) with one `maintenance` queue and a heartbeat job.
  - Environment validation (`packages/config`), structured logger with redaction, readiness checks for database, Redis and storage (`packages/core`).
  - Prisma set up with an empty baseline migration and a seed stub.
  - `docker-compose.yml`: PostgreSQL, Redis, RustFS (S3-compatible storage), Mailpit.
  - `pnpm healthcheck` environment check.
  - Vitest (unit and integration projects) and Playwright (desktop and mobile).
  - GitHub Actions CI workflow (written; see "Not yet verified").

- **Milestone 1.2, tenancy and identity schema:**
  - 14 tables: tenants, stores, users, roles, permissions, memberships, audit log, consent records, notification preferences, feature flags, idempotency keys, outbox events, jobs.
  - Row-Level Security on every tenant-owned table; a separate runtime database role (`app_user`) that cannot bypass it and cannot read password hashes.
  - Append-only audit log (update, delete and truncate rejected for every role).
  - `withTenant` helper that binds a transaction to one tenant.
  - Permission catalogue (39 permissions) and 7 system roles defined in code and seeded.
  - Seed: system data everywhere; a demo tenant, store and owner outside production.
  - 28 isolation tests and 4 seed tests against the real database.

**What exists is foundation only.** There is no sign-in, no products and no user-facing features. Nothing in the web app uses the new tables yet. The storefront and admin pages are placeholders.

## In progress

Nothing.

## Not started

Milestones 1.3 onward (PROJECT_PLAN.md section 4). No integration (payments, email, AI, Meta, Instagram, Facebook, TikTok, shipping) has been implemented or tested.

## Not yet verified

- The CI workflow has not been observed running on GitHub. Check the Actions tab after the first push; the secret-scan and dependency-audit steps in particular have only been reasoned about, not run in CI.
- A clean clone on a second computer has not been tried.

## Known bugs

None.

## Known issues

- **Integration tests use the development database.** They create and remove their own tenants, but audit-log rows they write stay (the table is append-only). A separate test database is planned with the isolation harness in Milestone 1.4.
- **The demo owner cannot sign in.** `owner@example.com` is seeded without a password until Milestone 1.3.
- **Prisma and Node 26:** Prisma 7.10 prints "Prisma only supports Node.js versions 20.19+, 22.12+, 24.0+" during install. Generate, migrate and queries all work on Node 26.13 here. If Prisma misbehaves later, switching to Node 24 is the fallback.
- **Dependency audit:** `pnpm audit` reports 1 moderate advisory in a transitive dependency. CI fails only on high or above. Revisit at the next dependency update.
- **pnpm `minimumReleaseAgeExclude`:** pnpm added a list of very recently published packages (AWS SDK, BullMQ) to `pnpm-workspace.yaml` so they could be installed. The list can be removed once those versions are older.
- **`msgpackr-extract` build script is denied** (optional native speed-up for BullMQ; not needed).
- **Docker in a fresh terminal:** after installing Docker Desktop, open a new terminal so `docker` is on the PATH. Docker Desktop must be running before `docker compose up`.

## Open technical decisions

See "Open decisions for the owner" in DECISIONS.md. Blocking specific work: payment provider (Q4), AI provider (Q15), social accounts (Q10 to Q13), giveaway legality and provider approval (Q28).

## Required software

| Tool | Version used | Notes |
| --- | --- | --- |
| Git | 2.51 | |
| Node.js | 26.13.0 | Pinned in `.nvmrc`; any 26.x works |
| pnpm | 12.18.0 | Pinned in `package.json`; install with `npm install -g pnpm` |
| Docker Desktop | Engine 29.9, Compose 5.7 | Per-user install with WSL 2 on Windows |

Main library versions (exact pins are in the `package.json` files): Next.js 16.4, React 19.3, TypeScript 6.0, Tailwind CSS 4.3, Prisma 7.10, BullMQ 6.7, Zod 4.6, Vitest 5.1, Playwright 1.65, ESLint 9.39.

## Required environment variables

Read by code today (validated in `packages/config/src/env.ts`): `NODE_ENV`, `APP_URL`, `LOG_LEVEL`, `DATABASE_URL`, `DATABASE_ADMIN_URL`, `REDIS_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`.

`.env.example` works as-is for local development. Generate your own `AUTH_SECRET` and `ENCRYPTION_KEY` (command is in the file). `.env` is never committed, so each computer has its own.

**Changed in Milestone 1.2:** `DATABASE_URL` must now connect as `app_user`, and `DATABASE_ADMIN_URL` is new. If you have an older `.env`, copy both lines from `.env.example`.

## Required external accounts and API keys

None yet. Upcoming, by phase: PROJECT_PLAN.md section 5.

## Commands

**First time on a computer** (after installing the software above and starting Docker Desktop):

```bash
git clone https://github.com/Cizaro/Ecom.git
```

```bash
cp .env.example .env
```

```bash
pnpm install
```

```bash
docker compose up -d --wait
```

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

```bash
pnpm healthcheck
```

**Every time you resume:**

```bash
git pull
```

```bash
pnpm install
```

```bash
docker compose up -d --wait
```

```bash
pnpm db:migrate
```

**Day to day:**

| Purpose | Command |
| --- | --- |
| Check the environment | `pnpm healthcheck` |
| Start web (http://localhost:3000) and worker | `pnpm dev` |
| Lint | `pnpm lint` |
| Format | `pnpm format` |
| Type check | `pnpm typecheck` |
| Unit tests | `pnpm test` |
| Integration tests (need services running) | `pnpm test:int` |
| Production build | `pnpm build` |
| End-to-end tests (need build and services) | `pnpm test:e2e` |
| Install the browser for end-to-end tests (once per computer) | `pnpm exec playwright install chromium` |
| Create a migration after a schema change | `pnpm db:migrate:dev` |
| Seed data (safe to repeat) | `pnpm db:seed` |
| Check schema and migrations agree | `pnpm db:drift` |
| Stop services | `docker compose down` |
| Stop services and delete local data | `docker compose down -v` |

Local service addresses: PostgreSQL `localhost:5432`, Redis `localhost:6379`, storage API `localhost:9000`, email inbox http://localhost:8025.

## Checks run this session (Milestone 1.2, on the first computer)

| Check | Result |
| --- | --- |
| `pnpm healthcheck` | Pass, 10 of 10 |
| `pnpm lint` | Pass |
| `pnpm format:check` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test` | Pass, 19 tests |
| `pnpm test:int` | Pass, 34 tests (run twice in a row) |
| Migrate, seed, drift check and integration tests on a brand-new empty database | Pass |
| `pnpm db:drift` | Pass, no difference |
| `pnpm build` | Pass |
| `pnpm test:e2e` | Pass, 10 tests (5 on desktop, 5 on mobile viewport) |
| Worker start | Starts and connects to Redis |
| `pnpm audit --audit-level high` | Pass (1 moderate advisory, see known issues) |
| CI on GitHub | First run was seen starting for Milestone 1.1; result not checked |

## Recommended next task

Milestone 1.3: authentication (staff sign-in, sessions, password reset, MFA for admin roles). Details in NEXT_STEPS.md.

## Session log

| Date | Summary |
| --- | --- |
| 2026-11-11 | Phase 0: assessment and planning documents |
| 2026-11-11 | Milestone 1.1: scaffold, local services, checks, CI workflow; remote added |
| 2026-11-11 | Milestone 1.2: tenancy and identity schema, Row-Level Security, permissions, seed |

Commit hashes: `git log --oneline`.
