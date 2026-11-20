import { getEnv } from "@ecom/config";
import { SHOP_TEMPLATES, TRIAL_DAYS } from "@ecom/core";
import { buttonClasses } from "@ecom/ui";
import Link from "next/link";
import { requirePlatformSite } from "@/server/platform-site";
import { TemplatePreview } from "./parts";

// Only features that exist and work today are listed here (no invented
// numbers, reviews or countdowns). Prices are the owner's decision and are
// not shown until they are set.
const FEATURES = [
  {
    title: "Your online shop",
    text: "Catalog, search, cart and checkout with cash on delivery, in English and Arabic, fast on phones.",
  },
  {
    title: "AI replies to messages",
    text: "Answers Instagram and Facebook DMs and comments for you, in English or Lebanese Arabic, using your real products and prices.",
  },
  {
    title: "Orders and stock in one place",
    text: "Orders, delivery, returns, discounts and stock counts, with alerts before something runs out.",
  },
  {
    title: "Posts on a schedule",
    text: "Upload photos once, get captions written by AI, approve them, and publish to Instagram and Facebook at the time you choose.",
  },
  {
    title: "One inbox",
    text: "Messages from your website, Instagram and Facebook together, sorted by AI so urgent ones come first.",
  },
  {
    title: "Reports you can ask about",
    text: "Sales, best sellers, what customers search for. Ask questions in plain words and get answers from your own figures.",
  },
];

const STEPS = [
  { title: "Sign up", text: "Your name, email, shop name and web address. No card needed." },
  {
    title: "Pick a design",
    text: "Choose a ready-made look, then change the colours, font and logo.",
  },
  {
    title: "Add products",
    text: "One by one, or a whole spreadsheet at once. AI can write descriptions.",
  },
  { title: "Start selling", text: "Share your shop link and connect Instagram and Facebook." },
];

export default async function PlatformHome() {
  await requirePlatformSite();
  const name = getEnv().PLATFORM_NAME;
  return (
    <>
      <section className="relative overflow-hidden border-b border-line bg-canvas">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div className="flex flex-col gap-6">
            <p className="text-sm font-semibold tracking-wide text-accent uppercase">
              Online shop + AI assistant
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
              Sell online and let AI answer your customers
            </h1>
            <p className="max-w-prose text-lg text-ink-muted">
              {name} gives your business a ready online shop, a dashboard for orders and stock, and
              an assistant that replies to Instagram and Facebook messages in English and Lebanese
              Arabic.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className={buttonClasses("primary", "px-5")}>
                Start your {TRIAL_DAYS}-day free trial
              </Link>
              <Link href="/templates" className={buttonClasses("secondary", "px-5")}>
                See the templates
              </Link>
            </div>
            <p className="text-sm text-ink-muted">
              No card needed. Your shop is online in minutes.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {SHOP_TEMPLATES.map((template, i) => (
              <div key={template.key} className={i % 2 === 1 ? "translate-y-6" : ""}>
                <TemplatePreview template={template} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:py-20">
        <div className="mb-10 flex max-w-2xl flex-col gap-3">
          <h2 className="text-3xl font-semibold tracking-tight">Everything a small shop needs</h2>
          <p className="text-ink-muted">
            Built for shops that sell on Instagram and want a real website too.
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="flex flex-col gap-2 rounded-card border border-line p-5"
            >
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="text-sm text-ink-muted">{feature.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y border-line bg-canvas">
        <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
          <h2 className="mb-10 text-3xl font-semibold tracking-tight">How it works</h2>
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-2">
                <span className="grid size-9 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-contrast">
                  {i + 1}
                </span>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="text-sm text-ink-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:py-20">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 rounded-card border border-line p-8 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Pricing</h2>
          <p className="text-ink-muted">
            Try everything free for {TRIAL_DAYS} days. Monthly plans for hosting and AI replies are
            being finalised and will be shown here, and sent to you, before your trial ends. Nothing
            is charged automatically.
          </p>
          <Link href="/signup" className={buttonClasses("primary", "px-5")}>
            Start free trial
          </Link>
        </div>
      </section>
    </>
  );
}
