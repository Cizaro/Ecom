import type { Prisma } from "@ecom/db";
import { assertPermission, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { openSecret, sealSecret } from "../platform/secret-box";
import { MetaError, pageWebhookFields, type MetaGraph, type MetaPage } from "./meta-graph";
import type { SocialWebhookItem } from "./webhook";

// A store's connection to its Facebook Page and linked Instagram account
// (Milestone 6.3, D112). Made by the owner (social.connect) through Meta's
// own sign-in; the Page token is stored encrypted and never leaves the
// server. One Meta connection per store, and a Page or Instagram account
// belongs to one store at a time.

export const PAGE_TOKEN_PURPOSE = "social.meta.page-token";

export class SocialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialError";
  }
}

export interface SocialConnectionSummary {
  id: string;
  provider: "meta";
  pageId: string;
  pageName: string;
  instagramAccountId: string | null;
  instagramUsername: string | null;
  scopes: string[];
  status: "active" | "needs_reconnect";
  connectedAt: Date;
  lastWebhookAt: Date | null;
}

/** A Page the signed-in person may connect, without its token. */
export interface PageChoice {
  id: string;
  name: string;
  instagramUsername: string | null;
  hasInstagram: boolean;
  canConnect: boolean;
}

const CONNECT_TASKS = ["MANAGE", "MESSAGING", "MODERATE"];

export function pageChoices(pages: MetaPage[]): PageChoice[] {
  return pages.map((page) => ({
    id: page.id,
    name: page.name,
    instagramUsername: page.instagram?.username ?? null,
    hasInstagram: page.instagram !== null,
    canConnect: page.tasks.some((task) => CONNECT_TASKS.includes(task)),
  }));
}

export async function getSocialConnection(
  db: TenantDb,
  context: RequestContext,
): Promise<SocialConnectionSummary | null> {
  assertPermission(context, "social.connect");
  const row = await db.run((tx) =>
    tx.socialConnection.findFirst({
      where: { provider: "meta" },
      select: {
        id: true,
        pageId: true,
        pageName: true,
        instagramAccountId: true,
        instagramUsername: true,
        scopes: true,
        status: true,
        connectedAt: true,
        lastWebhookAt: true,
      },
    }),
  );
  if (!row) return null;
  return {
    ...row,
    provider: "meta",
    status: row.status === "needs_reconnect" ? "needs_reconnect" : "active",
  };
}

const duplicate = (error: unknown) =>
  error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002";

export interface ConnectDeps {
  graph: MetaGraph;
  encryptionKey: string;
}

/**
 * Connects the chosen Page (and its Instagram account) with the person's
 * user token from the sign-in: the Page is re-read from Meta, subscribed to
 * webhooks, and its token stored encrypted. Replaces the store's previous
 * Meta connection.
 */
export async function connectMetaPage(
  db: TenantDb,
  context: RequestContext,
  deps: ConnectDeps,
  input: { userToken: string; pageId: string },
): Promise<SocialConnectionSummary> {
  assertPermission(context, "social.connect");
  const pages = await deps.graph.listPages(input.userToken);
  const page = pages.find((p) => p.id === input.pageId);
  if (!page) throw new SocialError("That Page is not one you manage. Sign in with Meta again.");
  if (!pageChoices([page])[0]!.canConnect) {
    throw new SocialError("Your Facebook role on that Page cannot manage messages or comments.");
  }
  const scopes = await deps.graph.grantedScopes(input.userToken).catch(() => [] as string[]);
  const previous = await db.run((tx) =>
    tx.socialConnection.findFirst({
      where: { provider: "meta" },
      select: { id: true, pageId: true, accessTokenEncrypted: true },
    }),
  );
  await deps.graph.subscribePage(page.id, page.accessToken, pageWebhookFields(scopes));

  const data = {
    pageId: page.id,
    pageName: page.name,
    instagramAccountId: page.instagram?.id ?? null,
    instagramUsername: page.instagram?.username ?? null,
    accessTokenEncrypted: sealSecret(deps.encryptionKey, PAGE_TOKEN_PURPOSE, page.accessToken),
    scopes: scopes.slice(0, 50),
    status: "active",
    connectedByUserId: context.userId,
    connectedAt: new Date(),
  };
  try {
    await db.run(async (tx) => {
      const saved = previous
        ? await tx.socialConnection.update({ where: { id: previous.id }, data })
        : await tx.socialConnection.create({
            data: { ...data, tenantId: context.tenantId, provider: "meta" },
          });
      await audit(
        tx,
        context,
        "social.connected",
        { type: "social_connection", id: saved.id },
        previous ? { pageId: previous.pageId } : undefined,
        {
          pageId: page.id,
          pageName: page.name,
          instagramAccountId: data.instagramAccountId,
          scopes: data.scopes,
        },
      );
    });
  } catch (error) {
    if (duplicate(error)) {
      throw new SocialError(
        "That Page or its Instagram account is already connected to another store.",
      );
    }
    throw error;
  }
  if (previous && previous.pageId !== page.id) {
    const oldToken = openSecret(
      deps.encryptionKey,
      PAGE_TOKEN_PURPOSE,
      previous.accessTokenEncrypted,
    );
    if (oldToken) await deps.graph.unsubscribePage(previous.pageId, oldToken).catch(() => {});
  }
  const summary = await getSocialConnection(db, context);
  if (!summary) throw new SocialError("The connection was not saved. Try again.");
  return summary;
}

/** Removes the store's Meta connection and its stored token; Meta stops sending its notifications. */
export async function disconnectMeta(
  db: TenantDb,
  context: RequestContext,
  deps: ConnectDeps,
): Promise<void> {
  assertPermission(context, "social.connect");
  const removed = await db.run(async (tx) => {
    const row = await tx.socialConnection.findFirst({
      where: { provider: "meta" },
      select: { id: true, pageId: true, pageName: true, accessTokenEncrypted: true },
    });
    if (!row) return null;
    await tx.socialConnection.delete({ where: { id: row.id } });
    await audit(
      tx,
      context,
      "social.disconnected",
      { type: "social_connection", id: row.id },
      {
        pageId: row.pageId,
        pageName: row.pageName,
      },
    );
    return row;
  });
  if (!removed) return;
  const token = openSecret(deps.encryptionKey, PAGE_TOKEN_PURPOSE, removed.accessTokenEncrypted);
  // Best effort: the token may already be revoked on Meta's side.
  if (token) await deps.graph.unsubscribePage(removed.pageId, token).catch(() => {});
}

/**
 * Stores what a webhook notification reported for one connection, once per
 * item (a resent notification is ignored). Runs for the connection's own
 * tenant, found by the platform lookup.
 */
export async function recordSocialWebhookItems(
  db: TenantDb,
  connectionId: string,
  items: SocialWebhookItem[],
): Promise<number> {
  if (items.length === 0) return 0;
  return db.run(async (tx) => {
    const result = await tx.socialWebhookEvent.createMany({
      data: items.map((item) => ({
        tenantId: db.tenantId,
        connectionId,
        channel: item.channel,
        kind: item.kind,
        externalKey: item.externalKey,
        payload: item.payload as Prisma.InputJsonValue,
        occurredAt: item.occurredAt,
      })),
      skipDuplicates: true,
    });
    await tx.socialConnection.update({
      where: { id: connectionId },
      data: { lastWebhookAt: new Date() },
    });
    return result.count;
  });
}

/** Recent notifications, for the connection page (what Meta has sent lately). */
export async function recentSocialEvents(
  db: TenantDb,
  context: RequestContext,
  limit = 10,
): Promise<{ id: string; channel: string; kind: string; receivedAt: Date }[]> {
  assertPermission(context, "social.connect");
  return db.run((tx) =>
    tx.socialWebhookEvent.findMany({
      select: { id: true, channel: true, kind: true, receivedAt: true },
      orderBy: { receivedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 50),
    }),
  );
}

export { MetaError };
