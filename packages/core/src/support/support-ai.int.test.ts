import { randomUUID } from "node:crypto";
import { createGateway, createMockProvider, dollarsToMicros, type AiProvider } from "@ecom/ai";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { createAiLedger, saveAiSettings } from "../ai/ai-admin";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { listTenantsWithSupportToCheck } from "../platform/support-lookup";
import {
  getConversationForStaff,
  replyAsShopper,
  replyAsStaff,
  startConversation,
  supportAccessKey,
} from "./support";
import {
  checkNewSupportMessages,
  dismissSupportDraft,
  draftSupportReply,
  getSupportAi,
} from "./support-ai";

// AI in the support inbox against the real (test) database, on the runtime
// connection, with the stand-in AI (no outside calls).

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];
const SECRET = "s".repeat(40);

function contextFor(tenantId: string, userId: string, role: SystemRoleKey): RequestContext {
  return {
    requestId: `req-${run}`,
    ip: "203.0.113.95",
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
    data: { name: `Inbox AI ${label} ${run}`, slug: `inbox-ai-${label}-${run}` },
  });
  tenantIds.push(tenant.id);
  await admin.store.create({ data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main" } });
  await admin.shippingZone.create({
    data: {
      tenantId: tenant.id,
      name: "All of Lebanon",
      countries: ["LB"],
      rateAmount: 400,
      currency: "USD",
    },
  });
  const user = await admin.user.create({
    data: { email: `inbox-ai-${label}-${run}@example.test`, name: label },
  });
  userIds.push(user.id);
  const owner = contextFor(tenant.id, user.id, "store_owner");
  return {
    tenantId: tenant.id,
    userId: user.id,
    owner,
    db: createTenantDb(app, owner),
    shop: createTenantDb(app, { tenantId: tenant.id }),
  };
}

const gatewayWith = (provider: AiProvider = createMockProvider()) =>
  createGateway({
    provider,
    ledger: createAiLedger(app, null),
    model: "mock",
    globalPaused: false,
    platformMonthlyBudgetMicros: dollarsToMicros(50),
  });

async function message(shop: ReturnType<typeof createTenantDb>, subject: string, text: string) {
  const started = await startConversation(shop, {
    customer: null,
    name: "Maya",
    email: `maya-${randomUUID().slice(0, 6)}@example.test`,
    subject,
    message: text,
    accessSecret: SECRET,
  });
  return started.id;
}

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("support AI", () => {
  it("labels new messages, drafts replies, and leaves spam undrafted", async () => {
    const s = await store("label");
    const question = await message(s.shop, "Delivery", "How much is delivery to Lebanon?");
    const refund = await message(s.shop, "Broken strap", "I want my money back, the strap broke.");
    const spam = await message(s.shop, "Offer", "Buy cheap followers, click here!");

    expect(await listTenantsWithSupportToCheck(env.DATABASE_ADMIN_URL)).toContain(s.tenantId);
    const result = await checkNewSupportMessages(s.shop, gatewayWith());
    expect(result).toEqual({ labelled: 3, drafted: 2, failed: 0, autoSent: 0 });

    const q = await getSupportAi(s.db, s.owner, question);
    expect(q).toMatchObject({ category: "question", urgency: "normal", needsPerson: false });
    expect(q.draft?.body).toMatch(/Delivery to All of Lebanon costs \$4\.00/);
    expect(q.draft?.citations[0]?.id).toBe("delivery:all-of-lebanon");

    const r = await getSupportAi(s.db, s.owner, refund);
    expect(r).toMatchObject({ category: "refund", urgency: "high", needsPerson: true });
    const sp = await getSupportAi(s.db, s.owner, spam);
    expect(sp).toMatchObject({ category: "spam", draft: null });

    // Nothing new: the next pass does nothing.
    expect(await checkNewSupportMessages(s.shop, gatewayWith())).toEqual({
      labelled: 0,
      drafted: 0,
      failed: 0,
      autoSent: 0,
    });
  });

  it("sending from a draft marks it sent and notes staff edits; drafts can be dismissed", async () => {
    const s = await store("send");
    const id = await message(s.shop, "Delivery", "How much is delivery to Lebanon?");
    await checkNewSupportMessages(s.shop, gatewayWith());
    const { draft } = await getSupportAi(s.db, s.owner, id);
    await replyAsStaff(s.db, s.owner, id, {
      message: `${draft!.body} Thank you!`,
      draftId: draft!.id,
    });
    const sent = await admin.supportReplyDraft.findUniqueOrThrow({ where: { id: draft!.id } });
    expect(sent).toMatchObject({ status: "sent", edited: true, decidedByUserId: s.userId });
    expect((await getSupportAi(s.db, s.owner, id)).draft).toBeNull();

    // A new draft on demand, then dismissed.
    expect(await draftSupportReply(s.db, s.owner, gatewayWith(), id)).toEqual({ ok: true });
    const fresh = (await getSupportAi(s.db, s.owner, id)).draft!;
    await dismissSupportDraft(s.db, s.owner, id, fresh.id);
    expect((await getSupportAi(s.db, s.owner, id)).draft).toBeNull();
  });

  it("does nothing while paused, and gives up on a message after three failed tries", async () => {
    const s = await store("pause");
    await message(s.shop, "Hours", "When are you open?");
    await saveAiSettings(s.db, s.owner, {
      paused: "on",
      monthlyBudgetUsd: "",
      automation: "approval",
    });
    expect(await checkNewSupportMessages(s.shop, gatewayWith())).toEqual({
      labelled: 0,
      drafted: 0,
      failed: 0,
      autoSent: 0,
    });
    expect(await admin.aiEvent.count({ where: { tenantId: s.tenantId } })).toBe(0);

    await saveAiSettings(s.db, s.owner, {
      paused: "",
      monthlyBudgetUsd: "",
      automation: "approval",
    });
    const broken = createMockProvider(() => ({ output: { nonsense: true } }));
    for (let i = 0; i < 3; i++) {
      expect((await checkNewSupportMessages(s.shop, gatewayWith(broken))).failed).toBe(1);
    }
    expect(await checkNewSupportMessages(s.shop, gatewayWith(broken))).toEqual({
      labelled: 0,
      drafted: 0,
      failed: 0,
      autoSent: 0,
    });
  });

  it("replies automatically only when allowed and safe, ten an hour at most", async () => {
    const s = await store("auto");
    // Default (approval): drafts only.
    const first = await message(s.shop, "Delivery", "How much is delivery to Lebanon?");
    expect((await checkNewSupportMessages(s.shop, gatewayWith())).autoSent).toBe(0);
    expect((await getSupportAi(s.db, s.owner, first)).draft).not.toBeNull();

    await saveAiSettings(s.db, s.owner, { paused: "", monthlyBudgetUsd: "", automation: "auto" });
    const question = await message(s.shop, "Delivery", "How much is delivery to Lebanon?");
    const refund = await message(s.shop, "Broken strap", "I want my money back, the strap broke.");
    const hello = await message(s.shop, "Hi", "Hi, how are you?");
    const result = await checkNewSupportMessages(s.shop, gatewayWith());
    // The new question and greeting, plus the one still waiting when it was turned on.
    expect(result.autoSent).toBe(3);

    const sent = await getConversationForStaff(s.db, s.owner, question);
    expect(sent.status).toBe("waiting");
    const reply = sent.messages.at(-1)!;
    expect(reply).toMatchObject({ authorType: "ai", authorName: "Automatic reply" });
    expect(reply.body).toMatch(/\$4\.00/);
    // Emailed to the shopper, recorded in the audit log.
    expect(
      await admin.outboxEvent.count({
        where: { tenantId: s.tenantId, type: "email.support_reply" },
      }),
    ).toBe(3);
    expect(
      await admin.auditLog.count({
        where: { tenantId: s.tenantId, action: "support.auto_replied" },
      }),
    ).toBe(3);
    // Everyday chat is answered too (when the facts do not answer it, the
    // conversation stays "to answer" for staff).
    const greeted = await getConversationForStaff(s.db, s.owner, hello);
    expect(greeted.messages.at(-1)?.authorType).toBe("ai");
    // A refund still waits for a person.
    const waiting = await getConversationForStaff(s.db, s.owner, refund);
    expect(waiting.status).toBe("open");
    expect(waiting.messages.every((m) => m.authorType !== "ai")).toBe(true);

    // A normal back-and-forth keeps getting answers, up to ten automatic
    // replies an hour; then a person answers.
    for (let i = 0; i < 10; i++) {
      await replyAsShopper(
        s.shop,
        question,
        { accessKey: supportAccessKey(SECRET, question) },
        "And delivery to Lebanon again?",
      );
      await checkNewSupportMessages(s.shop, gatewayWith());
    }
    const thread = await getConversationForStaff(s.db, s.owner, question);
    expect(thread.messages.filter((m) => m.authorType === "ai")).toHaveLength(10);
    expect(thread.status).toBe("open");
  });

  it("answers everything the customer wrote since the last reply, not just the last message", async () => {
    const s = await store("two");
    const id = await message(s.shop, "Hi", "How much is delivery to Lebanon?");
    await replyAsShopper(s.shop, id, { accessKey: supportAccessKey(SECRET, id) }, "Hi");
    await checkNewSupportMessages(s.shop, gatewayWith());
    expect((await getSupportAi(s.db, s.owner, id)).draft?.body).toMatch(
      /Delivery to All of Lebanon costs/,
    );
  });

  it("turning automatic replies on answers what is still waiting", async () => {
    const s = await store("catchup");
    const id = await message(s.shop, "Delivery", "How much is delivery to Lebanon?");
    // Seen while automatic replies were off: a draft only.
    await checkNewSupportMessages(s.shop, gatewayWith());
    expect((await getConversationForStaff(s.db, s.owner, id)).messages.at(-1)?.authorType).toBe(
      "customer",
    );
    await saveAiSettings(s.db, s.owner, { paused: "", monthlyBudgetUsd: "", automation: "auto" });
    expect((await checkNewSupportMessages(s.shop, gatewayWith())).autoSent).toBe(1);
    expect((await getConversationForStaff(s.db, s.owner, id)).messages.at(-1)?.authorType).toBe(
      "ai",
    );
    // Saving again (already on) does not answer twice.
    await saveAiSettings(s.db, s.owner, { paused: "", monthlyBudgetUsd: "", automation: "auto" });
    expect((await checkNewSupportMessages(s.shop, gatewayWith())).autoSent).toBe(0);
  });

  it("belongs to one store; drafting needs AI access", async () => {
    const a = await store("a");
    const b = await store("b");
    const id = await message(a.shop, "Delivery", "How much is delivery to Lebanon?");
    await checkNewSupportMessages(a.shop, gatewayWith());
    await expect(getSupportAi(b.db, b.owner, id)).rejects.toThrow();
    // Inventory staff cannot reply; nor can they draft.
    const stock = contextFor(a.tenantId, a.userId, "inventory_manager");
    await expect(
      draftSupportReply(createTenantDb(app, stock), stock, gatewayWith(), id),
    ).rejects.toThrow(ForbiddenError);
  });
});
