import { getEnv } from "@ecom/config";
import { checkReadiness, createLogger } from "@ecom/core";

// Readiness: the database, Redis and object storage are reachable.
export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  const result = await checkReadiness(env);

  if (!result.ok) {
    createLogger("web", env.LOG_LEVEL).error(
      { checks: result.checks.filter((check) => !check.ok) },
      "readiness check failed",
    );
  }

  // Failure details stay in the logs; the response only says which check failed.
  return Response.json(
    {
      status: result.ok ? "ready" : "not_ready",
      checks: result.checks.map(({ name, ok }) => ({ name, ok })),
    },
    { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
