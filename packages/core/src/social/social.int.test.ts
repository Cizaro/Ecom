import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { openSecret } from "../platform/secret-box";
import { findSocialConnection } from "../platform/social-lookup";
import {
  connectMetaPage,
  disconnectMeta,
  getSocialConnection,
  PAGE_TOKEN_PURPOSE,
  recentSocialEvents,
  recordSocialWebhookItems,
  SocialError,
} from "./connections";
import { createFakeMetaGraph, type MetaPage } from "./meta-graph";
import { parseMetaWebhook } from "./webhook";

// Social connections against the real (test) database, on the runtime
// connection. Meta is the fake; nothing calls out.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];
const KEY = env.ENCRYPTION_KEY;

// Page IDs unique to this run, so parallel runs never collide.
const digits =
  String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1e5)).padStart(5, "0");
const pages: MetaPage[] = [
  {
    id: `1${digits}`,
    name: "Shop Page",
    accessToken: "page-token-one",
    tasks: ["MANAGE"],
    instagram: { id: `2${digits}`, username: "shop.one" },
  },
  {
    id: `3${digits}`,
    name: "Viewer Page",
    accessToken: "page-token-two",
    tasks: ["ANALYZE"],
    instagram: null,
  },
];

function contextFor(tenantId: string, userId: string, role: SystemRoleKey): RequestContext {
  return {
    requestId: `req-${run}`,
    ip: "203.0.113.98",
    userId,
    isPlatformAdmin: false,
    tenantId,
    tenantSlug: "x",
    tenantName: "x",
    storeId: null,
    roleKey: role,
    roleName: role,
    permissions: new Set<PermissionKey>(
      SYSTEM_ROLES.find((r) => r.key === role)!.permissions as readonly PermissionKey[],
    ),
  };
}

async function store(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Social ${label} ${run}`, slug: `social-${label}-${run}` },
  });
  tenantIds.push(tenant.id);
  const user = await admin.user.create({
    data: { email: `social-${label}-${run}@example.test`, name: label },
  });
  userIds.push(user.id);
  return {
    db: createTenantDb(app, { tenantId: tenant.id, userId: user.id }),
    owner: contextFor(tenant.id, user.id, "store_owner"),
    manager: contextFor(tenant.id, user.id, "store_manager"),
  };
}

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("social connections", () => {
  it("connects a Page with its Instagram account, token encrypted, owners only", async () => {
    const a = await store("a");
    const graph = createFakeMetaGraph(pages);
    const deps = { graph, encryptionKey: KEY };

    await expect(
      connectMetaPage(a.db, a.manager, deps, {
        userToken: "fake-user-token",
        pageId: pages[0]!.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSocialConnection(a.db, a.manager)).rejects.toBeInstanceOf(ForbiddenError);

    const connected = await connectMetaPage(a.db, a.owner, deps, {
      userToken: "fake-user-token",
      pageId: pages[0]!.id,
    });
    expect(connected).toMatchObject({
      pageName: "Shop Page",
      instagramUsername: "shop.one",
      status: "active",
    });
    expect(connected).not.toHaveProperty("accessTokenEncrypted");
    expect(graph.subscribed.has(pages[0]!.id)).toBe(true);

    const row = await admin.socialConnection.findFirstOrThrow({
      where: { tenantId: a.owner.tenantId },
    });
    expect(row.accessTokenEncrypted).not.toContain("page-token-one");
    expect(openSecret(KEY, PAGE_TOKEN_PURPOSE, row.accessTokenEncrypted)).toBe("page-token-one");
    const audited = await admin.auditLog.findFirst({
      where: { tenantId: a.owner.tenantId, action: "social.connected" },
    });
    expect(JSON.stringify(audited)).not.toContain("page-token-one");
  });

  it("refuses a Page the person cannot manage, one not theirs, and one another store has", async () => {
    const b = await store("b");
    const c = await store("c");
    const graph = createFakeMetaGraph(pages);
    const deps = { graph, encryptionKey: KEY };
    await expect(
      connectMetaPage(b.db, b.owner, deps, { userToken: "fake-user-token", pageId: pages[1]!.id }),
    ).rejects.toBeInstanceOf(SocialError);
    await expect(
      connectMetaPage(b.db, b.owner, deps, { userToken: "fake-user-token", pageId: "999" }),
    ).rejects.toBeInstanceOf(SocialError);

    await connectMetaPage(b.db, b.owner, deps, {
      userToken: "fake-user-token",
      pageId: pages[0]!.id,
    }).catch(() => undefined); // may already belong to store a from the test above
    const owner = await findSocialConnection(env.DATABASE_ADMIN_URL, "facebook", pages[0]!.id);
    expect(owner).not.toBeNull();
    await expect(
      connectMetaPage(c.db, c.owner, deps, { userToken: "fake-user-token", pageId: pages[0]!.id }),
    ).rejects.toThrow(/already connected to another store/);
    // Store c sees nothing of the other store's connection.
    expect(await getSocialConnection(c.db, c.owner)).toBeNull();
  });

  it("stores webhook items once, in the owning store only, and disconnects", async () => {
    const owner = await findSocialConnection(
      env.DATABASE_ADMIN_URL,
      "instagram",
      pages[0]!.instagram!.id,
    );
    expect(owner).not.toBeNull();
    const db = createTenantDb(app, { tenantId: owner!.tenantId });
    const items = parseMetaWebhook({
      object: "instagram",
      entry: [
        {
          id: pages[0]!.instagram!.id,
          messaging: [
            { sender: { id: "9" }, timestamp: 1_790_000_000_000, message: { mid: `m-${run}` } },
          ],
          changes: [{ field: "comments", value: { id: `c${digits}`, text: "Price?" } }],
        },
      ],
    });
    expect(await recordSocialWebhookItems(db, owner!.connectionId, items)).toBe(2);
    expect(await recordSocialWebhookItems(db, owner!.connectionId, items)).toBe(0);

    const context = contextFor(owner!.tenantId, userIds[0]!, "store_owner");
    expect((await recentSocialEvents(db, context)).map((e) => e.kind).sort()).toEqual([
      "comment",
      "message",
    ]);
    const other = await store("d");
    expect(await recentSocialEvents(other.db, other.owner)).toEqual([]);
    // Another store cannot attach events to this connection.
    await expect(recordSocialWebhookItems(other.db, owner!.connectionId, items)).rejects.toThrow();

    const graph = createFakeMetaGraph(pages);
    graph.subscribed.add(pages[0]!.id);
    await disconnectMeta(db, context, { graph, encryptionKey: KEY });
    expect(graph.subscribed.has(pages[0]!.id)).toBe(false);
    expect(await getSocialConnection(db, context)).toBeNull();
    expect(await findSocialConnection(env.DATABASE_ADMIN_URL, "facebook", pages[0]!.id)).toBeNull();
    expect(
      await admin.socialWebhookEvent.count({ where: { connectionId: owner!.connectionId } }),
    ).toBe(0);
  });
});
