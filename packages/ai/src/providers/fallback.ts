import { ProviderError, type AiProvider } from "../types";

/**
 * A main provider with a second one that takes over when the first is busy,
 * unreachable, slow or out of credit, so a free plan's tight limits do not
 * stop the assistant. A refused key or an unknown model is not hidden: those
 * need fixing in the settings.
 */
export function withFallback(main: AiProvider, backup: AiProvider): AiProvider {
  return {
    name: `${main.name}+${backup.name}`,
    async complete(request) {
      try {
        return await main.complete(request);
      } catch (error) {
        const switchable =
          error instanceof ProviderError && (error.retryable || /credit/.test(error.message));
        if (!switchable) throw error;
        return backup.complete(request);
      }
    },
  };
}
