# Project Status

Last updated: 2026-11-11

## Current phase

**Phase 1 (foundation). Milestones 1.1, 1.2 and 1.3 complete.** Next: Milestone 1.4 (permission guard, request context, tenant-scoped data access).

## Completed

- **Phase 0:** assessment and planning documents.
- **Milestone 1.1, scaffold:** pnpm workspace, Next.js app, worker, env validation, logging, health and readiness endpoints, docker-compose services, `pnpm healthcheck`, Vitest, Playwright, CI.
- **Milestone 1.2, tenancy and identity schema:** tenants, stores, users, roles, permissions, memberships, audit log and platform tables; Row-Level Security with a restricted runtime database role; append-only audit log; permission catalogue (39) and 7 system roles; seed.
- **Milestone 1.3, staff authentication:**
  - Sign-in with email and password at `/admin/sign-in`; sign-out; sign-out everywhere.
  - Passwords hashed with Argon2id. Sessions in the database, in an HTTP-only, same-site cookie; revoking a session takes effect on the next request.
  - Lockout: 5 failed attempts per account or 30 per client address in 15 minutes.
  - Password reset by emailed single-use link (30 minutes); resetting ends all sessions.
  - Two-factor authentication (authenticator app) with backup codes, set up at `/admin/account/security`.
  - Disabled or deleted users cannot sign in and lose access immediately.
  - Audit-log entries for sign-in, failure, lockout, sign-out, reset and two-factor changes.
  - Email provider interface with SMTP (Mailpit locally) and console adapters.
  - `pnpm admin:create` to create staff users.
  - `/admin` and `/admin/account/security` require a session.

**What a signed-in user can do today:** see which stores they belong to and their role, manage two-factor, sign out. There are still no products, orders or dashboard.

## In progress

Nothing.

## Not started

Milestones 1.4 onward (PROJECT_PLAN.md section 4). No integration with payments, AI, Meta, Instagram, Facebook, TikTok or shipping has been implemented or tested. Email is implemented for SMTP only and tested against the local Mailpit inbox, not a real email provider.

## Known limitations of what is built

- **Permissions are not enforced yet.** Roles and permissions exist in the database and the session knows the user's memberships, but no page or action checks a permission. That is Milestone 1.4. Until then every signed-in user sees the same pages.
- **Two-factor is optional.** The rule "required for owner and manager roles when the tenant enables it" needs the permission layer and is planned for 1.4.
- **No QR code for two-factor setup.** The setup key is shown as text (and as a link that opens an authenticator app on a phone). A QR code comes with the design system in 1.5.
- **Session tokens are stored unhashed** in the `sessions` table (how the Better Auth library works). The table is unreadable by the runtime database role; someone with owner-level database access could hijack live sessions. Recorded in the threat model.
- **A two-factor code can be reused within its 30-second window** (library behaviour). An attacker would need the password and a code observed in that window.
- **Client address for rate limits comes from `X-Forwarded-For`.** This is only trustworthy behind a proxy that overwrites the header; the deployment guide must require one.
- **Form fields clear after a failed submit** (for example a wrong password clears the email). Cosmetic; fixed with the design system.
- **Staff users can only be created from the command line.** Inviting staff from the admin is part of settings (later).
- **Integration and end-to-end tests use the development database.** They create their own users and tenants (`e2e`, `auth-*`, `test-*`) and remove most of them, but audit-log rows stay. A separate test database is planned for 1.4.

## Known issues

- **Prisma and Node 26:** Prisma 7.10 warns that Node 26 is not a listed supported version. Everything works here; Node 24 is the fallback.
- **Dependency audit:** 1 moderate advisory in a transitive dependency. CI fails only on high or above.
- **pnpm `minimumReleaseAgeExclude`:** pnpm listed some very recently published packages in `pnpm-workspace.yaml` so they could be installed. Can be removed once those versions are older.
- **Docker in a fresh terminal:** after installing Docker Desktop, open a new terminal so `docker` is on the PATH. Docker Desktop must be running before `docker compose up`.

## Open technical decisions

See "Open decisions for the owner" in DECISIONS.md. Blocking specific work: payment provider (Q4), AI provider (Q15), social accounts (Q10 to Q13), giveaway legality and provider approval (Q28). Please also review the default role permissions (D24).

## Required software

| Tool | Version used | Notes |
| --- | --- | --- |
| Git | 2.51 | |
| Node.js | 26.13.0 | Pinned in `.nvmrc`; any 26.x works |
| pnpm | 12.18.0 | Pinned in `package.json`; install with `npm install -g pnpm` |
| Docker Desktop | Engine 29.9, Compose 5.7 | Per-user install with WSL 2 on Windows |

Main library versions (exact pins are in the `package.json` files): Next.js 16.4, React 19.3, TypeScript 6.0, Tailwind CSS 4.3, Prisma 7.10, Better Auth 1.7, BullMQ 6.7, Zod 4.6, Nodemailer 10.5, Vitest 5.1, Playwright 1.65, ESLint 9.39.

## Required environment variables

Read by code today (validated in `packages/config/src/env.ts`):

| Variable | Purpose |
| --- | --- |
| `NODE_ENV`, `APP_URL`, `LOG_LEVEL` | Basics. `APP_URL` is used in emailed links and decides whether cookies are HTTPS-only. |
| `DATABASE_URL` | Runtime connection; must use the role `app_user` |
| `DATABASE_ADMIN_URL` | Owner connection: migrations, seeding, sign-in |
| `REDIS_URL` | Queues and rate limits |
| `AUTH_SECRET` | Signs session cookies and encrypts two-factor secrets. Changing it signs everyone out and invalidates two-factor enrolments. |
| `ENCRYPTION_KEY` | Reserved for encrypting stored OAuth tokens (Phase 6) |
| `S3_*` | Object storage |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Email. `smtp` needs host and port. |

`.env.example` works as-is for local development. Generate your own `AUTH_SECRET` and `ENCRYPTION_KEY` (command is in the file). `.env` is never committed, so each computer has its own.

**If you have an older `.env`:** copy the `DATABASE_URL`, `DATABASE_ADMIN_URL` and email lines from `.env.example`.

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

**Create yourself a sign-in** (asks for a password; `demo` is the seeded demo store):

```bash
pnpm admin:create --email you@example.com --name "Your Name" --tenant demo
```

Then run `pnpm dev` and open http://localhost:3000/admin.

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
| Create a staff user | `pnpm admin:create --email <email> --tenant <slug>` (add `--role`, `--platform-admin`; `--help` for all options) |
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

Local service addresses: PostgreSQL `localhost:5432`, Redis `localhost:6379`, storage API `localhost:9000`, email inbox http://localhost:8025 (password-reset emails arrive here).

## Checks run this session (Milestone 1.3, on the first computer)

| Check | Result |
| --- | --- |
| `pnpm healthcheck` | Pass |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Pass |
| `pnpm test` | Pass, 38 tests |
| `pnpm test:int` | Pass, 57 tests |
| Migrate, seed, drift check and integration tests on a brand-new empty database | Pass |
| `pnpm db:drift` | Pass, no difference |
| `pnpm build` | Pass |
| `pnpm test:e2e` | Pass, 18 tests (9 on desktop, 9 on mobile viewport), three runs in a row |
| `pnpm admin:create` | Tried by hand: creates a user; rejects a short password, a duplicate email and missing options |
| Sign-in page in the browser | Viewed; `/admin` redirects to it |
| `pnpm audit --audit-level high` | Pass (1 moderate advisory) |
| CI on GitHub | See the Actions tab for the latest commit |

## Recommended next task

Milestone 1.4: permission guard, request context, tenant-scoped data access and the isolation test harness. Details in NEXT_STEPS.md.

## Session log

| Date | Summary |
| --- | --- |
| 2026-11-11 | Phase 0: assessment and planning documents |
| 2026-11-11 | Milestone 1.1: scaffold, local services, checks, CI workflow; remote added |
| 2026-11-11 | Milestone 1.2: tenancy and identity schema, Row-Level Security, permissions, seed |
| 2026-11-11 | Milestone 1.3: staff sign-in, password reset, two-factor, lockout, admin-creation command |

Commit hashes: `git log --oneline`.
