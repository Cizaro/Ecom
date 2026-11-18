/**
 * Automated tests never call a real AI service, whatever the developer's
 * .env says (it may hold a Groq or Claude key for trying the assistant):
 * they always use the built-in stand-in, and the keys are removed from the
 * test processes altogether.
 */
export function useTestAi(env: Record<string, string | undefined>): void {
  env.AI_PROVIDER = "mock";
  env.AI_FALLBACK_PROVIDER = "";
  env.AI_PAUSED = "false";
  for (const name of ["AI_API_KEY", "AI_BASE_URL", "GROQ_API_KEY", "MOONSHOT_API_KEY"]) {
    delete env[name];
  }
}
