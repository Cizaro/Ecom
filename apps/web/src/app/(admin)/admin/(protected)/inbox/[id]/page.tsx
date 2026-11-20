import { getConversationForStaff, getSupportAi, hasPermission } from "@ecom/core";
import { Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm, CheckboxField, TextAreaField } from "../../../_components/form";
import {
  dismissSupportDraftAction,
  draftSupportReplyAction,
  replyToConversationStaffAction,
  retrySocialReplyAction,
  updateConversationAction,
} from "../actions";
import { CATEGORY_LABEL, CHANNEL_LABEL } from "../labels";

export const metadata: Metadata = { title: "Conversation" };

const LABEL = { open: "To answer", waiting: "Waiting for customer", closed: "Closed" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("inbox.read");
  const { id } = await params;
  const db = tenantDb(context);
  const [conversation, ai] = await Promise.all([
    orNotFound(getConversationForStaff(db, context, id)),
    orNotFound(getSupportAi(db, context, id)),
  ]);
  const canReply = hasPermission(context, "inbox.reply");
  const canDraft = canReply && hasPermission(context, "ai.use");
  const canSeeCustomer = hasPermission(context, "customers.read");
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
  const mine = conversation.assignedUserId === context.userId;
  const social = conversation.channel !== "web";
  const where = CHANNEL_LABEL[conversation.channel];
  const replyHow = !social
    ? "Your reply is emailed to the customer."
    : conversation.kind === "comment"
      ? `Your reply is posted publicly under the comment on ${where}. Everyone can see it.`
      : `Your reply is sent as a direct message on ${where}. Meta allows replies within 24 hours of the customer's last message.`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={conversation.subject}
        description={
          <>
            {conversation.name}
            {conversation.email ? ` · ${conversation.email}` : ""}
            {conversation.customerId && canSeeCustomer ? (
              <>
                {" · "}
                <Link
                  href={`/admin/customers/${conversation.customerId}`}
                  className="underline underline-offset-4"
                >
                  Customer profile
                </Link>
              </>
            ) : null}
            {conversation.order ? (
              <>
                {" · "}
                <Link
                  href={`/admin/orders/${conversation.order.id}`}
                  className="underline underline-offset-4"
                >
                  Order #{conversation.order.number}
                </Link>
              </>
            ) : null}
            {" · "}
            <Link href="/admin/inbox" className="underline underline-offset-4">
              Inbox
            </Link>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="conversation-status">
        <Badge tone={conversation.status === "open" ? "warning" : "neutral"}>
          {LABEL[conversation.status]}
        </Badge>
        {mine ? <Badge tone="success">Yours</Badge> : null}
        <Badge tone="neutral">
          {where}
          {social ? (conversation.kind === "comment" ? " comment" : " message") : ""}
        </Badge>
      </div>

      {ai.category ? (
        <div
          className="flex flex-col gap-2 rounded-card border border-line p-4 text-sm"
          data-testid="support-ai-labels"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">AI sorting:</span>
            <Badge tone={ai.needsPerson || ai.category === "spam" ? "warning" : "neutral"}>
              {CATEGORY_LABEL[ai.category]}
            </Badge>
            {ai.urgency === "high" ? <Badge tone="warning">Urgent</Badge> : null}
          </div>
          {ai.summary ? <p className="text-ink-muted">{ai.summary}</p> : null}
          {ai.needsPerson ? (
            <p className="text-ink-muted" data-testid="support-ai-person">
              A person handles this kind of message personally; check any draft with care.
            </p>
          ) : null}
        </div>
      ) : null}

      <ol className="flex flex-col gap-3" data-testid="staff-messages">
        {conversation.messages.map((message) => (
          <li
            key={message.id}
            className={`rounded-card border p-4 text-sm ${
              message.authorType === "note"
                ? "border-warning-line bg-warning-soft"
                : message.authorType === "staff" || message.authorType === "ai"
                  ? "border-line bg-surface-muted"
                  : "border-line"
            }`}
            data-testid={message.authorType === "note" ? "staff-note" : "staff-message"}
          >
            <p className="mb-1 font-medium">
              {message.authorType === "customer"
                ? conversation.name
                : message.authorType === "note"
                  ? `Note by ${message.authorName} (staff only)`
                  : message.authorType === "ai"
                    ? "Automatic reply by AI"
                    : `${message.authorName} (replied)`}
              <span className="font-normal text-ink-muted">
                {" "}
                · {when.format(message.createdAt)}
              </span>
            </p>
            <p className="whitespace-pre-line">{message.body}</p>
            {message.deliveryStatus ? (
              <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="delivery">
                <Badge
                  tone={
                    message.deliveryStatus === "sent"
                      ? "success"
                      : message.deliveryStatus === "failed"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {message.deliveryStatus === "sent"
                    ? `Sent on ${where}`
                    : message.deliveryStatus === "failed"
                      ? "Not sent"
                      : "Sending"}
                </Badge>
                {message.deliveryError ? (
                  <span className="text-ink-muted">{message.deliveryError}</span>
                ) : null}
                {message.deliveryStatus === "failed" && canReply ? (
                  <ActionForm
                    action={retrySocialReplyAction}
                    submitLabel="Try again"
                    submitTone="secondary"
                    testId="delivery-retry"
                  >
                    <input type="hidden" name="id" value={conversation.id} />
                    <input type="hidden" name="messageId" value={message.id} />
                  </ActionForm>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {canReply ? (
        <>
          <Card
            title="Reply"
            description={
              ai.draft
                ? `The AI drafted this from your shop's facts. Read it, change what you want, then send. Nothing was sent to the customer. ${replyHow}`
                : replyHow
            }
          >
            {ai.draft && ai.draft.citations.length > 0 ? (
              <div className="text-sm" data-testid="support-draft-facts">
                <p className="font-medium">Facts the draft used</p>
                <ul className="mt-1 list-disc ps-5 text-ink-muted">
                  {ai.draft.citations.map((citation) => (
                    <li key={citation.id}>{citation.text}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {ai.draft && !ai.draft.answered ? (
              <p className="text-sm text-ink-muted" data-testid="support-draft-unanswered">
                The shop's facts did not answer this; the draft says so. Add what you know before
                sending.
              </p>
            ) : null}
            <ActionForm
              action={replyToConversationStaffAction}
              submitLabel="Send"
              testId="staff-reply-form"
            >
              <input type="hidden" name="id" value={conversation.id} />
              {ai.draft ? <input type="hidden" name="draftId" value={ai.draft.id} /> : null}
              <TextAreaField
                key={ai.draft?.id ?? "empty"}
                label="Message"
                name="message"
                rows={ai.draft ? 8 : 5}
                maxLength={social ? 1000 : 5000}
                defaultValue={ai.draft?.body ?? ""}
              />
              <CheckboxField
                label="Internal note: only staff see it, nothing is sent to the customer"
                name="internal"
              />
            </ActionForm>
          </Card>
          <div className="flex flex-wrap gap-2">
            {canDraft ? (
              <ActionForm
                action={draftSupportReplyAction}
                submitLabel={ai.draft ? "Draft again with AI" : "Draft a reply with AI"}
                submitTone="secondary"
                testId="support-draft-form"
              >
                <input type="hidden" name="id" value={conversation.id} />
              </ActionForm>
            ) : null}
            {ai.draft ? (
              <ActionForm
                action={dismissSupportDraftAction}
                submitLabel="Dismiss draft"
                submitTone="secondary"
                testId="support-dismiss-form"
              >
                <input type="hidden" name="id" value={conversation.id} />
                <input type="hidden" name="draftId" value={ai.draft.id} />
              </ActionForm>
            ) : null}
            {conversation.status !== "closed" ? (
              <ActionForm
                action={updateConversationAction}
                submitLabel="Close"
                submitTone="secondary"
              >
                <input type="hidden" name="id" value={conversation.id} />
                <input type="hidden" name="status" value="closed" />
              </ActionForm>
            ) : (
              <ActionForm
                action={updateConversationAction}
                submitLabel="Reopen"
                submitTone="secondary"
              >
                <input type="hidden" name="id" value={conversation.id} />
                <input type="hidden" name="status" value="open" />
              </ActionForm>
            )}
            <ActionForm
              action={updateConversationAction}
              submitLabel={mine ? "Give it up" : "Take it"}
              submitTone="secondary"
            >
              <input type="hidden" name="id" value={conversation.id} />
              <input type="hidden" name="assign" value={mine ? "nobody" : "me"} />
            </ActionForm>
          </div>
        </>
      ) : null}
    </div>
  );
}
