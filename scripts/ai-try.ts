// Asks the configured AI a customer question about one store, the same way
// the admin's "Try it" box does, and prints the draft, the facts it used,
// the outcome and the cost. The run is recorded in the store's AI history.
// Nothing is sent to any customer. Prints no secrets.
//
//   pnpm ai:try --tenant demo "How much is delivery?"
//   pnpm ai:try --tenant demo --ar "كم سعر التوصيل؟"

import { resolve } from "node:path";
import { createGateway, dollarsToMicros } from "@ecom/ai";
import { EnvValidationError, parseEnv } from "@ecom/config";
import {
  aiProviderFromSettings,
  createAiLedger,
  createCommerceKnowledge,
  createTenantDb,
  getBusinessProfile,
  parseBranding,
} from "@ecom/core";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: the server sets real environment variables.
}

const args = process.argv.slice(2);
const tenantIndex = args.indexOf("--tenant");
const tenantSlug = tenantIndex >= 0 ? args[tenantIndex + 1] : undefined;
const language = args.includes("--ar") ? "ar" : "en";
const question = args.filter((arg, i) => !arg.startsWith("--") && i !== tenantIndex + 1).join(" ");
if (!tenantSlug || !question) {
  console.error('Usage: pnpm ai:try --tenant <store slug> [--ar] "<question>"');
  process.exit(2);
}

let env;
try {
  env = parseEnv(process.env);
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(2);
  }
  throw error;
}

const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
try {
  const tenant = await admin.tenant.findUnique({
    where: { slug: tenantSlug },
    include: { stores: { take: 1, orderBy: { createdAt: "asc" } } },
  });
  const store = tenant?.stores[0];
  if (!tenant || !store) {
    console.error(`No store with the slug "${tenantSlug}".`);
    process.exit(2);
  }
  const app = getAppPrisma(env.DATABASE_URL);
  const db = createTenantDb(app, { tenantId: tenant.id });
  const { provider, model, prices } = aiProviderFromSettings(env);
  const gateway = createGateway({
    provider,
    ledger: createAiLedger(app, null),
    model,
    prices,
    globalPaused: env.AI_PAUSED,
    platformMonthlyBudgetMicros: dollarsToMicros(env.AI_MONTHLY_BUDGET_USD),
  });
  console.log(`Asking ${provider.name} (${model}) about "${store.name}"...`);
  const result = await gateway.run(
    "customer.answer",
    { question, language },
    {
      tenantId: tenant.id,
      profile: await getBusinessProfile(db),
      knowledge: createCommerceKnowledge(db, {
        name: store.name,
        branding: parseBranding(store.branding),
      }),
    },
  );
  const event = await admin.aiEvent.findUnique({
    where: { id: result.eventId },
    select: {
      model: true,
      inputTokens: true,
      outputTokens: true,
      costMicros: true,
      latencyMs: true,
      problem: true,
    },
  });
  if (result.ok) {
    console.log(`\nDraft (${result.route.replace("_", " ")}):\n${result.output.reply}\n`);
    console.log(
      `Answered from the facts: ${result.output.answered ? "yes" : "no"}; topic: ${result.output.topic}; hand over: ${result.output.handover ? "yes" : "no"}`,
    );
    for (const id of result.output.citations) {
      console.log(`  [${id}] ${result.facts.find((fact) => fact.id === id)?.text ?? ""}`);
    }
  } else {
    console.log(`\nNot used: ${result.message}`);
    if (event?.problem) console.log(`Why: ${event.problem}`);
  }
  if (event) {
    console.log(
      `\nModel ${event.model}; ${event.inputTokens} tokens in, ${event.outputTokens} out; $${(event.costMicros / 1_000_000).toFixed(4)}; ${event.latencyMs} ms.`,
    );
  }
} finally {
  await disconnectDatabase();
}
