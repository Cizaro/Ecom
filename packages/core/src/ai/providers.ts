import {
  createAnthropicProvider,
  createMockProvider,
  createOpenAiCompatibleProvider,
  withFallback,
  type AiProvider,
  type Prices,
} from "@ecom/ai";
import type { AiProviderName, Env } from "@ecom/config";

// Builds the AI provider from the server's settings (AI_PROVIDER and
// AI_FALLBACK_PROVIDER). Keys never leave the server; nothing a user sends
// chooses the provider.

const GROQ_URL = "https://api.groq.com/openai/v1";
const MOONSHOT_URL = "https://api.moonshot.ai/v1";

type AiEnv = Pick<
  Env,
  | "AI_PROVIDER"
  | "AI_FALLBACK_PROVIDER"
  | "AI_API_KEY"
  | "AI_BASE_URL"
  | "AI_DEFAULT_MODEL"
  | "GROQ_API_KEY"
  | "GROQ_MODEL"
  | "MOONSHOT_API_KEY"
  | "MOONSHOT_MODEL"
  | "AI_INPUT_PRICE_PER_MTOK"
  | "AI_OUTPUT_PRICE_PER_MTOK"
>;

/** The model a provider runs, as the settings name it. */
export function aiModelFor(name: AiProviderName, env: AiEnv): string {
  switch (name) {
    case "mock":
      return "mock";
    case "groq":
      return env.GROQ_MODEL ?? "";
    case "moonshot":
      return env.MOONSHOT_MODEL ?? "";
    default:
      return env.AI_DEFAULT_MODEL;
  }
}

/** The service address and key for an OpenAI-compatible provider. */
export function openAiCompatibleConnection(
  name: "groq" | "moonshot" | "openai-compatible",
  env: AiEnv,
): { baseUrl: string; apiKey: string } {
  if (name === "groq") return { baseUrl: GROQ_URL, apiKey: env.GROQ_API_KEY! };
  if (name === "moonshot") return { baseUrl: MOONSHOT_URL, apiKey: env.MOONSHOT_API_KEY! };
  return { baseUrl: env.AI_BASE_URL!, apiKey: env.AI_API_KEY! };
}

function single(name: AiProviderName, env: AiEnv): AiProvider {
  const model = aiModelFor(name, env);
  switch (name) {
    case "mock":
      return createMockProvider();
    case "anthropic":
      return createAnthropicProvider({ apiKey: env.AI_API_KEY!, model });
    default:
      return createOpenAiCompatibleProvider({
        ...openAiCompatibleConnection(name, env),
        model,
        name,
      });
  }
}

/** The provider (with its backup, when one is set) and what to record about it. */
export function aiProviderFromSettings(env: AiEnv): {
  provider: AiProvider;
  model: string;
  prices: Prices | undefined;
} {
  const main = single(env.AI_PROVIDER, env);
  return {
    provider: env.AI_FALLBACK_PROVIDER
      ? withFallback(main, single(env.AI_FALLBACK_PROVIDER, env))
      : main,
    model: aiModelFor(env.AI_PROVIDER, env),
    prices:
      env.AI_INPUT_PRICE_PER_MTOK !== undefined && env.AI_OUTPUT_PRICE_PER_MTOK !== undefined
        ? { input: env.AI_INPUT_PRICE_PER_MTOK, output: env.AI_OUTPUT_PRICE_PER_MTOK }
        : undefined,
  };
}
