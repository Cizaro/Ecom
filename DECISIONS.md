# Decisions

Important technical and product decisions, newest last. Each entry: what was decided, why, and what would change it. Open questions for the owner are at the end.

## Decided

### D1. New repository, separate from existing folder content (2026-11-11)
The working folder held only an unrelated project. This platform lives in its own folder and Git repository, `ecommerce-platform`. The other project was not modified.

### D2. Modular monolith (2026-11-11)
One codebase, a web process and a worker process, domain modules with explicit interfaces. Chosen because one developer is building it, the domains share transactions (stock, orders, payments), and module boundaries keep later extraction possible. Would change if a module needs independent scaling or a different runtime.

### D3. TypeScript, Next.js App Router, PostgreSQL, Prisma, BullMQ, S3-compatible storage (2026-11-11)
No existing stack to preserve, so the recommended stack is adopted. One language across storefront, admin, API and worker; server rendering for SEO and speed. Would change only for a strong reason found during scaffolding.

### D4. Tenant isolation in three layers from the first migration (2026-11-11)
Guard and permission check, tenant-scoped data client, and PostgreSQL Row-Level Security, plus an automated two-tenant test suite. Retrofitting isolation later is the most expensive and riskiest kind of change, and the product is intended to become SaaS.

### D5. Staff users and shoppers are separate models (2026-11-11)
`User` (staff, with tenant memberships and roles) and `Customer` (shopper, per tenant). Keeps permission logic simple and lets one person shop at several tenants' stores without shared identity.

### D6. Money as integer minor units with a currency code (2026-11-11)
Avoids rounding errors. Multi-currency ready.

### D7. Better Auth for authentication (2026-11-11, to confirm in Milestone 1.3)
Email and password, OAuth, TOTP MFA and session storage in the project's own Postgres, with no external auth service. To confirm against current documentation when implemented; the fallback is Auth.js. Authorization (roles, permissions, tenant membership) is the project's own code either way.

### D8. Every external provider behind an interface with a mock (2026-11-11)
Payment, shipping, tax, email, storage, search, AI, image processing, social, ads. Development and automated tests never depend on real accounts, and owner decisions about providers do not block progress.

### D9. AI only through a central gateway; facts only from the database (2026-11-11)
See ARCHITECTURE.md section 8. Default automation level is human approval.

### D10. Giveaway module built as a normal configurable feature (2026-11-11)
Per the owner's instruction there is no mandatory legal-review gate in the product. The legal and payment-provider risks are documented in docs/COMPLIANCE.md section 1 and remain the owner's responsibility. The admin shows a non-blocking reminder.

### D11. Cursor pagination, `/api/v1`, Zod as the single schema source (2026-11-11)
The same schemas validate requests, type the client, generate OpenAPI and validate AI output.

### D12. Documentation layout (2026-11-11)
Root: README, PROJECT_STATUS, NEXT_STEPS, DECISIONS, ARCHITECTURE, PROJECT_PLAN. `docs/`: DATA_MODEL, API_SPECIFICATION, SECURITY_THREAT_MODEL, COMPLIANCE. Diagrams in Mermaid.

### D13. RustFS for local S3-compatible storage (2026-11-11)
The MinIO images named in the plan can no longer be pulled from Docker Hub or Quay. RustFS is used locally instead; a one-shot AWS CLI container creates the bucket. The application only speaks the S3 API, so production can use any S3-compatible service.

### D14. Tool versions chosen at scaffold (2026-11-11)
- TypeScript 6.0, not 7.0: typescript-eslint 8.72 supports TypeScript below 6.1 only. Move to 7 when the linter supports it.
- ESLint 9, not 10: chosen for plugin compatibility; revisit with the next dependency update.
- Node.js 26 (installed by the owner). Prisma 7.10 warns that it is not a listed supported version but works; Node 24 is the fallback.
- Workspace packages are consumed as TypeScript source (no per-package build step); the worker runs through tsx.

### D15. Environment health check is `pnpm healthcheck` (2026-11-11)
`pnpm doctor` is a built-in pnpm command, so the project's check has a different name.

### D16. `.env.example` carries working local-only defaults (2026-11-11)
Database, Redis and storage values in `.env.example` match `docker-compose.yml` so a clean checkout works after copying the file. They are bound to localhost and are not secrets. Real secrets stay as `CHANGE_ME` placeholders, and the app refuses to start in production while one remains.

### D17. Single `.env` at the repository root (2026-11-11)
Web, worker, Prisma, tests and the health check all load the root `.env`. Only `packages/config` reads `process.env` in application code; a lint rule enforces this.

## Open decisions for the owner

Until answered, the assumption shown is used and kept configurable. Items marked **blocking** stop a specific milestone; nothing else waits.

| # | Question | Assumption in use | Blocks |
| --- | --- | --- | --- |
| Q1 | Which country or countries does the store operate in? | Unspecified; tax and policies configurable | Tax setup, giveaway legality, 3.4 |
| Q2 | Currency? | USD | |
| Q3 | Languages? | English, with multi-language and right-to-left support built in | |
| Q4 | Payment provider? | Mock, then Stripe test mode | **3.4** |
| Q5 | Countries served? | Same as operating country | Shipping zones |
| Q6 | Shipping method? | Flat rate by zone, manual tracking numbers | 3.5 |
| Q7 | Inventory owned, wholesale or dropshipped? | Owned, one location | 3.2 design detail |
| Q8 | Domain? | localhost | Launch |
| Q9 | Logo, colors, brand assets? | Neutral placeholder theme | 1.5 polish |
| Q10 | Instagram account? | None connected | **6.3** |
| Q11 | Facebook Page? | None connected | **6.3** |
| Q12 | TikTok account? | None connected | **6.5** |
| Q13 | Meta Business account? | None | **6.3, 7.3** |
| Q14 | One store or several at first? | One store on multi-tenant model | |
| Q15 | AI provider? | Mock; Anthropic and OpenAI-compatible adapters planned | **5.x with real output** |
| Q16 | Monthly AI budget? | 50 USD cap | |
| Q17 | Must AI replies always be approved? | Yes | |
| Q18 | Launch categories? | All five named categories | |
| Q19 | Expected number of products? | Under 500 | |
| Q20 | Launch date? | None set | Prioritization |
| Q21 | Customer payment methods? | Cards via provider | 3.4 |
| Q22 | Return and refund rules? | 14-day returns, unused items, refund to original method (placeholder text) | Policy pages |
| Q23 | Giveaway price and prize structure? | 1 USD per entry, single prize | 8.1 |
| Q24 | Maximum giveaway entries per customer? | 10 | 8.1 |
| Q25 | Customer notifications? | Order confirmation, shipped, delivered, refund, account, giveaway receipt and result, by email | 3.6 |
| Q26 | Minimum features for first launch? | Phases 1 to 3 | Prioritization |
| Q27 | Where will the Git remote live? | **Answered 2026-11-11:** https://github.com/Cizaro/Ecom | |
| Q28 | Has paid-draw legality been confirmed for the target countries, and will the payment provider allow it? | Not confirmed | Real entry payments in Phase 8 |
| Q29 | Hosting preference? | Any Docker-capable host | Phase 10 |
