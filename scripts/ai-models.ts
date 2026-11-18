// Lists the model names an AI service offers, to choose GROQ_MODEL,
// MOONSHOT_MODEL or AI_DEFAULT_MODEL. Uses the key from the settings; prints
// no secrets.
//
//   pnpm ai:models groq
//   pnpm ai:models moonshot
//   pnpm ai:models openai-compatible

import { resolve } from "node:path";
import { listOpenAiCompatibleModels, ProviderError } from "@ecom/ai";
import { openAiCompatibleConnection } from "@ecom/core";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: the server sets real environment variables.
}

const name = process.argv[2];
if (name !== "groq" && name !== "moonshot" && name !== "openai-compatible") {
  console.error("Usage: pnpm ai:models groq | moonshot | openai-compatible");
  process.exit(2);
}
// Only the keys are needed here, not the whole configuration.
const keys = {
  GROQ_API_KEY: process.env.GROQ_API_KEY || undefined,
  MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY || undefined,
  AI_API_KEY: process.env.AI_API_KEY || undefined,
  AI_BASE_URL: process.env.AI_BASE_URL || undefined,
};
const connection = openAiCompatibleConnection(
  name,
  keys as Parameters<typeof openAiCompatibleConnection>[1],
);
if (!connection.apiKey || !connection.baseUrl) {
  const needed =
    name === "groq"
      ? "GROQ_API_KEY"
      : name === "moonshot"
        ? "MOONSHOT_API_KEY"
        : "AI_API_KEY and AI_BASE_URL";
  console.error(`Set ${needed} in .env first.`);
  process.exit(2);
}
try {
  const models = await listOpenAiCompatibleModels(connection);
  console.log(`${name}: ${models.length} models`);
  for (const model of models) console.log(`  ${model}`);
} catch (error) {
  console.error(error instanceof ProviderError ? error.message : "Could not list the models.");
  process.exit(1);
}
