# Pricing: what each shop costs you, what you charge, and your margin

Last updated: 2026-12-02. A recommendation, not a rule: change any price in the platform panel (Platform > Plans). `pnpm platform:plans` creates the four monthly plans below on a new installation. Prices are in US dollars.

## 1. Where the numbers come from

- **AI cost per customer reply: about $0.0005.** Measured on this system: answering one Instagram or Facebook message uses about 1,400 tokens in and 480 out (sorting the message, then writing the reply) on Groq's `openai/gpt-oss-120b`, at $0.15 per million tokens in and $0.60 out (Groq list price, December 2026). **1,000 automatic replies cost about $0.50.** Kimi (the backup) costs roughly 3 to 4 times more, which is still small, and it is only used when Groq fails.
- **Server:** Hetzner CX33 (4 processors, 8 GB memory), about €9.50 a month including its IPv4 address after Hetzner's June 2026 price rise.
- **File storage (photos):** Cloudflare R2, $0.015 per GB a month, the first 10 GB free, no download fees.
- **Email:** about $0.35 per 1,000 emails with a sending service (Cloudflare Email Service; others are similar). Gmail works for testing only: it caps sending at about 500 a day.
- **Competitors:** Shopify Basic is $29 a month billed yearly or $39 billed monthly, with no AI. ManyChat Pro (Instagram message automation only, no shop) is $29 a month. Using both costs a Lebanese shop about $60 to $70 a month. Local agencies charge roughly $1,500 to $8,000 to build an online shop (rough figures from local agency blogs).

## 2. What it costs you

### Fixed costs (one installation that serves every shop)

| Item | Up to about 40 shops | About 40 to 150 shops |
| --- | --- | --- |
| Server(s) | $11 (one CX33) | $45 (a bigger app server plus a separate database server) |
| Server backups and off-site database copies | $3 | $8 |
| Domain for the platform (yearly cost, per month) | $1.25 | $1.25 |
| HTTPS for every shop address | Free (Let's Encrypt) | Free |
| Meta (Instagram and Facebook) | Free | Free |
| **Total** | **about $15 a month** | **about $55 a month** |

### Cost per shop each month

| Item | Typical small shop | At its plan's AI limit |
| --- | --- | --- |
| AI (replies, sorting, descriptions, captions, search) | $0.50 to $1 | the plan's AI limit (see below) |
| Emails (about 500 order and account emails) | $0.18 | $0.35 |
| Photos (about 2 GB) | $0.03 | $0.10 |
| Its share of the server (at 30 to 40 shops) | $0.40 | $0.40 |
| **Technology** | **about $1.50** | **AI limit + $0.85** |
| Your support time (20 to 60 minutes a month at $10 an hour) | $3 to $10 | |

The real cost of a shop is mostly **your time**, not the technology. Plans with priority support are priced for that.

## 3. Monthly plans

Every plan starts with a 14-day free trial, no card needed. Shops pay by Whish, OMT, bank transfer or cash; you record the payment in the panel.

| | **AI Assistant** | **Starter** | **Growth** | **Pro** |
| --- | --- | --- | --- | --- |
| **Price a month** | **$19** | **$29** | **$59** | **$119** |
| For | Instagram sellers who want automatic replies first | A small shop going online | A shop selling every day | Busy shops and brands |
| Online shop with free web address | ✓ (small catalog) | ✓ | ✓ | ✓ |
| Products | 50 | 150 | 1,000 | Unlimited |
| Staff accounts | 1 | 2 | 5 | 15 |
| AI replies on Instagram and Facebook, English and Lebanese Arabic | ✓ | ✓ | ✓ | ✓ |
| AI limit a month (real cost; about how many replies) | $1.50 (about 3,000) | $2 (about 4,000) | $6 (about 12,000) | $15 (about 30,000) |
| One inbox, AI sorting | ✓ | ✓ | ✓ | ✓ |
| Orders, stock, cash on delivery, delivery areas | | ✓ | ✓ | ✓ |
| Own domain (yourshop.com) | | | ✓ | ✓ |
| Scheduled posts with AI captions | | | ✓ | ✓ |
| Discounts, returns, reports with questions | | | ✓ | ✓ |
| Campaigns and customer segments | | | | ✓ |
| Support | Email | Email | WhatsApp | Priority WhatsApp |

### Your margin per plan

| Plan | Price | Typical cost (tech + support) | Margin | Worst case (AI at its limit + more support) | Margin |
| --- | --- | --- | --- | --- | --- |
| AI Assistant | $19 | $4.50 | 76% | $5.35 | 72% |
| Starter | $29 | $4.50 | 84% | $5.85 | 80% |
| Growth | $59 | $7 | 88% | $11.85 | 80% |
| Pro | $119 | $15 | 87% | $25.85 | 78% |

**Why these prices:** Starter at $29 gives a shop what Shopify ($29 to $39) and ManyChat ($29) give together for about $60 to $70, in Arabic, with cash on delivery and local payment, so it is easy to sell and still leaves over 80%. AI Assistant at $19 is the door-opener: most Lebanese shops sell through Instagram before they have a website, and it upgrades naturally to Starter. Growth is where most shops should land (own domain and scheduled posts are what they ask for next). Pro is priced for your time: more staff, more AI and priority support.

**Yearly payment (recommended):** 12 months for the price of 10. The panel bills plan price × months today, so for now give the discount by billing 10 months at once and telling the shop it covers 12 (or ask for a small change so a yearly invoice is discounted and extends the shop by 12 months).

## 4. One-time services (website and setup)

| Service | Price | What they get | Your cost |
| --- | --- | --- | --- |
| **Setup for you** | $149 | You choose the design, colours and logo, set delivery and policies, load up to 50 products, connect Instagram and Facebook | 4 to 6 hours of your time |
| **Website + AI package** | $899, then Growth at $59 a month (first 3 months included) | A design adjusted to their brand, up to 150 products loaded with AI descriptions in English and Arabic, the AI trained on their delivery and policies, Instagram and Facebook connected, a training call | 2 to 3 days of your time |
| **Custom design** | From $1,800, then Pro at $119 a month | A unique design for their brand, built on the same system and kept up to date by you | 1 to 2 weeks of your time |
| **More AI** | $5 for each extra $1 of AI limit (about 2,000 replies) | A higher AI limit for the month | $1 (80% margin) |
| **Domain registration** | Cost + $10 a year | You buy and connect their domain | $10 to $15 a year |

Agencies in Lebanon charge $1,500 to $8,000 for a shop website alone; the Website + AI package undercuts them while bringing in monthly income.

## 5. Selling the whole system

Three ways to sell the platform itself, from least to most final:

| Option | Price | What the buyer gets | Notes |
| --- | --- | --- | --- |
| **A. Managed white-label** (you host, their brand) | $1,500 setup + $15 per active shop a month (at least $300 a month) | An agency or entrepreneur sells shops under their own name and prices; you run the servers, updates and AI | Recurring income, no code handed over. Best first option. |
| **B. White-label licence** (non-exclusive, they host) | $14,900 one time + $390 a month for updates and support (optional) | The system installed on their servers under their brand, help setting up their own Meta app, 3 months of support | You can sell more licences. Needs a licence contract (no reselling the code). |
| **C. Full buyout** (exclusive, code ownership transferred) | From $75,000 | All the code, documentation, tests and rights; you stop selling it | Rebuilding a system like this (multi-shop, AI replies, Instagram and Facebook, admin, tests) takes a team many months. With paying shops it is worth more: software businesses commonly sell for a multiple of a year's recurring income. Use a lawyer and an escrow. |

## 6. An example month

20 shops: 5 AI Assistant, 8 Starter, 5 Growth, 2 Pro.

- Income: 5 × $19 + 8 × $29 + 5 × $59 + 2 × $119 = **$860 a month**
- Costs: fixed $15 + technology about $100 (AI at worst case) + your support time about $85 = **about $200**
- **Profit: about $660 a month (77%)**, before one-time setup and website packages.

The fixed costs are covered by your first paying shop.

## 7. Before you charge clients for AI replies

- **Meta approval is needed first.** Until Meta grants Advanced access (and Tech Provider status for managing other businesses' accounts), automatic replies only work for accounts with a role in your Meta app. Sell AI replies to clients after that approval (roadmap Stage A).
- **Only the AI limit is enforced today.** The products and staff limits, and which features each tier includes (own domain, scheduled posts, campaigns), are shown but not enforced yet: every shop can use every feature. Enforcing them is the next step before selling tiers.
- **AI cost counting:** the price of Groq's `openai/gpt-oss-120b` is now in the system's price list, so each shop's AI use counts at the real list price (before this, it counted as $0 because `.env` sets the fallback price to 0). If you switch to another model, add its price to `packages/ai/src/pricing.ts` or set `AI_INPUT_PRICE_PER_MTOK` and `AI_OUTPUT_PRICE_PER_MTOK`.
- **Payment fees:** Whish and OMT transfer fees are usually paid by the sender; say so on your payment instructions.
