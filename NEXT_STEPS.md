# Next Steps

Prioritized continuation plan. The top item is always the next thing to do. Update at the end of every session.

## Owner actions (do not block development)

1. **Try signing in.** Create yourself a user with `pnpm admin:create --email you@example.com --name "Your Name" --tenant demo`, run `pnpm dev`, open http://localhost:3000/admin. Password-reset emails arrive at http://localhost:8025.
2. The GitHub repository is currently **public**. Make it private in the repository settings if that is not intended.
3. Review the default role permissions (decision D24 in DECISIONS.md): who can refund, launch ads, run giveaway draws, export or delete customers.
4. Answer what you can in the open decisions table in DECISIONS.md.

## Next development task: Milestone 2.3, storefront listing

See PROJECT_PLAN.md section 4 (Phase 2).

1. Public catalog reads in `packages/core`: only published products with at least one active variant, in the store resolved from the host; no cost prices or draft data ever leave the server.
2. Homepage sections (featured, new arrivals, categories with their images) replacing the placeholder storefront.
3. Category pages with sub-categories, filters (price, brand, colour), sorting and pagination in the URL.
4. Search by name, description and SKU using PostgreSQL full-text (`search_vector`), behind the `SearchProvider` interface.
5. Product cards using the resized images (`srcset`), with real prices and honest sale display (decision D37).
6. Tests: a draft or archived product and another tenant's product never appear; filters and paging; phone-width browser test.

## Then, in order

| Order | Milestone | Notes |
| --- | --- | --- |
| 2 | 2.4 to 2.6 Storefront: product page, cart, SEO | |
| 3 | 3.1 to 3.8 Checkout and operations | 3.4 needs payment provider test keys |
| 4 | Launch hardening pulled forward from Phase 10 | Backups, monitoring, proxy configuration for client addresses |

Later phases follow PROJECT_PLAN.md section 4, adjusted by the owner's priorities.

## Small follow-ups carried forward

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
