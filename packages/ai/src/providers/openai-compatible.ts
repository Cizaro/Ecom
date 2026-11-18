import { z } from "zod";
import { ProviderError, type AiProvider } from "../types";

/**
 * Any service that speaks the OpenAI "chat completions" format: Groq,
 * Moonshot (Kimi), OpenRouter, a local model server and many others. The
 * address, key and model come from the server's settings only.
 *
 * Services differ in how strictly they can force a JSON shape, so this asks
 * for a JSON object (widely supported) and puts the required shape in the
 * instructions; the gateway then checks the answer against the schema and
 * the task's rules like any other provider's.
 */
export function createOpenAiCompatibleProvider(options: {
  baseUrl: string;
  apiKey: string;
  /** The model this service runs (the gateway's model is used when not given). */
  model?: string;
  /** Shown in the audit trail, e.g. "groq". */
  name?: string;
  /** For tests. */
  fetch?: typeof fetch;
  /** Pause before the one retry of a busy or failing service (tests use 0). */
  retryDelayMs?: number;
}): AiProvider {
  const send = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const retryDelay = options.retryDelayMs ?? 2_000;

  return {
    name: options.name ?? "openai-compatible",
    async complete(request) {
      const model = options.model ?? request.model;
      const shape = JSON.stringify(z.toJSONSchema(request.schema));
      const body = JSON.stringify({
        model,
        max_tokens: request.maxTokens,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${request.system}\n\nAnswer with one JSON object only, no other text, matching this JSON schema:\n${shape}`,
          },
          { role: "user", content: request.user },
        ],
      });

      let response: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await send(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${options.apiKey}`,
            },
            body,
            signal: AbortSignal.timeout(request.timeoutMs),
          });
        } catch (error) {
          if (
            error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError")
          ) {
            throw new ProviderError("The AI provider took too long to answer.", true);
          }
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            continue;
          }
          throw new ProviderError("The AI provider could not be reached.", true);
        }
        // One more try when the service is busy or failing, after its own suggested wait (5 s at most).
        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
          const wait = Number(response.headers.get("retry-after"));
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Number.isFinite(wait) && wait > 0 ? Math.min(wait * 1000, 5_000) : retryDelay,
            ),
          );
          continue;
        }
        break;
      }
      if (!response) throw new ProviderError("The AI provider could not be reached.", true);

      // Only the kind of failure is kept: provider messages can echo the request.
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError("The AI provider refused the API key.", false);
      }
      if (response.status === 402) {
        throw new ProviderError("The AI provider needs credit on the account.", false);
      }
      if (response.status === 429) {
        throw new ProviderError(
          "The AI provider is busy (rate limit). Try again in a minute.",
          true,
        );
      }
      if (response.status === 404) {
        throw new ProviderError("The AI provider does not know this model name.", false);
      }
      if (!response.ok) {
        throw new ProviderError(
          `The AI provider failed (${response.status}).`,
          response.status >= 500,
        );
      }

      const data = (await response.json().catch(() => null)) as {
        model?: string;
        choices?: { finish_reason?: string; message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      } | null;
      const choice = data?.choices?.[0];
      const content = choice?.message?.content ?? "";
      return {
        output: parseJson(content),
        stop:
          choice?.finish_reason === "content_filter"
            ? "refused"
            : choice?.finish_reason === "length"
              ? "truncated"
              : "ok",
        model: data?.model ?? model,
        inputTokens: data?.usage?.prompt_tokens ?? 0,
        outputTokens: data?.usage?.completion_tokens ?? 0,
      };
    },
  };
}

/** The JSON object in a reply, also when a model wraps it in a code block or adds words around it. */
function parseJson(content: string): unknown {
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** The model names the service offers (GET /models), for choosing AI_DEFAULT_MODEL. */
export async function listOpenAiCompatibleModels(options: {
  baseUrl: string;
  apiKey: string;
}): Promise<string[]> {
  const response = await fetch(`${options.baseUrl.replace(/\/+$/, "")}/models`, {
    headers: { authorization: `Bearer ${options.apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new ProviderError("The AI provider refused the API key.", false);
  }
  if (!response.ok) throw new ProviderError(`The AI provider failed (${response.status}).`, false);
  const data = (await response.json()) as { data?: { id?: string }[] };
  return (data.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => typeof id === "string")
    .sort();
}
