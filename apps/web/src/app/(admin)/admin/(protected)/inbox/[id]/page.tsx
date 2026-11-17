import { getConversationForStaff, hasPermission } from "@ecom/core";
import { Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm, CheckboxField, TextAreaField } from "../../../_components/form";
import { replyToConversationStaffAction, updateConversationAction } from "../actions";

export const metadata: Metadata = { title: "Conversation" };

const LABEL = { open: "To answer", waiting: "Waiting for customer", closed: "Closed" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("inbox.read");
  const { id } = await params;
  const conversation = await orNotFound(getConversationForStaff(tenantDb(context), context, id));
  const canReply = hasPermission(context, "inbox.reply");
  const canSeeCustomer = hasPermission(context, "customers.read");
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
  const mine = conversation.assignedUserId === context.userId;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={conversation.subject}
        description={
          <>
            {conversation.name} · {conversation.email}
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
      </div>

      <ol className="flex flex-col gap-3" data-testid="staff-messages">
        {conversation.messages.map((message) => (
          <li
            key={message.id}
            className={`rounded-card border p-4 text-sm ${
              message.authorType === "note"
                ? "border-warning-line bg-warning-soft"
                : message.authorType === "staff"
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
                  : `${message.authorName} (replied)`}
              <span className="font-normal text-ink-muted">
                {" "}
                · {when.format(message.createdAt)}
              </span>
            </p>
            <p className="whitespace-pre-line">{message.body}</p>
          </li>
        ))}
      </ol>

      {canReply ? (
        <>
          <Card title="Reply">
            <ActionForm
              action={replyToConversationStaffAction}
              submitLabel="Send"
              testId="staff-reply-form"
            >
              <input type="hidden" name="id" value={conversation.id} />
              <TextAreaField label="Message" name="message" rows={5} maxLength={5000} />
              <CheckboxField
                label="Internal note: only staff see it, nothing is emailed"
                name="internal"
              />
            </ActionForm>
          </Card>
          <div className="flex flex-wrap gap-2">
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
