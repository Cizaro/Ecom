import "server-only";

import {
  createAnthropicProvider,
  createGateway,
  createMockProvider,
  dollarsToMicros,
  type AiGateway,
  type AiProvider,
} from "@ecom/ai";
import { getEnv } from "@ecom/config";
import { createAiLedger } from "@ecom/core";
import { getAppPrisma } from "@ecom/db";

// The AI gateway for this server, per staff member (their id goes into the
// AI audit trail). The provider and its key come from the server's settings
// only (AI_PROVIDER, AI_API_KEY); nothing a user sends chooses them.

const globalForAi = globalThis as unknown as { __aiProvider?: AiProvider };

function provider(): AiProvider {
  const env = getEnv();
  globalForAi.__aiProvider ??=
    env.AI_PROVIDER === "anthropic"
      ? createAnthropicProvider({ apiKey: env.AI_API_KEY! })
      : createMockProvider();
  return globalForAi.__aiProvider;
}

/** Where AI settings, spend and the audit trail are kept, with this staff member's id. */
export function aiLedger(userId: string | null) {
  return createAiLedger(getAppPrisma(getEnv().DATABASE_URL), userId);
}

export function aiGateway(userId: string | null): AiGateway {
  const env = getEnv();
  return createGateway({
    provider: provider(),
    ledger: aiLedger(userId),
    model: env.AI_PROVIDER === "mock" ? "mock" : env.AI_DEFAULT_MODEL,
    globalPaused: env.AI_PAUSED,
    platformMonthlyBudgetMicros: dollarsToMicros(env.AI_MONTHLY_BUDGET_USD),
  });
}

/** What staff are told about the AI set-up (never the key). */
export function aiSetup() {
  const env = getEnv();
  return {
    provider: env.AI_PROVIDER,
    model: env.AI_PROVIDER === "mock" ? "mock" : env.AI_DEFAULT_MODEL,
    globalPaused: env.AI_PAUSED,
    platformBudgetUsd: env.AI_MONTHLY_BUDGET_USD,
  };
}
