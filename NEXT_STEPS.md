# Next Steps

Prioritized continuation plan. The top item is always the next thing to do. Update at the end of every session.

## Instagram and Facebook (connected 2026-11-19)

The Page **Moonlight14a** and Instagram **@moonlight_14a** are connected from the admin. Done 2026-11-19: app published, webhooks verified through a tunnel (Meta's test notification accepted), Instagram message access on. **Blocker for real customers' messages: Advanced access** (Meta App Review and business verification): with Standard access Meta shows the app only people with a role on the app, so a DM from a normal follower does not reach the shop. Apply once the site is online (docs/META_SETUP.md Part 4). Facebook Messenger messages also need the Messenger use case (pages_messaging). Milestone 6.4 (social inbox) is built: messages and comments land in the Inbox, replies go back through Meta. Milestone 6.5 (publishing approved posts now or at the planned time) is built too, so Phase 6 is complete apart from TikTok. Real publishing needs the site online (Meta downloads the photos from the file storage). Next: launch hardening (security part 2), or Phase 8 (giveaways) once the prize structure is confirmed; applying for Advanced access once the site is online.

## Owner actions (do not block development)

1. Done 2026-11-13: the owner has a sign-in for the demo store. More staff: `pnpm admin:create --email someone@example.com --name "Name" --tenant demo --role store_manager`. Password-reset emails arrive at http://localhost:8025 in development.
2. The GitHub repository is currently **public**. Make it private in the repository settings if that is not intended.
3. Review the default role permissions (decision D24 in DECISIONS.md): who can refund, launch ads, run giveaway draws, export or delete customers.
4. Answer what you can in the open decisions table in DECISIONS.md.

## Owner: set up delivery, tax and store emails

Sign in to the admin:

1. **Delivery and tax**: done for delivery: one area, "All of Lebanon", $4.00 flat (change it there any time). Still to do: set your tax rate (0% until you set it; confirm it with your accountant).
2. **Store emails**: add the address(es) that should hear about new orders and low stock.
3. **Email (2026-11-20):** on this computer the shop now sends real email through Gmail (SMTP_HOST=smtp.gmail.com, port 587, a Gmail app password in .env). Fine for testing; before going live, prefer a sending service on the shop's own domain. **Before going live**: choose an email sending service (for example Brevo, Mailgun, Amazon SES or your host's SMTP) and put its SMTP details in the live site's settings (`EMAIL_PROVIDER=smtp`, `SMTP_HOST`, ...). Until then, emails only reach the local test inbox at http://localhost:8025.

## Owner: going live

Follow docs/DEPLOYMENT.md: a server, a domain, a managed database and Redis, file storage, an email sending service. Then run `pnpm launch:check --tenant <slug>` on the server and fix what it lists. In the admin: write and publish the policy pages, set the look and contact details, Store emails, and turn on two-factor sign-in.

## Owner: the Arabic shop

The demo store offers Arabic already. For each product and category, open it in the admin and fill in the **Arabic** box (name, descriptions); anything left empty shows the English. Write the Arabic policy pages under **Policy pages**. Please read the shop in Arabic once and tell us any wording you would like changed: the translations are in `packages/i18n/src/ar.ts`.

## Owner: the AI assistant

0. **Automatic replies:** open **AI assistant > Settings**, set **What the AI may do alone** to **Reply automatically...** and save. Fill in the **Business profile** first (delivery, returns, opening hours, what never to promise): automatic replies only use those facts and the shop's products, prices and stock.

1. Open **AI assistant** in the admin, fill in the **Business profile** (what you sell, your tone, what the AI must never promise) and try a few customer questions. Today it runs on the built-in test stand-in, which only quotes the first matching fact.
2. On any product, open **AI drafts**, try **Draft wording and search text** and **Draft Arabic wording**, and apply only the parts you like. With the test stand-in the Arabic draft is the English marked "[test translation]": dismiss it.
3. Groq is set up and tested (main model `openai/gpt-oss-120b`). Kimi needs a balance on platform.moonshot.ai before it answers anything; after topping up, set `AI_FALLBACK_PROVIDER=moonshot` (model `kimi-k3`) in `.env`. To set up from scratch: paste your Groq key into `GROQ_API_KEY` and your Moonshot key into `MOONSHOT_API_KEY` in `.env` (never in the repository). Run `pnpm ai:models groq` and `pnpm ai:models moonshot`, copy a model name into `GROQ_MODEL` and `MOONSHOT_MODEL`, then set `AI_PROVIDER=groq`, `AI_FALLBACK_PROVIDER=moonshot` and both prices to 0. Try it with `pnpm ai:try --tenant demo "How much is delivery?"` or on the AI page. Use made-up questions: free plans may keep what is sent.
4. Later, for Claude: create an API key at console.anthropic.com, set a spending limit there, and set `AI_PROVIDER=anthropic` and `AI_API_KEY`.

## Housekeeping

- When `picomatch` releases a fix for GHSA-fc5q-39xc-vjpf, update it and remove the entry from `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` (decision D100).

## Next development task: Phase 6 (content and social)

Phase 5 (AI foundation) is complete: the gateway (5.1), product drafts (5.2), the support inbox (5.3) and the evaluation set (5.4, D104; Groq scored 35 of 35). Run `pnpm ai:eval` again after changing the AI provider or a prompt. Milestones 6.1 (D105: content library, posts with approval, calendar, AI captions) and 6.2 (D106: photo versions for each platform, light correction, plain-background removal) are built. 6.3 to 6.5 are skipped until the owner's Meta accounts are ready (docs/META_SETUP.md). Milestone 7.1 is built (D107): marketing plan, campaigns with briefs, customer segments, tracking links with click counts on posts and campaigns. Milestone 7.2 is built (D108): competitor research typed by staff, price comparison with our products, AI opportunity ideas with scores that cite the observations. Milestone 7.4 is built (D109, D110): shop events without personal details, the Reports page with a 14-day forecast and products running out, and questions answered only from the figures. Next: Phase 8 (giveaways) once the owner confirms the prize and entry structure, otherwise Phase 10 readiness work; 7.3 waits for the ad account.

**Owner request (2026-11-25): a performance dashboard** showing which post or video got views, reach, likes and saves, and ad spend and results. Today: clicks on each post's tracking link, and orders with a campaign's discount code. Views, reach and ad results need the platforms' official data: Instagram and Facebook insights (Milestones 6.3 and 7.4, after the Meta app in docs/META_SETUP.md, with the `instagram_manage_insights` and `read_insights` permissions), ad spend and results (7.3, needs the ad account), TikTok video views (6.5). Build it as one **Performance** page once the accounts are connected.

**Owner question (2026-11-25): AI replies in Instagram and Facebook DMs.** Planned for 6.4: DMs come into the support inbox and get AI reply drafts like website messages; staff press Send (Q17: AI replies are always approved). Needs the Meta app and the messaging permissions (app review). Instagram, Facebook and TikTok publishing (6.3, 6.5) need the owner's accounts (Q10 to Q13).

## Owner: content planning

Open **Content library** in the admin and add a few of your own photos, with a note of who owns each one. Then **Content posts** → New post: pick the photos and products, plan a time, try **Draft a caption with AI**, and send it for approval. Whoever approves (owner, manager or marketer) approves it, you post it on Instagram yourself, then press **Mark as published** with the link. **Marketing plan**: add your campaigns for the year (goal, dates, channels, who it is for, the offer, a discount code). On a post, make a **tracking link** and put its short link in the caption or bio: each click is counted on the post and the campaign. **Customer segments** groups customers by their orders. **Competitor research**: add the shops you compete with, note what you see on their pages (prices, products, posts that work, offers) with the link, link a price to your similar product to compare, then **Draft ideas with AI** and keep the good ones. **Content calendar** shows the month. In the library, open **Sizes and versions** on a photo to make an Instagram, story or Facebook size, correct the light, or remove a plain background; the version is added to the library. Give staff who only prepare posts the "Content editor" role: they cannot approve or publish.

## Return rules (owner)

Returns are recorded by staff today with no time limit (decision D80). Tell me your rules (how many days, which items, who pays return delivery) to add shopper-started return requests and a returns policy page.

## Card payments (Milestone 3.4), waiting on the owner

Stripe and Tap Payments do not accept Lebanese merchants (decision D71). Apply to **areeba** and/or **NetCommerce** for an online merchant account. When approved, put the test credentials in `.env` on your computer only (never in chat or a commit) and share their integration guide; the gateway is then added behind the existing `PaymentProvider` interface, with refunds.

## Then, in order

| Order | Milestone | Notes |
| --- | --- | --- |
| 2 | Phase 4 per PROJECT_PLAN.md, adjusted by the owner's priorities | |
| 2a | 3.4 Card gateway (areeba or NetCommerce) | When the merchant account exists |
| 3 | Launch hardening pulled forward from Phase 10 | Backups, monitoring, proxy configuration for client addresses |

Later phases follow PROJECT_PLAN.md section 4, adjusted by the owner's priorities.

## Small follow-ups carried forward

- Storefront: the header lists every top-level category; with hundreds (the test store reached 959 after many test runs) the home page outgrows its 150 KB budget. Cap the menu (for example 12, then "All categories").
- Publishing: reels and stories through the API (video upload and processing), and TikTok once a TikTok developer app exists.

- Cash on delivery: a maximum order amount for cash, and a store setting to switch cash on delivery off.
- Store look: a home page banner image and text per store; more ready-made looks; a preview before saving.
- A script or admin screen for the platform owner to create a new store (tenant, store, web address, first owner) in one step.
- Import: update existing products by SKU (today a known SKU is reported, not changed); variant pictures (a picture per colour).
- Reviews: an email asking customers to review a few days after their order is sent (with an unsubscribe); guest buyers reviewing through their order link; photos in reviews.
- Customer photos: a poster frame for videos (needs a video tool on the server); longer videos through direct upload to storage; asking Instagram creators for permission through the official API (Phase 6).
- Support: saved replies (inbox.configure), attachments, customers replying by answering the email, Instagram and Facebook messages in the same inbox (Phase 6).
- Arabic: separate Arabic addresses (for example /ar/...) with hreflang so search engines index the Arabic shop; Arabic for colour and size names; Arabic in the bulk import spreadsheet; Arabic for staff-written store emails and the store's tagline.
- Launch: an admin screen to add a store's web address; error reporting to a service such as Sentry; copying backups off the server automatically; a smaller production image (Next.js standalone output).
- Dashboard: compare with the previous period; best-selling products.
- Returns: shopper-started return requests once the return rules are known; card refunds with the gateway.
- Emails: an HTML version with the store's logo, and Arabic wording (with right-to-left layout).
- Emails: a "delivery refused" note to the shopper, if the owner wants one.
- Emails: an outbox clean-up job that removes sent rows after some months.
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
