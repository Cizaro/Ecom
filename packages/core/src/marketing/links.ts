import { randomBytes } from "node:crypto";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { assertMarketingId, MarketingError } from "./campaigns";

// Tracking links (Milestone 7.1, decision D107): a page of the store with UTM
// tags, and a short address (/go/<code>) that counts clicks before sending
// the visitor on. A link can only lead to a page of the same store, never to
// another site, so a short address cannot be used to send people elsewhere.
// Clicks are a count only: no address, device or cookie is kept.

export interface LinkInput {
  label: unknown;
  destination: unknown;
  source: unknown;
  medium: unknown;
  campaignTag?: unknown;
  content?: unknown;
  campaignId?: unknown;
  postId?: unknown;
}

export interface TrackingLink {
  id: string;
  label: string;
  destinationPath: string;
  source: string;
  medium: string;
  utmCampaign: string;
  content: string;
  shortCode: string;
  clickCount: number;
  lastClickedAt: Date | null;
  campaign: { id: string; name: string } | null;
  post: { id: string; title: string } | null;
  createdAt: Date;
}

/** Turns "Summer Sale 2026" into "summer-sale-2026" (the form UTM tags take). */
export function utmTag(value: string, max = 80): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max);
}

/**
 * A page of the store from what was typed: a path ("/p/tote"), or a full
 * address on one of the store's own domains. Anything else is refused.
 */
export function storePath(input: string, storeHosts: readonly string[]): string | null {
  const value = input.trim();
  if (!value) return null;
  let path: string;
  if (value.startsWith("/")) {
    if (value.startsWith("//") || value.includes("\\")) return null;
    path = value;
  } else {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!storeHosts.includes(url.hostname.toLowerCase())) return null;
    path = `${url.pathname}${url.search}`;
  }
  if (/\s/.test(path) || path.length > 500) return null;
  if (/^\/(admin|api|go)(\/|$|\?)/.test(path)) return null;
  // UTM tags are added by the link itself; any typed ones are dropped.
  const [pathname, query = ""] = path.split("?", 2) as [string, string?];
  const kept = new URLSearchParams(query);
  for (const key of [...kept.keys()]) if (key.toLowerCase().startsWith("utm_")) kept.delete(key);
  const rest = kept.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/** The full address with UTM tags, on the given origin ("https://shop.example"). */
export function trackedUrl(
  link: Pick<TrackingLink, "destinationPath" | "source" | "medium" | "utmCampaign" | "content">,
  origin: string,
): string {
  const tags = new URLSearchParams({
    utm_source: link.source,
    utm_medium: link.medium,
    utm_campaign: link.utmCampaign,
  });
  if (link.content) tags.set("utm_content", link.content);
  const separator = link.destinationPath.includes("?") ? "&" : "?";
  return `${origin}${link.destinationPath}${separator}${tags.toString()}`;
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
function newCode(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

const SELECT = {
  id: true,
  label: true,
  destinationPath: true,
  source: true,
  medium: true,
  utmCampaign: true,
  content: true,
  shortCode: true,
  clickCount: true,
  lastClickedAt: true,
  createdAt: true,
  campaign: { select: { id: true, name: true } },
  post: { select: { id: true, title: true } },
} as const;

export async function createLink(
  db: TenantDb,
  context: RequestContext,
  input: LinkInput,
): Promise<{ id: string; shortCode: string }> {
  assertPermission(context, "marketing.write");
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const label = text(input.label).replace(/\s+/g, " ").trim();
  if (!label) throw new MarketingError("Give the link a name.", "label");
  if (label.length > 120)
    throw new MarketingError("Shorten the name (120 characters at most).", "label");
  const source = utmTag(text(input.source), 60);
  if (!source)
    throw new MarketingError("Enter where the link is shared, like instagram.", "source");
  const medium = utmTag(text(input.medium), 60);
  if (!medium)
    throw new MarketingError("Enter the kind of placement, like bio or story.", "medium");
  const content = utmTag(text(input.content));
  const id = (value: unknown, what: string) => {
    if (typeof value !== "string" || !value) return null;
    assertMarketingId(value, what);
    return value;
  };
  const campaignId = id(input.campaignId, "campaign");
  const postId = id(input.postId, "post");

  return db.run(async (tx) => {
    const hosts = (await tx.storeDomain.findMany({ select: { hostname: true } })).map(
      (d) => d.hostname,
    );
    const destinationPath = storePath(text(input.destination), hosts);
    if (!destinationPath) {
      throw new MarketingError(
        'Links can only lead to a page of your own shop: enter a path like "/p/leather-tote" or the page\'s full address.',
        "destination",
      );
    }
    let campaignName = "";
    if (campaignId) {
      const campaign = await tx.marketingCampaign.findUnique({
        where: { id: campaignId },
        select: { name: true },
      });
      if (!campaign) throw new NotFoundError("campaign");
      campaignName = campaign.name;
    }
    if (postId) {
      const post = await tx.contentPost.findUnique({ where: { id: postId }, select: { id: true } });
      if (!post) throw new NotFoundError("post");
    }
    const utmCampaign = utmTag(text(input.campaignTag)) || utmTag(campaignName) || utmTag(label);
    if (!utmCampaign) throw new MarketingError("Enter a campaign tag.", "campaignTag");

    for (let attempt = 0; ; attempt++) {
      const shortCode = newCode();
      const clash = await tx.utmLink.findUnique({
        where: { tenantId_shortCode: { tenantId: db.tenantId, shortCode } },
        select: { id: true },
      });
      if (clash && attempt < 5) continue;
      const created = await tx.utmLink.create({
        data: {
          tenantId: db.tenantId,
          campaignId,
          postId,
          label,
          destinationPath,
          source,
          medium,
          utmCampaign,
          content: content || (postId ? `post-${postId.slice(-8)}` : ""),
          shortCode,
          createdByUserId: context.userId,
        },
        select: { id: true, shortCode: true },
      });
      await audit(tx, context, "marketing.link_created", { type: "utm_link", id: created.id });
      return created;
    }
  });
}

export async function deleteLink(db: TenantDb, context: RequestContext, id: string): Promise<void> {
  assertPermission(context, "marketing.write");
  assertMarketingId(id, "link");
  await db.run(async (tx) => {
    const deleted = await tx.utmLink.deleteMany({ where: { id } });
    if (deleted.count === 0) throw new NotFoundError("link");
    await audit(tx, context, "marketing.link_deleted", { type: "utm_link", id });
  });
}

/**
 * Tracking links, most clicked first. Reading a post's links needs only
 * content.write (they are shown on the post); all others need marketing.write.
 */
export async function listLinks(
  db: TenantDb,
  context: RequestContext,
  filter: { campaignId?: string; postId?: string } = {},
): Promise<TrackingLink[]> {
  if (filter.postId) {
    if (!context.permissions.has("marketing.write")) assertPermission(context, "content.write");
    assertMarketingId(filter.postId, "post");
  } else {
    assertPermission(context, "marketing.write");
  }
  if (filter.campaignId) assertMarketingId(filter.campaignId, "campaign");
  const rows = await db.run((tx) =>
    tx.utmLink.findMany({
      where: {
        ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
        ...(filter.postId ? { postId: filter.postId } : {}),
      },
      select: SELECT,
      orderBy: [{ clickCount: "desc" }, { createdAt: "desc" }],
      take: 300,
    }),
  );
  return rows;
}

/**
 * A visitor opened /go/<code> on the store: counts the click and returns
 * where to send them (a path on this store, with the UTM tags), or null for
 * an unknown code. Runs with the store's tenant, no signed-in user.
 */
export async function followLink(db: TenantDb, code: string): Promise<string | null> {
  const shortCode = code.toLowerCase();
  if (!/^[a-z0-9]{6,16}$/.test(shortCode)) return null;
  const link = await db.run(async (tx) => {
    const updated = await tx.utmLink.updateMany({
      where: { shortCode },
      data: { clickCount: { increment: 1 }, lastClickedAt: new Date() },
    });
    if (updated.count === 0) return null;
    return tx.utmLink.findFirst({
      where: { shortCode },
      select: {
        destinationPath: true,
        source: true,
        medium: true,
        utmCampaign: true,
        content: true,
      },
    });
  });
  if (!link) return null;
  // A relative address: the browser stays on the store's own host.
  return trackedUrl(link, "");
}
