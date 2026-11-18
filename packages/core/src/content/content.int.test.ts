import { randomUUID } from "node:crypto";
import { createGateway, createMockProvider, dollarsToMicros } from "@ecom/ai";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { makeTestImage, makeTestVideo } from "@ecom/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { createAiLedger } from "../ai/ai-admin";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { createMemoryStorage } from "../storage/storage";
import { addLibraryFile, listLibrary, updateLibraryFile } from "./library";
import {
  createPost,
  deletePost,
  draftPostCaption,
  getPost,
  listPosts,
  movePost,
  postCalendar,
  updatePost,
} from "./posts";

// The content library and posts against the real (test) database, on the
// runtime connection. Files go to storage in memory; AI is the stand-in.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];
const storage = createMemoryStorage();
let photo: Uint8Array;

function contextFor(tenantId: string, userId: string, role: SystemRoleKey): RequestContext {
  return {
    requestId: `req-${run}`,
    ip: "203.0.113.99",
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
    data: { name: `Content ${label} ${run}`, slug: `content-${label}-${run}` },
  });
  tenantIds.push(tenant.id);
  await admin.store.create({
    data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main", timezone: "Asia/Beirut" },
  });
  const user = await admin.user.create({
    data: { email: `content-${label}-${run}@example.test`, name: label },
  });
  userIds.push(user.id);
  const product = await admin.product.create({
    data: { tenantId: tenant.id, name: "Leather Tote", slug: "leather-tote", status: "active" },
  });
  await admin.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `CT-${label}-${run}`,
      priceAmount: 8900,
      currency: "USD",
      color: "Black",
    },
  });
  const as = (role: SystemRoleKey) => {
    const context = contextFor(tenant.id, user.id, role);
    return { context, db: createTenantDb(app, context) };
  };
  return { tenantId: tenant.id, productId: product.id, owner: as("store_owner"), as };
}

beforeAll(async () => {
  photo = await makeTestImage({ width: 600, height: 600 });
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("content library", () => {
  it("keeps photos and videos with their notes, and archives them", async () => {
    const s = await store("library");
    const { db, context } = s.owner;
    const image = await addLibraryFile(db, context, { storage }, photo, {
      title: "Tote on the beach",
      tags: "Summer, totes, summer",
      usageNote: "Our own photo",
    });
    await addLibraryFile(db, context, { storage }, makeTestVideo({ width: 720, height: 1280 }), {
      title: "Unboxing clip",
    });
    const items = await listLibrary(db, context);
    expect(items.map((i) => [i.title, i.kind])).toEqual([
      ["Unboxing clip", "video"],
      ["Tote on the beach", "image"],
    ]);
    expect(items[1]!.tags).toEqual(["summer", "totes"]);
    expect((await listLibrary(db, context, { tag: "totes" })).map((i) => i.id)).toEqual([image.id]);

    await updateLibraryFile(db, context, image.id, { title: "Tote on the beach", archived: "on" });
    expect((await listLibrary(db, context)).map((i) => i.title)).toEqual(["Unboxing clip"]);
    expect((await listLibrary(db, context, { archived: true })).map((i) => i.id)).toEqual([
      image.id,
    ]);

    await expect(
      addLibraryFile(db, context, { storage }, new Uint8Array([1, 2, 3]), { title: "Broken" }),
    ).rejects.toThrow(/photo \(JPEG, PNG or WebP\) or a video/);
  });
});

describe("content posts", () => {
  it("goes from draft to review to approved to published, with the right people", async () => {
    const s = await store("flow");
    const editor = s.as("content_editor");
    const file = await addLibraryFile(editor.db, editor.context, { storage }, photo, {
      title: "Tote",
    });
    const { id } = await createPost(editor.db, editor.context, {
      title: "Summer totes",
      channel: "instagram",
      format: "post",
      plannedFor: "2026-12-05T18:00",
      fileIds: [file.id],
      productIds: [s.productId],
    });
    // 18:00 in Beirut (UTC+2 in December) is 16:00 UTC.
    expect((await getPost(editor.db, editor.context, id)).plannedFor?.toISOString()).toBe(
      "2026-12-05T16:00:00.000Z",
    );
    // No caption, no review.
    await expect(movePost(editor.db, editor.context, id, "submit")).rejects.toThrow(/caption/);

    const drafted = await draftPostCaption(
      editor.db,
      editor.context,
      createGateway({
        provider: createMockProvider(),
        ledger: createAiLedger(app, null),
        model: "mock",
        globalPaused: false,
        platformMonthlyBudgetMicros: dollarsToMicros(50),
      }),
      id,
      { language: "en" },
    );
    expect(drafted).toMatchObject({ ok: true });
    const caption = drafted.ok ? drafted.caption : "";
    expect(caption).toMatch(/Leather Tote: Price: \$89\.00/);

    const input = {
      title: "Summer totes",
      channel: "instagram",
      format: "post",
      caption,
      plannedFor: "2026-12-05T18:00",
      fileIds: [file.id],
      productIds: [s.productId],
    };
    await updatePost(editor.db, editor.context, id, input);
    await movePost(editor.db, editor.context, id, "submit");

    // The content editor cannot approve.
    await expect(movePost(editor.db, editor.context, id, "approve")).rejects.toThrow(
      ForbiddenError,
    );
    // The owner asks for a change, with a note.
    await expect(movePost(s.owner.db, s.owner.context, id, "request_changes")).rejects.toThrow(
      /what should change/,
    );
    await movePost(s.owner.db, s.owner.context, id, "request_changes", {
      note: "Add the colours.",
    });
    expect(await getPost(editor.db, editor.context, id)).toMatchObject({
      status: "changes_requested",
      reviewNote: "Add the colours.",
    });

    await updatePost(editor.db, editor.context, id, { ...input, caption: `${caption} Black.` });
    await movePost(editor.db, editor.context, id, "submit");
    await movePost(s.owner.db, s.owner.context, id, "approve");
    expect(await getPost(editor.db, editor.context, id)).toMatchObject({
      status: "approved",
      approvedBy: "flow",
    });

    // Editing an approved post sends it back for approval.
    expect(
      await updatePost(editor.db, editor.context, id, { ...input, caption: "Changed" }),
    ).toEqual({
      backToDraft: true,
    });
    expect((await getPost(editor.db, editor.context, id)).status).toBe("draft");
    await movePost(editor.db, editor.context, id, "submit");
    await movePost(s.owner.db, s.owner.context, id, "approve");

    await expect(
      movePost(s.owner.db, s.owner.context, id, "publish", { url: "http://insecure.example" }),
    ).rejects.toThrow(/https/);
    await movePost(s.owner.db, s.owner.context, id, "publish", {
      url: "https://instagram.com/p/abc",
    });
    const published = await getPost(editor.db, editor.context, id);
    expect(published).toMatchObject({
      status: "published",
      publishedUrl: "https://instagram.com/p/abc",
    });
    await expect(updatePost(editor.db, editor.context, id, input)).rejects.toThrow(
      /published post/,
    );
    await expect(deletePost(editor.db, editor.context, id)).rejects.toThrow(/cannot be deleted/);

    // The calendar of December shows it on its day.
    const december = await postCalendar(editor.db, editor.context, "2026-12");
    expect(december.planned.map((p) => p.id)).toEqual([id]);
    expect((await listPosts(editor.db, editor.context)).counts.published).toBe(1);
  });

  it("belongs to one store and refuses another store's files and products", async () => {
    const a = await store("a");
    const b = await store("b");
    const file = await addLibraryFile(a.owner.db, a.owner.context, { storage }, photo, {
      title: "A",
    });
    const { id } = await createPost(a.owner.db, a.owner.context, {
      title: "A post",
      channel: "facebook",
      format: "post",
    });
    await expect(getPost(b.owner.db, b.owner.context, id)).rejects.toThrow();
    expect((await listLibrary(b.owner.db, b.owner.context)).length).toBe(0);
    await expect(
      createPost(b.owner.db, b.owner.context, {
        title: "B post",
        channel: "facebook",
        format: "post",
        fileIds: [file.id],
        productIds: [a.productId],
      }),
    ).rejects.toThrow(/no longer/);
    // Inventory staff have no content access.
    const stock = a.as("inventory_manager");
    await expect(listPosts(stock.db, stock.context)).rejects.toThrow(ForbiddenError);
  });
});
