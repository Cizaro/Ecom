import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { getConversationForStaff, listConversations, replyAsStaff } from "../support/support";
import { connectMetaPage, recordSocialWebhookItems } from "./connections";
import {
  checkInstagramNow,
  deliverSocialReply,
  processSocialEvents,
  retrySocialReply,
} from "./inbox";
import { createFakeMetaGraph, type MetaPage } from "./meta-graph";
import { parseMetaWebhook } from "./webhook";

// The social inbox against the real (test) database. Meta is the stand-in.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];
const KEY = env.ENCRYPTION_KEY;
const digits =
  String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1e5)).padStart(5, "0");

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

async function connectedStore(label: string, prefix: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Inbox ${label} ${run}`, slug: `inbox-${label}-${run}` },
  });
  tenantIds.push(tenant.id);
  const user = await admin.user.create({
    data: { email: `inbox-${label}-${run}@example.test`, name: `Staff ${label}` },
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
  const connection = await admin.socialConnection.findFirstOrThrow({
    where: { tenantId: tenant.id },
  });
  return {
    db,
    graph,
    page,
    connectionId: connection.id,
    owner,
    agent: contextFor(tenant.id, user.id, "customer_service"),
    inventory: contextFor(tenant.id, user.id, "inventory_manager"),
  };
}

const dm = (igId: string, sender: string, mid: string, text: string) =>
  parseMetaWebhook({
    object: "instagram",
    entry: [
      {
        id: igId,
        messaging: [
          {
            sender: { id: sender },
            recipient: { id: igId },
            timestamp: Date.now(),
            message: { mid, text },
          },
        ],
      },
    ],
  });

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("social inbox", () => {
  it("files Instagram messages in one conversation per person, once each", async () => {
    const s = await connectedStore("a", "4");
    const ig = s.page.instagram!.id;
    await recordSocialWebhookItems(s.db, s.connectionId, dm(ig, "555", `m1-${run}`, "Hi, price?"));
    expect(await processSocialEvents(s.db)).toMatchObject({ newConversations: 1, messages: 1 });
    await recordSocialWebhookItems(s.db, s.connectionId, [
      ...dm(ig, "555", `m2-${run}`, "Do you deliver?"),
      ...dm(ig, "555", `m1-${run}`, "Hi, price?"), // resent: stored once
    ]);
    expect(await processSocialEvents(s.db)).toMatchObject({ newConversations: 0, messages: 1 });
    expect(await processSocialEvents(s.db)).toMatchObject({ processed: 0 });

    const list = await listConversations(s.db, s.agent, { channel: "instagram" });
    expect(list.items).toHaveLength(1);
    const view = await getConversationForStaff(s.db, s.agent, list.items[0]!.id);
    expect(view).toMatchObject({
      channel: "instagram",
      kind: "message",
      status: "open",
      email: "",
    });
    expect(view.messages.map((m) => m.body)).toEqual(["Hi, price?", "Do you deliver?"]);
    // The web filter does not show it.
    expect((await listConversations(s.db, s.agent, { channel: "web" })).items).toHaveLength(0);
  });

  it("sends a staff reply through Meta and records it; a failure can be tried again", async () => {
    const s = await connectedStore("b", "5");
    const ig = s.page.instagram!.id;
    await recordSocialWebhookItems(
      s.db,
      s.connectionId,
      dm(ig, "777", `m3-${run}`, "Is it leather?"),
    );
    await processSocialEvents(s.db);
    const id = (await listConversations(s.db, s.agent, {})).items[0]!.id;
    const deps = { graph: s.graph, encryptionKey: KEY };

    const saved = await replyAsStaff(s.db, s.agent, id, { message: "Yes, real leather." });
    expect(saved.social).toBe(true);
    expect(await deliverSocialReply(s.db, deps, saved.messageId)).toEqual({ ok: true });
    expect(s.graph.sent.at(-1)).toEqual({ kind: "message", to: "777", text: "Yes, real leather." });
    let view = await getConversationForStaff(s.db, s.agent, id);
    expect(view.messages.at(-1)).toMatchObject({ deliveryStatus: "sent", deliveryError: null });
    expect(view.status).toBe("waiting");
    // No email to anyone for a social reply.
    expect(
      await admin.outboxEvent.count({
        where: { tenantId: s.owner.tenantId, type: "email.support_reply" },
      }),
    ).toBe(0);

    s.graph.failWith = "(#10) This message is sent outside of allowed window.";
    const late = await replyAsStaff(s.db, s.agent, id, { message: "Anything else?" });
    const failed = await deliverSocialReply(s.db, deps, late.messageId);
    expect(failed).toMatchObject({ ok: false, error: expect.stringContaining("allowed window") });
    view = await getConversationForStaff(s.db, s.agent, id);
    expect(view.messages.at(-1)).toMatchObject({ deliveryStatus: "failed" });

    s.graph.failWith = null;
    await expect(retrySocialReply(s.db, s.inventory, deps, late.messageId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await retrySocialReply(s.db, s.agent, deps, late.messageId)).toEqual({ ok: true });
    view = await getConversationForStaff(s.db, s.agent, id);
    expect(view.messages.at(-1)).toMatchObject({ deliveryStatus: "sent" });

    // An internal note is never sent.
    const note = await replyAsStaff(s.db, s.agent, id, { message: "Gift wrap", internal: true });
    expect(note.social).toBe(false);
    // Long replies are refused for social channels.
    await expect(replyAsStaff(s.db, s.agent, id, { message: "x".repeat(1001) })).rejects.toThrow(
      /1,000 characters/,
    );
  });

  it("replies to a comment publicly under it, and the backup check finds missed items", async () => {
    const s = await connectedStore("c", "6");
    const ig = s.page.instagram!.id;
    s.graph.pending.push(
      ...parseMetaWebhook({
        object: "instagram",
        entry: [
          {
            id: ig,
            changes: [
              {
                field: "comments",
                value: {
                  id: `7${digits}`,
                  text: "How much?",
                  from: { id: "88", username: "nour" },
                },
              },
            ],
          },
        ],
      }),
    );
    const checked = await checkInstagramNow(s.db, { graph: s.graph, encryptionKey: KEY });
    expect(checked).toEqual({ stored: 1, newConversations: 1 });
    // The backup check is not a notification from Meta.
    const connection = await admin.socialConnection.findUniqueOrThrow({
      where: { id: s.connectionId },
    });
    expect(connection.lastWebhookAt).toBeNull();

    const item = (await listConversations(s.db, s.agent, { channel: "instagram" })).items[0]!;
    const view = await getConversationForStaff(s.db, s.agent, item.id);
    expect(view).toMatchObject({ kind: "comment", name: "@nour" });
    const saved = await replyAsStaff(s.db, s.agent, item.id, { message: "Sent you a DM!" });
    await deliverSocialReply(s.db, { graph: s.graph, encryptionKey: KEY }, saved.messageId);
    expect(s.graph.sent.at(-1)).toEqual({
      kind: "comment",
      to: `7${digits}`,
      text: "Sent you a DM!",
    });
  });

  it("keeps each store's social conversations to itself", async () => {
    const a = await connectedStore("d", "7");
    const b = await connectedStore("e", "8");
    await recordSocialWebhookItems(
      a.db,
      a.connectionId,
      dm(a.page.instagram!.id, "999", `m9-${run}`, "Hello"),
    );
    await processSocialEvents(a.db);
    // Store b's processing never sees store a's notifications.
    expect(await processSocialEvents(b.db)).toMatchObject({ processed: 0 });
    expect((await listConversations(b.db, b.agent, {})).items).toHaveLength(0);
    const id = (await listConversations(a.db, a.agent, {})).items[0]!.id;
    await expect(getConversationForStaff(b.db, b.agent, id)).rejects.toThrow();
  });
});
