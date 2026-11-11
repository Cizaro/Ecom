# Next Steps

Prioritized continuation plan. The top item is always the next thing to do. Update at the end of every session.

## Owner actions (do not block development)

1. **Try signing in.** Create yourself a user with `pnpm admin:create --email you@example.com --name "Your Name" --tenant demo`, run `pnpm dev`, open http://localhost:3000/admin. Password-reset emails arrive at http://localhost:8025.
2. The GitHub repository is currently **public**. Make it private in the repository settings if that is not intended.
3. Review the default role permissions (decision D24 in DECISIONS.md): who can refund, launch ads, run giveaway draws, export or delete customers.
4. Answer what you can in the open decisions table in DECISIONS.md.
5. On the home computer: install Node.js 26, pnpm and Docker Desktop, then follow "First time on a computer" in PROJECT_STATUS.md.

## Next development task: Milestone 1.4, permissions and tenant-scoped access

This is the milestone that makes roles mean something. Scope, and nothing more:

1. **Request context.** One function that turns a request into `{ userId, tenantId, storeId?, roleKey, permissions, requestId }`, or refuses. The active tenant comes from the user's memberships (a tenant switcher when there is more than one), stored on the session, never from client input.
2. **Permission guard.** `requirePermission("orders.refund")` for pages, server actions and API routes. Platform administrators are handled explicitly. A lint rule or test that fails when an admin route or action has no guard.
3. **Tenant-scoped data client.** Domain services receive a database handle already bound to the context's tenant (wrapping `withTenant`), so service code cannot forget it. Restrict the admin client to the identity and platform modules by lint rule.
4. **Audit helper.** One `audit(context, action, entity, before, after)` used by every sensitive action, replacing the ad-hoc writes in the auth service.
5. **Two-factor enforcement.** Tenant setting "require two-factor for owners and managers"; users in those roles without it are sent to set it up.
6. **Host-to-tenant resolution for the storefront** (store domains table and a safe lookup that works before a tenant context exists).
7. **Separate test database** for integration and end-to-end tests, so they stop writing to the development database.
8. **Isolation test harness.** Two tenants, one user per role. For every admin route and action: wrong tenant gets not-found, missing permission gets forbidden, no session gets redirected. New routes without an entry fail CI.
9. **API foundation:** `/api/v1` route helper with the error format, request IDs and validation from docs/API_SPECIFICATION.md, plus one real endpoint (`GET /api/v1/admin/me`) to prove it.

Done when: a marketer and a store owner signed in to the same tenant see different things on a demonstration page, a user from another tenant sees nothing, all checks pass, and status files are updated.

## Then, in order

| Order | Milestone | Notes |
| --- | --- | --- |
| 2 | 1.5 Design system, app shells, Content Security Policy | Includes QR code for two-factor setup and keeping form values after an error. Placeholder theme if brand assets are not ready. |
| 3 | 2.1 to 2.6 Catalog and storefront | First visible store content |
| 4 | 3.1 to 3.8 Checkout and operations | 3.4 needs payment provider test keys |
| 5 | Launch hardening pulled forward from Phase 10 | Backups, monitoring, proxy configuration for client addresses |

Later phases follow PROJECT_PLAN.md section 4, adjusted by the owner's priorities.

## Small follow-ups carried forward

- Staff invitation and management screens (with settings, Milestone 3.7 at the latest).
- Scheduled cleanup of expired sessions and verification tokens (worker job).
- Email notification when a password is changed or two-factor is switched off.
- Pin Docker image versions (currently `latest` for RustFS, Mailpit and the AWS CLI helper).
- Add a Dockerfile for web and worker (with launch hardening).
- Set `NEXT_TELEMETRY_DISABLED=1` for builds if the owner wants Next.js anonymous telemetry off.

## Things to start early because they take calendar time

- Meta developer app, business verification and app review (Phase 6).
- TikTok developer app and audit (Phase 6).
- Payment provider account approval, including the giveaway question (docs/COMPLIANCE.md section 1).
- Domain purchase and transactional email domain setup (a real email provider is needed before launch).
