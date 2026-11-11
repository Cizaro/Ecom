# API Specification (plan)

Last updated: 2026-11-11 (Phase 0). This is the contract design. Once routes exist, the OpenAPI document is generated from the same Zod schemas the routes validate with and is served at `/api/v1/openapi.json`; that generated document then becomes authoritative.

## 1. Conventions

| Topic | Rule |
| --- | --- |
| Base path | `/api/v1`. Breaking changes go to `/api/v2`; additive changes do not bump the version. |
| Surfaces | `/api/v1/storefront/*` (public and shopper), `/api/v1/admin/*` (staff), `/api/v1/platform/*` (platform administrators), `/api/webhooks/*` (providers), `/api/health`, `/api/ready` |
| Format | JSON, UTF-8, camelCase fields, ISO 8601 UTC timestamps, money as `{ "amount": 1999, "currency": "USD" }` in minor units |
| Authentication | Staff and shoppers: secure, HTTP-only, same-site session cookies. Integrations: tenant API keys sent as a bearer token, stored hashed, scoped to permissions. |
| Tenant resolution | Storefront: from host name. Admin: from the session's active membership. API key: from the key. Never from a client-supplied tenant ID. |
| Authorization | Each route declares one required permission. Platform routes require platform administrator. |
| Validation | Zod schema per route for params, query and body. Unknown fields rejected. |
| Pagination | Cursor based: `?limit=25&cursor=...`; response has `pageInfo: { nextCursor, hasMore }`. Maximum limit 100. |
| Filtering | `?filter[status]=paid&filter[createdAt][gte]=2026-01-01`. Only whitelisted fields. |
| Sorting | `?sort=-createdAt,name`. Only whitelisted fields. |
| Search | `?q=...` on list routes that support it. |
| Idempotency | `Idempotency-Key` header required on POST routes that create payments, orders, refunds, giveaway entries, draws, publishes and ad launches. Same key and body returns the stored response; same key and different body returns 409. |
| CSRF | Cookie-authenticated mutations require a same-origin check plus CSRF token. |
| Rate limits | Per IP for anonymous, per user and per tenant otherwise. Stricter on login, password reset, checkout, giveaway entry and AI routes. 429 with `Retry-After`. |
| Request IDs | `X-Request-Id` returned on every response and logged. |

## 2. Error format

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Human-readable summary.",
    "details": [{ "field": "items[0].quantity", "issue": "must be at least 1" }],
    "requestId": "..."
  }
}
```

| Status | Codes |
| --- | --- |
| 400 | `validation_failed`, `invalid_request` |
| 401 | `unauthenticated` |
| 403 | `forbidden`, `feature_disabled`, `automation_paused` |
| 404 | `not_found` (also returned for records in another tenant) |
| 409 | `conflict`, `idempotency_mismatch`, `invalid_state_transition`, `insufficient_stock` |
| 422 | `not_eligible`, `limit_exceeded`, `capability_unavailable` |
| 429 | `rate_limited`, `quota_exceeded` |
| 5xx | `internal_error`, `provider_unavailable` |

`capability_unavailable` carries the message: "This feature is not available through the official API. Use the manual workflow instead."

## 3. Storefront API

| Area | Routes |
| --- | --- |
| Catalog | `GET /categories`, `GET /categories/{slug}`, `GET /products` (q, filters: category, brand, color, material, price range, availability; sort; pagination), `GET /products/{slug}`, `GET /products/{slug}/related`, `GET /brands` |
| Cart | `GET /cart`, `POST /cart/items`, `PATCH /cart/items/{id}`, `DELETE /cart/items/{id}`, `POST /cart/coupon`, `DELETE /cart/coupon` |
| Checkout | `POST /checkout`, `GET /checkout/{id}`, `PATCH /checkout/{id}` (addresses, shipping method), `GET /checkout/{id}/shipping-options`, `POST /checkout/{id}/pay` (returns provider client secret or redirect), `GET /checkout/{id}/status` |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `POST /auth/email/verify` |
| Account | `GET/PATCH /account`, `GET/POST/PATCH/DELETE /account/addresses`, `GET /account/orders`, `GET /account/orders/{number}`, `GET /orders/track` (number plus email, for guests), `GET/POST/DELETE /account/wishlist`, `GET /account/reviews`, `GET/PATCH /account/preferences`, `POST /account/export-request`, `POST /account/deletion-request` |
| Returns | `POST /account/orders/{number}/returns`, `GET /account/returns` |
| Reviews and UGC | `GET /products/{slug}/reviews`, `POST /products/{slug}/reviews`, `POST /reviews/{id}/report`, `GET/POST /products/{slug}/questions`, `POST /ugc`, `GET /ugc` (approved, permission granted), `POST /uploads/sign` |
| Support | `GET/POST /account/conversations`, `POST /account/conversations/{id}/messages`, `POST /contact` |
| Giveaways | `GET /giveaways`, `GET /giveaways/{slug}`, `POST /giveaways/{slug}/eligibility`, `POST /giveaways/{slug}/entries` (quantity; returns payment intent), `POST /giveaways/{slug}/free-entries`, `GET /account/giveaway-entries`, `GET /giveaways/{slug}/result` |
| Other | `POST /newsletter`, `POST /consent`, `POST /events` (analytics) |

## 4. Admin API

All under `/api/v1/admin`. Standard resources provide list, read, create, update and archive; only non-obvious routes are listed.

| Area | Routes beyond standard CRUD | Example permission |
| --- | --- | --- |
| Products, variants, categories, brands | `POST /products/{id}/duplicate`, `POST /products/import` (CSV, returns job), `GET /products/export`, `PUT /products/{id}/images/order` | `catalog.write` |
| Media | `POST /media/sign`, `POST /media/{id}/process` (resize, remove background, enhance; returns job) | `content.write` |
| Inventory | `GET /inventory/levels`, `POST /inventory/adjustments` (reason required), `GET /inventory/movements`, suppliers, purchase orders, `POST /purchase-orders/{id}/receive` | `inventory.adjust` |
| Orders | `POST /orders/{id}/transition`, `POST /orders/{id}/notes`, `POST /orders/{id}/cancel`, `POST /orders/{id}/refunds`, `POST /orders/{id}/shipments`, `GET /orders/{id}/invoice`, `POST /orders/{id}/notify` | `orders.manage`, `orders.refund` |
| Returns | `POST /returns/{id}/approve`, `/reject`, `/receive` | `returns.manage` |
| Customers | `POST /customers/{id}/notes`, `POST /customers/{id}/assign`, `POST /customers/{id}/export`, `POST /customers/{id}/delete` | `customers.read`, `customers.export`, `customers.delete` |
| Reviews and UGC | `POST /reviews/{id}/approve`, `/reject`, `/hide`, `/respond`; `POST /ugc/{id}/moderate`, `/request-permission` | `reviews.moderate` |
| Promotions | coupons, promotions | `promotions.write` |
| Content | assets, posts, calendars; `POST /posts/{id}/submit`, `/approve`, `/schedule`, `/publish` | `content.write`, `content.approve`, `social.publish` |
| Social | `GET /social/connections`, `POST /social/connections/{platform}/start`, `GET /social/connections/{platform}/callback`, `POST /social/connections/{id}/reconnect`, `DELETE /social/connections/{id}`, `GET /social/capabilities` | `social.connect` |
| Inbox | `GET /inbox/conversations`, `POST /inbox/conversations/{id}/assign`, `/tags`, `/notes`, `/reply`, `/escalate`, `/translate`; `GET /inbox/comments`, `POST /inbox/comments/{id}/reply`; saved replies; automation rules | `inbox.reply`, `inbox.configure` |
| AI | `POST /ai/tasks` (task name plus input; returns draft or job), `GET /ai/drafts`, `POST /ai/drafts/{id}/approve`, `/reject`, `PATCH /ai/drafts/{id}`; `GET /ai/usage`; `GET/PUT /ai/settings` (automation level, budget); `POST /ai/pause`, `POST /ai/resume`; prompt templates; brand voice | `ai.use`, `ai.configure` |
| Marketing | plans, campaigns, segments, UTM links; `POST /marketing/plans/generate`; `POST /campaigns/{id}/submit`, `/approve` | `marketing.write` |
| Ads | `POST /ads/drafts`, `GET /ads/drafts/{id}/preview`, `POST /ads/drafts/{id}/launch` (requires explicit confirmation body naming the account and budget), `POST /ads/campaigns/{id}/pause`, `POST /ads/pause-all`, `GET /ads/campaigns/{id}/metrics` | `ads.draft`, `ads.launch` |
| Research | competitors, observations; `POST /research/competitors/{id}/collect` (job), `POST /research/analyze` | `research.write` |
| Giveaways | campaigns, prizes, rules; `POST /giveaways/{id}/open`, `/close`, `/cancel`; `GET /giveaways/{id}/entries`, `POST /giveaways/entries/{id}/flag`, `/exclude`, `/refund`; `POST /giveaways/{id}/draw`; `POST /giveaways/{id}/redraw` (reason required); `POST /giveaways/winners/{id}/verify`, `/disqualify`; `PATCH /giveaways/winners/{id}/fulfillment`; `GET /giveaways/{id}/audit`, `GET /giveaways/{id}/entries/export` | `giveaways.manage`, `giveaways.draw` |
| Reporting | `GET /reports/overview`, `/sales`, `/products`, `/inventory`, `/marketing`, `/giveaways`, `/ai`; `?format=csv`; `POST /reports/ask` (natural-language analytics) | `reports.read` |
| Settings | store, shipping zones and rates, tax, notifications, templates, staff, roles, feature flags, API keys | `settings.write`, `staff.manage` |
| Jobs | `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/retry` | `jobs.read` |
| Audit | `GET /audit-log` | `audit.read` |

## 5. Platform API

`/api/v1/platform`: tenants (create, suspend, resume, export), plans, subscriptions, usage, feature flags, cross-tenant job and queue status, impersonation with audit and a visible banner.

## 6. Webhooks (inbound)

| Route | Verification |
| --- | --- |
| `POST /api/webhooks/payments/{provider}` | Provider signature over the raw body with a timestamp tolerance |
| `GET /api/webhooks/meta` | Verify-token challenge |
| `POST /api/webhooks/meta` | `X-Hub-Signature-256` HMAC with the app secret |
| `POST /api/webhooks/tiktok` | Provider signature |
| `POST /api/webhooks/shipping/{provider}` | Provider signature or shared secret |
| `POST /api/webhooks/meta/data-deletion` | Signed request; starts the data-deletion flow and returns a status URL |

Processing: verify signature on the raw body, store the event, return 2xx quickly, process from a queue. Duplicate event IDs are acknowledged and skipped. Failed processing retries with backoff, then moves to the dead-letter queue.

## 7. Background job status

Long operations return `202 Accepted` with `{ "jobId": "..." }`. `GET /admin/jobs/{id}` returns `status` (queued, running, succeeded, failed), `progress`, `result` or `error`.
