# Next Steps

Prioritized continuation plan. The top item is always the next thing to do. Update at the end of every session.

## Owner actions (do not block development)

1. **Try signing in.** Create yourself a user with `pnpm admin:create --email you@example.com --name "Your Name" --tenant demo`, run `pnpm dev`, open http://localhost:3000/admin. Password-reset emails arrive at http://localhost:8025.
2. The GitHub repository is currently **public**. Make it private in the repository settings if that is not intended.
3. Review the default role permissions (decision D24 in DECISIONS.md): who can refund, launch ads, run giveaway draws, export or delete customers.
4. Answer what you can in the open decisions table in DECISIONS.md.

## Next development task: Milestone 2.2, product media

See PROJECT_PLAN.md section 4 (Phase 2) and docs/DATA_MODEL.md section 2.

1. `media_assets` and `product_images` tables, tenant-scoped with Row-Level Security and same-tenant triggers (pattern: the catalog migration).
2. Storage provider interface with the S3 adapter (the local RustFS service is already running); object keys prefixed with the tenant ID.
3. Upload from the product page: type and size limits checked on the server from the file's content, not its name; images re-encoded so metadata such as location is removed.
4. Resized versions made by a worker job; alt text; drag or button ordering; one image marked as the main one; images optionally tied to a variant.
5. Category image and brand logo (the two columns left out in 2.1).
6. Tests: isolation (another tenant cannot read, attach or delete an asset), upload validation, and a browser test of upload and reorder.

## Then, in order

| Order | Milestone | Notes |
| --- | --- | --- |
| 2 | 2.3 to 2.6 Storefront: listing, product page, cart, SEO | First visible store content |
| 3 | 3.1 to 3.8 Checkout and operations | 3.4 needs payment provider test keys |
| 4 | Launch hardening pulled forward from Phase 10 | Backups, monitoring, proxy configuration for client addresses |

Later phases follow PROJECT_PLAN.md section 4, adjusted by the owner's priorities.

## Small follow-ups carried forward

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
