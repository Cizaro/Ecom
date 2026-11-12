# Next Steps

Prioritized continuation plan. The top item is always the next thing to do. Update at the end of every session.

## Owner actions (do not block development)

1. **Try signing in.** Create yourself a user with `pnpm admin:create --email you@example.com --name "Your Name" --tenant demo`, run `pnpm dev`, open http://localhost:3000/admin. Password-reset emails arrive at http://localhost:8025.
2. The GitHub repository is currently **public**. Make it private in the repository settings if that is not intended.
3. Review the default role permissions (decision D24 in DECISIONS.md): who can refund, launch ads, run giveaway draws, export or delete customers.
4. Answer what you can in the open decisions table in DECISIONS.md.

## Next development task: Milestone 1.5, design system, app shells, Content Security Policy

Scope:

1. **Design tokens and components** in `packages/ui` (buttons, fields, form messages, tables, empty states, page header), replacing the ad-hoc classes in the admin pages. Placeholder theme until brand assets arrive.
2. **Admin shell:** navigation built from the access registry and the user's permissions (so a link is shown only when the page would open), store switcher, mobile layout.
3. **Storefront shell:** header, footer, layout; resolve the store from the host name with `resolveStoreHost` (seed a `localhost` domain for the demo store).
4. **Content Security Policy** with nonces, added to the security headers and checked by the existing end-to-end header test.
5. **Carried over from 1.3:** QR code for two-factor setup; keep form values after a failed submit.

Done when: admin and storefront use the shared components, the CSP blocks inline scripts without a nonce, all checks pass, and status files are updated.

## Then, in order

| Order | Milestone | Notes |
| --- | --- | --- |
| 3 | 2.1 to 2.6 Catalog and storefront | First visible store content |
| 4 | 3.1 to 3.8 Checkout and operations | 3.4 needs payment provider test keys |
| 5 | Launch hardening pulled forward from Phase 10 | Backups, monitoring, proxy configuration for client addresses |

Later phases follow PROJECT_PLAN.md section 4, adjusted by the owner's priorities.

## Small follow-ups carried forward

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
