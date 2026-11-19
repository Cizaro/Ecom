import { connectMetaPage, isMetaError, pageChoices, SocialError } from "@ecom/core";
import { getEnv } from "@ecom/config";
import { z } from "zod";
import { tenantDb } from "@/server/access";
import { apiRoute } from "@/server/api";
import {
  checkMetaState,
  getMetaGraph,
  keepPendingToken,
  redirectUri,
  SOCIAL_PAGE,
} from "@/server/social";

// Where Meta sends the owner back after signing in (Milestone 6.3, D112).
// The state must match the one this person's sign-in started with; the code
// is exchanged for a long-lived user token on the server. With one Page that
// can be connected it is connected at once; with several, the owner chooses.
// Every outcome goes back to the connection page with a short message code.
export const dynamic = "force-dynamic";

const back = (params: Record<string, string>) =>
  new Response(null, {
    status: 303,
    headers: { Location: `${SOCIAL_PAGE}?${new URLSearchParams(params)}` },
  });

export const GET = apiRoute(
  {
    access: { level: "permission", permission: "social.connect" },
    // Meta may add parameters of its own; only these are read.
    query: z.object({
      code: z.string().max(2000).optional(),
      state: z.string().max(200).optional(),
      error: z.string().max(200).optional(),
    }),
  },
  async ({ context, query }) => {
    const graph = getMetaGraph();
    if (!graph) return back({ error: "not-configured" });
    if (query.error) return back({ error: "cancelled" });
    if (!query.code || !query.state || !(await checkMetaState(context, query.state))) {
      return back({ error: "expired" });
    }
    try {
      const userToken = await graph.userTokenFromCode({
        code: query.code,
        redirectUri: redirectUri(),
      });
      const pages = await graph.listPages(userToken);
      const usable = pageChoices(pages).filter((page) => page.canConnect);
      if (usable.length === 0) return back({ error: "no-pages" });
      if (pages.length === 1) {
        await connectMetaPage(
          tenantDb(context),
          context,
          { graph, encryptionKey: getEnv().ENCRYPTION_KEY },
          { userToken, pageId: usable[0]!.id },
        );
        return back({ connected: "1" });
      }
      await keepPendingToken(context, userToken);
      return back({ choose: "1" });
    } catch (error) {
      if (error instanceof Error && error.name === SocialError.name) {
        return back({ error: "page-taken" });
      }
      if (isMetaError(error)) return back({ error: "meta", detail: error.message.slice(0, 300) });
      throw error;
    }
  },
);
