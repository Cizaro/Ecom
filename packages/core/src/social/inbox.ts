import { createHash, randomBytes } from "node:crypto";
import type { AppTransaction } from "@ecom/db";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { EMAIL_EVENTS, enqueueStaffEmailsIn } from "../notifications/enqueue";
import { openSecret } from "../platform/secret-box";
import { PAGE_TOKEN_PURPOSE, recordSocialWebhookItems } from "./connections";
import { isMetaError, type MetaGraph } from "./meta-graph";

// The social inbox (Milestone 6.4, decision D113). Instagram and Facebook
// direct messages and comments become conversations in the store's inbox,
// next to the contact form's, so staff use one place with the same rules:
// assignment, internal notes, AI labels and reply drafts, approval before
// anything is sent. A staff reply on a social conversation is sent through
// Meta (direct message, or a public reply under the comment) and its
// delivery is recorded; a failure is shown with Meta's reason and can be
// tried again. Nothing is ever sent without a person pressing Send.

export interface SocialDeps {
  graph: MetaGraph;
  encryptionKey: string;
}

type Channel = "instagram" | "facebook";

interface Parsed {
  threadKey: string;
  kind: "message" | "comment";
  externalId: string;
  userId: string | null;
  username: string | null;
  replyToId: string | null;
  body: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const NUMERIC = /^[0-9]{1,40}$/;
const COMMENT_ID = /^[0-9_]{1,80}$/;

function messageText(text: string, attachments: unknown): string {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (clean) return clean.slice(0, 5000);
  return Array.isArray(attachments) && attachments.length > 0
    ? "[A photo, video or attachment: open it in the app]"
    : "[A message without text]";
}

/**
 * What a stored notification means for the inbox, or null when it is not a
 * customer's message or comment (the shop's own, an edit, a reaction...).
 */
export function interpretSocialEvent(
  event: { channel: string; kind: string; payload: unknown },
  own: { pageId: string; instagramAccountId: string | null },
): Parsed | null {
  const channel = event.channel === "facebook" ? "facebook" : "instagram";
  const payload = event.payload;
  if (!isObject(payload)) return null;
  const ownIds = new Set([own.pageId, own.instagramAccountId].filter(Boolean) as string[]);

  if (event.kind === "message") {
    const message = isObject(payload.message) ? payload.message : null;
    const sender = isObject(payload.sender) ? payload.sender : {};
    const mid = str(message?.mid);
    const senderId = str(sender.id);
    if (!message || !mid || !NUMERIC.test(senderId)) return null;
    if (message.is_echo === true || ownIds.has(senderId)) return null;
    const username = str(sender.username);
    return {
      threadKey: `${channel}:dm:${senderId}`,
      kind: "message",
      externalId: `${channel}:message:${mid}`.slice(0, 300),
      userId: senderId,
      username: username && /^[A-Za-z0-9._]{1,30}$/.test(username) ? username : null,
      replyToId: null,
      body: messageText(str(message.text), message.attachments),
    };
  }

  if (event.kind === "comment" && isObject(payload.value)) {
    const value = payload.value;
    const from = isObject(value.from) ? value.from : {};
    const fromId = str(from.id);
    if (fromId && ownIds.has(fromId)) return null;
    if (channel === "instagram") {
      const id = str(value.id);
      if (!COMMENT_ID.test(id)) return null;
      const parent = str(value.parent_id);
      const root = COMMENT_ID.test(parent) ? parent : id;
      const username = str(from.username);
      return {
        threadKey: `instagram:comment:${root}`,
        kind: "comment",
        externalId: `instagram:comment:${id}`,
        userId: NUMERIC.test(fromId) ? fromId : null,
        username: username && /^[A-Za-z0-9._]{1,30}$/.test(username) ? username : null,
        replyToId: root,
        body: messageText(str(value.text), null),
      };
    }
    // Facebook Page comment: only new ones.
    if (str(value.verb) && str(value.verb) !== "add") return null;
    const id = str(value.comment_id);
    if (!COMMENT_ID.test(id)) return null;
    const parent = str(value.parent_id);
    const post = str(value.post_id);
    const root = COMMENT_ID.test(parent) && parent !== post ? parent : id;
    const name = str(from.name).replace(/\s+/g, " ").trim().slice(0, 100);
    return {
      threadKey: `facebook:comment:${root}`,
      kind: "comment",
      externalId: `facebook:comment:${id}`,
      userId: NUMERIC.test(fromId) ? fromId : null,
      username: name || null,
      replyToId: root,
      body: messageText(str(value.message), null),
    };
  }
  return null;
}

function displayName(channel: Channel, parsed: Parsed): string {
  if (parsed.username) {
    return (channel === "instagram" ? `@${parsed.username}` : parsed.username).slice(0, 100);
  }
  return channel === "instagram" ? "Instagram user" : "Facebook user";
}

function subjectFor(channel: Channel, parsed: Parsed): string {
  const where = channel === "instagram" ? "Instagram" : "Facebook";
  const first = parsed.body.replace(/\s+/g, " ").trim().slice(0, 100);
  return (parsed.kind === "comment" ? `${where} comment: ${first}` : `${where} message: ${first}`)
    .slice(0, 150)
    .trim();
}

async function addToInbox(
  tx: AppTransaction,
  tenantId: string,
  connectionId: string,
  channel: Channel,
  parsed: Parsed,
  occurredAt: Date | null,
): Promise<"new" | "added" | "duplicate"> {
  const existing = await tx.supportMessage.findFirst({
    where: { externalId: parsed.externalId },
    select: { id: true },
  });
  if (existing) return "duplicate";
  const name = displayName(channel, parsed);
  const when = occurredAt ?? new Date();
  const conversation = await tx.supportConversation.findFirst({
    where: { externalThreadKey: parsed.threadKey },
    select: { id: true },
  });
  if (conversation) {
    await tx.supportMessage.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        authorType: "customer",
        authorName: name,
        body: parsed.body,
        externalId: parsed.externalId,
      },
    });
    await tx.supportConversation.update({
      where: { id: conversation.id },
      data: {
        status: "open",
        lastMessageAt: when,
        socialConnectionId: connectionId,
        ...(parsed.username ? { externalUsername: parsed.username, name } : {}),
      },
    });
    return "added";
  }
  const created = await tx.supportConversation.create({
    data: {
      tenantId,
      channel,
      kind: parsed.kind,
      socialConnectionId: connectionId,
      externalThreadKey: parsed.threadKey,
      externalUserId: parsed.userId,
      externalUsername: parsed.username,
      externalReplyToId: parsed.replyToId,
      email: "",
      name,
      subject: subjectFor(channel, parsed),
      // Social conversations have no shopper link; the key only fills the column.
      accessKeyHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      lastMessageAt: when,
      messages: {
        create: [
          {
            tenantId,
            authorType: "customer",
            authorName: name,
            body: parsed.body,
            externalId: parsed.externalId,
          },
        ],
      },
    },
    select: { id: true },
  });
  await enqueueStaffEmailsIn(
    tx,
    tenantId,
    "support",
    EMAIL_EVENTS.staffSupportMessage,
    { conversationId: created.id },
    `support-new:${created.id}`,
  );
  return "new";
}

/**
 * Turns the store's stored notifications into inbox conversations, oldest
 * first, each in its own transaction and once only. For the webhook (right
 * after storing) and the worker.
 */
export async function processSocialEvents(
  db: TenantDb,
  options: { limit?: number } = {},
): Promise<{ processed: number; newConversations: number; messages: number }> {
  const events = await db.run((tx) =>
    tx.socialWebhookEvent.findMany({
      where: { processedAt: null },
      orderBy: { receivedAt: "asc" },
      take: Math.min(Math.max(options.limit ?? 100, 1), 500),
      select: {
        id: true,
        channel: true,
        kind: true,
        payload: true,
        occurredAt: true,
        connection: { select: { id: true, pageId: true, instagramAccountId: true } },
      },
    }),
  );
  const result = { processed: 0, newConversations: 0, messages: 0 };
  for (const event of events) {
    await db.run(async (tx) => {
      const parsed = interpretSocialEvent(event, event.connection);
      if (parsed) {
        const outcome = await addToInbox(
          tx,
          db.tenantId,
          event.connection.id,
          event.channel === "facebook" ? "facebook" : "instagram",
          parsed,
          event.occurredAt,
        );
        if (outcome === "new") result.newConversations += 1;
        if (outcome !== "duplicate") result.messages += 1;
      }
      await tx.socialWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
    });
    result.processed += 1;
  }
  return result;
}

/**
 * The backup check: reads recent Instagram messages and comments from the API
 * and stores the ones not seen yet, then files them in the inbox. Notifications
 * Meta did not send still arrive this way.
 */
export async function checkInstagramNow(
  db: TenantDb,
  deps: SocialDeps,
): Promise<{ stored: number; newConversations: number }> {
  const connection = await db.run((tx) =>
    tx.socialConnection.findFirst({
      where: { provider: "meta", status: "active", instagramAccountId: { not: null } },
      select: { id: true, pageId: true, instagramAccountId: true, accessTokenEncrypted: true },
    }),
  );
  if (!connection?.instagramAccountId) return { stored: 0, newConversations: 0 };
  const token = openSecret(deps.encryptionKey, PAGE_TOKEN_PURPOSE, connection.accessTokenEncrypted);
  if (!token) return { stored: 0, newConversations: 0 };
  let items;
  try {
    items = await deps.graph.recentInstagramItems({
      pageId: connection.pageId,
      instagramAccountId: connection.instagramAccountId,
      pageToken: token,
    });
  } catch (error) {
    // An expired or revoked token: the owner must connect again.
    if (isMetaError(error) && error.code === 190) {
      await db.run((tx) =>
        tx.socialConnection.update({
          where: { id: connection.id },
          data: { status: "needs_reconnect" },
        }),
      );
    }
    throw error;
  }
  const stored = await recordSocialWebhookItems(db, connection.id, items.slice(0, 300), {
    touch: false,
  });
  const processed = await processSocialEvents(db);
  return { stored, newConversations: processed.newConversations };
}

// --- Replies ------------------------------------------------------------------

/**
 * Sends a staff reply that was saved as "sending" on a social conversation,
 * and records the outcome. Returns Meta's reason when it failed.
 */
export async function deliverSocialReply(
  db: TenantDb,
  deps: SocialDeps | null,
  messageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const message = await db.run((tx) =>
    tx.supportMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        body: true,
        authorType: true,
        deliveryStatus: true,
        conversation: {
          select: {
            channel: true,
            kind: true,
            externalUserId: true,
            externalReplyToId: true,
            socialConnection: {
              select: { pageId: true, accessTokenEncrypted: true, status: true },
            },
          },
        },
      },
    }),
  );
  if (
    !message ||
    (message.authorType !== "staff" && message.authorType !== "ai") ||
    message.deliveryStatus === "sent"
  ) {
    return { ok: true };
  }
  const conversation = message.conversation;
  const connection = conversation.socialConnection;
  let error: string | null = null;
  let externalId = "";
  const token =
    connection && deps
      ? openSecret(deps.encryptionKey, PAGE_TOKEN_PURPOSE, connection.accessTokenEncrypted)
      : null;
  if (!deps) {
    error = "Meta is not set up for this installation, so the reply could not be sent.";
  } else if (!connection || !token) {
    error = "Instagram and Facebook are not connected any more. Connect again, then try again.";
  } else {
    try {
      if (conversation.kind === "comment") {
        if (!conversation.externalReplyToId) throw new Error("no comment to reply to");
        externalId = await deps!.graph.replyToComment({
          channel: conversation.channel === "facebook" ? "facebook" : "instagram",
          commentId: conversation.externalReplyToId,
          pageToken: token,
          text: message.body,
        });
      } else {
        if (!conversation.externalUserId) throw new Error("no recipient");
        externalId = await deps!.graph.sendMessage({
          pageId: connection.pageId,
          pageToken: token,
          recipientId: conversation.externalUserId,
          text: message.body,
        });
      }
    } catch (caught) {
      error = isMetaError(caught)
        ? caught.message
        : "The reply could not be sent. Try again in a minute.";
    }
  }
  const record = (withId: boolean) =>
    db.run((tx) =>
      tx.supportMessage.update({
        where: { id: message.id },
        data: error
          ? { deliveryStatus: "failed", deliveryError: error.slice(0, 500) }
          : {
              deliveryStatus: "sent",
              deliveryError: null,
              ...(externalId && withId
                ? { externalId: `${conversation.channel}:sent:${externalId}`.slice(0, 300) }
                : {}),
            },
      }),
    );
  // The platform's id is kept when it is new; a repeated one is not worth an error.
  await record(true).catch((caught: unknown) => {
    const code = (caught as { code?: string } | null)?.code;
    if (code !== "P2002") throw caught;
    return record(false);
  });
  return error ? { ok: false, error } : { ok: true };
}

/** Tries a failed social reply again (inbox.reply). */
export async function retrySocialReply(
  db: TenantDb,
  context: RequestContext,
  deps: SocialDeps | null,
  messageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  assertPermission(context, "inbox.reply");
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) throw new NotFoundError("message");
  const found = await db.run(async (tx) => {
    const row = await tx.supportMessage.findUnique({
      where: { id: messageId },
      select: { id: true, deliveryStatus: true, conversationId: true },
    });
    if (!row || row.deliveryStatus !== "failed") return null;
    await tx.supportMessage.update({
      where: { id: row.id },
      data: { deliveryStatus: "sending", deliveryError: null },
    });
    await audit(tx, context, "support.reply_retried", {
      type: "support_conversation",
      id: row.conversationId,
    });
    return row;
  });
  if (!found) throw new NotFoundError("message");
  return deliverSocialReply(db, deps, messageId);
}
