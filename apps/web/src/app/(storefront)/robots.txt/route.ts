import { getEnv } from "@ecom/config";
import { robotsTxt } from "@/server/seo";
import { storefrontOrigin } from "@/server/storefront";

// Per store: the sitemap address is the store's own. A host no store answers
// to gets the 404 page (storefrontOrigin checks the host).
export async function GET(): Promise<Response> {
  const origin = await storefrontOrigin();
  return new Response(robotsTxt({ allowIndexing: getEnv().ALLOW_SEARCH_INDEXING, origin }), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
