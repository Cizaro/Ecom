# Project Status

Last updated: 2026-11-12

## Current phase

**Phase 2 (storefront and catalog): Milestones 2.1 to 2.4 complete.** Phase 1 (foundation, Milestones 1.1 to 1.5) is complete. Next: Milestone 2.5 (cart).

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
- **Milestone 1.4, permissions and tenant-scoped access:**
  - Request context (user, tenant, store, role, permissions, request ID) built on the server from the session. The working tenant is stored on the session after a membership check; a tenant switcher at `/admin/select-store` appears for staff in more than one store.
  - Guards `requireSession()`, `requireTenantContext()`, `requirePermission("…")` and `requirePlatformAdmin()`. Missing permission shows a 403 page. Platform administrators get no implicit access to tenant data.
  - Access registry (`apps/web/src/server/route-access.ts`): every admin page, server action and API route is listed with its access rule. A unit test fails if one is missing or does not call the matching guard.
  - Tenant-bound database handle (`TenantDb`) for domain services; a lint rule keeps the admin connection inside the identity and platform modules.
  - One audit helper used by authentication and by tenant actions (with request ID and client address).
  - Tenant setting "require two-factor for owners and managers": those users are sent to set it up and cannot turn it off.
  - Store domains table and a safe host-to-store lookup for the storefront (not wired to pages yet).
  - Separate test database (`ecommerce_test`), created and migrated automatically before integration and end-to-end tests.
  - Isolation suite: every admin page and API route visited signed out, as each of the 6 tenant roles, and from another tenant.
  - `/api/v1` foundation: error format, request IDs on every response, Zod validation, and `GET /api/v1/admin/me`.
  - Demonstration pages: `/admin/access` (what your role allows) and `/admin/team` (staff list, needs `staff.manage`).
- **Milestone 1.5, design system and shells:**
  - Design tokens (colors, radius, font) in `apps/web/src/app/globals.css`, placeholder theme until brand assets arrive; components use token names only.
  - Shared components in `packages/ui`: Button, Field, Alert, Badge, Card, List, PageHeader, EmptyState. Admin pages rebuilt on them.
  - Admin shell: navigation generated from the access registry (a link appears only if the page would open), store switcher, skip link, works on phones.
  - Storefront shell (header, footer) that finds its store from the host name; unknown hosts get the 404 page. The demo store answers at `localhost`.
  - Content Security Policy with a fresh nonce per request; injected inline handlers are blocked (tested in the browser).
  - Error page (with a support reference) and 404 page.
  - QR code for two-factor setup (generated on the server); the sign-in email is kept after a failed attempt.

- **Milestone 2.1, catalog:**
  - Tables for categories (a tree), brands, products, variants and product specifications, each limited to its own tenant by Row-Level Security, with database rules for URL names, SKUs, prices and same-tenant references.
  - Catalog services in `packages/core/src/catalog`: every function checks the permission (`catalog.read` or `catalog.write`), runs inside the tenant, and writes an audit-log entry for each change.
  - Admin pages: Products (search by name or SKU, filter by status, paging), add product, product page (status, variants, details), add and edit variant, Categories, Brands.
  - Product states: draft, published, archived. Publishing needs at least one variant that is for sale; a published product cannot lose its last one.
  - Prices typed as plain amounts (`49.90`), stored as whole minor units in the store's currency; sale price and compare-at price validated.
  - Roles with only `catalog.read` (marketer, customer service) see the catalog with the forms locked; pages that only make sense for editing answer 403.
  - Form components added to the design system: text area, drop-down, checkbox, and a confirm-before-delete form.
  - `pnpm db:seed` adds five launch categories and two sample products to the demo store when it has no categories.

**What a signed-in user can do today:** choose which store to work in; build the catalog (categories, brands, products with variants, prices and images; publish, unpublish, archive); see what their role allows; see the team (owners); manage two-factor; sign out. **What a visitor can do today** at http://localhost:3000: see the home page (categories, featured, new arrivals), open a category, sort and filter by brand, colour and price, search, and open a product page where choosing a colour and size changes the price and pictures. There is no cart or checkout yet. There are no stock levels, orders or dashboard yet.

- **Milestone 2.2, product media:**
  - Tables `media_assets` and `product_images`, a category image and a brand logo, each limited to its own tenant by Row-Level Security, same-tenant triggers and a rule that a file's key sits under its tenant's prefix.
  - Storage behind a `StorageProvider` interface with an S3-compatible adapter (RustFS locally) and an in-memory one for tests. Only files under `public/` can be read without credentials; the bucket cannot be listed.
  - Uploads accept JPEG, PNG and WebP up to 8 MB, judged by content, not name. Every image is re-encoded: turned upright, scaled to 2560 pixels at most, location and camera data removed.
  - The worker makes WebP versions 320, 640 and 1280 pixels wide. A sweep every minute picks up anything the queue missed.
  - Product page: upload several images at once (sent one at a time), description (alt text) per image, "Make main", move earlier or later, tie to a variant, remove. Up to 20 per product. Read-only roles see the images without controls.
  - Category and brand pages: upload, replace and remove one image or logo.
  - The product list shows each product's main image.
  - The Content Security Policy allows images from the storage address only.

- **Milestone 2.3, storefront listing:**
  - Shopper-facing catalog reads in one file (`packages/core/src/catalog/public.ts`): only published products with something for sale, in the store found from the host name; cost prices are never selected.
  - Search: a `search_vector` column kept current by a database trigger; typed words match word beginnings; SKU and brand name also match. Anything typed is treated as plain words.
  - Pages: home (`/`), category (`/c/<url-name>`, including its sub-categories), all products (`/products`), search (`/search?q=`), and a first product page (`/p/<url-name>`).
  - Sort (newest, price up or down, name, best match), filters (brand, colour, price range) and paging, all in the page address and working without JavaScript.
  - Product cards use the resized images, show a sale price beside the regular price, and never show a draft.
  - Header with search and category navigation; breadcrumbs.
  - `pnpm demo:catalog` adds ten labelled sample products with generated pictures to the demo store (development only).

- **Milestone 2.4, product page:**
  - Choosing colour and size through links in the page address; price, SKU and pictures follow the chosen variant; sizes a colour is not made in are shown as unavailable.
  - Gallery: swipe or scroll through pictures, thumbnails, keyboard reachable; the chosen variant's pictures come first.
  - "More from <category>" (other products for sale in the same category tree) and "Recently viewed" (from a cookie of product URL names, re-read from the catalog each time).
  - Share button (the device's share sheet, or copy link).
  - For search engines and link previews: canonical address, Open Graph tags, and schema.org Product and Breadcrumb data with the real price range; no stock, rating or review claims.
  - Selection rules as plain logic in `packages/core`, ready for the cart.

## In progress

Nothing.

## Not started

Phase 2 onward (PROJECT_PLAN.md section 4). No integration with payments, AI, Meta, Instagram, Facebook, TikTok or shipping has been implemented or tested. Email is implemented for SMTP only and tested against the local Mailpit inbox, not a real email provider.

## Known limitations of what is built

- **Products have no stock levels** (Milestone 3.2), so the storefront says nothing about availability yet.
- **No add to cart yet** (Milestone 2.5). The product page deliberately has no buy button and says nothing about stock or delivery (decision D48).
- **"Recently viewed" sets a preference cookie without asking**, because there is no consent banner yet (decision D49). Must be gated before launch in regions that require consent.
- **Gallery has no zoom and no previous/next buttons**; thumbnails, swipe and arrow keys work.
- **Search has no stemming or typo tolerance** ("bags" does not find "bag" unless typed as "bag"; word beginnings do match). Decision D42.
- **Home page sections are fixed** (Featured, New arrivals, Best sellers from the product flags); there is no screen to arrange them.
- **Storefront text is English only**; languages are an open decision.
- **Images of a draft product are reachable by anyone who has the exact address** (a 32-character random part makes it unguessable; decision D38).
- **Resized image versions need the worker running** (`pnpm dev` starts it). Without it, pages use the full-size cleaned image.
- **Image ordering uses buttons, not drag and drop; no cropping.** Video is not supported yet.
- **If storage is unreachable while an image is removed, its files stay in storage** (the image is still removed from the product and the event is logged). A cleanup job is a follow-up.
- **A compare-at ("was") price is not verified.** The form asks for a price the item was really sold at; nothing checks it yet (decision D37).
- **Catalog has no bulk import or export, and no API endpoints.** Products are entered one at a time in the admin.
- **Product names written without Latin letters need a URL name typed by hand** (for example a name only in Arabic); the form says so.
- **Store-level restrictions are not enforced.** A membership can list specific stores (`store_ids`), but every tenant has one store today and the context uses the first one. Store selection comes with multi-store support.
- **Host lookup trusts the Host header.** Behind a proxy that rewrites it, the deployment must pass the original host through (same requirement as the client address).
- **Every page renders on request** (needed for the per-request nonce). Fine at this size; revisit caching with the catalog.
- **Placeholder theme.** Colors and font are stand-ins until the brand assets arrive.
- **No screen to turn on "require two-factor".** The tenant setting exists and is enforced; it is changed in the database until store settings exist (Milestone 3.7).
- **Session tokens are stored unhashed** in the `sessions` table (how the Better Auth library works). The table is unreadable by the runtime database role; someone with owner-level database access could hijack live sessions. Recorded in the threat model.
- **A two-factor code can be reused within its 30-second window** (library behaviour). An attacker would need the password and a code observed in that window.
- **Client address for rate limits comes from `X-Forwarded-For`.** This is only trustworthy behind a proxy that overwrites the header; the deployment guide must require one.
- **Staff users can only be created from the command line.** Inviting staff from the admin is part of settings (later).
- **The test database shares the server, roles, Redis and storage bucket with development.** Rate-limit counters from tests can land in the development Redis; tests clear their own keys. Image jobs queued by the browser tests reach a running development worker, which logs them as `missing` and moves on. Test files stay under the test tenants' own prefixes.

## Known issues

- **Browser tests run four at a time locally.** All tests share one web server process; with more browsers than that it falls behind and tests time out (seen on a 20-core computer). Set in `playwright.config.ts`; CI keeps its default.
- **Database driver warning in the logs:** `DeprecationWarning: Calling client.query() when the client is already executing a query`. It comes from inside the Prisma library when one request loads related rows in a transaction; nothing is wrong today, but it must be rechecked before upgrading the `pg` driver to version 9.
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
| Integration tests (need services running; use the separate `ecommerce_test` database, created automatically) | `pnpm test:int` |
| Create or migrate the test database by hand | `pnpm db:test:prepare` |
| Production build | `pnpm build` |
| End-to-end tests (need build and services) | `pnpm test:e2e` |
| Install the browser for end-to-end tests (once per computer) | `pnpm exec playwright install chromium` |
| Create a migration after a schema change | `pnpm db:migrate:dev` |
| Seed data (safe to repeat) | `pnpm db:seed` |
| Check schema and migrations agree | `pnpm db:drift` |
| Add sample products to the demo store | `pnpm demo:catalog` |
| Stop services | `docker compose down` |
| Stop services and delete local data | `docker compose down -v` |

After pulling Milestone 2.2 on a computer that already has the services running, run `docker compose up -d --wait` once more: it applies the rule that makes uploaded images viewable.

Local service addresses: PostgreSQL `localhost:5432`, Redis `localhost:6379`, storage API `localhost:9000`, email inbox http://localhost:8025 (password-reset emails arrive here).

## Checks run this session (Milestone 2.4, on the first computer)

| Check | Result |
| --- | --- |
| `pnpm healthcheck` | Pass |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Pass |
| `pnpm test` | Pass, 152 tests (18 new: variant selection, recently viewed cookie, structured data) |
| `pnpm test:int` | Pass, 140 tests, on the separate test database |
| `pnpm db:drift` | Pass, no difference |
| `pnpm build` | Pass |
| `pnpm test:e2e` | Pass, 61 tests, three full runs in a row (25 mobile duplicates of the isolation matrix skipped) |
| `pnpm audit --audit-level high` | Pass (1 moderate advisory, unchanged) |
| Looked at in a browser | Product page: variant choice, gallery, related and recently viewed, at phone width without sideways scrolling |
| CI on GitHub | Milestone 2.3 commit passed; see the Actions tab for the Milestone 2.4 commit |

## Recommended next task

Milestone 2.5: cart. Details in NEXT_STEPS.md.

## Session log

| Date | Summary |
| --- | --- |
| 2026-11-11 | Phase 0: assessment and planning documents |
| 2026-11-11 | Milestone 1.1: scaffold, local services, checks, CI workflow; remote added |
| 2026-11-11 | Milestone 1.2: tenancy and identity schema, Row-Level Security, permissions, seed |
| 2026-11-11 | Milestone 1.3: staff sign-in, password reset, two-factor, lockout, admin-creation command |
| 2026-11-12 | Set up the home computer (project moved out of OneDrive to `C:\dev\Ecom`) |
| 2026-11-12 | Milestone 1.4: request context, permission guards, tenant-bound data access, audit helper, two-factor rule, host lookup, test database, isolation suite, `/api/v1` foundation |
| 2026-11-12 | CI: dropped `playwright install-deps` (stalled on Ubuntu mirrors) |
| 2026-11-12 | Milestone 1.5: design tokens, shared components, admin and storefront shells, Content Security Policy, QR code, error pages |
| 2026-11-12 | Milestone 2.1: catalog tables, services, admin pages for products, variants, categories and brands, demo catalog seed |
| 2026-11-12 | Milestone 2.2: media tables, storage provider, cleaned and resized image uploads, product images with ordering, category image, brand logo |
| 2026-11-13 | Milestone 2.3: public catalog reads, search, home, category, all-products and search pages with sort, filters and paging, first product page, sample catalog command |
| 2026-11-13 | Milestone 2.4: product page with variant choice in the address, gallery, related and recently viewed products, share, structured data |

Commit hashes: `git log --oneline`.
