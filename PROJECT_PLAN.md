# Project Plan

Last updated: 2026-11-11 (Phase 0)

## 1. Repository assessment

| Item | Finding |
| --- | --- |
| Working folder | `C:\Users\user\Desktop\Personal` contained no ecommerce code. Its only content is an unrelated project (`Gold bot trading`), which was left untouched. |
| This repository | Created new at `Personal\ecommerce-platform` with its own Git history. |
| Existing stack, database, auth, APIs, env vars | None. Greenfield. |
| Tools on this machine | Git 2.51 is installed. Node.js, npm/pnpm, Docker, PostgreSQL, Redis and Python are **not** installed. |
| Consequence | No code can be run, tested or built on this machine until Node.js and Docker (or a hosted Postgres/Redis) are installed. Phase 1 starts with that. |

## 2. Product requirements (summary)

**Product.** One platform where a store owner sells products online, runs operations (stock, orders, shipping, returns), talks to customers across social channels, plans and produces marketing content with AI help, and runs paid prize-draw campaigns.

**Users.**
- Shoppers: browse, buy, track orders, review, enter giveaways. Mostly on phones.
- Store staff: owner, manager, inventory manager, marketer, customer-service agent, content editor.
- Platform administrator: operates the SaaS across tenants (later).

**First release goal.** The owner's own store can take real orders: catalog, cart, checkout, payment, order handling, inventory, customer accounts, admin. Everything else builds on that.

**Product rules that apply everywhere.**
- No fake testimonials, sales numbers, scarcity or countdown timers.
- AI never invents stock, prices, discounts, delivery dates, order status, refund eligibility or policies. Those come from the database or the answer says the information is unavailable.
- No advertising spend, social publishing or automatic customer reply happens without the configured human approval.
- Only official platform APIs. Where one does not exist the UI says: "This feature is not available through the official API. Use the manual workflow instead."
- Every tenant-owned record is isolated by tenant.

**Out of scope for now.** Native mobile apps, marketplace (multi-vendor in one storefront), POS, own courier integration beyond a provider abstraction and one adapter.

## 3. Recommended technology stack

See [ARCHITECTURE.md](ARCHITECTURE.md) for structure and [DECISIONS.md](DECISIONS.md) for reasoning.

| Concern | Choice |
| --- | --- |
| Language | TypeScript, strict mode |
| Web framework | Next.js, App Router (storefront, admin, API route handlers) |
| UI | Tailwind CSS, shadcn/ui on Radix primitives |
| Database | PostgreSQL, Prisma ORM, Row-Level Security for tenant isolation |
| Jobs | BullMQ on Redis, separate worker process |
| File storage | S3-compatible (RustFS locally) |
| Auth | Better Auth (email/password, OAuth, TOTP MFA); sessions in Postgres |
| Validation | Zod schemas shared by API, forms and AI output validation |
| Payments | `PaymentProvider` interface; mock adapter first, Stripe adapter second |
| Search | PostgreSQL full-text search behind a `SearchProvider` interface |
| AI | Central gateway; adapters for Anthropic, OpenAI-compatible APIs, and a mock |
| i18n | next-intl; locale and currency per store; RTL-capable layout |
| Tests | Vitest (unit, integration against real Postgres), Playwright (end to end) |
| Tooling | pnpm workspaces, ESLint, Prettier, GitHub Actions |
| Deployment | Docker images for web and worker; docker-compose for local and staging |
| Observability | pino structured logs, Sentry, health and readiness endpoints, Bull Board |

Exact versions are pinned when the project is scaffolded (Milestone 1.1) and recorded in `package.json`, `.nvmrc` and PROJECT_STATUS.md. They are not listed here because none have been installed or verified yet.

## 4. Phases and milestones

Each milestone is small enough to review, ends with lint, type check, tests and build passing, and ends with a commit and updated status files.

Size key: S = about a session, M = several sessions, L = many sessions. These are relative sizes, not promises. The whole program is large: many months of work for one developer with AI assistance. Phases 1 to 3 are the path to a store that can sell.

| # | Milestone | Size | Needs from owner |
| --- | --- | --- | --- |
| **Phase 1: Foundation** | | | |
| 1.1 | Scaffold monorepo, tooling, CI, docker-compose, env validation, health-check command | S | Node.js and Docker installed |
| 1.2 | Database schema for tenancy, users, roles, audit log; migrations; seed | M | |
| 1.3 | Authentication, sessions, MFA for admins, password reset | M | |
| 1.4 | Permission system, tenant context, RLS, tenant-isolation test suite | M | |
| 1.5 | Design system, layouts (storefront and admin shells), error handling, logging | M | Brand colors, logo |
| **Phase 2: Storefront and catalog** | | | |
| 2.1 | Catalog schema and admin CRUD: categories, brands, products, variants | M | |
| 2.2 | Media upload to S3, image variants, alt text, ordering | M | |
| 2.3 | Homepage, category pages, filters, sorting, pagination, search | L | Launch categories |
| 2.4 | Product page: gallery, variants, stock status, related products | M | |
| 2.5 | Cart (drawer and page), wishlist | M | |
| 2.6 | SEO: metadata, sitemap, robots, structured data; static pages | S | Policy text |
| **Phase 3: Checkout and operations** | | | |
| 3.1 | Customer accounts, addresses | M | |
| 3.2 | Inventory: locations, levels, reservations, stock movements | M | Inventory model |
| 3.3 | Checkout, order state machine, mock payment provider, webhooks | L | |
| 3.4 | Real payment provider adapter in sandbox | M | Provider choice, test keys |
| 3.5 | Shipping and tax abstractions, shipments, tracking | M | Shipping model |
| 3.6 | Notifications (email), templates, preferences | M | Email provider |
| 3.7 | Admin: orders, refunds, returns, customers, dashboard, CSV export | L | Return rules |
| 3.8 | Coupons and promotions | M | |
| | **→ First launch candidate (single store)** | | Domain |
| **Phase 4: Reviews, UGC, CRM** | | | |
| 4.1 | Reviews, moderation queue, responses, reports | M | |
| 4.2 | UGC uploads, permission tracking, reels gallery | M | |
| 4.3 | Support conversations, customer profile timeline, notes | M | |
| **Phase 5: AI foundation** | | | |
| 5.1 | AI gateway: providers, templates, validation, quotas, audit, kill switch | L | AI provider, budget |
| 5.2 | Product copy, SEO, tags, translation, categorization | M | |
| 5.3 | Classification (intent, complaint, spam, abuse) and reply drafts with approval | M | Approval policy |
| 5.4 | AI evaluation tests and prompt-injection tests | M | |
| **Phase 6: Content and social** | | | |
| 6.1 | Asset library, content posts, calendar, approval workflow | M | |
| 6.2 | Image processing: resize per platform, background removal, enhancement | M | Image provider |
| 6.3 | Social integration framework, Meta OAuth, webhooks | L | Meta Business account, app review |
| 6.4 | Social inbox: comments and messages, assignment, SLA, AI suggestions | L | |
| 6.5 | Publishing and scheduling where supported; TikTok | L | TikTok developer app |
| **Phase 7: Marketing and research** | | | |
| 7.1 | Marketing plans, campaign briefs, segments, UTM links | M | |
| 7.2 | Competitor research center, observations, opportunity scoring | L | |
| 7.3 | Meta Ads drafts, preview, confirmation, metrics sync, kill switch | L | Ad account |
| 7.4 | Analytics events, reporting, natural-language analytics, forecasting | L | |
| **Phase 8: Giveaways** | | | |
| 8.1 | Campaign configuration, prizes, rules, public page | M | Prize and price structure |
| 8.2 | Eligibility, paid and free entries, receipts, entry history | M | Payment provider approval (see COMPLIANCE.md) |
| 8.3 | Fraud signals and review tools | M | |
| 8.4 | Automatic close, secure draw, audit, redraw, notification, fulfillment | M | |
| **Phase 9: Multi-tenant SaaS** | | | |
| 9.1 | Tenant onboarding, store creation, branding, custom domains | L | |
| 9.2 | Plans, subscription billing, usage limits, AI budgets | L | Pricing |
| 9.3 | Platform administration, tenant analytics, data export | M | |
| **Phase 10: Production readiness** | | | |
| 10.1 | Security review, accessibility review, performance pass | M | |
| 10.2 | Backups, restore test, monitoring, alerting, runbooks | M | Hosting choice |
| 10.3 | Final documentation set (the 24 completion deliverables), staged launch | M | |

Tenant isolation is built in Phase 1 and holds from the first table, so Phase 9 adds onboarding and billing rather than retrofitting isolation. Production-readiness items needed for a real launch (backups, monitoring, security headers) are pulled forward before the first launch candidate.

## 5. Dependency list

**To install on each development machine:** Git, Node.js (current LTS), pnpm, Docker Desktop (runs PostgreSQL, Redis, RustFS, Mailpit locally).

**External accounts, by the phase that first needs them:**

| Phase | Account | Purpose | Notes |
| --- | --- | --- | --- |
| 1 | GitHub (or other Git host) | Remote repository, CI, moving between computers | Needed now |
| 3 | Payment provider | Checkout | Sandbox keys first |
| 3 | Email provider | Order and account email | SMTP or API |
| 3 | Domain and hosting | Launch | |
| 5 | AI provider | All AI features | Mock provider until chosen |
| 6 | Meta developer app, Business account, Facebook Page, Instagram professional account | Inbox, publishing | App review takes time; start early |
| 6 | TikTok developer app | Publishing, limited data | Audit required for public posting |
| 6 | Image-processing provider | Background removal, enhancement | Could be self-hosted |
| 7 | Meta ad account | Ads workflow | |
| 10 | Sentry, uptime monitor | Error tracking, alerting | |

## 6. Risk list

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Paid random prize draws are regulated as lotteries or gambling in many jurisdictions and are restricted by payment providers | High | High | Module is fully configurable (countries, age, free entry, terms). Owner confirms legality for target countries and gets provider approval before taking real payments. See COMPLIANCE.md. Not gated in software, per owner instruction. |
| R2 | Social platform APIs do not support a requested feature, or app review is refused or slow | High | Medium | Capability detection per platform; manual workflow fallback; apply for review early in Phase 6 |
| R3 | Scope is very large; first launch slips | High | High | Launch on Phases 1 to 3; everything later is additive and feature-flagged |
| R4 | Cross-tenant data leak | Low | Critical | Tenant-scoped data access layer plus Postgres RLS plus an automated isolation test suite that runs in CI |
| R5 | AI states wrong facts to customers or follows injected instructions | Medium | High | Facts only from verified tool results; structured output validation; approval levels; sensitive topics routed to humans; global pause |
| R6 | AI, storage, notification or social API costs run away | Medium | Medium | Per-tenant quotas and budgets, hard caps, usage dashboard |
| R7 | Overselling or double charging under concurrency | Medium | High | Stock reservations in transactions, idempotency keys, idempotent webhooks, tests for races |
| R8 | Unintended ad spend | Low | High | Draft-only by default, full preview, explicit admin confirmation, kill switch, never in automated tests |
| R9 | Competitor research breaches platform terms | Medium | Medium | Public, permitted sources only; honor robots.txt and rate limits; store provenance; manual entry as default path |
| R10 | Work lost or stranded between computers | Medium | High | Everything in Git; status files updated every session; a remote must be added (open decision) |
| R11 | Privacy-law obligations (consent, deletion, export) missed | Medium | High | ConsentRecord, deletion and export workflows in the core model from Phase 1 |

## 7. Assumptions

Used until the owner decides otherwise. Each is a configuration value or an adapter, not hard-coded. The matching open questions are in [DECISIONS.md](DECISIONS.md).

1. First version serves one store, built on the multi-tenant model from day one.
2. Default currency USD, default language English; the model supports multiple currencies and languages, including right-to-left.
3. Inventory is owned and held by the store at one location.
4. Flat-rate shipping by zone to start; carrier integration later through the shipping abstraction.
5. Stripe in test mode is the first real payment adapter; the mock adapter is used until keys exist.
6. AI replies to customers always require human approval at launch.
7. Launch catalog is under 500 products across the five named categories.
8. Guest checkout is allowed.
9. Prices are stored tax-inclusive or tax-exclusive per store setting; default exclusive with a tax-calculation abstraction.
10. Giveaway defaults: entry price 1 USD, maximum 10 entries per customer, minimum age 18, single winner. All configurable per campaign.

## 8. Prioritized backlog

**P0, required to sell (Phases 1 to 3).** Milestones 1.1 through 3.8 in order.

**P1, strongly expected soon after launch.** Reviews (4.1), AI gateway and product copy (5.1, 5.2), content library and calendar (6.1), giveaways (8.1 to 8.4) if the owner confirms R1.

**P2, growth.** Social integrations and inbox (6.3 to 6.5), reply drafts (5.3), marketing plans (7.1), UGC (4.2), support conversations (4.3).

**P3, later.** Competitor research (7.2), Meta Ads (7.3), advanced analytics and forecasting (7.4), SaaS (Phase 9).

Giveaways can move ahead of other P1 items if they are central to the launch; they depend only on Phases 1 to 3.

The immediate next task is always in [NEXT_STEPS.md](NEXT_STEPS.md).
