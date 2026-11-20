import { getEnv } from "@ecom/config";
import { SHOP_TEMPLATES, TRIAL_DAYS } from "@ecom/core";
import type { Metadata } from "next";
import { requirePlatformSite } from "@/server/platform-site";
import { SignUpForm } from "./signup-form";

export const metadata: Metadata = { title: "Start your free trial" };

type Params = Record<string, string | string[] | undefined>;

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePlatformSite();
  const wanted = (await searchParams).template;
  const initial = SHOP_TEMPLATES.find((t) => t.key === wanted)?.key ?? SHOP_TEMPLATES[0]!.key;
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1fr_1.4fr] md:py-16">
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">Start your free trial</h1>
        <p className="text-lg text-ink-muted">
          {TRIAL_DAYS} days free with everything included. No card needed.
        </p>
        <ul className="flex flex-col gap-2 text-sm text-ink-muted">
          <li>✓ Your own shop at a free web address</li>
          <li>✓ Dashboard for orders, stock and customers</li>
          <li>✓ AI replies on Instagram and Facebook</li>
          <li>✓ English and Arabic</li>
        </ul>
      </div>
      <div className="rounded-card border border-line bg-surface p-6 shadow-sm">
        <SignUpForm
          templates={SHOP_TEMPLATES}
          suffix={getEnv().SHOP_ADDRESS_SUFFIX}
          initialTemplate={initial}
        />
      </div>
    </div>
  );
}
