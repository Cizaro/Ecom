import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { makeTestImage } from "@ecom/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { addLibraryFile } from "../content/library";
import { createPost, getPost, movePost, updatePost } from "../content/posts";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { createMemoryStorage } from "../storage/storage";
import { connectMetaPage } from "./connections";
import { createFakeMetaGraph, type MetaPage } from "./meta-graph";
import {
  publishBlocker,
  publishDuePosts,
  PublishError,
  publishPostNow,
  setAutoPublish,
} from "./publish";

// Publishing approved posts against the real (test) database. Meta is the
// stand-in and files are in memory: nothing is posted anywhere.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];
const storage = createMemoryStorage();
const KEY = env.ENCRYPTION_KEY;
const digits =
  String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1e5)).padStart(5, "0");
let square: Uint8Array;
let tall: Uint8Array;

function contextFor(tenantId: string, userId: string, role: SystemRoleKey): RequestContext {
  return {
    requestId: `req-${run}`,
    ip: "203.0.113.100",
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

async function store(label: string, prefix: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Publish ${label} ${run}`, slug: `publish-${label}-${run}` },
  });
  tenantIds.push(tenant.id);
  await admin.store.create({
    data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main", timezone: "Asia/Beirut" },
  });
  const user = await admin.user.create({
    data: { email: `publish-${label}-${run}@example.test`, name: label },
  });
  userIds.push(user.id);
  const page: MetaPage = {
    id: `${prefix}${digits}`,
    name: `Page ${label}`,
    accessToken: `token-${label}`,
    tasks: ["MANAGE"],
    instagram: { id: `${prefix}9${digits}`, username: `shop.${label}` },
  };
  const graph = createFakeMetaGraph([page]);
  const db = createTenantDb(app, { tenantId: tenant.id, userId: user.id });
  const owner = contextFor(tenant.id, user.id, "store_owner");
  await connectMetaPage(
    db,
    owner,
    { graph, encryptionKey: KEY },
    {
      userToken: "fake-user-token",
      pageId: page.id,
    },
  );
  const deps = { graph, encryptionKey: KEY, storage };
  return {
    db,
    graph,
    deps,
    owner,
    marketer: contextFor(tenant.id, user.id, "marketer"),
    agent: contextFor(tenant.id, user.id, "customer_service"),
  };
}

async function approvedPost(
  s: Awaited<ReturnType<typeof store>>,
  input: { channel: string; format?: string; photos: Uint8Array[]; plannedFor?: string },
) {
  const fileIds: string[] = [];
  for (const [index, photo] of input.photos.entries()) {
    fileIds.push(
      (await addLibraryFile(s.db, s.owner, { storage }, photo, { title: `Photo ${index}` })).id,
    );
  }
  const { id } = await createPost(s.db, s.marketer, {
    title: `Post ${randomUUID().slice(0, 4)}`,
    channel: input.channel,
    format: input.format ?? "post",
    caption: "New summer totes, $4 delivery anywhere in Lebanon.",
    plannedFor: input.plannedFor ?? "",
    fileIds,
  });
  await movePost(s.db, s.marketer, id, "submit");
  await movePost(s.db, s.owner, id, "approve");
  return id;
}

beforeAll(async () => {
  square = await makeTestImage({ width: 800, height: 800 });
  tall = await makeTestImage({ width: 400, height: 1200 });
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("publishing approved posts", () => {
  it("publishes an approved Instagram carousel as JPEG copies, once", async () => {
    const s = await store("a", "4");
    const id = await approvedPost(s, {
      channel: "instagram",
      format: "carousel",
      photos: [square, square],
    });
    await expect(publishPostNow(s.db, s.agent, s.deps, id)).rejects.toBeInstanceOf(ForbiddenError);

    const result = await publishPostNow(s.db, s.marketer, s.deps, id);
    expect(result).toMatchObject({ ok: true, url: expect.stringContaining("instagram.com") });
    const sent = s.graph.published.at(-1)!;
    expect(sent.channel).toBe("instagram");
    expect(sent.caption).toContain("summer totes");
    expect(sent.imageUrls).toHaveLength(2);
    expect(sent.imageUrls.every((url) => /\/social-[0-9a-f]{16}\.jpg$/.test(url))).toBe(true);

    const post = await getPost(s.db, s.marketer, id);
    expect(post).toMatchObject({ status: "published", publishError: null, autoPublish: false });
    expect(post.publishedUrl).toContain("instagram.com");
    // Never twice.
    await expect(publishPostNow(s.db, s.marketer, s.deps, id)).rejects.toBeInstanceOf(PublishError);
    expect(s.graph.published).toHaveLength(1);
  });

  it("refuses what Instagram would refuse, and keeps Meta's reason on failure", async () => {
    const s = await store("b", "5");
    const id = await approvedPost(s, { channel: "instagram", photos: [tall] });
    const shape = await publishPostNow(s.db, s.marketer, s.deps, id);
    expect(shape).toMatchObject({ ok: false, error: expect.stringContaining("shape") });
    expect((await getPost(s.db, s.marketer, id)).status).toBe("approved");

    const fb = await approvedPost(s, { channel: "facebook", photos: [tall] });
    s.graph.failWith = "(#200) The user hasn't authorized the application to perform this action";
    const failed = await publishPostNow(s.db, s.marketer, s.deps, fb);
    expect(failed).toMatchObject({ ok: false, error: expect.stringContaining("authorized") });
    expect((await getPost(s.db, s.marketer, fb)).publishError).toContain("authorized");
    s.graph.failWith = null;
    // Facebook takes any shape.
    expect(await publishPostNow(s.db, s.marketer, s.deps, fb)).toMatchObject({ ok: true });
    expect(s.graph.published.at(-1)!.channel).toBe("facebook");

    expect(
      publishBlocker({ channel: "tiktok", format: "post", files: [{ kind: "image" }] }),
    ).toMatch(/by hand/);
    expect(
      publishBlocker({ channel: "instagram", format: "reel", files: [{ kind: "video" }] }),
    ).toMatch(/by hand/);
  });

  it("publishes scheduled posts when their time comes, at most three tries", async () => {
    const s = await store("c", "6");
    const id = await approvedPost(s, {
      channel: "instagram",
      photos: [square],
      plannedFor: "2026-01-05T10:00",
    });
    const later = await approvedPost(s, {
      channel: "instagram",
      photos: [square],
      plannedFor: "2099-01-05T10:00",
    });
    await expect(setAutoPublish(s.db, s.agent, id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await setAutoPublish(s.db, s.marketer, id, true);
    await setAutoPublish(s.db, s.marketer, later, true);

    expect(await publishDuePosts(s.db, s.deps)).toEqual({ published: 1, failed: 0 });
    expect((await getPost(s.db, s.marketer, id)).status).toBe("published");
    expect((await getPost(s.db, s.marketer, later)).status).toBe("approved");

    // Failing scheduled post: tried three times, then left for a person.
    const flaky = await approvedPost(s, {
      channel: "facebook",
      photos: [square],
      plannedFor: "2026-01-05T11:00",
    });
    await setAutoPublish(s.db, s.marketer, flaky, true);
    s.graph.failWith = "temporarily unavailable";
    for (let i = 0; i < 4; i += 1) await publishDuePosts(s.db, s.deps);
    const after = await getPost(s.db, s.marketer, flaky);
    expect(after).toMatchObject({ status: "approved", autoPublish: false, publishAttempts: 3 });
    s.graph.failWith = null;

    // Editing an approved post sends it back to draft and unschedules it.
    await updatePost(s.db, s.marketer, later, {
      title: "Changed",
      channel: "instagram",
      format: "post",
      caption: "Changed caption",
      plannedFor: "2099-01-05T10:00",
    });
    expect(await getPost(s.db, s.marketer, later)).toMatchObject({
      status: "draft",
      autoPublish: false,
    });
    await expect(setAutoPublish(s.db, s.marketer, later, true)).rejects.toThrow(/approved/);
  });

  it("keeps each store's publishing to itself", async () => {
    const a = await store("d", "7");
    const b = await store("e", "8");
    const id = await approvedPost(a, { channel: "instagram", photos: [square] });
    await expect(publishPostNow(b.db, b.marketer, b.deps, id)).rejects.toThrow();
    expect(b.graph.published).toHaveLength(0);
  });
});
