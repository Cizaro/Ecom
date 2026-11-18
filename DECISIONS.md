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

### D46. The chosen variant lives in the page address (2026-11-13)
On a product page, colour and size choices are links to the same page with `?color=…&size=…`. The server works out the variant, so the price, SKU and pictures are right on first load, choosing works without JavaScript, and a link to "the tan one" can be shared. Colour takes priority: a size that the chosen colour is not made in is shown struck through and cannot be picked, and changing colour keeps the size when that colour has it. Every variant address points search engines at the one plain product address (canonical link). The selection rules are plain logic in `packages/core/src/catalog/variant-selection.ts`, to be reused by the cart.

### D47. Pictures follow the variant (2026-11-13)
The gallery shows the chosen variant's own pictures first, then pictures not tied to any variant; pictures of other variants are left out. If neither kind exists, all pictures are shown. The gallery is a native scroll-snap strip (swipe, trackpad, arrow keys) with thumbnail links, so it needs no script to be usable.

### D48. Nothing is said about stock until stock is tracked (2026-11-13; superseded by D65)
The product page shows no "in stock", "only N left" or delivery promise, and the data given to search engines has no availability field, because inventory does not exist yet (Milestone 3.2). There is also no add-to-cart button until the cart exists (Milestone 2.5), rather than a button that does nothing.

### D49. "Recently viewed" is a first-party cookie of product URL names (2026-11-13)
Viewing a product stores up to nine product URL names in a cookie named `recent` (30 days, SameSite=Lax, set by the page's own script). The server reads it and shows current cards for those that are still published, so prices are never stale and an edited cookie can only ever name public products of the same store. It holds no identifier of the visitor. It is a preference cookie, not a strictly necessary one: when the consent banner is built (privacy work), setting it must depend on the visitor's choice.

### D50. A guest cart is opened by an unguessable token; only its hash is stored (2026-11-13)
A visitor needs no account to use a cart. The first "add to cart" creates a cart and a 256-bit random token, kept in a cookie named `cart` that scripts cannot read (HttpOnly), SameSite=Lax, Secure over HTTPS, 30 days. The database stores only the SHA-256 of the token, and a cart is only ever looked up by that hash inside the store's tenant, so a database leak opens no carts and a line ID from another cart is simply "not found". The cookie is strictly necessary for the cart, so it needs no consent. When customer accounts exist, a signed-in customer's cart will be linked to the account and merged with the guest cart.

### D51. The cart never trusts a price from the browser (2026-11-13)
Cart forms send only which variant (or which line) and how many. Prices are read from the catalog every time the cart is shown, and totals are computed on the server in whole minor units. Each line remembers the price at the time it was added only to tell the shopper when it has changed; the total always uses the current price. Only a variant that is for sale in a published product of the same store can be added. An item that later stops being for sale stays in the cart, flagged and left out of the total, so the shopper sees what happened instead of an item silently vanishing.

### D52. Cart limits (2026-11-13)
At most 10 of one item and 50 different items per cart, enforced in the service and (quantity) in the database. Cart changes are limited to 60 a minute per visitor address per store. If the counter (Redis) is unreachable the change is allowed: losing the ability to shop is worse than briefly losing the limit. A cart unused for 30 days is treated as empty.

### D53. Visitors' server actions are registered separately (2026-11-13)
Server actions that need no sign-in live under the storefront folder and are listed in `STOREFRONT_ACTIONS`. The unit test requires each to be listed, to take its store from the host name (`storefrontDb()`), and never to call a staff guard; staff actions stay under the admin folder with their own list.

### D54. Search engines are kept out unless indexing is switched on (2026-11-14)
`ALLOW_SEARCH_INDEXING` is "false" unless set to "true". While it is off, `robots.txt` disallows everything and every page carries `noindex`, so a development, test or staging copy cannot end up in search results by accident. It must be set to "true" on the live site, and only there. The cost of the safe default is that a forgotten setting leaves the live shop unindexed, so it is on the launch checklist.

### D55. One address per list; variations are not indexed (2026-11-14)
A plain list (a category, all products) and each of its pages is indexed under its own address. A sorted, filtered or searched view points at the plain list (canonical link) and asks not to be indexed, because those views are near-copies without end. The cart, search results and the whole admin are never indexed. `sitemap.xml` is built per store from the same public catalog reads as the pages, so it can only list what a shopper can open; one file holds up to 45,000 addresses.

### D56. Customers are separate from staff, and belong to one store (2026-11-16)
Shoppers have their own tables (`customers`, `customer_sessions`, `customer_tokens`, `addresses`), their own session cookie (`customer_session`) and their own sign-in pages under `/account`. Nothing a customer session carries is checked by the admin guards, so a customer account opens nothing in the admin. A customer belongs to one tenant: the same email address in two stores is two unrelated customers with separate passwords. Customer authentication runs on the runtime database role inside the store's tenant (Row-Level Security), not on the admin connection that staff sign-in uses. This supersedes the earlier sketch of a separate `CustomerAccount` credential table in docs/DATA_MODEL.md: the password hash sits on the customer row.

### D57. A customer account needs a confirmed email address (2026-11-16)
After signing up, the customer must open an emailed link before they can sign in. This stops anyone creating an account in someone else's name and keeps marketing consent tied to a real mailbox. Opening the link shows a button; the confirmation happens on pressing it, because mail scanners and link previews open links automatically and would otherwise use up the single-use link. Choosing a new password through the emailed reset link also confirms the address.

### D58. Nobody can learn from the site whether an email address has an account (2026-11-16)
Sign-up always answers "we have sent an email", and "forgot password" always answers "if that address has an account". What differs is the email sent to the address itself (a confirmation link, or "you already have an account"). Sign-in gives one message for every kind of failure, and a missing account costs the same time as a wrong password. Limits: 5 failed sign-ins per email and 30 per address in 15 minutes; 10 sign-ups per address an hour; 3 account emails per mailbox an hour; 10 reset requests per address an hour.

### D59. Customer sessions and emailed links are random tokens stored as hashes (2026-11-16)
Same pattern as the cart (D50): 256-bit tokens, only their SHA-256 stored, looked up inside the store's tenant. Sessions last 30 days; confirmation links 24 hours; reset links 60 minutes and once. A new link replaces any earlier unused link of the same kind. Resetting the password signs the customer out everywhere.

### D60. A signed-in customer's cart belongs to the account (2026-11-16)
On sign-in, a guest cart on that browser is claimed by the account; if the account already had a cart, the guest items are merged into it (each held at the usual limit) and the guest cart is removed. A cart owned by a customer is found by the customer ID from their session and no longer by its cookie token, so a browser that has signed out cannot reach it, and the cart follows the customer to another device.

### D61. Addresses are checked against each country's rules, generously (2026-11-16)
An address needs a name, a street line, a city and a country from the ISO list. Where a country has firm rules they are enforced (for example United States: state and a five-digit ZIP code; United Kingdom, Canada, Australia and several European countries: a postcode in the national format; United Arab Emirates: an emirate and no postal code). Everywhere else a postal code and a region are accepted but not demanded: refusing a real address is worse than accepting an unusual one. The same check will be used at checkout. Up to 10 saved addresses; one default for delivery and one for billing, enforced by the database.

### D62. Stock levels change only through recorded movements (2026-11-16)
Each variant has a level per location: on hand, reserved (held for checkouts) and damaged; available = on hand - reserved - damaged. A level is never edited on its own: every change is written together with a movement row (reason, quantity, who, note, what caused it) in one transaction. The runtime database role may add and read movements but never change or delete them, so the history always explains the numbers. The database also refuses impossible numbers: nothing negative, and reserved plus damaged never more than on hand.

### D63. Taking stock is one conditional update (2026-11-16)
Holding stock for a checkout is a single `UPDATE ... SET reserved = reserved + n WHERE ... available >= n`. Under concurrent checkouts the second waits for the first's row lock and then finds nothing left, so two shoppers can never both get the last item (tested with eight at once). A hold covers every tracked item of the request or none. Each item is taken from one location, the default first. Holds expire (15 minutes by default) and the worker gives expired holds back every minute. Committing a hold turns it into a sale (the items leave on hand); releasing it returns them.

### D64. Stock tracking is per variant; existing variants were left untracked (2026-11-16)
New variants count stock from the start, so a new item shows as out of stock until stock is received (the add-variant form has an "Opening stock" field for staff with `inventory.adjust`). Variants that existed before this milestone were being sold without any count; the migration switched tracking off for them so the live catalog did not suddenly sell out. Staff can switch tracking on per variant on its stock page; it starts at zero. An untracked variant is sold without a stock check and nothing is claimed about its availability anywhere.

### D65. Shoppers see stock in words, never as a number (2026-11-16)
The product page says "In stock", "Only a few left" (at or below the variant's low-stock level, 3 when not set) or shows a sold-out message instead of the buy button. Cards show "Sold out" when every variant is out. The quantity list stops at what can be had, and the cart refuses more than is left, saying how many there are. The cart does not hold stock (checkout does); lines that ran low or sold out after being added are flagged, and sold-out lines are left out of the total. Search engines get availability only when every variant's stock is counted. This supersedes D48.

### D66. An order is a frozen copy, and only allowed status steps are possible (2026-11-16)
An order copies the item names, SKUs, colours, sizes and prices, and the delivery address, at the moment it is placed; later catalog or address changes never alter it. Order numbers are per store, from 1001. Status steps: waiting for payment to paid or cancelled; paid to sent (fulfilled), cancelled or refunded; sent to refunded. A database trigger refuses any other step and any change to an order's amounts, currency or number; order lines, order history and payment notifications can be added and read by the application but never changed or deleted.

### D67. Checkout holds stock with the order, and prices come only from the server (2026-11-16)
Placing an order rebuilds it from the shopper's cart on the server, in one transaction that also holds the stock (decision D63): if anything is unavailable or short, no order is made. The checkout form sends the total the shopper saw; if the server's total differs, the order is not placed and the shopper is told. Stock is held for 30 minutes; the worker cancels unpaid orders after that and gives their stock back. Delivery and tax were added in Milestone 3.5 (decision D74).

### D68. Payments are confirmed only by a verified, once-only notification (2026-11-16)
The application never sees card details: the shopper pays on the provider's page. An order becomes paid only when the provider's notification (webhook) passes its signature check, is less than five minutes old, and matches the payment's amount and currency. Each notification is recorded first by the provider's own event ID; a repeat changes nothing. A failed payment leaves the order waiting so the shopper can try again; a payment that arrives after the order was cancelled is recorded and flagged for a refund. A notification that cannot be verified gets a plain 400 and changes nothing. The webhook finds the payment's store with a lookup on the admin connection (platform module) that returns only the tenant ID; everything else runs inside that tenant.

### D69. The mock payment provider takes no money and is refused in production (2026-11-16)
Until a real provider is chosen (open decision Q4), `PAYMENT_PROVIDER=mock` shows a test payment page on the store's own site with pay, decline and leave buttons and a "test mode" notice. Its buttons produce a signed notification and deliver it along the same path as the webhook, so nothing in the application can mark an order paid any other way. Configuration validation refuses the mock when `NODE_ENV=production` unless `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true`, which only the automated tests set (they run the production build). `MOCK_PAYMENT_WEBHOOK_SECRET` in .env.example is a local-only value, like the local database password.

### D70. Guest orders belong to no account; a private link opens them (2026-11-16)
An order placed while signed in belongs to that customer and appears in their account. A guest's order belongs to no account, even if the email matches one, so nobody can put an order into someone else's account by typing their address. A guest opens their order with the key in its link (shown after paying and in the confirmation email). The key is derived from the order ID with a server secret (`ENCRYPTION_KEY`), so the email sent later can carry it again; only its hash is stored, and changing the secret makes old links stop working. The order page asks browsers not to pass its address on to other sites.

### D71. The store is in Lebanon: no Stripe; a local card gateway later (2026-11-17)
The owner is based in Lebanon. Stripe does not list Lebanon as a supported country, PayPal is reported unavailable to Lebanese merchants, and Tap Payments' own help centre says it is not accepting new merchants from Lebanon. The card gateway will be a Lebanese provider such as areeba (or NetCommerce), added behind the existing `PaymentProvider` interface once the owner has a merchant account and test credentials (approval reportedly takes 3 to 6 weeks). No integration code is written for a provider until its documentation and test access exist. This replaces the earlier assumption of Stripe in open decision Q4.

### D72. Cash on delivery is a payment method of the order (2026-11-17)
Cash on delivery is the main way Lebanese shoppers pay online orders, so it is always offered and chosen by default at checkout. An order records its `payment_method` (online or cash_on_delivery), fixed once placed. A cash order starts as `confirmed` (new status) with its stock held (30 days at most); a phone number is required for the courier. Marking it sent commits the stock (it leaves the shelf). Staff then record "cash received" (a payment row from `cash_on_delivery`, one per order, and the paid time set) or "delivery refused" (the order is cancelled and the items go back on the shelf as "return" movements, once). Allowed status steps gain confirmed to fulfilled or cancelled, and fulfilled to cancelled; the service allows the latter only for a cash order with no money recorded. A database check keeps online orders out of `confirmed` and cash orders out of waiting-for-payment and paid. The order confirmation email is sent when a cash order is placed and tells the shopper how much to pay the courier.

### D73. Online payments can be switched off (2026-11-17)
`PAYMENT_PROVIDER=none` offers cash on delivery only and needs no payment secrets, so the live store can open before a card gateway exists (the mock provider remains refused in production). The checkout then shows no card option, and the mock webhook refuses every notification.

### D74. Delivery areas are picked by the shopper; tax is one store-wide rate (2026-11-17)
Staff set delivery areas (name, countries, price, optional free-delivery amount, offered or not). At checkout the shopper picks their area from a list that shows each price, rather than the store guessing it from a typed city name, which is unreliable for Lebanese addresses. The server checks that the area is offered, in this store and covers the address's country, and works the fee out again. A store with no areas charges no delivery and accepts any country (how it worked before). Tax is one rate per store, either included in prices (the tax inside the total is shown, the total is unchanged) or added on top; it applies to the items and the delivery together, rounded half up to the cent. 0% shows no tax. The default is 0%: the owner sets the rate (Lebanon's VAT is for the owner and their accountant to confirm). Checkout sends a fingerprint of the prices it showed; if staff changed an area or the tax in between, the order is not placed and the shopper sees the new total. Orders copy the area name, fee and tax rate, and the database refuses to change them later, so editing or deleting an area never alters past orders.

### D75. A shipment is recorded once, when the order is marked as sent (2026-11-17)
Marking an order as sent records one shipment: courier, tracking number and tracking link, all optional. The link must be a full https address (no other schemes, no user names in it) and opens in a new tab with no referrer. Shipments are a record: the application can add and read them, never change or delete them. Corrections and split parcels can come later if needed.

### D76. The storefront trusts X-Forwarded-Host only from this machine (2026-11-17)
After a server action redirects, Next.js renders the next page with a request to its own localhost address and passes the shopper's host in X-Forwarded-Host. The storefront previously read only the Host header, so on any host other than the server's own name (every custom store domain) the page after a redirect showed the wrong store or a 404. The storefront now uses X-Forwarded-Host only when the Host header is a loopback address (localhost, 127.0.0.1, ::1), which public requests to a store domain never have. A request to a store domain cannot switch stores by sending the header. A reverse proxy on another machine will need its own trusted-proxy setting (launch hardening).

### D77. Store emails go through the outbox, saved with the change they report (2026-11-17)
Order emails (confirmed, on its way, payment received, cancelled) and staff emails (new order, low stock) are rows in `outbox_events`, written in the same transaction as the order or stock change. A rolled-back change never emails; a committed one always does, eventually. A dedupe key per email (for example "shipped:<order>") makes each one once only, even when a payment notification arrives twice. The request that made the change sends its store's waiting emails straight away; the worker sends anything left every 30 seconds. A sender claims a batch with `FOR UPDATE SKIP LOCKED` and a five-minute lock, so two senders never send the same email; a failure is retried after 1, 5, 30, 120 and 720 minutes, then given up (six attempts) and listed for staff, who can try it again. Emails are rendered when sent, from the order as recorded, inside the store's tenant; they state only what the order records and promise no delivery dates. This replaces sending the confirmation directly from the request.

### D78. Staff emails go to addresses the store lists; shopper emails are order emails only (2026-11-17)
Each store lists up to five addresses for new orders and five for low stock (none by default). "New order" is sent when an order is ready to prepare: a cash order when placed, an online order when paid. Shoppers get emails only about their own orders, which they need, so there is no opt-in for them; no marketing email exists yet, and when it does it will need the shopper's consent first (consent_records). Unpaid online orders that expire get a short cancellation email.

### D79. Low stock is noticed when an order takes a product down to its level (2026-11-17)
When placing an order lowers a counted product from "in stock" to its low-stock level or to none, staff on the low-stock list are told, at most once a day per product. Held items (checkouts in progress) count as not available, as everywhere else; the email says so. Staff stock changes do not send it, since staff made them.

### D80. Returns are recorded by staff, with any money given back (2026-11-17)
Until the owner sets return rules (open decision Q22), there is no shopper-started return and no return window: staff record a return when items come back. Only an order that was sent and paid can have one (a cash parcel refused at the door is "Delivery refused"). Staff enter how many of each line came back and whether each can be sold again (back on sale) or is damaged (kept apart, not for sale); stock moves are recorded as "return". No more of a line can come back than was bought; the database enforces this with the line locked, and checks the line belongs to the return's order. Money given back (cash, bank transfer or other) is recorded on the return and added to the order's `refunded_amount`, never more than was paid less earlier refunds; the column can only grow. Recording a return needs `returns.manage`; giving money back with it also needs `orders.refund`. When everything paid has been given back, the order becomes "refunded". Card refunds through a payment provider come with the card gateway. Returns are add-only records, and the shopper gets a "return recorded" email.

### D81. The dashboard counts orders taken, in the store's time zone (2026-11-17)
"Sales" are orders the store has taken (cash orders confirmed or sent, online orders paid, refunded ones included) at their total less money given back; cancelled orders and online orders waiting for payment are not sales. Days are the store's own (`stores.timezone`; the demo store is set to Asia/Beirut). The dashboard also shows orders to send, cash still to collect, online orders waiting for payment and low-stock products, each linking to the matching list. It needs `reports.read` and is shown on the admin home. Only the store's own currency is summed.

### D82. The orders export needs permission to export customer data (2026-11-17)
The CSV holds names, emails, phones and addresses, so it needs `customers.export` as well as `orders.read`, and every export is written to the audit log with its filters and row count. It follows the Orders page filters (search, status, payment, from and to dates in the store's time zone), takes at most 5,000 rows, and protects spreadsheet users: any value starting with = + - @ is prefixed with an apostrophe so it cannot run as a formula.

### D83. Discount codes are checked twice and counted from orders (2026-11-18)
Staff with `promotions.write` make codes: percent off the items (1 to 100), a fixed amount off the items, or free delivery, with an optional minimum order, first and last day (store time), total uses and uses per email address. At checkout "Apply" checks the code against the shopper's own cart and shows the new total; when the order is placed the code is checked again with its row locked, so two shoppers can never both take its last use. Uses are counted from orders that are not cancelled, so a cancelled order gives its use back. A discount comes off the items first (never below zero), or equals the delivery fee for free delivery; "free delivery over" is judged on the items after the discount, and tax applies to what is then charged. The order keeps the code and the amount, frozen like its other amounts; a used code cannot be deleted, only switched off. No countdowns or urgency are shown to shoppers. Automatic promotions (without a code) are not built.

### D84. Bulk product import: check first, then import all or nothing (2026-11-18)
Owner request. Staff with `catalog.write` download an Excel template made for their store (Category and Brand columns are dropdowns of the store's own categories and brands; a new one is added in the admin first and the template downloaded again), fill one row per product or per colour/size, and upload it (.xlsx or .csv, 2 MB and 1,000 rows at most). Every row is checked first (product name, SKU new in the store and the file, price, sale price lower, category and brand exist, stock a whole number, picture links valid) and the result is kept as a "checked" import; nothing is created until staff press Import, and only a file with no problems can be imported. All its products are created in one transaction, as drafts unless staff choose to publish; URL names come from product names and are made unique. Opening stock needs `inventory.adjust` and is recorded as received. The Excel reader checks the file's unpacked size before opening it and reads values only.

### D85. Picture links are downloaded safely, in the background (2026-11-18)
Fetching a URL typed by a user is a server-side request forgery risk. The downloader accepts only http(s) without credentials on ports 80/443, resolves the host itself and refuses private, loopback, link-local, carrier-NAT, multicast and documentation addresses (IPv4 and IPv6, including mapped addresses), connects to the address it checked (no second lookup), checks every redirect (three at most), has a 15-second limit and an 8 MB limit while reading, and accepts only real JPEG, PNG or WebP bytes; the picture then goes through the normal image pipeline. The import request downloads a first batch for about 20 seconds; the worker does the rest every 30 seconds. A link that fails is reported on the import page and never undoes the products. `IMPORT_ALLOW_PRIVATE_IMAGE_HOSTS=true` lifts the address check for the automated tests only. exceljs's old `uuid` is overridden to a fixed version.

### D86. Reviews come only from customers who received the product, and show after approval (2026-11-18)
To keep reviews honest (no fake testimonials), a review can be written only by a signed-in customer with an order of theirs that was sent and contains the product; the database checks this with a trigger, so neither a bug nor staff can add one otherwise. One review per customer per product; the customer cannot edit it afterwards. Every review waits for staff (`reviews.moderate`) to approve it; staff can hide or reject it and reply publicly, but never change what the customer wrote, and reviews are not deleted. Ratings, counts and the search-engine rating data come from approved reviews only, and are absent when there are none. The name shown is the first name and the last name's initial. Signed-in customers can report a shown review once each (not their own); reported reviews have their own filter for staff. Guest buyers cannot review yet (their orders belong to no account).

### D87. One storefront template; each store has its own look (2026-11-18)
Owner requirement: reuse the website for other shops and clients with a few design changes. Components already used named design tokens only. Each store now has its own values for them: main colour, accent colour, corner style, font (system fonts only, so nothing is fetched from other sites), logo, tagline and contact details, edited on the admin page Store and look (`settings.write`, audited), with four ready-made looks. The storefront sets the tokens on its outer element for the store it is serving; the admin keeps a neutral look. Only validated values reach the page (six-digit colours, fixed lists for corners and fonts). Button text colour is computed for readability on any brand colour, and an accent too pale to read on white is refused (WCAG 4.5 to 1). The store's name and time zone are edited on the same page. Deeper redesigns change the storefront pages only (docs/REUSE.md).

### D88. The AI module must be reusable for any business (2026-11-18)
Owner requirement, recorded before Phase 5 so it shapes the design: the AI part must be redirected to a different business by feeding it that business's data. Binding rules: its own package depending only on interfaces (no imports from commerce modules); business facts through a knowledge-source interface with the commerce adapter as one implementation; a per-store business profile as editable data; prompt templates with no product-category words; abilities registered by the business's adapter; facts only from the knowledge source; a non-shop fixture business in the tests from day one; per-store data, budget and audit. Details in docs/REUSE.md and ARCHITECTURE.md section 8.

### D89. Customer and creator photos are shown only with recorded, withdrawable permission (2026-11-18)
Customers share photos or short videos of products they received (an order of theirs, sent), from their account. Sharing requires ticking an exact, versioned permission sentence naming the store; the wording, its version and the time are kept on the item, and a consent record (`ugc_reuse`) is written. The customer can withdraw permission at any time: the item is taken down at once, its file deleted, and a consent record of the withdrawal written; the item record stays, without the file, as proof. Staff (`reviews.moderate`) approve, hide, reject, feature or remove items; nothing is shown before approval, and the database refuses to show an item without a file and live permission. Staff (`content.write`) may add a creator's content only with the link to where it was posted, a note of how permission was given, and a confirmation; staff who can moderate publish it directly. Videos are stored as uploaded (MP4 or QuickTime, checked by their bytes, 8 MB at most, picture size read from the file) and never play with sound on their own. The credit shown is the customer's first name and initial unless they choose another name. Approved items appear on the product page and in a gallery at /gallery, linked from the menu once there are any.

### D90. Support conversations: account-owned or private-link, with staff-only notes (2026-11-19)
Shoppers write from a Contact us page (linked in the footer). A signed-in customer's conversation belongs to their account (Account, Messages); a guest's opens only with a private link emailed to them, derived from the server secret with only its hash stored, like guest orders. An order can be linked only if it is the shopper's own (their account's, or for a guest the same email). Staff with `inbox.read` see the Inbox (to answer, waiting for customer, closed; mine only; search); `inbox.reply` answers (emailed to the shopper, status waiting, first replier takes it), adds internal notes that are never shown or emailed to the shopper, closes, reopens, takes or gives up conversations. Messages and notes are add-only. A new list of staff addresses (Store emails) is told about each customer message. Spam control: the existing per-address rate limit and a hidden field bots fill in; no CAPTCHA.

### D91. One customer page with everything that happened (2026-11-19)
Staff with `customers.read` open a customer from the list: orders, money spent (orders taken less refunds), account status, and a timeline of the account, orders, reviews, shared photos, conversations and staff notes, newest first, each linking to its admin page. `customers.write` adds notes; notes are add-only (a correction is a new note) and visible to staff only.

### D92. Policy pages are written by the store; templates leave every rule blank (2026-11-19)
Returns, delivery, privacy and terms pages are the store's own text (Policy pages, `settings.write`). An empty page starts from a template that states only what the platform really does (for example, only essential cookies) and leaves every store decision as a [BLANK IN CAPITALS]; a page cannot be published while a blank is left or under 50 characters. Text is plain, shown as headings, paragraphs and lists, never as HTML. Published pages are linked in the shop footer and listed in the sitemap. The templates are a starting point, not legal advice.

### D93. Launch readiness is checked by a command, and the app ships as one Docker image (2026-11-19)
`pnpm launch:check --tenant <slug>` fails on what would hurt real customers (not production mode, no HTTPS, console email, an example sender, the test payment provider, test switches on) and warns about what to finish (search indexing, delivery areas, tax, unpublished policy pages, missing staff email addresses, owners without two-factor sign-in); it also checks the database, Redis and storage. One image runs the web app, the worker or the database update, by command; it holds no secrets (configuration at run time only), runs as a normal user and has a health check. `pnpm db:backup` writes a PostgreSQL dump, checks it is one, and keeps the newest 14; a restore was tested. `pnpm store:create` creates a store and its web address on a fresh server (production seeding adds no demo data). docs/DEPLOYMENT.md is the step-by-step guide.

### D94. Shop languages: English by default, Arabic by choice, wording keyed by its English (2026-11-20)
The shop is in English unless the shopper presses the language button in the header; the choice is kept in a cookie for a year. A store chooses whether it offers Arabic (Store and look); staff pages are always English. All wording lives in one small package, `@ecom/i18n`, usable on the server, in the browser and in emails: the English written in the code is the key for its Arabic, so a missing translation shows English, never a blank or a key name. A test fails when any shop or email wording has no Arabic. Messages from the services are translated where they are shown (`t.message`), including ones with values inside. Arabic keeps Western digits; prices are written "$49.90" as in Lebanese shops. The layout uses start and end instead of left and right, so it mirrors by itself. The language is in a cookie, not the address: search engines see the English shop (separate Arabic addresses are a later step, see NEXT_STEPS).

### D95. Product and category wording in Arabic is a separate, optional translation (2026-11-20)
`product_translations` and `category_translations` hold a product's or category's Arabic name and descriptions; the product's own fields stay the default (English) wording. Anything left empty shows the English. Shop pages load records as before and pass them through `localize...()`, so no listing query depends on the language. Shop search also matches Arabic names. Orders and support conversations record the language they were made in, and the emails to the shopper are written in it; emails to staff stay English. Order lines keep the product name as it was when ordered. Policy pages can be written once per language; until an Arabic page is published, Arabic shoppers see the English one.

### D96. The AI gateway: one package, interfaces only, every run checked and recorded (2026-11-21)
All AI goes through `packages/ai`, which imports nothing else from the platform (a test fails if it does). A business plugs in three things: a knowledge source (facts with ids), a business profile (staff-edited data: description, tone, languages, promises, hand-over subjects) and a ledger (settings, spend, audit trail). Callers ask for a named task with typed input; the first task is `customer.answer`. For each run the gateway: stops if AI is paused for everyone (`AI_PAUSED`) or for the business, or the month's budget is used; checks the input; gathers facts; removes email addresses and phone and card numbers; builds the prompt from the profile and facts with customer text kept between tags as data; calls the provider with a time limit; checks the answer; decides who must look at it; records the run. Tests run against a made-up dental clinic, not a shop.

### D97. Facts are checked, not hoped for (2026-11-21)
An answer must cite the ids of the facts it uses; citing a fact that was not given fails, claiming an answer with no citation fails, and every number in the reply must appear in a cited fact or the customer's question, so no price, quantity, date or time can be invented. A failed answer gets one second try with the problems named, then is not used. The shop's knowledge source gives only what shoppers can see: published products (price, sale price, colours, "available" or "sold out", never stock counts), delivery areas, published policy pages and the store's contact details, in the shopper's language where written.

### D98. AI decides nothing alone by default; budgets and the audit trail are per store (2026-11-21)
Each store chooses: only drafts, answers a person approves (the default), or answering simple questions alone. Refunds, payment problems, complaints, legal, threats, privacy and account questions, questions the facts do not answer, and anything the AI hands over always go to a person. In this milestone nothing is sent to customers at all: staff try the assistant in the admin. Each store has a monthly budget (at most the platform's `AI_MONTHLY_BUDGET_USD`), counted from the cost of its own runs. Every run is recorded (`ai_events`, never changed by the app) with what was sent (without personal details), what came back, tokens, cost, time and the staff member. Providers: the built-in stand-in (`mock`, no outside calls, for development and tests) and Anthropic's Claude (`claude-opus-5-5` by default, answers in a checked JSON shape, with the API's own fallback when a request is declined).

### D99. AI writes product drafts; a person applies them, part by part (2026-11-22)
Two content tasks in `packages/ai`, named for "items" so any business can use them: `item.copy` (summary, description, search-engine title of 60 characters at most and description of 160 at most, up to 8 lowercase tags, and one of the store's existing categories or none) and `item.translate` (name, summary and description in another language). Both write from the item's own details only, never the shop's other facts: every number in a draft must appear in those details, a translation must keep exactly the original's numbers (Arabic-Indic digits count as the same) and be written in Arabic letters, an empty field stays empty, and a category that is not one of the store's is refused. The tasks rate every result as needing a person, so even a store that lets the AI act alone gets drafts here. Drafts are kept in `product_suggestions` (one waiting draft per product, kind and language; a newer one replaces it) and shown on the product's page, where staff tick the parts to apply or dismiss the draft. Tags are added to the product's own; a translation replaces only the ticked parts. Drafting and deciding need `catalog.write` and `ai.use`, so a content editor can, an inventory manager or a marketer cannot. The built-in test stand-in cannot translate: it returns the English marked "[test translation]" so nobody mistakes it for Arabic.

### D100. One dependency advisory ignored until a fix exists (2026-11-22)
A high-severity advisory for `picomatch` (GHSA-fc5q-39xc-vjpf, slow pattern matching on crafted patterns) has no fixed version yet. It is reached only through developer tools (the linter, build and test tooling), never through what the app runs: `pnpm audit --prod` finds nothing. It is listed under `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` so CI's audit keeps checking everything else at high severity. Owner decision. Remove the entry once a fixed version is released.

### D101. Free AI services for testing: Groq and Moonshot (Kimi), with a backup provider (2026-11-22)
The owner tests the AI on free plans before paying for Claude. One provider speaks the "OpenAI chat completions" format used by Groq, Moonshot (Kimi), OpenRouter and local model servers; `groq` and `moonshot` are named presets of it with their own key and model settings, so both keys can sit in the settings at once. `AI_FALLBACK_PROVIDER` takes over when the main provider is busy, unreachable, slow or out of credit (useful with free plans' tight limits); a refused key or unknown model is reported, not hidden. Because these services differ in forcing a JSON shape, the provider asks for a JSON object and states the shape in the instructions; the gateway's checks are the same for every provider. Model names are read from the service (`pnpm ai:models`), never guessed. Unknown models count against the budget at the most expensive known price unless their price is set (`AI_INPUT_PRICE_PER_MTOK` and `AI_OUTPUT_PRICE_PER_MTOK`; 0 and 0 for a free plan). The launch check warns that free plans may keep what is sent: test with made-up questions. Tested live on 2026-11-22: Groq's free plan (`openai/gpt-oss-120b`) answered in 1 to 3 seconds in English and Arabic, cited the right facts, refused an injected fake discount and said so when the facts had no answer. Moonshot refuses every request until the account has a balance, even on its lowest tier; it reports that as a 429, which the provider now reads as "needs credit".

### D102. Questions in Lebanese Arabic and Arabizi find products: a word list and AI search words (2026-11-22)
Shoppers in Lebanon write in Arabic, Lebanese Arabic and Arabic in Latin letters ("3endkon shanta sawda?"), while product names and colours are in English. Two ways, used together, connect them. A word list in the shop's adapter (`packages/core/src/ai/shop-words.ts`) maps common shop words and colours to the catalog's English (shanta/شنطة to bag, sawda/سودا to black), after spelling Arabic one way. A business-neutral AI task, `search.terms`, turns any message into up to 8 search words in the language of the store's records before the answer is drafted; if it fails, the answer is drafted from the question alone. Both runs are recorded. Product facts also name the product's category, so a wallet is not offered as a bag. Answers reply in the customer's own language, dialect and script; Arabizi is detected in code and named in the instructions, because models do not notice it reliably. The number check compares by value (4 = 4.00), reads Arabic-Indic digits, and ignores digits joined to letters (Arabizi). Automated tests always use the stand-in AI and never see the AI keys, whatever `.env` says (`useTestAi`).

### D103. Support inbox AI: labels and reply drafts; staff always send (2026-11-22)
Every new customer message in an open conversation is labelled in the background by the worker (every minute), so shoppers never wait: a category (question, order status, other; refund, payment problem, complaint, legal, threat, privacy, account; spam, abuse), an urgency, the language and a one-line summary for staff (`message.triage`, business-neutral). A reply is then drafted from the shop's facts with the conversation so far (the customer-answer task with earlier messages passed as data), except for spam, abuse, threats, legal and privacy messages, which a person handles from the start. Staff see the labels in the inbox list and on the conversation, find the draft in the reply box with the facts it used, edit it and press Send themselves, or dismiss it, or ask for a new draft; the AI never sends anything. A draft that is sent records whether staff changed it (`support_reply_drafts`). The background pass does nothing, and records nothing, while a store's AI is paused or over budget; it looks at five conversations per store per pass and gives up on a message after three failed tries. `pnpm ai:inbox --tenant <slug>` runs the pass at once. Customers never see the labels.

### D104. A fixed AI evaluation set, misbehaving-AI tests, and a stricter number check (2026-11-22)
`packages/ai/src/eval` holds 35 cases with the behaviour expected of a good model, in seven groups: answers from facts, honesty (says so when the facts do not answer; no delivery-date promises; no diagnosis), languages (Arabic, Lebanese Arabic, Arabizi), hand-over, trick messages (fake free item, asking for the instructions, fake facts slipped into the message, other customers' data, an Arabic injection, role-play for a discount), message labels and search words. They use two made-up businesses (a test shop and the dental clinic), never a real store, and a ledger in memory, so an evaluation never touches a store's data or budget. The automated tests run the set on the stand-in and, with a "misbehaving" stand-in, check that the gateway refuses manipulated or invented answers. `pnpm ai:eval` runs the set against the configured provider (pacing itself on free plans, retrying when the provider is busy) and saves a report in `eval-results/` (not committed). The misbehaving-AI tests found two gaps, now closed: a phone number counted as several small numbers (so "$0" passed), and amounts in a customer's message were allowed in the reply (so a trick message could plant "30%"). Amounts and percentages now come only from facts; a phone number is one number; replies giving an email address that is not the business's own, or repeating the instructions, are refused; citations copied with brackets are tidied. First live run, Groq `openai/gpt-oss-120b`: 35 of 35.

### D105. Content planning: library, posts, calendar and approval; publishing recorded by hand until accounts are connected (2026-11-23)
Milestone 6.1 adds four tables, each limited to its own store by Row-Level Security with same-store triggers: `content_assets` (a library entry for an uploaded photo or video: title, tags, description, a note of who owns it and the permission to use it, archived instead of deleted), `content_posts`, and the files and products a post uses (`content_post_assets` in order, `content_post_products`). A post moves draft → waiting for approval → approved → published, with "changes requested" (and a note) back to the writer. Writing and sending for approval need `content.write`; approving or asking for changes needs `content.approve`; marking as published needs `social.publish` (the content editor role can do the first only; marketers, managers and owners can do all). Editing a post that is waiting or approved sends it back to draft, so what is approved is exactly what goes out; a published post cannot be changed and an approved or published one cannot be deleted. Planned times are typed and shown in the store's time zone (Asia/Beirut for the demo store) and stored in UTC; the calendar groups posts by the store's day. No social account is connected yet (Q10 to Q12), so publishing is done on the platform by a person and recorded here with an optional https link; nothing is posted automatically and no platform is called. The AI caption (`post.caption`, business-neutral) is drafted from the featured products' own details (name, price, sale price, colours; the Arabic name for an Arabic caption), must not contain a number that is not in those details, and is refused when it adds pressure ("only 3 left", "last chance", "hurry", limited stock, in English, Arabic or Arabizi), because the shop never uses fake scarcity. It is a draft the writer copies into the caption box and saves; it still goes through approval. The product picker lists the 300 newest products and always keeps those already on the post.

## Open decisions for the owner

Until answered, the assumption shown is used and kept configurable. Items marked **blocking** stop a specific milestone; nothing else waits.

| # | Question | Assumption in use | Blocks |
| --- | --- | --- | --- |
| Q1 | Which country or countries does the store operate in? | Lebanon (owner, 2026-11-17). Tax rate set by the owner under Delivery and tax (default 0%) | Giveaway legality |
| Q2 | Currency? | USD | |
| Q3 | Languages? | English, with multi-language and right-to-left support built in | |
| Q4 | Card payment provider? | A Lebanese gateway (areeba or NetCommerce); Stripe and Tap are not available (D71). Cash on delivery is built. | **3.4**, waits on the merchant account |
| Q5 | Countries served? | Lebanon only (owner, 2026-11-17) | |
| Q6 | Shipping method? | Built: delivery areas with a price each and optional free delivery above an amount; courier and tracking entered by staff (D74, D75). Owner, 2026-11-17: one flat price, $4.00, anywhere in Lebanon (set up in the demo store as the area "All of Lebanon"). | |
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
