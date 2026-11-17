import type { AiProvider, ProviderRequest, ProviderResult } from "../types";

/**
 * A stand-in for a real model, for development and the automated tests. It
 * never calls an outside service and costs nothing. It answers what the task
 * says a well-behaved model would, unless a test gives it something else to
 * say (to check the gateway refuses bad answers).
 */
export function createMockProvider(
  override?: (request: ProviderRequest) => Partial<ProviderResult> | undefined,
): AiProvider {
  return {
    name: "mock",
    async complete(request) {
      const custom = override?.(request);
      const estimate = (text: string) => Math.ceil(text.length / 4);
      return {
        output: request.mockOutput(),
        stop: "ok",
        model: "mock",
        inputTokens: estimate(request.system + request.user),
        outputTokens: 50,
        ...custom,
      };
    },
  };
}
