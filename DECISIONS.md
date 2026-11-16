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
