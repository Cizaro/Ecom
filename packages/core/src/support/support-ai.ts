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
import { parseBranding } from "../tenancy/branding";

// AI in the support inbox (Milestone 5.3, decision D103). Each new customer
// message is labelled for staff (subject, urgency, language, one-line
// summary) and, unless it is spam, abuse or something a person must handle
// personally, a reply is drafted from the shop's facts. Staff read the draft,
// edit it and send it themselves, or dismiss it: the AI never sends anything.
// The labelling runs in the background (the worker), so shoppers never wait.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** No automatic draft: a person handles these from the start. */
const NO_AUTO_DRAFT: readonly MessageCategory[] = ["spam", "abuse", "threat", "legal", "privacy"];

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
          where: { authorType: { in: ["customer", "staff"] } },
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

/** Drafts a reply to the newest customer message and keeps it as the conversation's pending draft. */
async function draftFor(
  db: TenantDb,
  gateway: AiGateway,
  thread: Thread,
  userId: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const newest = newestCustomerMessage(thread);
  if (!newest) return { ok: false, message: "There is no customer message to answer." };
  const earlier = thread.messages
    .filter((message) => message.id !== newest.id)
    .slice(-6)
    .map((message) => ({
      from: message.authorType === "customer" ? ("customer" as const) : ("business" as const),
      text: message.body.slice(0, 4000),
    }));
  const result = await answerCustomerQuestion(db, gateway, {
    question: newest.body.slice(0, 4000),
    language: thread.locale === "ar" ? "ar" : "en",
    history: earlier,
  });
  if (!result.ok) return { ok: false, message: result.message };
  const facts = new Map((result.facts ?? []).map((fact) => [fact.id, fact.text]));
  const citations = result.output.citations.map((id) => ({ id, text: facts.get(id) ?? "" }));
  await db.run(async (tx) => {
    await tx.supportReplyDraft.updateMany({
      where: { conversationId: thread.id, status: "pending" },
      data: { status: "replaced" },
    });
    await tx.supportReplyDraft.create({
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
    });
  });
  return { ok: true };
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
): Promise<{ labelled: number; drafted: number; failed: number }> {
  const counts = { labelled: 0, drafted: 0, failed: 0 };
  if (!(await gateway.available(db.tenantId))) return counts;
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
      { subject: thread.subject, message: newest.body.slice(0, 5000) },
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
  return result;
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
