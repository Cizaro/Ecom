# Project Status

Last updated: 2026-11-11

## Current phase

**Phase 0 (discovery and planning): complete, awaiting owner review.** Next: Phase 1, Milestone 1.1 (scaffold).

## Completed

- Repository assessment (no existing ecommerce code; greenfield).
- Planning documents: PROJECT_PLAN.md, ARCHITECTURE.md, DECISIONS.md, docs/DATA_MODEL.md, docs/API_SPECIFICATION.md, docs/SECURITY_THREAT_MODEL.md, docs/COMPLIANCE.md.
- `.env.example` (placeholders only), `.gitignore`, README.
- Git repository initialized with the first commit.

## In progress

Nothing.

## Not started

All application code. Every feature in Phases 1 to 10 (see PROJECT_PLAN.md section 4). No integration (payments, email, AI, Meta, Instagram, Facebook, TikTok, shipping) has been implemented or tested.

## Known bugs

None (no code yet).

## Known issues with the environment

- First computer (Windows 11): Node.js, pnpm, Docker, PostgreSQL and Redis are not installed. Only Git is available.
- No Git remote is configured. The repository exists only on the first computer until one is added.

## Open technical decisions

See the "Open decisions for the owner" table in DECISIONS.md. The ones that block specific work: payment provider (Q4), AI provider (Q15), social accounts (Q10 to Q13), Git remote (Q27), giveaway legality and provider approval (Q28).

## Required software

| Tool | Version | Status on first computer |
| --- | --- | --- |
| Git | 2.40 or later | Installed (2.51) |
| Node.js | Current LTS (exact version pinned in `.nvmrc` at Milestone 1.1) | Not installed |
| pnpm | Pinned via `packageManager` in `package.json` at Milestone 1.1 | Not installed |
| Docker Desktop | Recent | Not installed |

PostgreSQL, Redis, MinIO (storage) and Mailpit (email capture) will run in Docker; no separate installs.

## Required environment variables

Full list with placeholders: `.env.example`. None are needed yet. Phase 1 needs: `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `APP_URL`.

## Required external accounts and API keys

None needed yet. Upcoming, by phase: see PROJECT_PLAN.md section 5.

## Commands

**Today (documentation only):**

```bash
git log --oneline
```

```bash
git status
```

**Moving the repository to another computer.** Create an empty private repository on a Git host, then on the first computer:

```bash
git remote add origin <repository-url>
```

```bash
git push -u origin main
```

On the other computer:

```bash
git clone <repository-url>
```

**After Milestone 1.1 exists** (not available yet; listed so the target is clear):

| Purpose | Command |
| --- | --- |
| Install dependencies | `pnpm install` |
| Start local services | `docker compose up -d` |
| Check the environment | `pnpm doctor` |
| Apply migrations | `pnpm db:migrate` |
| Seed data | `pnpm db:seed` |
| Start web and worker | `pnpm dev` |
| Lint | `pnpm lint` |
| Type check | `pnpm typecheck` |
| Unit and integration tests | `pnpm test` |
| End-to-end tests | `pnpm test:e2e` |
| Production build | `pnpm build` |

## Checks run this session

Lint, type check, tests and build: not applicable, there is no code. Verified by hand: `.env.example` contains placeholders only; no secrets in the repository.

## Recommended next task

Owner: review the plan, install Node.js and Docker Desktop, create a private remote and push. Then start Milestone 1.1 as described in NEXT_STEPS.md.

## Session log

| Date | Summary | Commit |
| --- | --- | --- |
| 2026-11-11 | Phase 0: assessment and planning documents | See `git log` (first commit) |
