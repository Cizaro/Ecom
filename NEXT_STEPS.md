# Next Steps

Prioritized continuation plan. The top item is always the next thing to do. Update at the end of every session.

## Owner actions (do not block development)

1. Check the **Actions** tab of https://github.com/Cizaro/Ecom after the latest push and confirm the CI run is green. It has not been observed running yet.
2. Confirm the GitHub repository is **private**.
3. Answer what you can in the open decisions table in DECISIONS.md.
4. On the home computer: install Node.js 26, pnpm and Docker Desktop, then follow "First time on a computer" in PROJECT_STATUS.md.

## Next development task: Milestone 1.2, tenancy and identity schema

Scope, and nothing more:

1. Prisma models: `Tenant`, `Store`, `User`, `Role`, `Permission`, `RolePermission`, `UserTenantMembership`, `AuditLog`, `ConsentRecord`, `NotificationPreference`, plus the platform tables needed from the start (`FeatureFlag`, `IdempotencyKey`, `OutboxEvent`, `Job`). Design reference: docs/DATA_MODEL.md sections 1 and 7.
2. Migration, including hand-written SQL for:
   - Row-Level Security policies on every tenant-owned table, keyed on a transaction-local `app.tenant_id` setting.
   - A separate, non-owner database role for the application so RLS cannot be bypassed.
   - Append-only trigger on `AuditLog`.
3. The permission catalogue (`module.action` keys) and the seven seeded system roles with their permission sets, defined in code and written by the seed script.
4. Seed: system roles and permissions, one demo tenant and store, one owner user (no usable password until Milestone 1.3).
5. Tests (integration, against the real database):
   - RLS: with tenant A set, rows of tenant B are invisible and cannot be inserted, updated or deleted.
   - With no tenant set, tenant-owned tables return nothing.
   - `AuditLog` rejects update and delete.
   - Seed is idempotent (running it twice changes nothing).
6. Update docs/DATA_MODEL.md where the implementation differs from the design; update ARCHITECTURE.md if the RLS mechanism changes.

Done when: `pnpm db:migrate`, `pnpm db:seed`, lint, type check, unit tests, integration tests, build and end-to-end tests all pass, and status files are updated.

## Then, in order

| Order | Milestone | Notes |
| --- | --- | --- |
| 2 | 1.3 Authentication | Confirm decision D7 (Better Auth) against current documentation and Node 26 first |
| 3 | 1.4 Permissions, tenant context, tenant-scoped client, isolation test suite | Suite must exist before any catalog code |
| 4 | 1.5 Design system, app shells, Content Security Policy | Placeholder theme if brand assets are not ready |
| 5 | 2.1 to 2.6 Catalog and storefront | |
| 6 | 3.1 to 3.8 Checkout and operations | 3.4 needs payment provider test keys |
| 7 | Launch hardening pulled forward from Phase 10 | Backups, monitoring |

Later phases follow PROJECT_PLAN.md section 4, adjusted by the owner's priorities.

## Small follow-ups carried forward

- Pin Docker image versions (currently `latest` for RustFS, Mailpit and the AWS CLI helper) once the set of services settles.
- Add a Dockerfile for web and worker (needed for staging; planned with launch hardening).
- Set `NEXT_TELEMETRY_DISABLED=1` for builds if the owner wants Next.js anonymous telemetry off.

## Things to start early because they take calendar time

- Meta developer app, business verification and app review (Phase 6).
- TikTok developer app and audit (Phase 6).
- Payment provider account approval, including the giveaway question (docs/COMPLIANCE.md section 1).
- Domain purchase and transactional email domain setup.
