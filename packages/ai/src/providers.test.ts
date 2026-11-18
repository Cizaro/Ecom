import { describe, expect, it } from "vitest";
import { z } from "zod";
import { costMicros } from "./pricing";
import { withFallback } from "./providers/fallback";
import { createMockProvider } from "./providers/mock";
import { createOpenAiCompatibleProvider } from "./providers/openai-compatible";
import { ProviderError, type ProviderRequest } from "./types";

// The OpenAI-compatible provider against a fake service (no outside calls),
// the backup switch, and prices.

const schema = z.object({ reply: z.string() });

const request = (extra: Partial<ProviderRequest> = {}): ProviderRequest => ({
  task: "test",
  model: "gateway-model",
  system: "You help.",
  user: "Hello",
  schema,
  maxTokens: 100,
  effort: "low",
  timeoutMs: 5_000,
  mockOutput: () => ({ reply: "mock" }),
  ...extra,
});

function fakeService(
  responses: { status: number; body?: unknown; headers?: Record<string, string> }[],
) {
  const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const next = responses[Math.min(calls.length, responses.length - 1)]!;
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get("authorization"),
    });
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status,
      headers: next.headers,
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const answer = (content: string, finish = "stop") => ({
  model: "served-model",
  choices: [{ finish_reason: finish, message: { content } }],
  usage: { prompt_tokens: 120, completion_tokens: 30 },
});

describe("OpenAI-compatible provider", () => {
  it("sends the task with the JSON shape and the provider's own model, and reads the answer", async () => {
    const service = fakeService([{ status: 200, body: answer('{"reply":"Hi"}') }]);
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://api.example.test/v1/",
      apiKey: "test-key",
      model: "kimi-test",
      name: "moonshot",
      fetch: service.fetchFn,
      retryDelayMs: 0,
    });
    const result = await provider.complete(request());
    expect(provider.name).toBe("moonshot");
    expect(service.calls[0]!.url).toBe("https://api.example.test/v1/chat/completions");
    expect(service.calls[0]!.auth).toBe("Bearer test-key");
    expect(service.calls[0]!.body).toMatchObject({
      model: "kimi-test",
      response_format: { type: "json_object" },
    });
    expect(JSON.stringify(service.calls[0]!.body.messages)).toContain('\\"reply\\"');
    expect(result).toEqual({
      output: { reply: "Hi" },
      stop: "ok",
      model: "served-model",
      inputTokens: 120,
      outputTokens: 30,
    });
  });

  it("finds the JSON when a model wraps it in a code block or words", async () => {
    const service = fakeService([
      { status: 200, body: answer('Sure!\n```json\n{"reply":"Hi"}\n```') },
    ]);
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetch: service.fetchFn,
      retryDelayMs: 0,
    });
    expect((await provider.complete(request())).output).toEqual({ reply: "Hi" });
  });

  it("tries once more when busy, then reports it; reports a cut-off answer", async () => {
    const busy = fakeService([{ status: 429 }, { status: 429 }]);
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetch: busy.fetchFn,
      retryDelayMs: 0,
    });
    await expect(provider.complete(request())).rejects.toThrow(/busy/);
    expect(busy.calls).toHaveLength(2);

    const recovered = fakeService([
      { status: 503 },
      { status: 200, body: answer('{"reply":"ok"}', "length") },
    ]);
    const second = createOpenAiCompatibleProvider({
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetch: recovered.fetchFn,
      retryDelayMs: 0,
    });
    expect((await second.complete(request())).stop).toBe("truncated");
  });

  it("reports a refused key, missing credit and an unknown model without the service's words", async () => {
    for (const [status, message] of [
      [401, /refused the API key/],
      [402, /needs credit/],
      [404, /does not know this model/],
    ] as const) {
      const service = fakeService([
        { status, body: { error: { message: "secret detail echoed" } } },
      ]);
      const provider = createOpenAiCompatibleProvider({
        baseUrl: "https://api.example.test/v1",
        apiKey: "k",
        fetch: service.fetchFn,
        retryDelayMs: 0,
      });
      const error = await provider.complete(request()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as Error).message).toMatch(message);
      expect((error as Error).message).not.toContain("secret detail");
    }
  });
});

describe("OpenAI-compatible provider: an empty balance", () => {
  it("reports a 429 that means no credit as needing credit, not as busy", async () => {
    const service = fakeService([
      {
        status: 429,
        body: {
          error: { type: "exceeded_current_quota_error", message: "account org-123 suspended" },
        },
      },
    ]);
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetch: service.fetchFn,
      retryDelayMs: 0,
    });
    const error = await provider.complete(request()).catch((e: unknown) => e);
    expect((error as Error).message).toBe("The AI provider needs credit on the account.");
    expect((error as Error).message).not.toContain("org-123");
    expect(service.calls).toHaveLength(2);
  });
});

describe("backup provider", () => {
  const failing = (error: ProviderError) => ({
    name: "main",
    complete: async () => {
      throw error;
    },
  });

  it("takes over when the main one is busy or out of credit", async () => {
    const backup = createMockProvider();
    for (const error of [
      new ProviderError("The AI provider is busy (rate limit).", true),
      new ProviderError("The AI provider needs credit on the account.", false),
    ]) {
      const result = await withFallback(failing(error), backup).complete(request());
      expect(result.output).toEqual({ reply: "mock" });
    }
  });

  it("does not hide a refused key", async () => {
    const provider = withFallback(
      failing(new ProviderError("The AI provider refused the API key.", false)),
      createMockProvider(),
    );
    await expect(provider.complete(request())).rejects.toThrow(/refused the API key/);
  });
});

describe("prices", () => {
  it("uses the known price list, then the server's prices, then the most expensive", () => {
    expect(costMicros("claude-opus-5-5", 1000, 100, { input: 0, output: 0 })).toBe(6000);
    expect(costMicros("some-free-model", 1000, 100, { input: 0, output: 0 })).toBe(0);
    expect(costMicros("some-free-model", 1000, 100)).toBe(12_000);
  });
});
