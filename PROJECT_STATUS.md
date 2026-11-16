# Project Status

Last updated: 2026-11-12

## Current phase

**Phase 3 (checkout and operations): Milestones 3.1 to 3.3 and 3.5 to 3.8 complete, plus cash on delivery.** Phases 1 and 2 are complete. Bulk product import from a spreadsheet is built too. **Phase 4 (reviews, UGC, CRM): Milestone 4.1 (reviews) complete.** Next: 4.2 or launch readiness, to agree with the owner. The card gateway (3.4) still waits on a merchant account. The card gateway (3.4) waits on a Lebanese merchant account (areeba or NetCommerce); Stripe is not available in Lebanon.

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

**What a signed-in user can do today:** choose which store to work in; build the catalog (categories, brands, products with variants, prices and images; publish, unpublish, archive); see what their role allows; see the team (owners); manage two-factor; sign out. **What a visitor can do today** at http://localhost:3000: see the home page (categories, featured, new arrivals), open a category, sort and filter by brand, colour and price, search, and open a product page where choosing a colour and size changes the price and pictures, add it to a cart, and change or remove cart lines; create an account (confirmed by email), sign in and out, reset a forgotten password, keep a profile and saved addresses, and have the cart follow them between devices. Product pages say whether an item is in stock, nearly gone or sold out, and the cart never holds more than there is. They can check out as a guest or signed in and pay with the test payment provider (no real money), see their order, and find it in their account. Staff see orders and mark them sent with courier and tracking, and set delivery areas and tax. Staff see a dashboard, filter and export orders, and record returns and refunds. There is no real card payment provider yet.

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

- **Milestone 2.5, cart:**
  - Tables `carts` and `cart_items`, limited to their tenant by Row-Level Security and same-tenant triggers.
  - A guest cart opened by a random token in an HttpOnly cookie; only the token's hash is stored.
  - Cart services in `packages/core/src/cart`: add, change quantity, remove, read. Prices are always read from the catalog; totals are whole minor units computed on the server.
  - Only variants a shopper could see can be added. An item that stops being for sale is flagged and left out of the total; a changed price is pointed out.
  - "Add to cart" with quantity on the product page for the chosen variant; cart page; cart count in the header. All of it works without JavaScript.
  - Limits: 10 of one item, 50 different items, 60 changes a minute per visitor address.
  - Visitors' server actions have their own registry and test rule.

- **Milestone 2.6, search engines and Phase 2 wrap-up:**
  - `ALLOW_SEARCH_INDEXING` switch, off by default: while off, `robots.txt` disallows everything and every page says `noindex`.
  - `/robots.txt` and `/sitemap.xml` per store. The sitemap lists the home page, all products, categories and published products, from the same public reads as the pages.
  - Page titles carry the store's name ("Women's Bags | Demo Store").
  - Canonical addresses and link-preview tags on the home, category and all-products pages. Sorted, filtered and searched views are not indexed and point at the plain list.
  - A "not found" page inside the shop's header and footer, still answering 404.
  - Page-weight and layout-shift budgets enforced by a browser test; first measurements in docs/PERFORMANCE.md.

- **Milestone 3.1, customers and addresses:**
  - Tables `customers`, `customer_sessions`, `customer_tokens` and `addresses`, plus `carts.customer_id`; all tenant-scoped with Row-Level Security and same-tenant triggers. A customer belongs to one store.
  - Customer accounts in `packages/core/src/customers`: sign up, confirm email (required before sign-in), sign in, sign out, forgotten password, profile, marketing consent as a history of decisions.
  - Nothing tells a stranger whether an email has an account; one message for every failed sign-in; rate limits on sign-in, sign-up and account emails.
  - Sessions and emailed links are random tokens stored only as hashes; resetting the password signs out everywhere.
  - Saved addresses with each country's rules (for example US ZIP code and state, UK postcode, no postal code in the UAE), one default for delivery and one for billing.
  - The guest cart joins the account on sign-in and merges with any cart the account already had.
  - Storefront pages under `/account`: sign up, confirm, sign in, forgotten and new password, account details, addresses. "Sign in" / "Account" in the header. All kept out of search engines.
  - Admin: a read-only Customers list with search (`customers.read`), with no password material ever loaded.
  - Visitors' account actions registered and checked like the cart actions.

- **Milestone 3.2, inventory:**
  - Tables `inventory_locations`, `inventory_levels`, `stock_movements` and `stock_reservations`, plus `product_variants.track_inventory`; tenant-scoped with Row-Level Security and same-tenant triggers.
  - Every stock change is a recorded movement with reason, quantity, who and note; the history cannot be edited or deleted by the application; the database refuses impossible numbers.
  - Stock services in `packages/core/src/inventory`: receive, count (with a reason), mark damaged, remove damaged; locations with one default.
  - Holds for checkout that can never double-sell the last item (eight simultaneous attempts, one wins), all-or-nothing per request, expiring after 15 minutes; commit (sale) and release. The worker gives expired holds back every minute.
  - Admin: Stock list (fewest first, low-stock filter), an item's stock page with levels per location, the change form and its history, Locations, stock on the product page, and "Opening stock" when adding a variant. View with `inventory.read`, change with `inventory.adjust`.
  - Storefront: "In stock" or "Only a few left" on the product page, a sold-out message instead of the buy button, "Sold out" on cards, the quantity list limited to what there is, availability for search engines when counted.
  - Cart: refuses more than is left and says how many there are; flags lines that ran low or sold out; sold-out lines are not in the total.

- **Milestone 3.3, checkout and orders:**
  - Tables `orders`, `order_items`, `order_events`, `payments`, `payment_events` and `order_counters`; an order is a frozen copy of what was bought; database triggers allow only the defined status steps and never let an order's amounts change.
  - Checkout on one page (contact, delivery address, summary) for guests and signed-in customers, optionally saving the address; prices rebuilt on the server; stock held in the same transaction for 30 minutes; refused if the total changed.
  - A `PaymentProvider` interface with a mock provider: a test payment page with pay, decline and leave buttons; payment confirmed only by a signed, fresh, once-only notification whose amount matches; a public webhook at `/api/webhooks/payments/mock`.
  - Unpaid orders cancelled after 30 minutes by the worker, stock returned; a late payment flagged for a refund.
  - Order page with status and "Pay now" to try again; guests open it with a private link, also sent in the confirmation email; customers see their orders under Account.
  - Admin: Orders list (search by number or email, filter by status) and order page with items, address, payments, history, "Mark as sent" and "Cancel order" for unpaid ones. View with `orders.read`, change with `orders.manage`.
  - The mock provider refuses to run in production unless explicitly allowed (only the tests do).

- **Cash on delivery (part of 3.4):**
  - Checkout asks "How will you pay?": cash on delivery (default, needs a phone number) or, when a provider is set up, online by card.
  - A cash order is confirmed at once, its stock held, and the confirmation email says how much to pay the courier.
  - Staff mark it sent (stock leaves the shelf), then "Cash received" (the order counts as paid) or "Delivery refused" (cancelled, items back in stock).
  - `PAYMENT_PROVIDER=none` runs the store with cash on delivery only, in production too.
  - Database rules keep online and cash orders on their own status paths; the payment method cannot change after placing.

- **Milestone 3.5, delivery and tax:**
  - Admin page **Delivery and tax** (permission `settings.write`): delivery areas with countries, price, optional free delivery above an amount, offered or not, and order; one tax rate for the store, included in prices or added at checkout. Every change is audited.
  - Checkout: the shopper picks a delivery area from the list (each shows its price); the summary and total update; the server works delivery and tax out again and refuses an area that is switched off, from another store or for another country, and refuses the order if prices changed after the page was shown.
  - Orders keep the delivery area, fee, tax rate and tax amount they were placed with; the order page, the admin order page and the confirmation email show them. The database refuses to change them.
  - Marking an order as sent records the courier, tracking number and tracking link (https only); the shopper sees them on their order.
  - A store with no delivery areas works as before: no delivery charge.
  - Fixed: after a form on a store's own domain redirected (placing an order, signing in), the next page could show the wrong store. See decision D76.

- **Milestone 3.6, store emails:**
  - Shoppers get: order confirmed (cash order placed or online payment), on its way (with the courier and tracking staff entered, and the cash to have ready), payment received (cash recorded), and cancelled (by staff, or an online order not paid in time).
  - Staff get, at addresses listed on the new **Store emails** admin page (`settings.write`): new order ready to prepare, and low stock when an order takes a product down to its level (once a day per product).
  - Every email is saved with the order change in one transaction, sent once only, straight away by the request and otherwise by the worker every 30 seconds, and retried after failures. Emails that could not be sent are listed on Store emails with a "Try again" button.
  - Emails are plain text, show only what the order records, and stay within the store's own data.

- **Milestone 3.7, admin order tools:**
  - **Dashboard** on the admin home (`reports.read`): sales and orders today, last 7 and 30 days, a 14-day chart, orders to send, cash to collect, online orders waiting for payment, low-stock products and the latest orders, in the store's time zone.
  - **Orders**: filters for payment method and from/to dates, and **Download as CSV** of the filtered orders (`customers.export`, audited, at most 5,000 rows, safe against spreadsheet formulas).
  - **Returns**: on a sent and paid order, staff record what came back (how many of each item, resellable or damaged, reason) and any money given back (cash, bank transfer or other, with `orders.refund`). Stock comes back, the order shows what was given back and becomes "Refunded" when everything is, and the shopper sees it on their order and gets an email.

- **Milestone 3.8, discount codes:**
  - Admin page **Discount codes** (`promotions.write`, audited): percent off, amount off or free delivery; optional minimum order, first and last day, total uses and uses per customer; switch on or off; delete only if never used. The list shows how many orders used each code.
  - Checkout: a **Discount code** box with **Apply** that shows the new total straight away; the code is checked again, locked, when the order is placed. The order, its emails, the admin order page and the CSV export show the code and the money off.

- **Bulk product import (owner request):**
  - Products page: **Import from a spreadsheet**. Download an Excel template for the store (Category and Brand are dropdowns of its own lists), fill it in, upload it (.xlsx or .csv).
  - Every row is checked first and problems are listed by row and column; nothing is added until **Import**, and then all products are added together, as drafts or published.
  - Picture links are downloaded safely (public addresses only, size and time limits, real images only) by the request and then the worker; failures are listed per link.

- **Milestone 4.1, reviews:**
  - Product page: average rating and count next to the name, a reviews section with a star breakdown, reviews marked "Verified purchase", the store's replies, and pages of older reviews.
  - Only a signed-in customer who received the product can write one (checked by the database too), once; it shows after staff approve it.
  - Admin **Reviews** page (`reviews.moderate`): waiting, reported, shown, hidden and rejected; approve, hide or reject; reply publicly. All audited.
  - Signed-in shoppers can report a review once. Search engines get the rating from approved reviews only.

## In progress

Nothing.

## Not started

Phase 2 onward (PROJECT_PLAN.md section 4). No integration with payments, AI, Meta, Instagram, Facebook, TikTok or shipping has been implemented or tested. Email is implemented for SMTP only and tested against the local Mailpit inbox, not a real email provider.

## Known limitations of what is built

- **Products have no stock levels** (Milestone 3.2), so the storefront says nothing about availability yet.
- **No card payments yet.** Cash on delivery works; the online option is the test-only mock. A Lebanese card gateway (areeba or NetCommerce) needs your merchant account (Stripe and Tap do not accept Lebanese merchants). No refunds yet (with the card gateway).
- **No billing address and no discount codes yet.** Delivery is one price per area; there are no weight-based rates or courier integrations.
- **Confirmation email links use `APP_URL`'s scheme and port** with the store's domain; check them on the deployed site.
- **Staff names are not shown in an order's history yet** (only "Staff").
- **Customers cannot yet change their email address or change their password while signed in** (only through the reset link).
- **Staff can list customers but not open, disable or delete one** from the admin yet (Milestone 3.7). Disabling is possible in the database.
- **Expired customer sessions and used links stay in the database** (ignored, not deleted) until a cleanup job exists.
- **Account pages and emails are English only.** Store emails are plain text.
- **Emails reach only the local test inbox** (Mailpit at http://localhost:8025) until a real sending service is configured for the live site.
- **Products that existed before stock tracking are not counted** (they keep selling without a stock check) until staff switch counting on for each variant (decision D64). New variants are counted from the start and show as out of stock until stock is received.
- **The cart does not hold stock.** Stock is held when the order is placed, so an item can sell out between adding it and checking out; the cart and checkout then say so.
- **No transfers between locations, suppliers or purchase orders yet**, and each item in a checkout is taken from a single location.
- **Delivery times are not shown** anywhere; the store states none it cannot keep.
- **Expired carts stay in the database** (ignored, not deleted) until a cleanup job exists.
- **"Recently viewed" sets a preference cookie without asking**, because there is no consent banner yet (decision D49). Must be gated before launch in regions that require consent.
- **Gallery has no zoom and no previous/next buttons**; thumbnails, swipe and arrow keys work.
- **Search has no stemming or typo tolerance** ("bags" does not find "bag" unless typed as "bag"; word beginnings do match). Decision D42.
- **Home page sections are fixed** (Featured, New arrivals, Best sellers from the product flags); there is no screen to arrange them.
- **Storefront text is English only**; languages are an open decision.
- **Search engines are blocked by default.** The live site must set `ALLOW_SEARCH_INDEXING=true` (decision D54).
- **Page timings are not measured**, only page weight and layout shift (docs/PERFORMANCE.md).
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
- **Development server can serve a stale layout** after files are rewritten by a script (seen once: the header change did not appear until `pnpm dev` was restarted). Restart it if a change does not show.
- **`pnpm` is not found in the terminal panel of the Claude desktop app** on the first computer (it is found in other terminals). Workaround: `node node_modules\tsx\dist\cli.mjs scripts\<name>.ts`.
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
| `ENCRYPTION_KEY` | Derives the keys in guests' private order links (changing it makes old links stop working); later also encrypts stored OAuth tokens (Phase 6) |
| `ALLOW_SEARCH_INDEXING` | "true" lets search engines index the storefront. Default "false". Set "true" on the live site only. |
| `S3_*` | Object storage |
| `PAYMENT_PROVIDER`, `MOCK_PAYMENT_WEBHOOK_SECRET` | Online payments: `mock` (test page, needs the signing secret; a local-only value is in .env.example) or `none` (cash on delivery only; use this on the live site until a card gateway exists). **If you have an older `.env`, add the `MOCK_PAYMENT_WEBHOOK_SECRET` line from .env.example**, or the app will not start. |
| `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION` | Only for the automated tests. Never set it on a real site. |
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

## Checks run this session (Milestone 4.1, on the first computer)

| Check | Result |
| --- | --- |
| `pnpm healthcheck` | Pass |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Pass |
| `pnpm test` | Pass, 270 tests (new: the name shown with a review, ratings in search data only from approved reviews) |
| `pnpm test:int` | Pass, 253 tests, on the separate test database (4 new: only customers who received the product review, once, and the database refuses others; only approved reviews shown, summary, replies, no deletes; reports once, not own; store separation and permissions) |
| `pnpm db:drift` | Pass, no difference |
| `pnpm build` | Pass |
| `pnpm test:e2e` | Pass, 109 tests (41 skipped by design), including a customer reviewing after delivery, staff replying and approving, and the review shown to everyone. Also fixed: reply boxes on the Reviews page each have their own ID |
| `pnpm audit --audit-level high` | Pass (1 moderate advisory, unchanged) |
| Looked at in a browser | Covered by the browser tests on desktop and phone |
| CI on GitHub | See the Actions tab for this commit |

## Recommended next task

Milestone 4.2 (customer photos and videos) or launch readiness, as the owner prefers.

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
| 2026-11-13 | Owner's sign-in created (password set through the reset page) |
| 2026-11-13 | Milestone 2.5: guest cart with hashed token, cart services, add to cart, cart page, header count |
| 2026-11-14 | Test fix: cost-leak checks look at fields, not text (CI failed once by chance) |
| 2026-11-14 | Milestone 2.6: indexing switch, robots.txt, sitemap.xml, store-name titles, canonical addresses, in-shop 404, performance budgets. Phase 2 complete |
| 2026-11-16 | Milestone 3.1: customer accounts with email confirmation, password reset, profile and consent; saved addresses with country rules; cart follows the account; admin customer list |
| 2026-11-16 | Milestone 3.2: stock locations, levels, recorded movements, race-safe checkout holds, admin stock screens, storefront and cart stock checks |
| 2026-11-16 | Milestone 3.3: orders and payments tables with status and amount rules, checkout, mock payment provider with signed once-only webhooks, unpaid-order expiry, order pages, account orders, admin orders |
| 2026-11-17 | Stripe dropped (not available in Lebanon). Cash on delivery: payment method on orders, confirmed status, sent / cash received / delivery refused, cash-only mode |
| 2026-11-17 | Milestone 3.5: delivery areas and tax set by staff, delivery area at checkout with live total, frozen on the order, shipments with courier and tracking; storefront host fix after redirects |
| 2026-11-17 | Milestone 3.6: store emails through the outbox (confirmed, on its way, payment received, cancelled; staff new order and low stock), worker email sweep, Store emails admin page; owner: delivery $4 flat, Lebanon only (area added to the demo store) |
| 2026-11-17 | Milestone 3.7: dashboard, order filters and CSV export, staff-recorded returns with refunds, return email; demo store time zone set to Asia/Beirut |
| 2026-11-18 | Milestone 3.8: discount codes (percent, amount, free delivery; limits and dates), checkout Apply with live total, locked check when ordering, uses counted from orders |
| 2026-11-18 | Bulk product import: store template with category and brand dropdowns, check then import, safe picture downloads by request and worker |
| 2026-11-18 | Milestone 4.1: verified-buyer reviews with approval, replies, reports, ratings on product pages and in search data |

Commit hashes: `git log --oneline`.
