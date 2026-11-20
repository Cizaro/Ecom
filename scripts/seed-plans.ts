// Creates (or updates) the recommended plans in the platform panel, with the
// prices and limits from docs/PRICING.md. Run it once on each installation;
// change prices later in the panel (Platform > Plans).
//
//   pnpm platform:plans
//
// Plans that already exist (same key) are updated to these values.

import { resolve } from "node:path";
import { parseEnv } from "@ecom/config";
import { listPlans, savePlan, type PlanInput } from "@ecom/core";
import { disconnectDatabase } from "@ecom/db";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: the server sets real environment variables.
}

// Monthly prices in USD. "aiBudget" is what the AI may cost per month (the
// real cost, not the price), which the shop's AI stops at.
export const RECOMMENDED_PLANS: PlanInput[] = [
  {
    key: "ai_assistant",
    name: "AI Assistant",
    price: "19",
    productLimit: "50",
    staffLimit: "1",
    aiBudget: "1.5",
    sortOrder: "1",
    isPublic: "on",
    description: [
      "Automatic replies to Instagram and Facebook messages and comments",
      "English and Lebanese Arabic",
      "One inbox for all your messages",
      "Answers from your own products and prices",
    ].join("\n"),
  },
  {
    key: "starter",
    name: "Starter",
    price: "29",
    productLimit: "150",
    staffLimit: "2",
    aiBudget: "2",
    sortOrder: "2",
    isPublic: "on",
    description: [
      "Your online shop with a free web address",
      "Cash on delivery, orders and stock",
      "AI replies on Instagram and Facebook",
      "4 ready-made designs, English and Arabic",
    ].join("\n"),
  },
  {
    key: "growth",
    name: "Growth",
    price: "59",
    productLimit: "1000",
    staffLimit: "5",
    aiBudget: "6",
    sortOrder: "3",
    isPublic: "on",
    description: [
      "Everything in Starter",
      "Your own domain (e.g. yourshop.com)",
      "Scheduled posts with AI captions",
      "Discounts, returns and reports you can ask questions about",
    ].join("\n"),
  },
  {
    key: "pro",
    name: "Pro",
    price: "119",
    staffLimit: "15",
    aiBudget: "15",
    sortOrder: "4",
    isPublic: "on",
    description: [
      "Everything in Growth",
      "Unlimited products",
      "Campaigns and customer segments",
      "Priority support on WhatsApp",
    ].join("\n"),
  },
];

const env = parseEnv(process.env);
try {
  const existing = await listPlans(env.DATABASE_ADMIN_URL);
  for (const plan of RECOMMENDED_PLANS) {
    const id = existing.find((p) => p.key === plan.key)?.id;
    await savePlan(env.DATABASE_ADMIN_URL, { userId: null }, { ...plan, ...(id ? { id } : {}) });
    console.log(
      `platform:plans: ${id ? "updated" : "created"} ${String(plan.name)} at $${String(plan.price)} a month`,
    );
  }
} finally {
  await disconnectDatabase();
}
