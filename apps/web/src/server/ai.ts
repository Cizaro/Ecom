import "server-only";

import { createGateway, dollarsToMicros, type AiGateway } from "@ecom/ai";
import { getEnv } from "@ecom/config";
import { aiModelFor, aiProviderFromSettings, createAiLedger } from "@ecom/core";
import { getAppPrisma } from "@ecom/db";

// The AI gateway for this server, per staff member (their id goes into the
// AI audit trail). The provider, its backup and their keys come from the
// server's settings only (AI_PROVIDER, AI_FALLBACK_PROVIDER and the keys);
// nothing a user sends chooses them.

const globalForAi = globalThis as unknown as {
  __ai?: ReturnType<typeof aiProviderFromSettings>;
};

const setupFromSettings = () => (globalForAi.__ai ??= aiProviderFromSettings(getEnv()));

/** Where AI settings, spend and the audit trail are kept, with this staff member's id. */
export function aiLedger(userId: string | null) {
  return createAiLedger(getAppPrisma(getEnv().DATABASE_URL), userId);
}

export function aiGateway(userId: string | null): AiGateway {
  const env = getEnv();
  const { provider, model, prices } = setupFromSettings();
  return createGateway({
    provider,
    ledger: aiLedger(userId),
    model,
    prices,
    globalPaused: env.AI_PAUSED,
    platformMonthlyBudgetMicros: dollarsToMicros(env.AI_MONTHLY_BUDGET_USD),
  });
}

/** What staff are told about the AI set-up (never a key). */
export function aiSetup() {
  const env = getEnv();
  return {
    provider: env.AI_PROVIDER,
    model: aiModelFor(env.AI_PROVIDER, env),
    fallback: env.AI_FALLBACK_PROVIDER
      ? { provider: env.AI_FALLBACK_PROVIDER, model: aiModelFor(env.AI_FALLBACK_PROVIDER, env) }
      : null,
    globalPaused: env.AI_PAUSED,
    platformBudgetUsd: env.AI_MONTHLY_BUDGET_USD,
  };
}
