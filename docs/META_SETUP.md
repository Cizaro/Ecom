# Connecting Instagram, Facebook and TikTok: owner checklist

**Status (2026-11-24): skipped for now.** Milestones 6.3 (connecting Meta), 6.4 (social inbox), 6.5 (publishing and TikTok) and 7.3 (Meta ads) wait on the accounts below. Development moved on to Phase 7 (7.1, 7.2, 7.4) in the meantime. Until they are connected, posts are planned and approved in the admin and posted by hand (decision D105).

Do these steps when you are back home, in order. Use your own phone and computer; never send passwords, codes or the app secret to anyone, including in chat. When a step says "put it in `.env`", that is the `.env` file on your computer only, never `.env.example` and never a commit.

## Part 1: accounts (about 30 minutes)

1. **Instagram professional account.** In the Instagram app: your profile → menu → **Settings and activity** → **Account type and tools** → **Switch to professional account** → choose **Business** and a category (for example "Shopping & retail"). Free.
2. **Facebook Page for the shop.** If the shop has no Page: on Facebook, **Pages** → **Create new Page**, with the shop's name and category. You must be an admin of the Page.
3. **Link Instagram to the Page.** On the Facebook Page: **Settings** → **Linked accounts** → **Instagram** → connect, and sign in to the shop's Instagram there.
4. **Meta Business portfolio.** Go to business.facebook.com, create a business portfolio with the shop's legal name and your work email, then under **Settings** → **Accounts** add the Page and the Instagram account.

## Part 2: business verification (start early: it can take several days)

5. In the business portfolio: **Settings** → **Business info** (or **Security Center**) → **Start verification**. Have ready: the legal business name exactly as registered, address, phone, website, and a document such as the commercial registration certificate. Meta reviews it; you get an email.

## Part 3: the developer app (about 20 minutes)

6. Go to developers.facebook.com, sign in with the same Facebook profile, **Get started**, and verify your phone.
7. **My Apps** → **Create app** → type **Business** → name it (for example "<shop name> store") → connect it to your business portfolio.
8. In the app, add these products: **Facebook Login for Business**, **Instagram** (the "Instagram API with Facebook Login" option), and **Webhooks**. Leave the app in **Development** mode: that is enough to build and test with your own accounts.
9. In **App settings** → **Basic**, copy the **App ID** and the **App Secret** and put them in `.env`:
   - `META_APP_ID=` the App ID
   - `META_APP_SECRET=` the App Secret
   - `META_WEBHOOK_VERIFY_TOKEN=` any long random phrase you make up
10. Tell me in chat only "the Meta app is ready" and the App ID (the App ID is not secret; the App Secret is).

When adding permissions later, include **insights** (`instagram_manage_insights`, `read_insights`): they give the views, reach, likes and saves per post and video for the performance dashboard you asked for.

That is all that is needed to start Milestone 6.3: connecting the Page and Instagram from the admin, receiving comments and messages, and publishing approved posts to your own accounts.

## Part 4: later, when the shop is live on its own domain

11. **App review.** To publish and read messages for real (not only as a tester), Meta reviews each permission. It needs the live site's address with https, the privacy policy page and a data-deletion page (both are built), an app icon, and a short screen recording of each feature. We prepare these together after deployment (docs/DEPLOYMENT.md).
12. **Ad account (Milestone 7.3).** In the business portfolio: **Settings** → **Accounts** → **Ad accounts** → **Add** → **Create a new ad account**, currency USD, time zone Beirut. Add a payment method yourself (some Lebanese cards are declined for ads; a USD card from a bank that allows online foreign payments usually works). The admin will only ever create ad drafts; launching and spending need your explicit confirmation, and automated tests never spend money.

## Part 5: TikTok (Milestone 6.5, optional)

13. Switch the shop's TikTok to a **Business account** (Settings → Account → Switch to Business Account).
14. At developers.tiktok.com: sign up, create an app, add **Login Kit** and **Content Posting API**, and put the keys in `.env` as `TIKTOK_CLIENT_KEY=` and `TIKTOK_CLIENT_SECRET=`. Posting to the public needs TikTok's app review; until then posts go to your account as private drafts.

## Checklist

- [ ] Instagram is a Business account
- [ ] Facebook Page exists and I am its admin
- [ ] Instagram linked to the Page
- [ ] Business portfolio created, Page and Instagram added
- [ ] Business verification started
- [ ] Developer app created (Business type) with Facebook Login for Business, Instagram and Webhooks
- [ ] `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` in `.env`
- [ ] Told Claude "the Meta app is ready" with the App ID
- [ ] Later: ad account with a payment method (7.3)
- [ ] Optional: TikTok Business account and developer app (6.5)
