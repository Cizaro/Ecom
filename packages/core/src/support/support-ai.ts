import {
  ALWAYS_HUMAN_TOPICS,
  MESSAGE_CATEGORIES,
  type AiGateway,
  type MessageCategory,
} from "@ecom/ai";
import type { Prisma } from "@ecom/db";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { answerCustomerQuestion, getBusinessProfile } from "../ai/ai-admin";
import { createCommerceKnowledge } from "../ai/commerce-knowledge";
import { EMAIL_EVENTS, enqueueEmailIn } from "../notifications/enqueue";
import { recordAudit } from "../platform/audit";
import { deliverSocialReply, type SocialDeps } from "../social/inbox";
import { parseBranding } from "../tenancy/branding";

// AI in the support inbox (Milestone 5.3, decision D103). Each new customer
// message is labelled for staff (subject, urgency, language, one-line
// summary) and, unless it is spam, abuse or something a person must handle
// personally, a reply is drafted from the shop's facts. Staff read the draft,
// edit it and send it themselves, or dismiss it.
// The labelling runs in the background (the worker), so shoppers never wait.
//
// Automatic replies (decisions D115, D116): when the owner chooses "answer alone"
// (AI settings, automation = auto), the AI sends its draft itself when the
// message is a question, an order-status question or everyday conversation
// (a greeting, thanks, small talk), not urgent, the AI did not ask for a
// person, and the conversation has not already had three automatic replies
// in a row. Its reply uses only the shop's facts; when they do not answer
// the question it says so politely and the conversation stays "to answer"
// for staff. Refunds, payment, complaints, legal, privacy, threats, abuse
// and spam always wait for staff. An automatic reply is
// recorded as written by "ai", emailed (contact form) or sent through Meta
// (Instagram, Facebook), and logged; staff see it in the inbox.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** No automatic draft: a person handles these from the start. */
const NO_AUTO_DRAFT: readonly MessageCategory[] = ["spam", "abuse", "threat", "legal", "privacy"];

/** Only these are ever answered automatically. */
const AUTO_REPLY_CATEGORIES: readonly MessageCategory[] = ["question", "order_status", "other"];
/** After this many automatic replies in a row, a person takes over. */
export const MAX_AUTO_REPLIES_IN_A_ROW = 3;

/** The most a background pass looks at per store, to keep within a provider's limits. */
const PER_PASS = 5;
export const SUPPORT_AI_MAX_ATTEMPTS = 3;

export interface SupportAiView {
  category: MessageCategory | null;
  urgency: "normal" | "high" | null;
  summary: string | null;
  /** A person must handle it (refund, complaint, legal, ...). */
  needsPerson: boolean;
  draft: {
    id: string;
    messageId: string;
    body: string;
    citations: { id: string; text: string }[];
    answered: boolean;
    handover: boolean;
    createdAt: Date;
  } | null;
}

const isCategory = (value: unknown): value is MessageCategory =>
  (MESSAGE_CATEGORIES as readonly unknown[]).includes(value);

interface Thread {
  id: string;
  subject: string;
  locale: string;
  messages: { id: string; authorType: string; body: string }[];
}

async function threadIn(db: TenantDb, conversationId: string): Promise<Thread | null> {
  return db.run((tx) =>
    tx.supportConversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        subject: true,
        locale: true,
        messages: {
          where: { authorType: { in: ["customer", "staff", "ai"] } },
          select: { id: true, authorType: true, body: true },
          // IDs are time-ordered (UUID v7).
          orderBy: { id: "asc" },
        },
      },
    }),
  );
}

const newestCustomerMessage = (thread: Thread) =>
  [...thread.messages].reverse().find((message) => message.authorType === "customer");

/**
 * Everything the customer wrote since the business last replied, as one
 * message: people often send "Hi" and their question separately, and the
 * reply must answer all of it. The rest is the earlier conversation.
 */
function unanswered(thread: Thread): { text: string; earlier: Thread["messages"] } {
  let start = thread.messages.length;
  while (start > 0 && thread.messages[start - 1]!.authorType === "customer") start--;
  const waiting = thread.messages.slice(start);
  if (waiting.length === 0) {
    // Already replied to (staff asking for a fresh draft): the newest customer message.
    const last = thread.messages.findLastIndex((message) => message.authorType === "customer");
    return {
      text: last >= 0 ? thread.messages[last]!.body.trim() : "",
      earlier: last >= 0 ? thread.messages.slice(0, last) : thread.messages,
    };
  }
  return {
    text: waiting.map((message) => message.body.trim()).join("\n"),
    earlier: thread.messages.slice(0, start),
  };
}

const ARABIC_LETTERS = /[؀-ۿ]/;

/** Drafts a reply to the newest customer message and keeps it as the conversation's pending draft. */
async function draftFor(
  db: TenantDb,
  gateway: AiGateway,
  thread: Thread,
  userId: string | null,
): Promise<
  | { ok: true; draft: { id: string; body: string; answered: boolean; handover: boolean } }
  | { ok: false; message: string }
> {
  const newest = newestCustomerMessage(thread);
  if (!newest) return { ok: false, message: "There is no customer message to answer." };
  const waiting = unanswered(thread);
  const earlier = waiting.earlier.slice(-6).map((message) => ({
    from: message.authorType === "customer" ? ("customer" as const) : ("business" as const),
    text: message.body.slice(0, 4000),
  }));
  const result = await answerCustomerQuestion(db, gateway, {
    question: waiting.text.slice(0, 4000),
    language: thread.locale === "ar" || ARABIC_LETTERS.test(waiting.text) ? "ar" : "en",
    history: earlier,
  });
  if (!result.ok) return { ok: false, message: result.message };
  const facts = new Map((result.facts ?? []).map((fact) => [fact.id, fact.text]));
  const citations = result.output.citations.map((id) => ({ id, text: facts.get(id) ?? "" }));
  const draft = await db.run(async (tx) => {
    await tx.supportReplyDraft.updateMany({
      where: { conversationId: thread.id, status: "pending" },
      data: { status: "replaced" },
    });
    return tx.supportReplyDraft.create({
      data: {
        tenantId: db.tenantId,
        conversationId: thread.id,
        messageId: newest.id,
        body: result.output.reply,
        citations: citations as unknown as Prisma.InputJsonValue,
        answered: result.output.answered,
        handover: result.output.handover,
        aiEventId: result.eventId,
        createdByUserId: userId,
      },
      select: { id: true, body: true, answered: true, handover: true },
    });
  });
  return { ok: true, draft };
}

/**
 * Sends a draft on the AI's own (automation = auto). Returns the new
 * message when it was saved; the caller sends social ones through Meta.
 */
async function sendAutomatically(
  db: TenantDb,
  conversationId: string,
  draft: { id: string; body: string; answered: boolean },
): Promise<{ messageId: string; social: boolean } | null> {
  return db.run(async (tx) => {
    const conversation = await tx.supportConversation.findUnique({
      where: { id: conversationId },
      select: { channel: true, status: true },
    });
    if (!conversation || conversation.status !== "open") return null;
    const pending = await tx.supportReplyDraft.findFirst({
      where: { id: draft.id, status: "pending" },
      select: { id: true },
    });
    if (!pending) return null;
    // Not more than three automatic replies in a row: then a person answers.
    const recent = await tx.supportMessage.findMany({
      where: { conversationId, authorType: { in: ["staff", "ai"] } },
      orderBy: { id: "desc" },
      take: MAX_AUTO_REPLIES_IN_A_ROW,
      select: { authorType: true },
    });
    if (
      recent.length === MAX_AUTO_REPLIES_IN_A_ROW &&
      recent.every((message) => message.authorType === "ai")
    ) {
      return null;
    }
    const social = conversation.channel !== "web";
    const body = social ? draft.body.slice(0, 1000) : draft.body.slice(0, 5000);
    const message = await tx.supportMessage.create({
      data: {
        tenantId: db.tenantId,
        conversationId,
        authorType: "ai",
        authorName: "Automatic reply",
        body,
        ...(social ? { deliveryStatus: "sending" } : {}),
      },
      select: { id: true },
    });
    await tx.supportReplyDraft.update({
      where: { id: draft.id },
      data: { status: "sent", decidedAt: new Date() },
    });
    await tx.supportConversation.update({
      where: { id: conversationId },
      // Answered from the facts: waiting for the customer. Not answered (a
      // greeting, or "someone will get back to you"): still for staff.
      data: { status: draft.answered ? "waiting" : "open", lastMessageAt: new Date() },
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
    await recordAudit(tx, {
      tenantId: db.tenantId,
      actorType: "system",
      actorUserId: null,
      action: "support.auto_replied",
      entityType: "support_conversation",
      entityId: conversationId,
      after: { channel: conversation.channel, draftId: draft.id },
    });
    return { messageId: message.id, social };
  });
}

/**
 * The background pass for one store: labels new customer messages and drafts
 * replies. Does nothing (and records nothing) while the store's AI is paused
 * or over budget. A message whose labelling keeps failing is given up after
 * three tries.
 */
export async function checkNewSupportMessages(
  db: TenantDb,
  gateway: AiGateway,
  /** To send automatic replies on Instagram and Facebook; null when Meta is not set up. */
  social: SocialDeps | null = null,
): Promise<{ labelled: number; drafted: number; failed: number; autoSent: number }> {
  const counts = { labelled: 0, drafted: 0, failed: 0, autoSent: 0 };
  if (!(await gateway.available(db.tenantId))) return counts;
  const settings = await db.run((tx) =>
    tx.aiSettings.findUnique({ where: { tenantId: db.tenantId }, select: { automation: true } }),
  );
  const automatic = settings?.automation === "auto";
  const conversations = await db.run(
    (tx) =>
      tx.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM support_conversations c
      WHERE c.status = 'open'
        AND c.ai_check_attempts < ${SUPPORT_AI_MAX_ATTEMPTS}
        AND EXISTS (
          SELECT 1 FROM support_messages m
          WHERE m.conversation_id = c.id
            AND m.author_type = 'customer'
            AND (c.ai_checked_message_id IS NULL OR m.id > c.ai_checked_message_id)
        )
      ORDER BY c.last_message_at ASC
      LIMIT ${PER_PASS}`,
  );
  if (conversations.length === 0) return counts;

  const store = await db.run((tx) =>
    tx.store.findFirst({ select: { name: true, branding: true }, orderBy: { createdAt: "asc" } }),
  );
  const profile = await getBusinessProfile(db);
  const knowledge = createCommerceKnowledge(db, {
    name: store?.name ?? "Our store",
    branding: parseBranding(store?.branding ?? {}),
  });

  for (const { id } of conversations) {
    const thread = await threadIn(db, id);
    const newest = thread && newestCustomerMessage(thread);
    if (!thread || !newest) continue;
    const triage = await gateway.run(
      "message.triage",
      { subject: thread.subject, message: unanswered(thread).text.slice(0, 5000) },
      { tenantId: db.tenantId, profile, knowledge },
    );
    if (!triage.ok) {
      counts.failed++;
      await db.run((tx) =>
        tx.supportConversation.update({
          where: { id },
          data: { aiCheckAttempts: { increment: 1 } },
        }),
      );
      continue;
    }
    await db.run((tx) =>
      tx.supportConversation.update({
        where: { id },
        data: {
          aiCategory: triage.output.category,
          aiUrgency: triage.output.urgency,
          aiSummary: triage.output.summary.slice(0, 200),
          aiCheckedMessageId: newest.id,
          aiCheckAttempts: 0,
        },
      }),
    );
    counts.labelled++;
    if (!NO_AUTO_DRAFT.includes(triage.output.category)) {
      const drafted = await draftFor(db, gateway, thread, null);
      if (drafted.ok) counts.drafted++;
      const safe =
        automatic &&
        drafted.ok &&
        AUTO_REPLY_CATEGORIES.includes(triage.output.category) &&
        triage.output.urgency !== "high" &&
        !drafted.draft.handover;
      if (safe && drafted.ok) {
        const sent = await sendAutomatically(db, id, drafted.draft);
        if (sent) {
          counts.autoSent++;
          // Instagram and Facebook replies go out through Meta now (or wait, failed, for staff).
          if (sent.social) await deliverSocialReply(db, social, sent.messageId);
        }
      }
    }
  }
  return counts;
}

// --- Staff ---------------------------------------------------------------------

/** The AI labels and the pending reply draft of one conversation. */
export async function getSupportAi(
  db: TenantDb,
  context: RequestContext,
  conversationId: string,
): Promise<SupportAiView> {
  assertPermission(context, "inbox.read");
  if (!UUID.test(conversationId)) throw new NotFoundError("conversation");
  const row = await db.run((tx) =>
    tx.supportConversation.findUnique({
      where: { id: conversationId },
      select: {
        aiCategory: true,
        aiUrgency: true,
        aiSummary: true,
        replyDrafts: {
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            messageId: true,
            body: true,
            citations: true,
            answered: true,
            handover: true,
            createdAt: true,
          },
        },
      },
    }),
  );
  if (!row) throw new NotFoundError("conversation");
  const category = isCategory(row.aiCategory) ? row.aiCategory : null;
  const draft = row.replyDrafts[0];
  return {
    category,
    urgency: row.aiUrgency === "high" || row.aiUrgency === "normal" ? row.aiUrgency : null,
    summary: row.aiSummary,
    needsPerson:
      category !== null &&
      ((ALWAYS_HUMAN_TOPICS as readonly string[]).includes(category) || category === "abuse"),
    draft: draft
      ? {
          ...draft,
          citations: Array.isArray(draft.citations)
            ? (draft.citations as { id: string; text: string }[])
            : [],
        }
      : null,
  };
}

/** Staff ask for a (new) reply draft. */
export async function draftSupportReply(
  db: TenantDb,
  context: RequestContext,
  gateway: AiGateway,
  conversationId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  assertPermission(context, "inbox.reply");
  assertPermission(context, "ai.use");
  if (!UUID.test(conversationId)) throw new NotFoundError("conversation");
  const thread = await threadIn(db, conversationId);
  if (!thread) throw new NotFoundError("conversation");
  const result = await draftFor(db, gateway, thread, context.userId);
  if (result.ok) {
    await db.run((tx) =>
      audit(tx, context, "support.reply_drafted", {
        type: "support_conversation",
        id: conversationId,
      }),
    );
  }
  return result.ok ? { ok: true } : result;
}

/** Staff set the pending draft aside. */
export async function dismissSupportDraft(
  db: TenantDb,
  context: RequestContext,
  conversationId: string,
  draftId: string,
): Promise<void> {
  assertPermission(context, "inbox.reply");
  if (!UUID.test(conversationId) || !UUID.test(draftId)) throw new NotFoundError("draft");
  await db.run(async (tx) => {
    const changed = await tx.supportReplyDraft.updateMany({
      where: { id: draftId, conversationId, status: "pending" },
      data: { status: "dismissed", decidedByUserId: context.userId, decidedAt: new Date() },
    });
    if (changed.count !== 1) throw new NotFoundError("draft");
    await audit(tx, context, "support.draft_dismissed", {
      type: "support_conversation",
      id: conversationId,
    });
  });
}
