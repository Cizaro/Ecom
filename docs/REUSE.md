# Reusing this platform for other shops and other businesses

The owner wants the system built "like a puzzle": pieces that can be used again for another shop, another client, or another kind of business. This page says, plainly, what can be reused today, what needs work, and the rules new work must follow so it stays that way.

## What can be reused today

| You want | How | Effort |
| --- | --- | --- |
| **Another shop on the same installation** (a second brand, a client's store) | Create a tenant and a store, point its web address at the app. It gets its own products, orders, customers, staff, emails and settings. Stores never see each other's data: the database enforces it on every query. | Minutes. No code. |
| **A different look for that shop** | Admin, **Store and look**: logo, main colour, accent colour, corner style, font, tagline, contact details, or a ready-made look. The storefront is one template; each store supplies its own values. | Minutes. No code. |
| **A deeper redesign for one client** (different layout, new sections) | The storefront pages are in `apps/web/src/app/(storefront)`. They use the shared components in `packages/ui` and named design tokens, never fixed colours. Change the pages or add a second set of pages; the business logic underneath does not change. | Days. Front-end code only. |
| **A separate copy for a client who wants their own server** | Deploy the same code again with its own database and `.env`. Nothing is tied to one company. | Hours. No code. |
| **The shop in Arabic** (or not) | Admin, **Store and look**: tick "Offer the shop in Arabic too". Shoppers get a button in the header; English stays the default. Add Arabic names to products and categories, and Arabic policy pages. All shop wording is already translated in `packages/i18n`. | Minutes. No code. |
| **Another language** (French, for example) | Add a catalog file beside `packages/i18n/src/ar.ts` and the language to the list there and in the database checks; the completeness test lists every phrase to translate. | Days. Translation work, little code. |
| **A different kind of product** (clothes, shoes, cosmetics, home goods, electronics accessories) | Nothing in the code knows it sells bags. Products have variants (colour, size), free-form details, categories and brands that staff define. | None. Just enter the catalog. |

## What needs new work

| You want | What is missing |
| --- | --- |
| **A business that does not sell physical items** (a clinic, a restaurant, a salon, a course) | Bookings, menus, appointments or subscriptions are not built. The reusable parts are the foundation: tenants, staff and permissions, customers, payments, notifications, media, settings, audit log, reports. A new module (for example "bookings") would sit beside "orders" and use that foundation. |
| **The AI assistant** | Not built yet (Phase 5). It must follow the rules below so it works for any business. |
| **Other languages and right-to-left layout** | The storefront text is English only for now. |
| **Other countries' payment gateways** | Each gateway is one adapter behind the `PaymentProvider` interface. |

## How the pieces fit (and why they come apart)

- **`packages/core`** holds the business rules, one folder per piece: catalog, inventory, orders, payments, shipping, promotions, reviews, notifications, customers, reports, media, tenancy. Pieces talk through exported functions, not through each other's tables.
- **Every outside service is an adapter** behind an interface: payments, email, file storage, and later AI, search and social networks. Swapping a provider never touches the business rules.
- **`packages/ui`** is the component kit. Components use tokens (`bg-brand`, `rounded-card`), so a new look is new token values, not new components.
- **`apps/web`** is the website (storefront and admin). **`apps/worker`** runs background jobs. Either can be replaced or added to (a mobile app could call the same core).
- **Tenancy is in the database**, not in the application: Row-Level Security limits every query to one tenant, so a reused piece cannot leak another client's data by mistake.

## Rules for new work, so reuse keeps working

1. **No business-specific words in code.** Not "bag", not "Lebanon". What a store sells, where it delivers and how it looks are data the store enters.
2. **Settings over constants.** A value one client might want different (a fee, a limit, a colour, a text) is a store setting with a sensible default.
3. **Interfaces for outside services.** One adapter per provider; the mock adapter comes first, so everything is testable without accounts.
4. **Pieces depend on the foundation, not on each other's insides.** A new module may use tenancy, permissions, customers, media and notifications; it reaches other modules only through their exported functions.
5. **Everything tenant-scoped,** with a test that one store cannot see another's.

## Rules for the AI module (Phase 5), decided before it is built

The owner wants the AI part to be redirected to a different business by giving it that business's data. So:

1. **The AI module knows nothing about bags, or even about shops.** It lives in its own package and depends only on interfaces. It can be lifted into another project.
2. **Business knowledge comes through a "knowledge source" interface.** The first adapter reads this platform's catalog, stock, prices, delivery areas, policies and orders. Another business supplies another adapter (a services list, a menu, a document folder, an FAQ) and the AI works with it unchanged.
3. **A "business profile" per store** tells the AI what the business is: what it does, its tone of voice, its languages, what it may promise, when to hand over to a person. It is data staff edit, not text in code.
4. **Prompts are templates** filled from the profile and the knowledge source, with a default set per kind of business. No prompt mentions a product category.
5. **What the AI may do is a list of registered abilities** ("look up an order", "check availability"), each provided by the business's adapter. A clinic registers "find a free appointment" instead.
6. **Facts only from the knowledge source.** The AI never invents stock, prices, dates or policies; when the source has no answer it says so. This is checked, not hoped for.
7. **Tests use a second, made-up business** (not a shop) from the first day, so an e-commerce assumption fails a test instead of surprising a later client.
8. **Each store's data, budget and audit trail stay its own.**
