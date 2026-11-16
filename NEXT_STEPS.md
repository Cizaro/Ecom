# Next Steps

Prioritized continuation plan. The top item is always the next thing to do. Update at the end of every session.

## Owner actions (do not block development)

1. Done 2026-11-13: the owner has a sign-in for the demo store. More staff: `pnpm admin:create --email someone@example.com --name "Name" --tenant demo --role store_manager`. Password-reset emails arrive at http://localhost:8025 in development.
2. The GitHub repository is currently **public**. Make it private in the repository settings if that is not intended.
3. Review the default role permissions (decision D24 in DECISIONS.md): who can refund, launch ads, run giveaway draws, export or delete customers.
4. Answer what you can in the open decisions table in DECISIONS.md.

## Next development task: Milestone 3.4, a real payment provider (needs the owner's choice)

**Blocked on the owner:** choose the payment provider (open decision Q4 in DECISIONS.md; the suggestion is Stripe) and create a test-mode account. Put its test keys in `.env` on your computer only; never send them in chat or commit them.

1. A provider adapter behind the existing `PaymentProvider` interface (`packages/core/src/payments/provider.ts`): create a payment on the provider's hosted page, verify its webhook signatures, map its events.
2. Refunds: a `refunds` table, staff refund from the order page (`orders.refund`), the provider's refund call, order status refunded; the "paid after cancellation" case resolved by a refund.
3. Configuration: `PAYMENT_PROVIDER=stripe` (or the chosen one), its keys and webhook secret validated at start-up; the mock stays for development and tests.
4. Tests only in the provider's test mode: success, decline, 3-D Secure, webhook retries and replays, refunds. No live money in any automated test.

If the provider decision will take a while, 3.5 (shipping and tax) or 3.6 (notification emails) can go first.

## Then, in order

| Order | Milestone | Notes |
| --- | --- | --- |
| 2 | 3.5 to 3.8 Shipping and tax, notifications, admin order tools (refunds, returns, dashboard), promotions | 3.5 needs the shipping rules (open decisions) |
| 3 | Launch hardening pulled forward from Phase 10 | Backups, monitoring, proxy configuration for client addresses |

Later phases follow PROJECT_PLAN.md section 4, adjusted by the owner's priorities.

## Small follow-ups carried forward

- Orders: a billing address separate from delivery; order notes from the shopper; an "order received, waiting for payment" email.
- Orders: let a guest claim their past orders into an account by confirming the same email address.
- Orders: staff notes on an order, and the staff member's name in the order history (stored as an ID today).
- Checkout: express payment buttons and saved cards come with the real provider.
- Checkout: show stock holds per order to staff, and let staff extend a hold.

- Stock: transfers between locations, suppliers and purchase orders (receive against an order), CSV import of counts.
- Stock: a low-stock email to staff (with notifications, Milestone 3.6).
- Stock: "notify me when back in stock" for shoppers (needs consent; Phase 4).
- Stock: splitting one item across locations when no single location has enough (today each item comes from one location).
- Stock: a worker job to delete old released and committed holds (they are kept, not removed).

- Customers: staff screens to view one customer, disable or re-enable them, and handle data export and deletion requests (with admin customers, Milestone 3.7).
- Customers: worker job to delete expired customer sessions and used or expired emailed links (they are ignored, not removed).
- Customers: "change email address" and "change password while signed in" (today only through the reset link).
- Customers: sign in with Google or Apple, if the owner wants it (open decision).
- Addresses: country-specific region drop-downs and labels that change with the chosen country (the server already applies each country's rules).
- Translate account pages and emails when store languages are decided.

- Launch checklist item: set `ALLOW_SEARCH_INDEXING=true` on the live site only (decision D54), then submit the sitemap in the search engines' webmaster tools.
- SEO: a sitemap index when a store passes 45,000 pages; a share image for the home page; per-store description text (today a fixed sentence).
- Performance: measure timings on the deployed site with throttling (docs/PERFORMANCE.md lists what is not measured).

- Cart: worker job to delete carts that expired (they are ignored today, not removed).
- Cart: link a cart to a signed-in customer and merge the guest cart (with customer accounts, Phase 3).
- Cart: a small "added" panel with the picture, and a cart drawer, as enhancements over the page.
- Cart: abandoned-cart reminders need consent and customer contact details (Phase 4 marketing).

- Product page: zoom on the main picture; video; a size guide; previous and next buttons on the gallery for mouse users.
- Product page: gate the "recently viewed" cookie behind the consent choice once the banner exists (decision D49).
- Product page: show stock wording and availability in structured data once inventory exists (Milestone 3.2).
- Sort drop-down: a choice made in the instant before the page's script attaches is not submitted (the browser tests retry; without JavaScript a "Sort" button is shown).

- Storefront: admin screen to choose and order home page sections (today: Featured, New arrivals, Best sellers from the product flags).
- Storefront: filters by size and material; a price slider; infinite scroll as an enhancement over paging.
- Storefront: search suggestions and "did you mean"; synonyms; searching specification values.
- Storefront: caching of category and home pages (every page renders on request today).
- Storefront: translated interface text and right-to-left layout when the store's languages are decided (open decision).

- Media: cleanup job for files in storage that no row points to (left behind only if storage was unreachable during a delete; each case is logged).
- Media: drag-and-drop ordering and upload progress per file (buttons work today); crop or focal point.
- Media: background removal and video, behind the existing interfaces (with content tools, Phase 6).
- Media: production needs a public-read rule for `public/*` on the bucket (see `docker/storage-public-read-policy.json`) and ideally a CDN; set `S3_PUBLIC_URL` to it.

- Catalog: bulk import and export (CSV), duplicate a product, reorder variants, and a list filter by category.
- Catalog: length, width and height are stored per variant but not yet in the form.
- Catalog: `/api/v1/admin` endpoints for products (the admin pages use server actions; the API is needed for integrations and the AI tools in Phase 5).
- Catalog: stop a variant being deleted once an order refers to it (with orders, Milestone 3.3).

- Screen for the tenant setting "require two-factor for owners and managers" (with store settings, Milestone 3.7). Until then: `UPDATE tenants SET require_staff_two_factor = true WHERE slug = '…'`.
- Store selection within a tenant, and enforcing a membership's `store_ids`, when a tenant can have several stores.

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
