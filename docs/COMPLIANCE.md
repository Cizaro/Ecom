# Compliance

Last updated: 2026-11-11 (Phase 0)

This document lists the legal and platform-policy obligations the software is designed around. It is engineering guidance, not legal advice. Which rules apply depends on the countries the store operates in and sells to, which is still an open decision (see DECISIONS.md).

## 1. Paid giveaways and prize draws

**This is the highest compliance risk in the project and the owner should read this section before Phase 8.**

A campaign where people pay for a chance to win a prize chosen at random has the three elements (payment, chance, prize) that most legal systems use to define a lottery or gambling. Consequences vary by country and, in some countries, by state or region:

- In many jurisdictions, private paid lotteries are illegal or need a license. Operating one can carry criminal penalties.
- Some jurisdictions allow prize draws only if a genuinely equal free entry route exists, or only if the outcome depends on skill.
- Some jurisdictions prohibit games of chance entirely.
- Rules often depend on where each entrant is, not only where the store is.

Payment and platform rules apply separately from the law:

- Payment providers generally restrict or prohibit lotteries, raffles and pay-to-enter sweepstakes without prior written approval. Taking entry payments without approval risks a frozen account and withheld funds. Confirm with the chosen provider before taking real entry payments.
- Meta and TikTok have promotion and advertising policies for giveaways and for gambling-like promotions; ads may need prior authorization and geographic targeting.

**What the software does.** As instructed, the giveaway module is a normal feature the store administrator enables and configures; there is no mandatory legal-review gate in the product. The module gives the owner the controls needed to run a campaign lawfully where that is possible:

- Eligible countries and regions, and minimum age, enforced at entry.
- Optional free entry route with equal chance of winning.
- Per-campaign terms and conditions, privacy notice, refund and cancellation policy, shown before payment and stored with a version.
- Entry receipts and entry history.
- Cryptographically secure draw with a permanent audit record; no edits after the draw; redraws only with a recorded reason.
- Winner verification, disqualification and prize-fulfillment tracking.
- Entry-data export and administrator reports.
- Payment-provider abstraction, so a provider that permits this business model can be used.

**What remains the owner's responsibility.** Confirming that paid draws are lawful in each eligible country and region, obtaining any license or registration, obtaining payment-provider approval, any tax reporting on prizes, and the content of the terms. The admin screen for creating a campaign will show a short non-blocking reminder of this.

## 2. Privacy and data protection

Designed to meet the common requirements of GDPR-style laws; specific obligations depend on target countries.

| Obligation | Design |
| --- | --- |
| Lawful basis and consent for marketing | `ConsentRecord` per purpose with source, time and policy version; marketing email and SMS only where consent exists; one-click unsubscribe |
| Cookie consent | Consent banner; non-essential analytics and marketing tags load only after consent |
| Access and portability | Customer export job (account page and admin) |
| Erasure | Account deletion request; anonymization that preserves financial records required by law |
| Data minimization | Only required fields collected; AI gateway redacts personal data not needed for the task |
| Retention | Per-table retention defaults; documented in the data-retention guide |
| Processors | List of sub-processors (hosting, payment, email, AI, storage) maintained for the privacy page |
| Breach response | Audit logs and runbook in Phase 10 |
| Children | Store is not directed at children; giveaway minimum age enforced |

## 3. Payments

- Card data is entered only in the provider's hosted fields or page, keeping the application in the lightest PCI DSS scope. No card number or security code is stored, logged or sent to the application server.
- Only provider tokens, card brand and last four digits are stored.
- Strong customer authentication (for example 3-D Secure) is handled by the provider's flow.

## 4. Consumer protection and honest marketing

- No fake testimonials, fabricated sales figures, invented scarcity or misleading countdown timers. Reviews show a verified-purchase badge only when linked to a real order item. Timers are only shown for promotions with a real end time in the database.
- Compare-at prices should reflect a price the product was actually offered at; the admin shows this guidance.
- Clear total price, shipping cost, delivery estimate, returns and refund terms before payment. Cooling-off and return rights vary by country; return rules are configurable.
- AI-generated product copy is reviewed by a person before publishing by default.
- Paid partnerships and reused customer content need disclosure and permission; UGC permission status and expiry are tracked.

## 5. Email and SMS

- Transactional messages (order, shipping, account, giveaway receipt) are separated from marketing messages.
- Marketing needs recorded consent, sender identification, a postal address where required and a working unsubscribe.
- SMS marketing needs explicit consent and opt-out keywords; rules are strict in several countries.

## 6. Social platforms

- Only official APIs, within granted permissions and rate limits. Meta requires app review and business verification for most messaging and publishing permissions; TikTok requires an app audit for public posting. Both take time and can be refused.
- Messaging windows and automation disclosure rules on Meta platforms are respected; automated replies are identified where the platform requires it.
- Platform data-deletion callbacks are implemented; data obtained from a platform is deleted on disconnect or on user request as the platform terms require.
- No unofficial clients, credential sharing, or automation that imitates a person.

## 7. Competitor research

- Only publicly available information from sources that permit collection. No bypassing logins, CAPTCHAs, private accounts, access controls, robots.txt or rate limits.
- Most social platforms prohibit automated scraping in their terms. The default path for social competitor data is manual entry by staff or official APIs; automated fetching is limited to sites that allow it.
- Every observation stores its source URL, collection date and method.
- Competitor content is analyzed for patterns, not copied. Captions, images and videos are not reproduced.
- Public comments can contain personal data; they are stored minimally and not used to profile individuals.

## 8. AI

- Customers are told when they are talking to an automated assistant where law or platform policy requires it.
- AI output about stock, price, delivery, refunds, orders and policies is grounded in database facts.
- AI spam or fraud predictions never remove a customer or entry on their own; they flag for human review.
- Provider data-use and retention settings are reviewed when a provider is chosen; providers that train on customer data by default are configured not to, or not used.

## 9. Accessibility

Target: WCAG 2.2 level AA for storefront and admin. Keyboard navigation, focus management, semantic HTML, alt text, color contrast and reduced-motion support are part of the definition of done, with an accessibility review in Phase 10.

## 10. Tax and invoicing

Tax rules (VAT, GST, sales tax, invoicing format, cross-border duties) depend on the operating and destination countries. The system provides a tax-calculation abstraction, tax classes per product and configurable invoices. The owner or an accountant sets the rates and confirms invoice requirements.

## 11. SaaS (Phase 9)

When other businesses use the platform: terms of service, a data-processing agreement (the platform is a processor for tenant customer data), acceptable-use policy (including tenants' own responsibility for giveaway legality), sub-processor list, and tenant data export and deletion on termination.
