# Next Steps

Prioritized continuation plan. The top item is always the next thing to do. Update at the end of every session.

## Owner actions (do not block development)

1. Check the **Actions** tab of https://github.com/Cizaro/Ecom and confirm the latest CI run is green.
2. The GitHub repository is currently **public**. Make it private in the repository settings if that is not intended.
3. Review the default role permissions (decision D24 in DECISIONS.md): who can refund, launch ads, run giveaway draws, export or delete customers.
4. Answer what you can in the open decisions table in DECISIONS.md.
5. On the home computer: install Node.js 26, pnpm and Docker Desktop, then follow "First time on a computer" in PROJECT_STATUS.md.

## Next development task: Milestone 1.3, authentication

Scope, and nothing more:

1. **Confirm the library.** Check Better Auth's current documentation for: Prisma 7 and Node 26 support, storing sessions in our Postgres, TOTP MFA, and whether its tables can live beside ours with our naming and Row-Level Security rules. If it does not fit, fall back to Auth.js or a small in-house implementation, and record the outcome in DECISIONS.md (updates D7).
2. **Staff sign-in:** email and password, Argon2id hashing, secure HTTP-only same-site session cookies, session rotation on sign-in, sign-out, sign-out everywhere.
3. **Password reset:** single-use, short-lived tokens; emails go through an `EmailProvider` interface with a console adapter and an SMTP adapter pointed at Mailpit locally.
4. **MFA (TOTP)** with recovery codes, required for owner and manager roles when enabled by the tenant.
5. **Abuse controls:** rate limits and temporary lockout on sign-in and reset (Redis-backed).
6. **Database access:** authentication reads and writes `users` through the admin connection, confined to the identity module (decision D20). New tables (sessions, verification tokens, MFA secrets) get RLS or a `GLOBAL_TABLES` entry with a reason.
7. **Pages:** sign-in, forgot password, reset password, MFA challenge, under the admin area; `/admin` redirects to sign-in when there is no session.
8. **A way to create the first owner:** `pnpm admin:create` (email, tenant; prompts for the password, never takes it as an argument). This is the "admin-user creation" deliverable.
9. **Audit log entries** for sign-in, failed sign-in, sign-out, password change, MFA changes.
10. **Tests:** hashing and token unit tests; integration tests for the flows and lockout; end-to-end sign-in, sign-out, reset (reading the email from Mailpit) on desktop and mobile; checks that session cookies have the right flags and that no secret is logged.

Done when: a seeded or newly created owner can sign in and out through the browser, all checks pass, and status files are updated.

## Then, in order

| Order | Milestone | Notes |
| --- | --- | --- |
| 2 | 1.4 Permission guard, request context, tenant-scoped client, isolation test harness | Includes a separate test database and host-to-tenant resolution |
| 3 | 1.5 Design system, app shells, Content Security Policy | Placeholder theme if brand assets are not ready |
| 4 | 2.1 to 2.6 Catalog and storefront | |
| 5 | 3.1 to 3.8 Checkout and operations | 3.4 needs payment provider test keys |
| 6 | Launch hardening pulled forward from Phase 10 | Backups, monitoring |

Later phases follow PROJECT_PLAN.md section 4, adjusted by the owner's priorities.

## Small follow-ups carried forward

- Separate test database for integration tests (with Milestone 1.4).
- Pin Docker image versions (currently `latest` for RustFS, Mailpit and the AWS CLI helper).
- Add a Dockerfile for web and worker (with launch hardening).
- Set `NEXT_TELEMETRY_DISABLED=1` for builds if the owner wants Next.js anonymous telemetry off.

## Things to start early because they take calendar time

- Meta developer app, business verification and app review (Phase 6).
- TikTok developer app and audit (Phase 6).
- Payment provider account approval, including the giveaway question (docs/COMPLIANCE.md section 1).
- Domain purchase and transactional email domain setup.
