# Next Steps

Prioritized continuation plan. The top item is always the next thing to do. Update at the end of every session.

## Owner actions (do not block development)

1. **Try signing in.** Create yourself a user with `pnpm admin:create --email you@example.com --name "Your Name" --tenant demo`, run `pnpm dev`, open http://localhost:3000/admin. Password-reset emails arrive at http://localhost:8025.
2. The GitHub repository is currently **public**. Make it private in the repository settings if that is not intended.
3. Review the default role permissions (decision D24 in DECISIONS.md): who can refund, launch ads, run giveaway draws, export or delete customers.
4. Answer what you can in the open decisions table in DECISIONS.md.

## Next development task: Milestone 2.5, cart

See PROJECT_PLAN.md section 4 (Phase 2) and docs/DATA_MODEL.md section 3.

1. `carts` and `cart_items` tables, tenant-scoped with Row-Level Security; a guest cart is found by an unguessable token in an HttpOnly cookie (strictly necessary, so no consent needed).
2. Cart services: add, change quantity, remove; prices always re-read from the variant, never trusted from the browser; a variant that is no longer for sale is flagged, not silently dropped.
3. "Add to cart" on the product page for the chosen variant (reuse `selectVariant`), with quantity; a cart page and a cart count in the header.
4. Limits: quantity bounds, items per cart, rate limit on cart changes.
5. Totals in minor units: subtotal only for now (shipping, tax and discounts come with checkout in Phase 3).
6. Tests: one visitor cannot read or change another's cart; another store's variant cannot be added; price changes are picked up; phone-width browser test.

## Then, in order

| Order | Milestone | Notes |
| --- | --- | --- |
| 2 | 2.6 Storefront: SEO (sitemap, robots, remaining metadata) | Product pages already have structured data, canonical and link-preview tags |
| 3 | 3.1 to 3.8 Checkout and operations | 3.4 needs payment provider test keys |
| 4 | Launch hardening pulled forward from Phase 10 | Backups, monitoring, proxy configuration for client addresses |

Later phases follow PROJECT_PLAN.md section 4, adjusted by the owner's priorities.

## Small follow-ups carried forward

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
