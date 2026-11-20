import { DEFAULT_LOCALE, type Locale } from "@ecom/i18n";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { AppTransaction } from "@ecom/db";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { normalizeEmail } from "../customers/accounts";
import { EMAIL_EVENTS, enqueueEmailIn, enqueueStaffEmailsIn } from "../notifications/enqueue";

// Support conversations between shoppers and the store. Rules:
//
// - A signed-in customer's conversation belongs to their account; a guest's
//   opens only with the private link emailed to them (derived from a server
//   secret; only its hash is stored), like guest orders.
// - Staff (inbox.read to see, inbox.reply to answer) reply, add internal
//   notes the shopper never sees, change the status and take conversations.
// - Messages and notes are a record: added, never changed or deleted.
// - An order can be linked only if it is the shopper's own (their account's,
//   or for a guest the same email address).
// - Everything stays inside the store's own tenant.

export const SUPPORT_STATUSES = ["open", "waiting", "closed"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export class SupportError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "SupportError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const oneLine = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

/** The key in a guest's private link to a conversation. */
export function supportAccessKey(secret: string, conversationId: string): string {
  return createHmac("sha256", secret).update(`support:${conversationId}`).digest("base64url");
}

function cleanBody(value: unknown): string {
  const body = typeof value === "string" ? value.trim() : "";
  if (body.length < 2) throw new SupportError("Write your message.", "message");
  if (body.length > 5000)
    throw new SupportError("Shorten the message (5,000 characters at most).", "message");
  return body;
}

export interface SupportMessageView {
  id: string;
  /** ai: an automatic reply (D115). */
  authorType: "customer" | "staff" | "note" | "ai";
  authorName: string;
  body: string;
  createdAt: Date;
  /** Staff replies on Instagram or Facebook: sending, sent or failed (D113). */
  deliveryStatus: "sending" | "sent" | "failed" | null;
  deliveryError: string | null;
}

export const SUPPORT_CHANNELS = ["web", "instagram", "facebook"] as const;
export type SupportChannel = (typeof SUPPORT_CHANNELS)[number];

export interface ConversationView {
  id: string;
  subject: string;
  status: SupportStatus;
  name: string;
  email: string;
  customerId: string | null;
  order: { id: string; number: number } | null;
  assignedUserId: string | null;
  createdAt: Date;
  lastMessageAt: Date;
  channel: SupportChannel;
  kind: "message" | "comment";
  externalUsername: string | null;
  messages: SupportMessageView[];
}

const SELECT = {
  id: true,
  subject: true,
  status: true,
  name: true,
  email: true,
  customerId: true,
  assignedUserId: true,
  createdAt: true,
  lastMessageAt: true,
  channel: true,
  kind: true,
  externalUsername: true,
  order: { select: { id: true, number: true } },
  messages: {
    select: {
      id: true,
      authorType: true,
      authorName: true,
      body: true,
      createdAt: true,
      deliveryStatus: true,
      deliveryError: true,
    },
    // IDs are time-ordered (UUID v7), so this keeps messages in the order written.
    orderBy: { id: "asc" as const },
  },
} as const;

async function viewIn(
  tx: AppTransaction,
  id: string,
  withNotes: boolean,
): Promise<ConversationView | null> {
  const row = await tx.supportConversation.findUnique({ where: { id }, select: SELECT });
  if (!row) return null;
  return {
    ...row,
    status: row.status as SupportStatus,
    channel: row.channel as SupportChannel,
    kind: row.kind === "comment" ? "comment" : "message",
    messages: row.messages
      .filter((message) => withNotes || message.authorType !== "note")
      .map((message) => ({
        ...message,
        authorType: message.authorType as SupportMessageView["authorType"],
        deliveryStatus: message.deliveryStatus as SupportMessageView["deliveryStatus"],
      })),
  };
}

// --- Shoppers ------------------------------------------------------------------

/** A shopper starts a conversation. Returns its ID and, for a guest, the link key. */
export async function startConversation(
  db: TenantDb,
  input: {
    customer: { id: string; email: string; name: string } | null;
    name?: unknown;
    email?: unknown;
    subject: unknown;
    message: unknown;
    orderNumber?: unknown;
    accessSecret: string;
    /** The shop language the shopper is using; emails to them are written in it. */
    locale?: Locale;
  },
): Promise<{ id: string; accessKey: string }> {
  const email = input.customer ? input.customer.email : normalizeEmail(input.email);
  if (!email) throw new SupportError("Enter a valid email address so we can reply.", "email");
  const name = oneLine(input.name) || input.customer?.name || "";
  if (!name) throw new SupportError("Enter your name.", "name");
  if (name.length > 100) throw new SupportError("Shorten your name.", "name");
  const subject = oneLine(input.subject);
  if (!subject) throw new SupportError("Enter what your message is about.", "subject");
  if (subject.length > 150)
    throw new SupportError("Shorten the subject (150 characters at most).", "subject");
  const body = cleanBody(input.message);
  const numberText = oneLine(input.orderNumber).replace(/^#/, "");
  if (numberText && !/^\d{1,9}$/.test(numberText)) {
    throw new SupportError(
      "Enter the order number as digits, like 1042, or leave it empty.",
      "orderNumber",
    );
  }
  if (input.accessSecret.length < 32) throw new Error("startConversation: accessSecret too short");

  const id = randomUUID();
  const accessKey = supportAccessKey(input.accessSecret, id);
  await db.run(async (tx) => {
    let orderId: string | null = null;
    if (numberText) {
      const order = await tx.order.findFirst({
        where: { number: Number(numberText) },
        select: { id: true, customerId: true, email: true },
      });
      const own =
        order && (input.customer ? order.customerId === input.customer.id : order.email === email);
      if (!own) {
        throw new SupportError(
          "We could not find that order for you. Check the number, or leave it empty.",
          "orderNumber",
        );
      }
      orderId = order.id;
    }
    await tx.supportConversation.create({
      data: {
        id,
        tenantId: db.tenantId,
        customerId: input.customer?.id ?? null,
        email,
        name,
        subject,
        orderId,
        locale: input.locale ?? DEFAULT_LOCALE,
        accessKeyHash: hash(accessKey),
        messages: {
          create: [{ tenantId: db.tenantId, authorType: "customer", authorName: name, body }],
        },
      },
    });
    await enqueueEmailIn(
      tx,
      db.tenantId,
      EMAIL_EVENTS.supportReceived,
      { conversationId: id },
      `support-received:${id}`,
    );
    await enqueueStaffEmailsIn(
      tx,
      db.tenantId,
      "support",
      EMAIL_EVENTS.staffSupportMessage,
      { conversationId: id },
      `support-new:${id}`,
    );
  });
  return { id, accessKey };
}

/** A conversation as the shopper sees it (no internal notes). Not found unless it is theirs. */
export async function getConversationForShopper(
  db: TenantDb,
  conversationId: string,
  auth: { customerId?: string | null; accessKey?: string | null },
): Promise<ConversationView> {
  if (!UUID.test(conversationId)) throw new NotFoundError("conversation");
  return db.run(async (tx) => {
    const found = await tx.supportConversation.findUnique({
      where: { id: conversationId },
      select: { customerId: true, accessKeyHash: true },
    });
    const allowed =
      found &&
      ((auth.customerId && found.customerId === auth.customerId) ||
        (!found.customerId &&
          auth.accessKey &&
          KEY.test(auth.accessKey) &&
          hash(auth.accessKey) === found.accessKeyHash));
    if (!allowed) throw new NotFoundError("conversation");
    return (await viewIn(tx, conversationId, false))!;
  });
}

/** The shopper answers in their own conversation; it goes back to the store. */
export async function replyAsShopper(
  db: TenantDb,
  conversationId: string,
  auth: { customerId?: string | null; accessKey?: string | null },
  message: unknown,
): Promise<void> {
  const body = cleanBody(message);
  const conversation = await getConversationForShopper(db, conversationId, auth);
  await db.run(async (tx) => {
    await tx.supportMessage.create({
      data: {
        tenantId: db.tenantId,
        conversationId,
        authorType: "customer",
        authorName: conversation.name,
        body,
      },
    });
    await tx.supportConversation.update({
      where: { id: conversationId },
      data: { status: "open", lastMessageAt: new Date() },
    });
    const count = await tx.supportMessage.count({ where: { conversationId } });
    await enqueueStaffEmailsIn(
      tx,
      db.tenantId,
      "support",
      EMAIL_EVENTS.staffSupportMessage,
      { conversationId },
      `support-message:${conversationId}:${count}`,
    );
  });
}

export interface ConversationSummary {
  id: string;
  subject: string;
  status: SupportStatus;
  name: string;
  email: string;
  lastMessageAt: Date;
  assignedUserId: string | null;
  customerId: string | null;
  channel?: string;
  /** AI labels, for staff lists only. */
  aiCategory?: string | null;
  aiUrgency?: string | null;
  aiSummary?: string | null;
}

const SUMMARY = {
  id: true,
  subject: true,
  status: true,
  name: true,
  email: true,
  lastMessageAt: true,
  assignedUserId: true,
  customerId: true,
} as const;

/** A signed-in customer's conversations, newest activity first. */
export async function listCustomerConversations(
  db: TenantDb,
  customerId: string,
): Promise<ConversationSummary[]> {
  const rows = await db.run((tx) =>
    tx.supportConversation.findMany({
      where: { customerId },
      select: SUMMARY,
      orderBy: { lastMessageAt: "desc" },
      take: 50,
    }),
  );
  return rows.map((row) => ({ ...row, status: row.status as SupportStatus }));
}

// --- Staff ---------------------------------------------------------------------

async function staffNameIn(tx: AppTransaction, context: RequestContext): Promise<string> {
  const user = await tx.user.findUnique({
    where: { id: context.userId },
    select: { name: true, email: true },
  });
  return (user?.name || user?.email || "Staff").slice(0, 100);
}

export async function listConversations(
  db: TenantDb,
  context: RequestContext,
  input: { status?: SupportStatus; mine?: boolean; search?: string; channel?: SupportChannel } = {},
): Promise<{ items: ConversationSummary[]; counts: Record<SupportStatus, number> }> {
  assertPermission(context, "inbox.read");
  const status = input.status && SUPPORT_STATUSES.includes(input.status) ? input.status : "open";
  const search = oneLine(input.search).slice(0, 100).toLowerCase();
  return db.run(async (tx) => {
    const groups = await tx.supportConversation.groupBy({ by: ["status"], _count: { _all: true } });
    const counts = { open: 0, waiting: 0, closed: 0 };
    for (const group of groups) counts[group.status as SupportStatus] = group._count._all;
    const rows = await tx.supportConversation.findMany({
      where: {
        status,
        ...(input.channel && SUPPORT_CHANNELS.includes(input.channel)
          ? { channel: input.channel }
          : {}),
        ...(input.mine ? { assignedUserId: context.userId } : {}),
        ...(search
          ? {
              OR: [
                { email: { contains: search } },
                { name: { contains: search, mode: "insensitive" as const } },
                { subject: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: { ...SUMMARY, channel: true, aiCategory: true, aiUrgency: true, aiSummary: true },
      // Waiting longest first, so nobody is forgotten.
      orderBy: { lastMessageAt: status === "open" ? "asc" : "desc" },
      take: 100,
    });
    return { counts, items: rows.map((row) => ({ ...row, status: row.status as SupportStatus })) };
  });
}

export async function getConversationForStaff(
  db: TenantDb,
  context: RequestContext,
  conversationId: string,
): Promise<ConversationView> {
  assertPermission(context, "inbox.read");
  if (!UUID.test(conversationId)) throw new NotFoundError("conversation");
  const view = await db.run((tx) => viewIn(tx, conversationId, true));
  if (!view) throw new NotFoundError("conversation");
  return view;
}

/**
 * Staff answer (sent to the shopper by email, with the conversation then
 * waiting for them), or add an internal note the shopper never sees.
 */
export async function replyAsStaff(
  db: TenantDb,
  context: RequestContext,
  conversationId: string,
  input: {
    message: unknown;
    internal?: boolean;
    /** The AI draft this reply started from, if any (it is then marked sent). */
    draftId?: string;
  },
): Promise<{ messageId: string; social: boolean }> {
  assertPermission(context, "inbox.reply");
  if (!UUID.test(conversationId)) throw new NotFoundError("conversation");
  const body = cleanBody(input.message);
  return db.run(async (tx) => {
    const found = await tx.supportConversation.findUnique({
      where: { id: conversationId },
      select: { id: true, assignedUserId: true, channel: true },
    });
    if (!found) throw new NotFoundError("conversation");
    const social = found.channel !== "web";
    if (social && !input.internal && body.length > 1000) {
      throw new SupportError(
        "Shorten the reply for Instagram and Facebook (1,000 characters at most).",
        "message",
      );
    }
    const authorName = await staffNameIn(tx, context);
    const message = await tx.supportMessage.create({
      data: {
        tenantId: db.tenantId,
        conversationId,
        authorType: input.internal ? "note" : "staff",
        authorUserId: context.userId,
        authorName,
        body,
        // Sent through Meta after this transaction (deliverSocialReply).
        ...(social && !input.internal ? { deliveryStatus: "sending" } : {}),
      },
      select: { id: true },
    });
    if (!input.internal && input.draftId && UUID.test(input.draftId)) {
      const draft = await tx.supportReplyDraft.findFirst({
        where: { id: input.draftId, conversationId, status: "pending" },
        select: { id: true, body: true },
      });
      if (draft) {
        await tx.supportReplyDraft.update({
          where: { id: draft.id },
          data: {
            status: "sent",
            edited: draft.body.trim() !== body,
            decidedByUserId: context.userId,
            decidedAt: new Date(),
          },
        });
      }
    }
    if (!input.internal) {
      await tx.supportConversation.update({
        where: { id: conversationId },
        data: {
          status: "waiting",
          lastMessageAt: new Date(),
          // Whoever answers first takes it.
          ...(found.assignedUserId ? {} : { assignedUserId: context.userId }),
        },
      });
      if (!social) {
        await enqueueEmailIn(
          tx,
          db.tenantId,
          EMAIL_EVENTS.supportReply,
          { conversationId, messageId: message.id },
          `support-reply:${message.id}`,
        );
      }
    }
    await audit(tx, context, input.internal ? "support.note_added" : "support.replied", {
      type: "support_conversation",
      id: conversationId,
    });
    return { messageId: message.id, social: social && !input.internal };
  });
}

/** Closes or reopens a conversation, or takes (or gives up) it. */
export async function updateConversation(
  db: TenantDb,
  context: RequestContext,
  conversationId: string,
  input: { status?: unknown; assign?: "me" | "nobody" },
): Promise<void> {
  assertPermission(context, "inbox.reply");
  if (!UUID.test(conversationId)) throw new NotFoundError("conversation");
  const status =
    input.status === undefined
      ? undefined
      : SUPPORT_STATUSES.find((value) => value === input.status);
  if (input.status !== undefined && !status) throw new SupportError("Choose a status.");
  await db.run(async (tx) => {
    const before = await tx.supportConversation.findUnique({
      where: { id: conversationId },
      select: { status: true, assignedUserId: true },
    });
    if (!before) throw new NotFoundError("conversation");
    const data = {
      ...(status ? { status } : {}),
      ...(input.assign === "me" ? { assignedUserId: context.userId } : {}),
      ...(input.assign === "nobody" ? { assignedUserId: null } : {}),
    };
    await tx.supportConversation.update({ where: { id: conversationId }, data });
    await audit(
      tx,
      context,
      "support.updated",
      { type: "support_conversation", id: conversationId },
      { status: before.status, assignedUserId: before.assignedUserId },
      { status: status ?? before.status, assign: input.assign ?? null },
    );
  });
}
