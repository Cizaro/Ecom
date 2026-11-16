# Next Steps

Prioritized continuation plan. The top item is always the next thing to do. Update at the end of every session.

## Owner actions (do not block development)

1. Done 2026-11-13: the owner has a sign-in for the demo store. More staff: `pnpm admin:create --email someone@example.com --name "Name" --tenant demo --role store_manager`. Password-reset emails arrive at http://localhost:8025 in development.
2. The GitHub repository is currently **public**. Make it private in the repository settings if that is not intended.
3. Review the default role permissions (decision D24 in DECISIONS.md): who can refund, launch ads, run giveaway draws, export or delete customers.
4. Answer what you can in the open decisions table in DECISIONS.md.

## Owner: set up delivery and tax

Sign in to the admin and open **Delivery and tax**:

1. Add your delivery areas, for example "Beirut" (country code LB, $3.00), "Mount Lebanon" (LB, $4.00), "Other areas" (LB, $5.00). Leave "Free delivery over" empty or enter an amount.
2. Enter your tax rate and whether your prices already include it. It is 0% until you set it; confirm the rate with your accountant.
3. When you mark an order as sent, you can add the courier, tracking number and tracking link; the shopper sees them on their order.

## Next development task: Milestone 3.6, notifications

1. Email templates in one place (order confirmed, sent with tracking, cash received, cancelled, delivery refused), with the store's name and links.
2. A "your order is on its way" email when staff mark it sent, including courier and tracking.
3. Staff notifications: a new order, and low stock (carried over from 3.2).
4. Shopper email preferences where the law requires them (marketing email stays off until asked for).
5. Tests: each email goes to the right person, once, with the right store and no data from another store; a failed email never undoes the order change.

## Card payments (Milestone 3.4), waiting on the owner

Stripe and Tap Payments do not accept Lebanese merchants (decision D71). Apply to **areeba** and/or **NetCommerce** for an online merchant account. When approved, put the test credentials in `.env` on your computer only (never in chat or a commit) and share their integration guide; the gateway is then added behind the existing `PaymentProvider` interface, with refunds.

## Then, in order

| Order | Milestone | Notes |
| --- | --- | --- |
| 2 | 3.7 and 3.8 Admin order tools (returns, dashboard, CSV export), promotions | 3.7 needs the return rules (open decision Q22) |
| 2a | 3.4 Card gateway (areeba or NetCommerce) | When the merchant account exists |
| 3 | Launch hardening pulled forward from Phase 10 | Backups, monitoring, proxy configuration for client addresses |

Later phases follow PROJECT_PLAN.md section 4, adjusted by the owner's priorities.

## Small follow-ups carried forward

- Cash on delivery: a maximum order amount for cash, and a store setting to switch cash on delivery off.
- Delivery: correcting a shipment's tracking after it was recorded, and more than one parcel per order.
- Delivery: offer only the areas for the country chosen in the checkout form (today every area is listed and a mismatch is refused with a message).
- Delivery: a delivery time per area, once the owner can state one truthfully.
- Storefront: the card gateway's payment link is built from APP_URL; on a custom store domain it should use the store's own domain.
- Cash on delivery: a courier view or export of today's parcels with phone numbers and amounts to collect.
- Cash on delivery: flag customers whose deliveries were refused before (staff decide; no automatic blocking).

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
