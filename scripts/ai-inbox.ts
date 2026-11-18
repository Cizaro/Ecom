// Runs the support inbox's AI pass now for one store (the worker runs it
// every minute): labels new customer messages and drafts replies, then
// prints what it did. Nothing is sent to any customer. Prints no secrets.
//
//   pnpm ai:inbox --tenant demo

import { resolve } from "node:path";
import { createGateway, dollarsToMicros } from "@ecom/ai";
import { EnvValidationError, parseEnv } from "@ecom/config";
import {
  aiProviderFromSettings,
  checkNewSupportMessages,
  createAiLedger,
  createTenantDb,
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
if (!tenantSlug) {
  console.error("Usage: pnpm ai:inbox --tenant <store slug>");
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
  const tenant = await admin.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    console.error(`No store with the slug "${tenantSlug}".`);
    process.exit(2);
  }
  const app = getAppPrisma(env.DATABASE_URL);
  const { provider, model, prices } = aiProviderFromSettings(env);
  const gateway = createGateway({
    provider,
    ledger: createAiLedger(app, null),
    model,
    prices,
    globalPaused: env.AI_PAUSED,
    platformMonthlyBudgetMicros: dollarsToMicros(env.AI_MONTHLY_BUDGET_USD),
  });
  const started = new Date();
  console.log(`Checking new messages in "${tenant.name}" with ${provider.name} (${model})...`);
  const result = await checkNewSupportMessages(
    createTenantDb(app, { tenantId: tenant.id }),
    gateway,
  );
  console.log(`Labelled ${result.labelled}, drafted ${result.drafted}, failed ${result.failed}.`);

  const checked = await admin.supportConversation.findMany({
    where: { tenantId: tenant.id, updatedAt: { gte: started } },
    select: {
      subject: true,
      aiCategory: true,
      aiUrgency: true,
      aiSummary: true,
      replyDrafts: { where: { status: "pending" }, select: { body: true }, take: 1 },
    },
  });
  for (const row of checked) {
    console.log(
      `\n"${row.subject}": ${row.aiCategory ?? "?"}${row.aiUrgency === "high" ? ", urgent" : ""}`,
    );
    if (row.aiSummary) console.log(`  Summary: ${row.aiSummary}`);
    console.log(`  Draft: ${row.replyDrafts[0]?.body ?? "(none: a person handles it)"}`);
  }
} finally {
  await disconnectDatabase();
}
