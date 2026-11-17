import { randomBytes, randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { addCustomerNote, getCustomerForStaff } from "../customers/profile";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { deliverPendingEmails } from "../notifications/delivery";
import { createMemoryEmailProvider } from "../notifications/email";
import { saveNotificationSettings } from "../notifications/settings";
import {
  getConversationForShopper,
  getConversationForStaff,
  listConversations,
  listCustomerConversations,
  replyAsShopper,
  replyAsStaff,
  startConversation,
  SupportError,
  updateConversation,
} from "./support";

// Support conversations and customer profiles against the real (test)
// database on the runtime connection, so Row-Level Security applies.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];
const SECRET = "s".repeat(40);
const OPTIONS = { appUrl: "http://localhost:3000", accessSecret: SECRET };

async function store(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Support ${label} ${run}`, slug: `sup-${label}-${run}` },
  });
  await admin.store.create({ data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main" } });
  tenantIds.push(tenant.id);
  return {
    tenantId: tenant.id,
    shop: createTenantDb(app, { tenantId: tenant.id }),
    owner: await staff(tenant.id, "store_owner"),
  };
}

async function staff(tenantId: string, role: SystemRoleKey) {
  const user = await admin.user.create({
    data: { email: `sup-${role}-${randomUUID().slice(0, 8)}@example.test`, name: `Rana ${role}` },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId, roleId: roleRow.id },
  });
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.69",
    userId: user.id,
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
  return { context, db: createTenantDb(app, context) };
}

let orderNumber = 9000;
async function orderFor(tenantId: string, email: string, customerId: string | null) {
  orderNumber += 1;
  return admin.order.create({
    data: {
      tenantId,
      number: orderNumber,
      status: "confirmed",
      paymentMethod: "cash_on_delivery",
      customerId,
      email,
      accessKeyHash: randomBytes(32).toString("hex"),
      currency: "USD",
      subtotalAmount: 2500,
      totalAmount: 2500,
      shippingAddress: { fullName: "x", line1: "x", city: "Beirut", country: "LB" },
      payBy: new Date(Date.now() + 86_400_000),
    },
  });
}

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("a guest writing to the store", () => {
  it("gets a private link, staff reply and note, and only the link opens it", async () => {
    const s = await store("guest");
    await saveNotificationSettings(s.owner.db, s.owner.context, {
      orderEmails: "",
      stockEmails: "",
      supportEmails: "help@shop.test",
    });
    await expect(
      startConversation(s.shop, {
        customer: null,
        name: "Lea",
        email: "not-an-email",
        subject: "Hi",
        message: "Hello there",
        accessSecret: SECRET,
      }),
    ).rejects.toThrow(SupportError);

    const order = await orderFor(s.tenantId, "lea@example.test", null);
    const started = await startConversation(s.shop, {
      customer: null,
      name: "Lea Hanna",
      email: " Lea@Example.test ",
      subject: "Where is my bag?",
      message: "Ordered last week.",
      orderNumber: `#${order.number}`,
      accessSecret: SECRET,
    });
    const mail = createMemoryEmailProvider();
    await deliverPendingEmails(s.shop, mail, OPTIONS);
    expect(mail.sent.map((m) => `${m.to} | ${m.subject}`).sort()).toEqual([
      "help@shop.test | New message: Where is my bag?",
      "lea@example.test | We received your message: Where is my bag?",
    ]);
    const received = mail.sent.find((m) => m.to === "lea@example.test")!;
    expect(received.text).toContain(`/support/${started.id}?key=${started.accessKey}`);

    // Only the key opens it.
    await expect(getConversationForShopper(s.shop, started.id, {})).rejects.toThrow(NotFoundError);
    await expect(
      getConversationForShopper(s.shop, started.id, { accessKey: "x".repeat(43) }),
    ).rejects.toThrow(NotFoundError);
    const seen = await getConversationForShopper(s.shop, started.id, {
      accessKey: started.accessKey,
    });
    expect(seen).toMatchObject({
      subject: "Where is my bag?",
      email: "lea@example.test",
      status: "open",
    });
    expect(seen.order?.number).toBe(order.number);

    // Staff note (not seen by the guest, not emailed) and reply (emailed, waiting).
    await replyAsStaff(s.owner.db, s.owner.context, started.id, {
      message: "Courier says Thursday.",
      internal: true,
    });
    await replyAsStaff(s.owner.db, s.owner.context, started.id, {
      message: "It is on its way and should arrive soon.",
    });
    mail.sent.length = 0;
    await deliverPendingEmails(s.shop, mail, OPTIONS);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: "lea@example.test", subject: "Re: Where is my bag?" });
    expect(mail.sent[0]!.text).toContain("It is on its way");
    expect(mail.sent[0]!.text).not.toContain("Thursday");

    const guestView = await getConversationForShopper(s.shop, started.id, {
      accessKey: started.accessKey,
    });
    expect(guestView.status).toBe("waiting");
    expect(guestView.messages.map((m) => m.authorType)).toEqual(["customer", "staff"]);
    const staffView = await getConversationForStaff(s.owner.db, s.owner.context, started.id);
    expect(staffView.messages.map((m) => m.authorType)).toEqual(["customer", "note", "staff"]);
    expect(staffView.assignedUserId).toBe(s.owner.context.userId);

    // The guest answers: back to the store.
    await replyAsShopper(s.shop, started.id, { accessKey: started.accessKey }, "Thank you!");
    expect((await getConversationForStaff(s.owner.db, s.owner.context, started.id)).status).toBe(
      "open",
    );
    // Messages cannot be changed or deleted by the application.
    await expect(
      withTenant(app, { tenantId: s.tenantId }, (tx) =>
        tx.supportMessage.deleteMany({ where: { conversationId: started.id } }),
      ),
    ).rejects.toThrow();
  });

  it("cannot link someone else's order", async () => {
    const s = await store("orders");
    const order = await orderFor(s.tenantId, "owner@example.test", null);
    await expect(
      startConversation(s.shop, {
        customer: null,
        name: "Nosy",
        email: "nosy@example.test",
        subject: "About an order",
        message: "Tell me about it.",
        orderNumber: String(order.number),
        accessSecret: SECRET,
      }),
    ).rejects.toThrow(/could not find that order/);
  });
});

describe("signed-in customers and staff", () => {
  it("keep conversations in the account; staff sort, take and close them", async () => {
    const s = await store("account");
    const customer = await admin.customer.create({
      data: { tenantId: s.tenantId, email: `nour-${run}@example.test`, name: "Nour Saad" },
    });
    const other = await admin.customer.create({
      data: { tenantId: s.tenantId, email: `other-${run}@example.test`, name: "Other" },
    });
    const started = await startConversation(s.shop, {
      customer: { id: customer.id, email: customer.email, name: customer.name },
      subject: "Gift wrapping?",
      message: "Do you wrap gifts?",
      accessSecret: SECRET,
    });
    expect((await listCustomerConversations(s.shop, customer.id)).map((c) => c.id)).toEqual([
      started.id,
    ]);
    // Another customer cannot open it, nor can the key (it belongs to an account).
    await expect(
      getConversationForShopper(s.shop, started.id, { customerId: other.id }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      getConversationForShopper(s.shop, started.id, { accessKey: started.accessKey }),
    ).rejects.toThrow(NotFoundError);

    const inbox = await listConversations(s.owner.db, s.owner.context);
    expect(inbox.counts).toEqual({ open: 1, waiting: 0, closed: 0 });
    await updateConversation(s.owner.db, s.owner.context, started.id, { assign: "me" });
    expect(
      (await listConversations(s.owner.db, s.owner.context, { mine: true })).items.map((c) => c.id),
    ).toEqual([started.id]);
    await updateConversation(s.owner.db, s.owner.context, started.id, { status: "closed" });
    expect((await listConversations(s.owner.db, s.owner.context)).counts.closed).toBe(1);

    // Permissions: customer service can answer; stock staff cannot see the inbox.
    const support = await staff(s.tenantId, "customer_service");
    if (support.context.permissions.has("inbox.reply")) {
      await replyAsStaff(support.db, support.context, started.id, { message: "Yes, we do." });
    }
    const stock = await staff(s.tenantId, "inventory_manager");
    await expect(listConversations(stock.db, stock.context)).rejects.toThrow(ForbiddenError);

    // Another store sees nothing.
    const elsewhere = await store("elsewhere");
    expect((await listConversations(elsewhere.owner.db, elsewhere.owner.context)).items).toEqual(
      [],
    );
    await expect(
      getConversationForStaff(elsewhere.owner.db, elsewhere.owner.context, started.id),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("customer profile", () => {
  it("shows everything that happened, newest first, with staff notes", async () => {
    const s = await store("profile");
    const customer = await admin.customer.create({
      data: { tenantId: s.tenantId, email: `maya-${run}@example.test`, name: "Maya Khoury" },
    });
    const order = await orderFor(s.tenantId, customer.email, customer.id);
    await startConversation(s.shop, {
      customer: { id: customer.id, email: customer.email, name: customer.name },
      subject: "Sizes",
      message: "Is the tote big enough for a laptop?",
      accessSecret: SECRET,
    });
    await addCustomerNote(s.owner.db, s.owner.context, customer.id, "Prefers calls after 5pm.");
    await expect(addCustomerNote(s.owner.db, s.owner.context, customer.id, " ")).rejects.toThrow();

    const profile = await getCustomerForStaff(s.owner.db, s.owner.context, customer.id);
    expect(profile).toMatchObject({ orderCount: 1, spent: { amount: 2500, currency: "USD" } });
    expect(profile.timeline.map((entry) => entry.kind)).toEqual([
      "note",
      "conversation",
      "order",
      "account",
    ]);
    expect(profile.timeline[0]).toMatchObject({
      title: "Note by Rana store_owner",
      detail: "Prefers calls after 5pm.",
    });
    expect(profile.timeline[2]!.href).toBe(`/admin/orders/${order.id}`);

    const stock = await staff(s.tenantId, "inventory_manager");
    await expect(getCustomerForStaff(stock.db, stock.context, customer.id)).rejects.toThrow(
      ForbiddenError,
    );
    const elsewhere = await store("profile-other");
    await expect(
      getCustomerForStaff(elsewhere.owner.db, elsewhere.owner.context, customer.id),
    ).rejects.toThrow(NotFoundError);
    // Notes are a record: not deleted by the application.
    await expect(
      withTenant(app, { tenantId: s.tenantId }, (tx) =>
        tx.customerNote.deleteMany({ where: { customerId: customer.id } }),
      ),
    ).rejects.toThrow();
  });
});
