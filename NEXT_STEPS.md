# Next Steps

Prioritized continuation plan. The top item is always the next thing to do. Update at the end of every session.

## Before any code (owner actions)

1. **Review the plan.** Read PROJECT_PLAN.md and the open decisions in DECISIONS.md. Answer what you can; the rest proceed on the listed assumptions.
2. **Install tools** on each development computer: Node.js (current LTS) and Docker Desktop. Git is already on the first computer. Nothing can be run or tested until Node.js is installed.
3. **Create a private remote repository** (for example on GitHub) and push this repository to it, so the home computer can clone it. Commands are in PROJECT_STATUS.md.

## Next development task: Milestone 1.1, scaffold

Scope, and nothing more:

1. pnpm workspace with `apps/web`, `apps/worker`, `packages/core`, `packages/db`, `packages/config`, `packages/ui`, `packages/testing`.
2. TypeScript strict configuration, ESLint, Prettier.
3. Next.js app with empty storefront and admin route groups and `/api/health` and `/api/ready`.
4. `docker-compose.yml` for PostgreSQL, Redis, MinIO and Mailpit.
5. Environment validation in `packages/config` matching `.env.example`.
6. Prisma initialized with an empty first migration; seed script stub.
7. Vitest and Playwright configured with one passing test each.
8. `pnpm doctor`: checks Node version, Docker, database, Redis and storage connectivity, and env variables.
9. GitHub Actions workflow: install, lint, type check, test, build, dependency audit, secret scan.
10. Pin versions in `package.json` and `.nvmrc`; record them in PROJECT_STATUS.md.

Done when: on a clean checkout, `pnpm install`, `docker compose up -d`, `pnpm doctor`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` all succeed, and the commands are documented in PROJECT_STATUS.md.

## Then, in order

| Order | Milestone | Notes |
| --- | --- | --- |
| 2 | 1.2 Tenancy, users, roles, audit schema; migrations; seed | Includes RLS policies and append-only triggers |
| 3 | 1.3 Authentication | Confirm decision D7 against current docs first |
| 4 | 1.4 Permissions, tenant context, isolation test suite | Suite must exist before any catalog code |
| 5 | 1.5 Design system and app shells | Use placeholder theme if brand assets are not ready |
| 6 | 2.1 to 2.6 Catalog and storefront | |
| 7 | 3.1 to 3.8 Checkout and operations | 3.4 needs payment provider test keys |
| 8 | Launch hardening pulled forward from Phase 10 | Backups, monitoring, security headers |

Later phases follow the order in PROJECT_PLAN.md section 4, adjusted by the owner's priorities (for example moving giveaways earlier).

## Things to start early because they take calendar time

- Meta developer app, business verification and app review (needed for Phase 6).
- TikTok developer app and audit (needed for Phase 6).
- Payment provider account approval, including the giveaway question (docs/COMPLIANCE.md section 1).
- Domain purchase and transactional email domain setup.
