# Project Status

Last updated: 2026-11-26

## Current phase

**Phase 3 (checkout and operations): Milestones 3.1 to 3.3 and 3.5 to 3.8 complete, plus cash on delivery.** Phases 1 and 2 are complete. Bulk product import from a spreadsheet is built too. **Phase 4 (reviews, UGC, CRM) complete: 4.1 reviews, 4.2 customer photos and videos, 4.3 support conversations and customer timeline.** **Launch readiness built:** policy pages, launch check, backups, production image and deployment guide. **Arabic shop built:** English by default, Arabic by choice, right to left, Arabic emails. **Phase 5 (AI foundation) complete: 5.1 gateway, 5.2 product drafts, 5.3 support inbox AI, 5.4 evaluation set.** **Phase 6 started: Milestones 6.1 (content library, posts with approval, calendar, AI captions) and 6.2 (photo versions for each platform) built.** **Phase 6 complete: 6.3 (connecting Instagram and Facebook), 6.4 (social inbox) and 6.5 (publishing approved posts) built.** TikTok publishing waits for a TikTok developer app. **Phase 7: Milestones 7.1 (marketing plan, campaigns, segments, tracking links), 7.2 (competitor research and AI ideas) and 7.4 (shop events, reports, forecasts, questions about the figures) built.** 7.3 waits for the ad account. Next: Phase 8 (giveaways) once the owner confirms the prize structure, or Phase 10 readiness work. The card gateway (3.4) waits on a Lebanese merchant account (areeba or NetCommerce); Stripe is not available in Lebanon.

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

- **Store settings and per-store look (reuse for other shops):**
  - Admin page **Store and look** (`settings.write`, audited): store name, time zone, tagline, contact email and phone; logo; main and accent colours, corner style, font, or one of four ready-made looks, with a preview.
  - The storefront is one template that takes each store's values, so two stores on the same installation look different. Button text stays readable on any colour; unreadable accents are refused. The admin keeps its neutral look.
  - `docs/REUSE.md`: what can be reused for other shops and businesses today, what needs work, and the rules that keep it reusable, including the rules the AI module must follow.

- **Milestone 4.2, customer photos and videos:**
  - Account page **My photos**: a customer who received a product shares a photo or a short video (MP4 or MOV, 8 MB) with a caption and the name to show, after ticking a clear permission sentence. They see each item's status and can **withdraw permission and delete** at any time.
  - Admin **Customer photos** (`reviews.moderate`): waiting, shown, hidden, rejected, withdrawn and removed; approve, hide, reject, feature, remove for good; each item's permission record. Staff with `content.write` can add a creator's content with where it was posted and how permission was given.
  - Shop: customer photos on the product page with a "Share your photo" link for buyers, and a **Customer photos** gallery (featured first), linked from the menu once there are any. Videos are muted and start only when tapped.

- **Milestone 4.3, support and customer timeline:**
  - Shop: **Contact us** page (footer link); signed-in customers find their conversations under Account, Messages; guests get a private link by email. An order can be named if it is theirs.
  - Admin **Inbox** (`inbox.read`, `inbox.reply`): to answer, waiting for customer, closed, mine only, search; reply (emailed), internal notes (staff only, never emailed), close, reopen, take or give up.
  - Admin customer page (`customers.read`): orders, spent, account status and a timeline of everything (orders, reviews, photos, messages, notes) linking to each; staff notes with `customers.write`.
  - Store emails: a new list for staff told about each customer message.

- **Launch readiness:**
  - Admin **Policy pages**: returns, delivery, privacy and terms, from templates with [BLANKS]; cannot be published until filled; linked in the shop footer and the sitemap.
  - `pnpm launch:check --tenant <slug>`: settings, services and the store's setup, with what to fix and what to review.
  - `pnpm db:backup`: a checked PostgreSQL dump, keeping the newest 14; restore tested.
  - `pnpm store:create`: creates a store with its web address on a fresh server, or adds another address.
  - `Dockerfile`: one image for the web app, the worker and database updates; no secrets inside; runs as a normal user; health check. Built and run on the development computer.
  - `docs/DEPLOYMENT.md`: server, settings, HTTPS, first start, checks, backups, monitoring, updates.

- **Arabic shop:**
  - A language button in the shop header (English by default; the choice is remembered). Stores choose whether they offer Arabic (Store and look).
  - Every shop page, message and customer email in Arabic; right-to-left layout; Arabic-capable fonts; prices as "$49.90".
  - Arabic names and descriptions for products and categories (admin, Arabic box on each), shown in lists, product pages, cart and checkout, and found by search.
  - Policy pages per language, falling back to English until the Arabic one is published.
  - Orders and messages remember the shopper's language for their emails.

- **Milestone 5.1, AI gateway:**
  - `packages/ai`: the AI module, independent of the shop (knowledge source, business profile and ledger interfaces); tested against a made-up dental clinic.
  - Every run: off switch (platform and store), monthly budget, input checked, personal details removed, customer text kept as data, checked JSON answer, citations and numbers checked against the facts, one second try, approval routing, audit trail with cost.
  - Providers: built-in test stand-in (no outside calls) and Anthropic's Claude (`claude-opus-5-5`).
  - The shop's knowledge source: published products (no stock counts), delivery prices, policy pages, contact details.
  - Admin **AI assistant**: status and spend, try a customer question and see the facts used, business profile, settings, recent runs. Nothing is sent to customers yet.
  - Launch check reports the AI set-up.
- **Milestone 5.2, AI product drafts:**
  - Two tasks in `packages/ai`, written for "items" of any business: `item.copy` (summary, description, search-engine title and description, tags, category) and `item.translate` (name and descriptions in another language).
  - Checked: drafts use the product's own details only; no number that is not in them; translations keep exactly the original's numbers and are in Arabic letters; only the store's own categories. Always for a person to approve.
  - Product page: an **AI drafts** panel to draft the wording and search text, or the Arabic wording, then tick the parts to apply or dismiss the draft. Tags are added to the current ones.
  - Table `product_suggestions` with Row-Level Security; drafting and deciding need `catalog.write` and `ai.use`.
- **Free AI services for testing:** Groq and Moonshot (Kimi) through one OpenAI-compatible provider, with a backup provider when the main one is busy; `pnpm ai:models` lists a service's models and `pnpm ai:try` asks a question from the terminal.
- **Milestone 5.3, support inbox AI** and **Milestone 5.4, AI evaluation set:** see decisions D103 and D104.
- **Milestone 6.1, content planning (D105):**
  - **Content library** (`/admin/marketing/library`): upload photos and videos with a title, tags, a description and a note of who owns each and the permission to use it; filter by tag; archive.
  - **Content posts** (`/admin/marketing/posts`): name, channel, kind, planned time in the store's time zone, caption, photos and featured products.
  - Approval: draft → waiting for approval → approved → published, or changes requested with a note. Content editors write and send; marketers, managers and owners approve and record publishing. Changing a waiting or approved post sends it back to draft.
  - Publishing is recorded by hand with an optional link: no social account is connected and nothing is posted automatically.
  - **Content calendar** (`/admin/marketing/calendar`): the month by day in the store's time zone, with the count of unplanned posts.
  - **AI caption** from the featured products' real details: no invented numbers, no pressure or fake scarcity, English or Arabic; a draft copied into the caption and still approved.
  - Tables `content_assets`, `content_posts`, `content_post_assets`, `content_post_products` with Row-Level Security.
- **Milestone 6.2, photo versions (D106):**
  - **Sizes and versions** on each library photo (`/admin/marketing/library/[id]`): Instagram square and portrait, story / reel / TikTok / WhatsApp status, Facebook landscape, or the photo's own size.
  - Crop to fill (automatic, centre, top or bottom) or the whole photo on white, light grey, black, a blurred copy or transparent.
  - Light correction, brightness and colour within 10%, slight sharpening.
  - Plain-background removal on our own server; busy backgrounds are refused with a message. No outside image service is connected.
  - Each version is a new library file linked to its original, with the same tags and rights note and a note of what was done.
- **Milestone 7.1, marketing plan (D107):**
  - **Marketing plan** (`/admin/marketing/campaigns`): the year's campaigns by month; each campaign has a brief (goal, dates, channels, audience, key message, offer, planned budget, discount code, segment, products, notes).
  - Results counted from the shop: clicks on its tracking links, and orders with its discount code while it ran (value after refunds). Nothing is spent or posted.
  - Posts can belong to a campaign; the campaign lists its posts.
  - **Tracking links** (`/admin/marketing/links`, and on each post and campaign): a page of the shop with UTM tags and a short address `/go/<code>` that counts clicks. Links only lead to the shop itself; no visitor data is kept.
  - **Customer segments** (`/admin/marketing/segments`): by orders, spend, recency, lapsed customers or category; count now and how many agreed to marketing emails; members for staff who can see customers; CSV of consenting emails for owners (audited).
- **Milestone 7.2, competitor research (D108):**
  - **Competitor research** (`/admin/research`): competitors with their website and social accounts; observations typed by staff (products, prices, promotions, posts, hooks, hashtags, reviews) with the link and the date. Nothing is collected automatically.
  - A price seen next to our similar product's price, with the difference.
  - **Research ideas** (`/admin/research/ideas`): AI drafts up to 5 ideas with a score from 0 to 100, the reasons and the observations each cites; shown as "AI suggestion"; keep or dismiss. No fake urgency, fake reviews or copying is ever suggested (the answer is refused).

- **Milestone 7.4, analytics and reports (D109, D110):**
  - Shop events counted in our own database with no personal details: product views, adds to cart, checkouts opened, searches with their result counts, tracking-link clicks. Crawlers and prefetches skipped.
  - **Reports** (`/admin/reports`, in the menu): 7, 30 or 90 days; sales against the period before, orders, units, average order, new and returning customers; sales per day with the next 14 days' expected range; sales by category; top products with views and adds to cart (CSV download); the view-to-order funnel; searches, marking those that found nothing; campaign clicks and code orders; products running out within 3 weeks.
  - **Ask about these figures**: a question in plain words, answered only from the report's figures, citing them; needs `ai.use`.

- **Milestone 6.3, connecting Instagram and Facebook (D112):**
  - **Instagram and Facebook** (`/admin/social`, owners only): Connect goes to Meta's own sign-in; the owner chooses the shop's Page and its linked Instagram account; status, permissions granted, last notification, recent notifications, Disconnect.
  - The Page's token is stored encrypted and never shown or logged; one connection per store; a Page belongs to one store at a time.
  - Webhook address `/api/webhooks/meta`: Meta's subscription check with the verify token; notifications acted on only with a valid signature; each message or comment stored once for the store that owns the Page or account, ready for the inbox (6.4).
  - Tests use a Meta stand-in (`META_GRAPH_MODE=fake`); the launch check fails if it is left on. Tried against Meta on 2026-11-19: the Page Moonlight14a and @moonlight_14a connected with 12 permissions. Webhooks not yet received (need a public https address). Facebook Messenger messages need `pages_messaging` (Messenger use case, not added yet).

- **Milestone 6.4, social inbox (D113):**
  - Instagram and Facebook direct messages and comments appear in the **Inbox** next to contact-form messages, with a channel filter and badges; one conversation per person for messages, one per comment thread.
  - Same tools as before: take, notes, close, AI sorting and AI reply drafts; staff are emailed about new conversations.
  - Replies are sent through Meta after Send: a direct message, or a public reply under the comment (the screen says which); delivery shown as Sent or Not sent with Meta's reason and **Try again**.
  - Filed right after Meta's notification, by the worker every 30 seconds, and found by a backup check of Instagram every 5 minutes (**Check Instagram now** in the Inbox).
  - Real customers' messages need Meta's Advanced access (app review); until then Meta shows the app only people with a role on it.

- **Milestone 6.5, publishing (D114):**
  - On an approved Instagram or Facebook photo post: **Publish to Instagram/Facebook now**, or **Publish automatically** at the planned time (checked every minute); one photo or a carousel of up to 10, with the approved caption.
  - The live post's address is recorded; a failure shows Meta's reason; automatic publishing tries three times, then waits for a person.
  - Photos go as JPEG copies checked against Instagram's shape limits. Reels, stories, videos, TikTok and WhatsApp: **I posted it myself**.
  - Real publishing needs the site's file storage online (Meta downloads the photos).

- **Automatic replies (D115):** with **AI assistant > Settings > Reply automatically** on, the AI answers questions, order-status questions and everyday chat (greetings, thanks) by itself on the contact form, Instagram and Facebook, using only the shop's facts (D116); when the facts do not answer, it says so and the conversation stays for staff. Refunds, complaints, payment, legal and privacy questions wait for staff. At most ten automatic replies in an hour per conversation.

## In progress

**Launch hardening** (from Phase 10), in four parts: security, monitoring and restore, accessibility, performance.

- **Security, part 1 (D111):** each visitor action has its own limit (orders 5 in 10 minutes, discount-code checks 20 in 10 minutes, new contact conversations 5 an hour, and so on); the visitor address is the one our proxy added (`TRUST_PROXY_HOPS`), so it cannot be forged; the launch check fails if the tests' `RATE_LIMIT_SCALE` is left on and warns when addresses cannot be told apart; the after-sign-in redirect refuses tabs, line breaks and spaces. `pnpm sync` added for working from two computers.

## Not started

Phase 2 onward (PROJECT_PLAN.md section 4). Meta (Instagram and Facebook) connection is implemented and works against Meta (Page connected 2026-11-19); webhooks are tested against a stand-in only, because Meta needs a public https address (D112). No integration with card payments, TikTok or shipping has been implemented or tested. Email is implemented for SMTP only and tested against the local Mailpit inbox, not a real email provider.

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

## Checks run this session (launch hardening, security part 1, on the second computer)

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Pass |
| `pnpm test` | Pass, 490 tests (new: the visitor address is the proxy's entry, never the visitor's, and odd values are refused; the redirect after sign-in refuses other sites disguised with backslashes, tabs, line breaks or spaces; the launch check fails relaxed limits and warns about TRUST_PROXY_HOPS=0; `pnpm sync` adds only missing settings) |
| `pnpm test:int` | Pass, 301 tests |
| `pnpm build` | Pass |
| `pnpm test:e2e` | 166 passed, 2 failed, 66 skipped on the full run; the 2 (a mobile checkout waiting 5 seconds for "Sent", a mobile sign-up notice) are timing failures under load and passed on rerun |
| CI on GitHub | The last runs stopped at "Install browser system packages" (Ubuntu download timing out) after all unit and integration tests and the build passed; fixing it needs a GitHub login with the workflow permission |

## Recommended next task

Launch hardening, security part 2: review file uploads, checkout and the admin API for gaps; then monitoring and a tested database restore, accessibility and performance. Phase 8 (giveaways) once the owner confirms the prize and entry structure (COMPLIANCE.md). Owner: connect the real Page (docs/META_SETUP.md Part 3b), then 6.4 (social inbox). 7.3 waits for the ad account. Owner: open Reports and try a question. Owner: try a photo version (Sizes and versions in the library), a post with an AI caption and the approval steps.

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
| 2026-11-18 | Per-store look (colours, corners, font, logo, contact) and store settings page; reuse guide; AI reusability rules recorded (D88) |
| 2026-11-18 | Milestone 4.2: customer photos and short videos with recorded, withdrawable permission; staff moderation and creator content; product page photos and gallery |
| 2026-11-19 | Milestone 4.3: contact page, support inbox with internal notes, guest private links, customer timeline and notes; Phase 4 complete |
| 2026-11-19 | Launch readiness: policy pages, launch check, database backups, production Docker image, deployment guide |
| 2026-11-20 | Arabic shop: language switch, right to left, every shop text and customer email in Arabic, Arabic product and category names, policy pages per language |
| 2026-11-21 | Milestone 5.1: AI gateway package, shop knowledge source, AI settings, business profile and audit trail, admin AI assistant page |
| 2026-11-22 | Milestone 5.2: AI product drafts (wording, search text, tags, category, Arabic), applied part by part from the product page (second computer) |
| 2026-11-22 | AI providers for testing: Groq and Moonshot (Kimi) through an OpenAI-compatible provider, backup provider, ai:models and ai:try commands |
| 2026-11-22 | AI in Lebanese Arabic and Arabizi: word list and AI search words for finding products, replies in the customer's dialect, number check by value; automated tests never call a real AI |
| 2026-11-22 | Milestone 5.3: support inbox AI (labels, urgency, summary, reply drafts staff edit and send), worker pass, ai:inbox command |
| 2026-11-22 | Milestone 5.4: AI evaluation set (35 cases, 7 groups), misbehaving-AI tests, stricter number and leak checks, ai:eval command; Groq scored 35 of 35. Phase 5 complete |
| 2026-11-23 | Milestone 6.1: content library, posts with an approval workflow, calendar in the store's time zone, AI captions without invented numbers or pressure |
| 2026-11-24 | Milestone 6.2: photo versions for each platform (sizes, crop or whole photo on a background, light correction within limits, plain-background removal), made on our server and kept in the library |
| 2026-11-24 | Meta and TikTok setup checklist for the owner (docs/META_SETUP.md); 6.3 to 6.5 and 7.3 skipped until the accounts are ready |
| 2026-11-29 | Milestone 6.3: Instagram and Facebook connected through Meta's sign-in, Page token encrypted, signed webhooks stored once per store |
| 2026-11-29 | Milestone 6.4: Instagram and Facebook messages and comments in the inbox, replies sent through Meta with delivery status, backup check every 5 minutes |
| 2026-11-30 | Milestone 6.5: approved photo posts published to Instagram and Facebook now or at the planned time, never twice, Meta's reason kept on failure |
| 2026-11-30 | Automatic replies when the owner turns them on: safe questions answered from the shop's facts on every channel, the rest left for staff |
| 2026-11-25 | Milestone 7.1: marketing plan with campaign briefs, customer segments with consent-only export, tracking links with short addresses and click counts on posts and campaigns |
| 2026-11-26 | Milestone 7.2: competitor research typed by staff with price comparison, AI opportunity ideas scored and citing the observations |
| 2026-11-27 | Milestone 7.4: shop events without personal details, Reports page with forecasts and running-out stock, questions answered from the figures (second computer) |

Commit hashes: `git log --oneline`.
