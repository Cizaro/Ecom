import { followLink } from "@ecom/core";
import { storefrontDb } from "@/server/storefront";

// A tracking link's short address (D107): counts the click and sends the
// visitor to the page of this store it was made for, with its UTM tags. The
// destination is always a path on this same store, so the short address
// cannot send anyone elsewhere. An unknown code goes to the home page.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { db } = await storefrontDb();
  const { code } = await params;
  const destination = (await followLink(db, code)) ?? "/";
  return new Response(null, {
    status: 302,
    headers: {
      location: destination,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
