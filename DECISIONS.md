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

### D18. Two database roles; the runtime role cannot bypass Row-Level Security (2026-11-11)
`DATABASE_URL` connects as `app_user`, which owns nothing, has no BYPASSRLS, and has explicit per-table grants. `DATABASE_ADMIN_URL` connects as the schema owner and is reserved for migrations, seeding, authentication, platform administration and cross-tenant worker jobs. The migration creates `app_user` without a password; `pnpm db:migrate` then sets its password from `DATABASE_URL`, so no credential is ever in a migration.

### D19. Tenant context is two transaction-local settings (2026-11-11)
`withTenant` opens a transaction and sets `app.tenant_id` and `app.user_id`; policies read them through `app.current_tenant_id()` and `app.current_user_id()`. Unset means no rows. Transaction-local settings cannot leak across pooled connections.

### D20. The runtime role cannot read password hashes or the platform-admin flag (2026-11-11)
Column-level grants on `users` exclude `password_hash` and `is_platform_admin`, and the runtime role may only update its own `name`. Sign-in (Milestone 1.3) therefore uses the admin connection, inside the identity module only.

### D21. Platform administrator is a user flag, not a membership (2026-11-11)
A `platform_admin` system role row exists so its permission set is visible and seeded like the others, but it is granted by `users.is_platform_admin`, never by a tenant membership.

### D22. Tables are plural snake_case; every table needs a policy or an exemption (2026-11-11)
Prisma models map to plural snake_case tables and snake_case columns. Security SQL (RLS policies, grants, triggers, partial indexes, check constraints) is hand-written in the same migration that creates a table. An integration test fails if any table has neither RLS enabled nor an entry in `GLOBAL_TABLES` (packages/db/src/tables.ts). CI also checks that the schema and the migrations have not drifted apart.

### D23. Applied migrations are never edited (2026-11-11)
Fixes go in a new migration, even for a migration written minutes earlier (see `20261111130000_append_only_error`). Local databases are not reset to paper over a change.

### D24. Default role permissions (2026-11-11)
Defined in packages/core/src/identity/permissions.ts. Notable defaults, all changeable later through custom roles: staff management, customer deletion, ad launch, giveaway draws, AI configuration and social account connection are owner-only; refunds and customer export are owner and manager; customer-service agents cannot refund; content editors cannot approve or publish. **Owner: please review these defaults.**

### D25. Better Auth confirmed for authentication (2026-11-11, closes D7)
Better Auth 1.7 supports Prisma 7 and Next.js 16 and lets us keep our own table names and UUID keys, so the decision in D7 stands. How it is used:
- Wrapped by our own `AuthService` (packages/core/src/identity). Nothing else calls the library.
- **No public auth API route.** The library's HTTP handler is not mounted; the web app calls the service from server actions only. This removes sign-up and every unused endpoint from the attack surface, and Next.js's origin check on server actions is the CSRF protection.
- Password hashing is replaced with Argon2id from Node's built-in crypto (the library's default is scrypt).
- Lockout is our own Redis-backed limiter, because the library's rate limiter only covers its HTTP handler.
- It runs on the admin database connection (D20). Its tables (`sessions`, `accounts`, `verifications`, `two_factors`) have Row-Level Security enabled with no policy and no grant, so the runtime role cannot touch them.
- Passwords now live in `accounts.password`; `users.password_hash` was dropped.
Accepted trade-offs: session tokens are stored unhashed, and a two-factor code can be reused within its 30-second window (see PROJECT_STATUS.md, known limitations).

### D26. Helper schema renamed from `app` to `app_private` (2026-11-11)
PostgreSQL's default search path starts with a schema named after the connected role. Our owner role is called `app` locally and in CI, so once a schema named `app` existed, new tables were silently created in it instead of `public`. Caught by the drift check; fixed by migration `20261111141000_rename_helper_schema`. Rule going forward: helper objects live in `app_private`, and a test asserts no table exists outside `public`. Where D19 says `app.current_tenant_id()`, read `app_private.current_tenant_id()`; the settings `app.tenant_id` and `app.user_id` are unchanged.

### D27. Staff accounts are created, not self-registered (2026-11-11)
There is no sign-up page. Staff users are created with `pnpm admin:create` today and by invitation from the admin later. The command never accepts a password as an argument.

### D28. The working tenant is stored on the session (2026-11-12)
Staff in several tenants choose one at `/admin/select-store`; the choice is saved in `sessions.active_tenant_id` after the server checks the membership. It never comes from a URL, header or form field that is trusted as is: a tenant ID in the switcher form is only a choice among the user's own memberships, and anything else gets the same not-found answer as a tenant that does not exist. Staff in exactly one tenant never see the switcher.

### D29. One access registry drives guards, tests and the isolation suite (2026-11-12)
`apps/web/src/server/route-access.ts` lists every admin page, server action and `/api/v1` route with one access level: public, session, tenant, or a single permission. A unit test fails when a route is missing or its source does not call the matching guard; the end-to-end suite visits every listed route signed out, as each tenant role and from another tenant. Missing permission answers 403 (a page via Next.js `forbidden()`, or the API error format); records in another tenant answer 404.

### D30. Platform administrators have no implicit tenant access (2026-11-12)
Tenant pages require a membership, whoever you are; tenant roles never include `platform.*` permissions. Platform pages use `requirePlatformAdmin()`. Acting inside a tenant for support is the separate, audited `platform.impersonate` feature (later).

### D31. Tests use a separate database on the same server (2026-11-12)
Integration and end-to-end tests run against `<database>_test` (locally `ecommerce_test`), created and migrated automatically by `scripts/prepare-test-db.ts`. Same server, roles and Redis as development, so nothing extra to install. The admin role must be allowed to create databases (true for the local and CI containers).

### D32. Content Security Policy with per-request nonces (2026-11-12)
Scripts run only with the request's nonce or when loaded by such a script (`'strict-dynamic'`); inline event handlers are blocked. The price is that every page renders on request (no prebuilt pages), acceptable until the catalog needs caching. Styles allow `'unsafe-inline'`, which React and Next.js need and which cannot run code.

### D33. Design tokens live in one CSS block (2026-11-12)
Colors, radius and font are Tailwind theme variables in `globals.css`; components in `packages/ui` and the app use only those names. Rebranding means editing that block.

### D34. Catalog references are kept inside one tenant by database triggers (2026-11-12)
A foreign key is checked without Row-Level Security, so on its own it would accept a product pointing at another tenant's category. Composite foreign keys `(tenant_id, id)` would prevent that, but Prisma cannot express an optional one. Instead a trigger function, `app_private.check_same_tenant()`, rejects any category parent, product category, product brand, variant product or attribute product from a different tenant. The services also check first and answer exactly as for a record that does not exist.

### D35. Products are archived, never deleted; variants can be deleted (2026-11-12)
A product has three states: draft, published (`active`) and archived. There is no delete, so order history can always point at it. A variant can be deleted until orders reference it (Phase 3 adds that restriction). A published product must keep at least one variant that is for sale: publishing without one, and removing or switching off the last one, are refused.

### D36. One currency per store; prices live on variants (2026-11-12)
New variants are priced in the store's default currency; the currency is stored on each variant so a later multi-currency design does not need a migration. Amounts are integers in minor units (D6) in a 32-bit column, which allows up to 21,474,836.47 in a two-decimal currency. Text typed by staff is parsed without floating-point arithmetic.

### D37. Sale and compare-at prices are constrained in the database (2026-11-12)
A sale price must be lower than the price, and a compare-at ("was") price higher. Both rules are check constraints as well as form validation. This cannot prove a compare-at price was really charged before, so the form says so; a price-history record that can prove it is planned with promotions (Milestone 3.8).

### D38. Product images are public files with unguessable addresses (2026-11-12)
Images are served straight from object storage (or a CDN in front of it), not through the app. Only keys under `public/` are readable without credentials; the bucket cannot be listed. Every key is `public/<tenant id>/<32 random hex characters>/<file>`, so one address does not reveal another, and a database check constraint keeps each tenant's rows inside its own prefix. Consequence: the images of a draft product are reachable by anyone who has the exact address. Private files (invoices, exports) will go outside `public/` and be served through signed, expiring links.

### D39. Uploads are re-encoded before they are stored (2026-11-12)
The file type is decided from the file's first bytes (JPEG, PNG or WebP only; no SVG, GIF or anything executable), then the image is decoded and written out again: turned upright, scaled to 2560 pixels at most, with all embedded metadata (location, camera) dropped. Pictures with transparency stay PNG; the rest become JPEG. The original bytes are never stored. Limits: 8 MB per file, 50 megapixels, 20 images per product.

### D40. Resized versions are made in the background; the status row is the source of truth (2026-11-12)
The upload request stores the cleaned image and returns; a worker job makes WebP versions 320, 640 and 1280 pixels wide. Pages use the cleaned image until those exist. If the queue is unreachable the upload still succeeds: a sweep every minute queues any asset still marked `processing` after two minutes. After four failed attempts the asset is marked `failed` and keeps using the full-size image.

### D41. The first image is the main image (2026-11-12)
There is no separate "main" flag that could disagree with the order. "Make main" moves an image to the front. An image can be tied to one variant of the same product (enforced by a database trigger), for showing the right picture when a colour is chosen.

### D42. Search uses PostgreSQL full-text with the language-neutral configuration (2026-11-13)
Each product has a `search_vector` column kept current by a database trigger: name (highest weight), short description, material and audience tags, long description. It uses PostgreSQL's `simple` configuration, which splits text into lowercase words without language-specific stemming, so it behaves the same whatever language a store writes in (English stemming would mishandle Arabic, for example). To make up for no stemming, every typed word matches as a word beginning ("tot" finds "tote") and all words must match. SKUs and brand names are also matched from their start. The query is built only from letters and digits, so nothing a shopper types is interpreted as a search operator. A dedicated search service can replace this behind the same function later.

### D43. What shoppers can read (2026-11-13)
Shopper-facing reads need no sign-in. They are protected by two things together: the tenant comes only from the host name (Row-Level Security then limits every query to that store), and every public query asks only for products that are published and have at least one variant for sale. These reads live in one file (`packages/core/src/catalog/public.ts`) that never selects cost prices. A draft, archived or unsellable product answers "not found" by its address.

### D44. The struck-through price is the variant's own regular price (2026-11-13)
When a variant has a sale price, the storefront shows the sale price with the regular price struck through and a "Sale" label. Both are the store's current prices for that variant. The separate compare-at ("was") price is not shown to shoppers until a price history can back it (decision D37, Milestone 3.8). "Best seller" is shown only where staff ticked the box; no sales claim is computed or invented.

### D45. Filters live in the page address (2026-11-13)
Sort, filters, search words and page number are query parameters, submitted by a plain form, so lists work without JavaScript and can be shared and bookmarked. Unknown or malformed parameters are dropped. Blank parameters from an empty form field are removed by a redirect so one list has one address. Filter options are counted over the whole list, not the filtered one, so choosing one brand does not hide the others.

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
