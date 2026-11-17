import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ProviderError, type AiProvider } from "../types";

/**
 * Claude through Anthropic's API. Answers come back as JSON in the task's
 * schema (structured outputs). When a request is declined by the model's
 * safety checks, the API retries it on another model by itself
 * ("server-side fallback"); a decline that stands is reported as "refused".
 * The key comes from the server's settings only.
 */
export function createAnthropicProvider(options: { apiKey: string }): AiProvider {
  const client = new Anthropic({ apiKey: options.apiKey, maxRetries: 2 });
  return {
    name: "anthropic",
    async complete(request) {
      try {
        const response = await client.beta.messages.parse(
          {
            model: request.model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [{ role: "user", content: request.user }],
            output_config: {
              effort: request.effort,
              format: betaZodOutputFormat(request.schema),
            },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { timeout: request.timeoutMs },
        );
        return {
          output: response.parsed_output,
          stop:
            response.stop_reason === "refusal"
              ? "refused"
              : response.stop_reason === "max_tokens"
                ? "truncated"
                : "ok",
          model: response.model,
          inputTokens:
            response.usage.input_tokens +
            (response.usage.cache_read_input_tokens ?? 0) +
            (response.usage.cache_creation_input_tokens ?? 0),
          outputTokens: response.usage.output_tokens,
        };
      } catch (error) {
        // Only the kind of failure is kept: provider messages can echo the request.
        if (error instanceof Anthropic.RateLimitError) {
          throw new ProviderError("The AI provider is busy (rate limit).", true);
        }
        if (error instanceof Anthropic.AuthenticationError) {
          throw new ProviderError("The AI provider refused the API key.", false);
        }
        if (error instanceof Anthropic.BadRequestError) {
          throw new ProviderError("The AI provider rejected the request.", false);
        }
        if (error instanceof Anthropic.APIConnectionTimeoutError) {
          throw new ProviderError("The AI provider took too long to answer.", true);
        }
        if (error instanceof Anthropic.APIError) {
          throw new ProviderError(
            `The AI provider failed (${error.status ?? "no status"}).`,
            (error.status ?? 500) >= 500,
          );
        }
        throw error;
      }
    },
  };
}
